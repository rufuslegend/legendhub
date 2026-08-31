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

test("slot mask migration backfills legacy items and resumes after its additive DDL", {
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
                DROP TRIGGER IF EXISTS Items_BEFORE_UPDATE;
                DROP TABLE IF EXISTS NotificationQueue;
                DROP TABLE IF EXISTS Members;
                DROP TABLE IF EXISTS Items_AuditTrail;
                DROP TABLE IF EXISTS Items;
                DROP TABLE IF EXISTS MigrationRuns;
                DROP TABLE IF EXISTS Migrations;
                CREATE TABLE Items (
                    Id INT NOT NULL,
                    Name VARCHAR(255) NOT NULL,
                    Slot INT NOT NULL,
                    Holdable TINYINT NOT NULL,
                    Casts VARCHAR(50) NULL,
                    ModifiedBy VARCHAR(64) NOT NULL,
                    PRIMARY KEY (Id)
                ) ENGINE=InnoDB;
                CREATE TABLE Items_AuditTrail (
                    Id INT NOT NULL AUTO_INCREMENT,
                    ItemId INT NOT NULL,
                    Name VARCHAR(255) NOT NULL,
                    Slot INT NOT NULL,
                    Holdable TINYINT NOT NULL,
                    Casts VARCHAR(50) NULL,
                    ModifiedBy VARCHAR(64) NOT NULL,
                    PRIMARY KEY (Id)
                ) ENGINE=InnoDB;
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
                    (7, 'legacy', CURDATE()), (8, 'legacy', CURDATE()),
                    (9, 'legacy', CURDATE());
            `
        );
        await query(pool, `
            INSERT INTO Items (Id, Name, Slot, Holdable, ModifiedBy)
            VALUES
                (101, 'Holdable sword', 14, 1, 'ItemEditor'),
                (102, 'Shield', 10, 1, 'ItemEditor'),
                (103, 'Held focus', 15, 0, 'ItemEditor')
        `);
        await query(pool, `
            INSERT INTO Items_AuditTrail (ItemId, Name, Slot, Holdable, ModifiedBy)
            VALUES (102, 'Shield', 10, 1, 'ItemEditor')
        `);

        await assert.rejects(migrations.up(), /Migration 10 .* failed/);
        const slotMaskColumns = await query(pool, `
                SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE
                FROM information_schema.columns
                WHERE TABLE_SCHEMA = DATABASE()
                    AND TABLE_NAME IN ('Items', 'Items_AuditTrail')
                    AND COLUMN_NAME = 'SlotMask'
                ORDER BY TABLE_NAME
            `);
        assert.deepEqual(
            slotMaskColumns.map(({TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE}) => ({
                TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE
            })),
            [
                {TABLE_NAME: "Items", COLUMN_NAME: "SlotMask", DATA_TYPE: "int", IS_NULLABLE: "NO"},
                {TABLE_NAME: "Items_AuditTrail", COLUMN_NAME: "SlotMask", DATA_TYPE: "int", IS_NULLABLE: "NO"}
            ]
        );
        for (const column of slotMaskColumns)
            assert.match(column.COLUMN_TYPE, /^int(?:\(\d+\))? unsigned$/);

        await query(pool, `
            ALTER TABLE Items ADD COLUMN Deleted TINYINT NOT NULL DEFAULT 0;
            ALTER TABLE Items_AuditTrail ADD COLUMN Deleted TINYINT NOT NULL DEFAULT 0;
            CREATE TABLE Members (
                Id INT NOT NULL,
                Username VARCHAR(64) NOT NULL,
                PRIMARY KEY (Id)
            ) ENGINE=InnoDB;
            CREATE TABLE NotificationQueue (
                Id INT NOT NULL AUTO_INCREMENT,
                ActorId INT NOT NULL,
                ObjectId INT NOT NULL,
                ObjectType VARCHAR(32) NOT NULL,
                ObjectPage VARCHAR(32) NOT NULL,
                ObjectName VARCHAR(255) NOT NULL,
                Verb VARCHAR(32) NOT NULL,
                CreatedOn DATETIME NOT NULL,
                PRIMARY KEY (Id)
            ) ENGINE=InnoDB;
            CREATE TABLE ItemStatInfo (
                Id INT NOT NULL AUTO_INCREMENT,
                Display VARCHAR(25) NOT NULL,
                Short VARCHAR(10) NOT NULL,
                Var VARCHAR(35) NOT NULL,
                Type VARCHAR(15) NOT NULL,
                FilterString VARCHAR(10) NOT NULL,
                DefaultValue VARCHAR(10) NULL,
                NetStat DECIMAL(5,2) NULL,
                ShowColumnDefault TINYINT NOT NULL,
                Editable TINYINT NOT NULL,
                CategoryId INT NOT NULL,
                SortNumber INT NOT NULL,
                PRIMARY KEY (Id)
            ) ENGINE=InnoDB;
            INSERT INTO Members (Id, Username) VALUES (17, 'ItemEditor');
        `);
        await migrations.up();

        assert.deepEqual(
            await query(pool, "SELECT Id FROM Migrations ORDER BY Id"),
            Array.from({length: 11}, (_, index) => ({Id: index + 1}))
        );
        assert.deepEqual(
            await query(pool, `
                SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE,
                    COLUMN_DEFAULT, CHARACTER_SET_NAME, COLLATION_NAME
                FROM information_schema.columns
                WHERE TABLE_SCHEMA = DATABASE()
                    AND TABLE_NAME IN ('Items', 'Items_AuditTrail')
                    AND COLUMN_NAME IN ('Name', 'Casts', 'Official')
                ORDER BY TABLE_NAME, COLUMN_NAME
            `),
            [
                {TABLE_NAME: "Items", COLUMN_NAME: "Casts", COLUMN_TYPE: "text", IS_NULLABLE: "YES", COLUMN_DEFAULT: null, CHARACTER_SET_NAME: "utf8mb4", COLLATION_NAME: "utf8mb4_unicode_ci"},
                {TABLE_NAME: "Items", COLUMN_NAME: "Name", COLUMN_TYPE: "varchar(255)", IS_NULLABLE: "NO", COLUMN_DEFAULT: null, CHARACTER_SET_NAME: "utf8mb4", COLLATION_NAME: "utf8mb4_unicode_ci"},
                {TABLE_NAME: "Items", COLUMN_NAME: "Official", COLUMN_TYPE: "tinyint(4)", IS_NULLABLE: "NO", COLUMN_DEFAULT: "0", CHARACTER_SET_NAME: null, COLLATION_NAME: null},
                {TABLE_NAME: "Items_AuditTrail", COLUMN_NAME: "Casts", COLUMN_TYPE: "text", IS_NULLABLE: "YES", COLUMN_DEFAULT: null, CHARACTER_SET_NAME: "utf8mb4", COLLATION_NAME: "utf8mb4_unicode_ci"},
                {TABLE_NAME: "Items_AuditTrail", COLUMN_NAME: "Name", COLUMN_TYPE: "varchar(255)", IS_NULLABLE: "NO", COLUMN_DEFAULT: null, CHARACTER_SET_NAME: "utf8mb4", COLLATION_NAME: "utf8mb4_unicode_ci"},
                {TABLE_NAME: "Items_AuditTrail", COLUMN_NAME: "Official", COLUMN_TYPE: "tinyint(4)", IS_NULLABLE: "NO", COLUMN_DEFAULT: "0", CHARACTER_SET_NAME: null, COLLATION_NAME: null}
            ]
        );
        assert.deepEqual(
            await query(pool, `
                SELECT TABLE_NAME FROM information_schema.tables
                WHERE TABLE_SCHEMA = DATABASE()
                    AND TABLE_NAME IN ('OfficialItemVariants', 'EquipmentSubmissions')
                ORDER BY TABLE_NAME
            `),
            [{TABLE_NAME: "EquipmentSubmissions"}, {TABLE_NAME: "OfficialItemVariants"}]
        );
        assert.deepEqual(
            await query(pool, "SELECT Var, Editable, FilterString FROM ItemStatInfo WHERE Var = 'official'"),
            [{Var: "official", Editable: 0, FilterString: "= 1"}]
        );

        assert.deepEqual(
            await query(pool, "SELECT Id, SlotMask FROM Items ORDER BY Id"),
            [
                {Id: 101, SlotMask: 49152},
                {Id: 102, SlotMask: 1024},
                {Id: 103, SlotMask: 32768}
            ]
        );
        assert.deepEqual(
            await query(pool, "SELECT Id FROM Items ORDER BY Id"),
            [{Id: 101}, {Id: 102}, {Id: 103}]
        );
        assert.deepEqual(
            await query(pool, "SELECT ItemId, SlotMask FROM Items_AuditTrail WHERE ItemId = 102"),
            [{ItemId: 102, SlotMask: 1024}]
        );

        await query(pool, "UPDATE Items SET Name = 'Holdable sword updated' WHERE Id = 101");
        assert.deepEqual(
            await query(pool, "SELECT ItemId, SlotMask, Official FROM Items_AuditTrail WHERE ItemId = 101"),
            [{ItemId: 101, SlotMask: 49152, Official: 0}]
        );
        assert.deepEqual(
            await query(pool, `
                SELECT ActorId, ObjectId, ObjectType, ObjectPage, ObjectName, Verb
                FROM NotificationQueue
            `),
            [{
                ActorId: 17,
                ObjectId: 101,
                ObjectType: "item",
                ObjectPage: "items",
                ObjectName: "Holdable sword",
                Verb: "updated"
            }]
        );
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
                    SELECT COLLATION_NAME
                    FROM information_schema.columns
                    WHERE TABLE_SCHEMA = DATABASE()
                        AND TABLE_NAME = 'BuilderImportReceipts'
                        AND COLUMN_NAME = 'IdempotencyKey'
                `
            ),
            [{COLLATION_NAME: "ascii_bin"}]
        );
        assert.deepEqual(
            await query(
                pool,
                `
                    SELECT
                        TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, CHARACTER_SET_NAME,
                        COLUMN_DEFAULT, EXTRA
                    FROM information_schema.columns
                    WHERE TABLE_SCHEMA = DATABASE()
                        AND (
                            (TABLE_NAME = 'BuilderProfiles' AND COLUMN_NAME IN (
                                'ActiveNameHash', 'DeletedOn', 'Id', 'Payload', 'PayloadBytes', 'Revision'
                            ))
                            OR (TABLE_NAME = 'AccountPreferences' AND COLUMN_NAME IN (
                                'DocumentVersion', 'Payload', 'Revision', 'StorageGeneration'
                            ))
                            OR (TABLE_NAME = 'BuilderImportReceipts' AND COLUMN_NAME IN (
                                'Id', 'IdempotencyKey', 'ResultPayload'
                            ))
                        )
                    ORDER BY TABLE_NAME, COLUMN_NAME
                `
            ),
            [
                {TABLE_NAME: "AccountPreferences", COLUMN_NAME: "DocumentVersion", COLUMN_TYPE: "int(11)", IS_NULLABLE: "NO", CHARACTER_SET_NAME: null, COLUMN_DEFAULT: "1", EXTRA: ""},
                {TABLE_NAME: "AccountPreferences", COLUMN_NAME: "Payload", COLUMN_TYPE: "json", IS_NULLABLE: "NO", CHARACTER_SET_NAME: "utf8mb4", COLUMN_DEFAULT: null, EXTRA: ""},
                {TABLE_NAME: "AccountPreferences", COLUMN_NAME: "Revision", COLUMN_TYPE: "bigint(20)", IS_NULLABLE: "NO", CHARACTER_SET_NAME: null, COLUMN_DEFAULT: "1", EXTRA: ""},
                {TABLE_NAME: "AccountPreferences", COLUMN_NAME: "StorageGeneration", COLUMN_TYPE: "bigint(20)", IS_NULLABLE: "NO", CHARACTER_SET_NAME: null, COLUMN_DEFAULT: "1", EXTRA: ""},
                {TABLE_NAME: "BuilderImportReceipts", COLUMN_NAME: "Id", COLUMN_TYPE: "bigint(20)", IS_NULLABLE: "NO", CHARACTER_SET_NAME: null, COLUMN_DEFAULT: null, EXTRA: "auto_increment"},
                {TABLE_NAME: "BuilderImportReceipts", COLUMN_NAME: "IdempotencyKey", COLUMN_TYPE: "char(64)", IS_NULLABLE: "NO", CHARACTER_SET_NAME: "ascii", COLUMN_DEFAULT: null, EXTRA: ""},
                {TABLE_NAME: "BuilderImportReceipts", COLUMN_NAME: "ResultPayload", COLUMN_TYPE: "json", IS_NULLABLE: "NO", CHARACTER_SET_NAME: "utf8mb4", COLUMN_DEFAULT: null, EXTRA: ""},
                {TABLE_NAME: "BuilderProfiles", COLUMN_NAME: "ActiveNameHash", COLUMN_TYPE: "binary(32)", IS_NULLABLE: "YES", CHARACTER_SET_NAME: null, COLUMN_DEFAULT: null, EXTRA: ""},
                {TABLE_NAME: "BuilderProfiles", COLUMN_NAME: "DeletedOn", COLUMN_TYPE: "datetime", IS_NULLABLE: "YES", CHARACTER_SET_NAME: null, COLUMN_DEFAULT: null, EXTRA: ""},
                {TABLE_NAME: "BuilderProfiles", COLUMN_NAME: "Id", COLUMN_TYPE: "bigint(20)", IS_NULLABLE: "NO", CHARACTER_SET_NAME: null, COLUMN_DEFAULT: null, EXTRA: "auto_increment"},
                {TABLE_NAME: "BuilderProfiles", COLUMN_NAME: "Payload", COLUMN_TYPE: "mediumtext", IS_NULLABLE: "YES", CHARACTER_SET_NAME: "utf8mb4", COLUMN_DEFAULT: null, EXTRA: ""},
                {TABLE_NAME: "BuilderProfiles", COLUMN_NAME: "PayloadBytes", COLUMN_TYPE: "int(11)", IS_NULLABLE: "NO", CHARACTER_SET_NAME: null, COLUMN_DEFAULT: "0", EXTRA: ""},
                {TABLE_NAME: "BuilderProfiles", COLUMN_NAME: "Revision", COLUMN_TYPE: "bigint(20)", IS_NULLABLE: "NO", CHARACTER_SET_NAME: null, COLUMN_DEFAULT: "1", EXTRA: ""}
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
