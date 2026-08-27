const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const mysql = require("mysql");
const {createMigrationRunner} = require("../src/routes/api/migrations");

const enabled = process.env.MYSQL_MIGRATION_INTEGRATION === "1";

function query(pool, sql, values = []) {
    return new Promise(function(resolve, reject) {
        pool.query(sql, values, function(error, results) {
            if (error)
                reject(error);
            else
                resolve(results);
        });
    });
}

function end(pool) {
    return new Promise(function(resolve, reject) {
        pool.end(function(error) {
            if (error)
                reject(error);
            else
                resolve();
        });
    });
}

test("non-transactional migrations recover from a partially committed DDL attempt", {
    skip: !enabled
}, async function() {
    const database = process.env.MYSQL_MIGRATION_TEST_DATABASE;
    if (!database || !database.endsWith("_migration_test"))
        throw new Error("MYSQL_MIGRATION_TEST_DATABASE must name a dedicated *_migration_test database");

    const pool = mysql.createPool({
        connectionLimit: 1,
        host: process.env.MYSQL_HOST,
        port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database,
        multipleStatements: true
    });
    const migrations = createMigrationRunner({
        pool,
        lockTimeoutSeconds: 0,
        migrationsDirectory: path.join(
            __dirname,
            "..",
            "test-fixtures",
            "migrations",
            "non-transactional-retry"
        ),
        log: {info: function() {}}
    });

    try {
        await query(
            pool,
            `
                DROP TABLE IF EXISTS MigrationRuns;
                DROP TABLE IF EXISTS Migrations;
                DROP TABLE IF EXISTS MigrationRetryControl;
                DROP TABLE IF EXISTS MigrationRetryTarget;
                CREATE TABLE MigrationRetryTarget (Id INT NOT NULL PRIMARY KEY) ENGINE=InnoDB;
                CREATE TABLE MigrationRetryControl (Attempts INT NOT NULL) ENGINE=InnoDB;
                INSERT INTO MigrationRetryControl (Attempts) VALUES (0);
            `
        );

        await assert.rejects(migrations.up(), function(error) {
            assert.match(error.message, /Migration 1 .* failed/);
            assert.match(error.cause.message, /Intentional failure after the first DDL step/);
            return true;
        });

        const partialColumns = await query(
            pool,
            `
                SELECT COLUMN_NAME
                FROM information_schema.columns
                WHERE TABLE_SCHEMA = DATABASE()
                    AND TABLE_NAME = 'MigrationRetryTarget'
                    AND COLUMN_NAME IN ('FirstStep', 'SecondStep')
                ORDER BY COLUMN_NAME
            `
        );
        assert.deepEqual(
            partialColumns.map((column) => column.COLUMN_NAME),
            ["FirstStep"]
        );

        const failedRuns = await query(
            pool,
            "SELECT Status, Error FROM MigrationRuns WHERE MigrationId = 1"
        );
        assert.equal(failedRuns[0].Status, "failed");
        assert.match(failedRuns[0].Error, /Intentional failure/);
        assert.deepEqual(await query(pool, "SELECT Id FROM Migrations"), []);

        const notificationState = await query(
            pool,
            "SELECT @DISABLE_NOTIFICATIONS AS Disabled"
        );
        assert.equal(notificationState[0].Disabled, null);

        await migrations.up();

        const completedColumns = await query(
            pool,
            `
                SELECT COLUMN_NAME
                FROM information_schema.columns
                WHERE TABLE_SCHEMA = DATABASE()
                    AND TABLE_NAME = 'MigrationRetryTarget'
                    AND COLUMN_NAME IN ('FirstStep', 'SecondStep')
                ORDER BY COLUMN_NAME
            `
        );
        assert.deepEqual(
            completedColumns.map((column) => column.COLUMN_NAME),
            ["FirstStep", "SecondStep"]
        );
        const completedHistory = await query(pool, "SELECT Id FROM Migrations");
        assert.deepEqual(completedHistory.map((migration) => migration.Id), [1]);

        const completedRuns = await query(
            pool,
            `
                SELECT Status, CompletedOn IS NOT NULL AS HasCompletedOn, Error
                FROM MigrationRuns
                WHERE MigrationId = 1
            `
        );
        assert.equal(completedRuns[0].Status, "completed");
        assert.equal(completedRuns[0].HasCompletedOn, 1);
        assert.equal(completedRuns[0].Error, null);

        const attempts = await query(pool, "SELECT Attempts FROM MigrationRetryControl");
        assert.equal(attempts[0].Attempts, 2);
    }
    finally {
        await end(pool);
    }
});

test("email migration reaches its verified schema state and can recover on a second run", {
    skip: !enabled
}, async function() {
    const database = process.env.MYSQL_MIGRATION_TEST_DATABASE;
    if (!database || !database.endsWith("_migration_test"))
        throw new Error("MYSQL_MIGRATION_TEST_DATABASE must name a dedicated *_migration_test database");

    const pool = mysql.createPool({
        connectionLimit: 1,
        host: process.env.MYSQL_HOST,
        port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database,
        multipleStatements: true
    });
    const migrations = createMigrationRunner({
        pool,
        lockTimeoutSeconds: 0,
        migrationsDirectory: path.join(__dirname, "..", "src", "routes", "api", "migrations"),
        log: {info: function() {}}
    });

    try {
        await query(
            pool,
            `
                DROP TABLE IF EXISTS AccountActionTokens;
                DROP TABLE IF EXISTS AccountActionAttempts;
                DROP TABLE IF EXISTS Members;
                DROP TABLE IF EXISTS MigrationRuns;
                DROP TABLE IF EXISTS Migrations;
                CREATE TABLE Members (
                    Id INT NOT NULL AUTO_INCREMENT,
                    Username VARCHAR(64) NOT NULL,
                    Password VARCHAR(255) NOT NULL,
                    PRIMARY KEY (Id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
                INSERT INTO Members (Username, Password) VALUES ('ExistingMember', 'legacy-hash');
                CREATE TABLE Migrations (
                    Id INT NOT NULL,
                    Name VARCHAR(255) NOT NULL,
                    RunOn DATE NOT NULL,
                    PRIMARY KEY (Id)
                ) ENGINE=InnoDB;
                INSERT INTO Migrations (Id, Name, RunOn) VALUES
                    (1, 'legacy', CURDATE()), (2, 'legacy', CURDATE()),
                    (3, 'legacy', CURDATE()), (4, 'legacy', CURDATE()),
                    (5, 'legacy', CURDATE()), (6, 'legacy', CURDATE()),
                    (7, 'legacy', CURDATE());
            `
        );

        await migrations.up();

        const columns = await query(
            pool,
            `
                SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, CHARACTER_SET_NAME
                FROM information_schema.columns
                WHERE TABLE_SCHEMA = DATABASE()
                    AND TABLE_NAME = 'Members'
                    AND COLUMN_NAME IN (
                        'Email', 'NormalizedEmail', 'EmailVerifiedOn',
                        'PendingEmail', 'PendingNormalizedEmail', 'StorageNamespace'
                    )
                ORDER BY COLUMN_NAME
            `
        );
        assert.deepEqual(columns, [
            {COLUMN_NAME: "Email", COLUMN_TYPE: "varchar(254)", IS_NULLABLE: "YES", CHARACTER_SET_NAME: "utf8mb4"},
            {COLUMN_NAME: "EmailVerifiedOn", COLUMN_TYPE: "datetime", IS_NULLABLE: "YES", CHARACTER_SET_NAME: null},
            {COLUMN_NAME: "NormalizedEmail", COLUMN_TYPE: "varchar(254)", IS_NULLABLE: "YES", CHARACTER_SET_NAME: "utf8mb4"},
            {COLUMN_NAME: "PendingEmail", COLUMN_TYPE: "varchar(254)", IS_NULLABLE: "YES", CHARACTER_SET_NAME: "utf8mb4"},
            {COLUMN_NAME: "PendingNormalizedEmail", COLUMN_TYPE: "varchar(254)", IS_NULLABLE: "YES", CHARACTER_SET_NAME: "utf8mb4"},
            {COLUMN_NAME: "StorageNamespace", COLUMN_TYPE: "char(32)", IS_NULLABLE: "YES", CHARACTER_SET_NAME: "ascii"}
        ]);
        const indexes = await query(
            pool,
            `
                SELECT INDEX_NAME, NON_UNIQUE, COLUMN_NAME
                FROM information_schema.statistics
                WHERE TABLE_SCHEMA = DATABASE()
                    AND TABLE_NAME = 'Members'
                    AND INDEX_NAME IN (
                        'UX_Members_NormalizedEmail',
                        'UX_Members_PendingNormalizedEmail',
                        'UX_Members_StorageNamespace'
                    )
                ORDER BY INDEX_NAME
            `
        );
        assert.deepEqual(indexes, [
            {INDEX_NAME: "UX_Members_NormalizedEmail", NON_UNIQUE: 0, COLUMN_NAME: "NormalizedEmail"},
            {INDEX_NAME: "UX_Members_PendingNormalizedEmail", NON_UNIQUE: 0, COLUMN_NAME: "PendingNormalizedEmail"},
            {INDEX_NAME: "UX_Members_StorageNamespace", NON_UNIQUE: 0, COLUMN_NAME: "StorageNamespace"}
        ]);
        assert.deepEqual(
            await query(
                pool,
                `
                    SELECT TABLE_NAME
                    FROM information_schema.tables
                    WHERE TABLE_SCHEMA = DATABASE()
                        AND TABLE_NAME IN ('AccountActionTokens', 'AccountActionAttempts')
                    ORDER BY TABLE_NAME
                `
            ),
            [{TABLE_NAME: "AccountActionAttempts"}, {TABLE_NAME: "AccountActionTokens"}]
        );
        assert.deepEqual(
            await query(pool, "SELECT COUNT(*) AS NullStorageNamespaces FROM Members WHERE StorageNamespace IS NULL"),
            [{NullStorageNamespaces: 0}]
        );

        await query(pool,
            "INSERT INTO Members (Username, Password) VALUES ('RollbackMember', 'legacy-hash')");
        assert.deepEqual(
            await query(pool,
                "SELECT StorageNamespace FROM Members WHERE Username = 'RollbackMember'"),
            [{StorageNamespace: null}],
            "the migrated schema retains the v3.0 registration insert contract"
        );

        await query(
            pool,
            "DELETE FROM MigrationRuns WHERE MigrationId = 8; DELETE FROM Migrations WHERE Id = 8"
        );
        await migrations.up();
        assert.deepEqual(await query(pool, "SELECT Id FROM Migrations WHERE Id = 8"), [{Id: 8}]);
    }
    finally {
        await end(pool);
    }
});

test("Builder storage migration verifies its additive schema and is retry-safe", {
    skip: !enabled
}, async function() {
    const database = process.env.MYSQL_MIGRATION_TEST_DATABASE;
    if (!database || !database.endsWith("_migration_test"))
        throw new Error("MYSQL_MIGRATION_TEST_DATABASE must name a dedicated *_migration_test database");

    const pool = mysql.createPool({
        connectionLimit: 1,
        host: process.env.MYSQL_HOST,
        port: process.env.MYSQL_PORT,
        user: process.env.MYSQL_USER,
        password: process.env.MYSQL_PASSWORD,
        database,
        multipleStatements: true
    });
    const migrations = createMigrationRunner({
        pool,
        lockTimeoutSeconds: 0,
        migrationsDirectory: path.join(__dirname, "..", "src", "routes", "api", "migrations"),
        log: {info: function() {}}
    });

    try {
        await query(
            pool,
            `
                DROP TABLE IF EXISTS BuilderImportReceipts;
                DROP TABLE IF EXISTS AccountPreferences;
                DROP TABLE IF EXISTS BuilderProfiles;
                DROP TABLE IF EXISTS AccountActionTokens;
                DROP TABLE IF EXISTS AccountActionAttempts;
                DROP TABLE IF EXISTS Members;
                DROP TABLE IF EXISTS MigrationRuns;
                DROP TABLE IF EXISTS Migrations;
                CREATE TABLE Members (Id INT NOT NULL AUTO_INCREMENT, PRIMARY KEY (Id)) ENGINE=InnoDB;
                CREATE TABLE Migrations (
                    Id INT NOT NULL,
                    Name VARCHAR(255) NOT NULL,
                    RunOn DATE NOT NULL,
                    PRIMARY KEY (Id)
                ) ENGINE=InnoDB;
                INSERT INTO Migrations (Id, Name, RunOn) VALUES
                    (1, 'legacy', CURDATE()), (2, 'legacy', CURDATE()),
                    (3, 'legacy', CURDATE()), (4, 'legacy', CURDATE()),
                    (5, 'legacy', CURDATE()), (6, 'legacy', CURDATE()),
                    (7, 'legacy', CURDATE()), (8, 'legacy', CURDATE());
                CREATE TABLE BuilderProfiles (
                    Id BIGINT NOT NULL AUTO_INCREMENT,
                    PublicId CHAR(36) CHARACTER SET ascii NOT NULL,
                    MemberId INT NOT NULL,
                    Name TEXT NOT NULL,
                    ActiveNameHash BINARY(32) NULL,
                    Payload MEDIUMTEXT NULL,
                    PayloadVersion SMALLINT NULL,
                    PayloadBytes INT NOT NULL DEFAULT 0,
                    Revision BIGINT NOT NULL DEFAULT 1,
                    CreatedOn DATETIME NOT NULL,
                    UpdatedOn DATETIME NOT NULL,
                    DeletedOn DATETIME NULL,
                    PRIMARY KEY (Id),
                    UNIQUE KEY UX_BuilderProfiles_PublicId (PublicId),
                    UNIQUE KEY UX_BuilderProfiles_ActiveName (MemberId, ActiveNameHash),
                    KEY IX_BuilderProfiles_MemberUpdated (MemberId, UpdatedOn),
                    CONSTRAINT FK_BuilderProfiles_Members FOREIGN KEY (MemberId) REFERENCES Members (Id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            `
        );

        await migrations.up();

        assert.deepEqual(
            await query(
                pool,
                `
                    SELECT TABLE_NAME
                    FROM information_schema.tables
                    WHERE TABLE_SCHEMA = DATABASE()
                        AND TABLE_NAME IN (
                            'BuilderProfiles', 'AccountPreferences', 'BuilderImportReceipts'
                        )
                    ORDER BY TABLE_NAME
                `
            ),
            [
                {TABLE_NAME: "AccountPreferences"},
                {TABLE_NAME: "BuilderImportReceipts"},
                {TABLE_NAME: "BuilderProfiles"}
            ]
        );
        assert.deepEqual(
            await query(
                pool,
                `
                    SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, CHARACTER_SET_NAME
                    FROM information_schema.columns
                    WHERE TABLE_SCHEMA = DATABASE()
                        AND (
                            (TABLE_NAME = 'BuilderProfiles' AND COLUMN_NAME IN (
                                'ActiveNameHash', 'Payload', 'PayloadBytes', 'DeletedOn'
                            ))
                            OR (TABLE_NAME = 'AccountPreferences' AND COLUMN_NAME = 'Payload')
                            OR (TABLE_NAME = 'BuilderImportReceipts' AND COLUMN_NAME IN (
                                'IdempotencyKey', 'ResultPayload'
                            ))
                        )
                    ORDER BY TABLE_NAME, COLUMN_NAME
                `
            ),
            [
                {TABLE_NAME: "AccountPreferences", COLUMN_NAME: "Payload", COLUMN_TYPE: "json", IS_NULLABLE: "NO", CHARACTER_SET_NAME: "utf8mb4"},
                {TABLE_NAME: "BuilderImportReceipts", COLUMN_NAME: "IdempotencyKey", COLUMN_TYPE: "char(64)", IS_NULLABLE: "NO", CHARACTER_SET_NAME: "ascii"},
                {TABLE_NAME: "BuilderImportReceipts", COLUMN_NAME: "ResultPayload", COLUMN_TYPE: "json", IS_NULLABLE: "NO", CHARACTER_SET_NAME: "utf8mb4"},
                {TABLE_NAME: "BuilderProfiles", COLUMN_NAME: "ActiveNameHash", COLUMN_TYPE: "binary(32)", IS_NULLABLE: "YES", CHARACTER_SET_NAME: null},
                {TABLE_NAME: "BuilderProfiles", COLUMN_NAME: "DeletedOn", COLUMN_TYPE: "datetime", IS_NULLABLE: "YES", CHARACTER_SET_NAME: null},
                {TABLE_NAME: "BuilderProfiles", COLUMN_NAME: "Payload", COLUMN_TYPE: "mediumtext", IS_NULLABLE: "YES", CHARACTER_SET_NAME: "utf8mb4"},
                {TABLE_NAME: "BuilderProfiles", COLUMN_NAME: "PayloadBytes", COLUMN_TYPE: "int", IS_NULLABLE: "NO", CHARACTER_SET_NAME: null}
            ]
        );
        assert.deepEqual(
            await query(
                pool,
                `
                    SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, COLUMN_NAME, SEQ_IN_INDEX
                    FROM information_schema.statistics
                    WHERE TABLE_SCHEMA = DATABASE()
                        AND (
                            (TABLE_NAME = 'BuilderProfiles' AND INDEX_NAME = 'UX_BuilderProfiles_ActiveName')
                            OR (TABLE_NAME = 'BuilderImportReceipts' AND INDEX_NAME = 'UX_BuilderImportReceipts_Key')
                        )
                    ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX
                `
            ),
            [
                {TABLE_NAME: "BuilderImportReceipts", INDEX_NAME: "UX_BuilderImportReceipts_Key", NON_UNIQUE: 0, COLUMN_NAME: "MemberId", SEQ_IN_INDEX: 1},
                {TABLE_NAME: "BuilderImportReceipts", INDEX_NAME: "UX_BuilderImportReceipts_Key", NON_UNIQUE: 0, COLUMN_NAME: "IdempotencyKey", SEQ_IN_INDEX: 2},
                {TABLE_NAME: "BuilderProfiles", INDEX_NAME: "UX_BuilderProfiles_ActiveName", NON_UNIQUE: 0, COLUMN_NAME: "MemberId", SEQ_IN_INDEX: 1},
                {TABLE_NAME: "BuilderProfiles", INDEX_NAME: "UX_BuilderProfiles_ActiveName", NON_UNIQUE: 0, COLUMN_NAME: "ActiveNameHash", SEQ_IN_INDEX: 2}
            ]
        );
        assert.deepEqual(
            await query(
                pool,
                `
                    SELECT TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
                    FROM information_schema.key_column_usage
                    WHERE TABLE_SCHEMA = DATABASE()
                        AND TABLE_NAME IN (
                            'BuilderProfiles', 'AccountPreferences', 'BuilderImportReceipts'
                        )
                        AND REFERENCED_TABLE_NAME = 'Members'
                    ORDER BY TABLE_NAME
                `
            ),
            [
                {TABLE_NAME: "AccountPreferences", CONSTRAINT_NAME: "FK_AccountPreferences_Members", COLUMN_NAME: "MemberId", REFERENCED_TABLE_NAME: "Members", REFERENCED_COLUMN_NAME: "Id"},
                {TABLE_NAME: "BuilderImportReceipts", CONSTRAINT_NAME: "FK_BuilderImportReceipts_Members", COLUMN_NAME: "MemberId", REFERENCED_TABLE_NAME: "Members", REFERENCED_COLUMN_NAME: "Id"},
                {TABLE_NAME: "BuilderProfiles", CONSTRAINT_NAME: "FK_BuilderProfiles_Members", COLUMN_NAME: "MemberId", REFERENCED_TABLE_NAME: "Members", REFERENCED_COLUMN_NAME: "Id"}
            ]
        );

        await query(
            pool,
            "DELETE FROM MigrationRuns WHERE MigrationId = 9; DELETE FROM Migrations WHERE Id = 9"
        );
        await migrations.up();
        assert.deepEqual(await query(pool, "SELECT Id FROM Migrations WHERE Id = 9"), [{Id: 9}]);
    }
    finally {
        await end(pool);
    }
});
