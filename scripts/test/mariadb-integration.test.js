"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const {after, before, test} = require("node:test");

const repository = path.resolve(__dirname, "../..");
const mysql = require(path.join(repository, "www/node_modules/mysql"));
const {
    createMigrationRunner
} = require(path.join(repository, "www/src/routes/api/migrations"));
const {
    createBuilderProfileRepository
} = require(path.join(repository, "www/src/routes/api/builder-profile-repository"));

const image = "mariadb:12.3.3@" +
    "sha256:dd9b303aed4f4890ed09f766d8ca9ddfd176c0c6f6267feff53b3192ec65a979";
const password = "disposable-mariadb-integration-password";
const containerName = `legendhub-mariadb-integration-${process.pid}-${Date.now()}`;
const databases = {
    configuration: "legendhub_configuration_migration_test",
    locks: "legendhub_lock_migration_test",
    builder: "legendhub_builder_migration_test",
    equipment: "legendhub_equipment_migration_test"
};

let control;
let containerStarted = false;
let fixturesDirectory;
let port;

function docker(arguments_, options = {}) {
    return spawnSync("docker", arguments_, {encoding: "utf8", ...options});
}

function wait(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function connect(configuration) {
    return new Promise((resolve, reject) => {
        const connection = mysql.createConnection(configuration);
        connection.connect(error => error ? reject(error) : resolve(connection));
    });
}

function query(executor, statement, values = []) {
    return new Promise((resolve, reject) => {
        executor.query(statement, values, (error, results) => {
            if (error) {
                reject(error);
                return;
            }
            if (Array.isArray(results)) {
                resolve(results.map(row => row && !Array.isArray(row) ? {...row} : row));
                return;
            }
            resolve(results);
        });
    });
}

function end(executor) {
    if (!executor)
        return Promise.resolve();
    return new Promise((resolve, reject) => {
        executor.end(error => error ? reject(error) : resolve());
    });
}

function createPool(database, connectionLimit = 2) {
    return mysql.createPool({
        connectionLimit,
        host: "127.0.0.1",
        port,
        user: "root",
        password,
        database,
        multipleStatements: true
    });
}

async function waitForMariaDb() {
    let lastError;
    for (let attempt = 0; attempt < 90; attempt += 1) {
        try {
            control = await connect({
                host: "127.0.0.1",
                port,
                user: "root",
                password
            });
            return;
        }
        catch (error) {
            lastError = error;
            await wait(1000);
        }
    }
    throw lastError;
}

function quoteIdentifier(identifier) {
    return `\`${identifier.replace(/`/g, "``")}\``;
}

async function recreateDatabase(database) {
    const identifier = quoteIdentifier(database);
    await query(control, `DROP DATABASE IF EXISTS ${identifier}`);
    await query(control,
        `CREATE DATABASE ${identifier} CHARACTER SET latin1 COLLATE latin1_swedish_ci`);
}

async function createMigrationHistory(pool, throughId) {
    await query(pool, `
        CREATE TABLE Migrations (
            Id INT NOT NULL,
            Name VARCHAR(255) NOT NULL,
            RunOn DATE NOT NULL,
            PRIMARY KEY (Id)
        ) ENGINE=InnoDB
    `);
    const values = Array.from({length: throughId}, (_, index) => [
        index + 1,
        `legacy-${index + 1}`,
        new Date("2026-08-27T00:00:00Z")
    ]);
    await query(pool, "INSERT INTO Migrations (Id, Name, RunOn) VALUES ?", [values]);
}

function migrationFixture(migrationId) {
    const directory = path.join(fixturesDirectory, `migration-${migrationId}`);
    fs.mkdirSync(directory);
    const migrationPath = path.join(
        repository,
        "www/src/routes/api/migrations",
        `${migrationId}.js`
    );
    fs.writeFileSync(
        path.join(directory, `${migrationId}.js`),
        `module.exports = require(${JSON.stringify(migrationPath)});\n`
    );
    return directory;
}

async function runMigration(pool, migrationId) {
    const runner = createMigrationRunner({
        pool,
        lockTimeoutSeconds: 0,
        migrationsDirectory: path.join(fixturesDirectory, `migration-${migrationId}`),
        log: {info() {}}
    });
    await runner.up();
}

async function setUpBuilderLegacySchema(pool) {
    await query(pool, `
        CREATE TABLE Members (
            Id INT NOT NULL,
            Username VARCHAR(64) NOT NULL,
            PRIMARY KEY (Id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        INSERT INTO Members (Id, Username) VALUES (73, 'BuilderOwner');
    `);
    await createMigrationHistory(pool, 8);
}

async function setUpEquipmentLegacySchema(pool) {
    await query(pool, `
        CREATE TABLE Members (
            Id INT NOT NULL,
            Username VARCHAR(64) NOT NULL,
            PRIMARY KEY (Id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        CREATE TABLE Items (
            Id INT NOT NULL,
            Name VARCHAR(255) NOT NULL,
            Casts VARCHAR(50) NULL,
            ModifiedBy VARCHAR(64) NOT NULL,
            Deleted TINYINT NOT NULL DEFAULT 0,
            PRIMARY KEY (Id)
        ) ENGINE=InnoDB;
        CREATE TABLE Items_AuditTrail (
            Id INT NOT NULL AUTO_INCREMENT,
            ItemId INT NOT NULL,
            Name VARCHAR(255) NOT NULL,
            Casts VARCHAR(50) NULL,
            ModifiedBy VARCHAR(64) NOT NULL,
            Deleted TINYINT NOT NULL DEFAULT 0,
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
        INSERT INTO Items (Id, Name, Casts, ModifiedBy)
            VALUES (101, 'Legacy sword', 'faerie fire', 'ItemEditor');
    `);
    await createMigrationHistory(pool, 10);
}

before(async () => {
    fixturesDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "legendhub-mariadb-fixtures-"));
    migrationFixture(9);
    migrationFixture(11);

    const started = docker([
        "run", "--detach", "--rm", "--platform", "linux/amd64",
        "--name", containerName,
        "--env", `MARIADB_ROOT_PASSWORD=${password}`,
        "--publish", "127.0.0.1::3306",
        "--volume", `${path.join(repository, "mysql/mariadb-conf")}:/etc/mysql/conf.d:ro`,
        image,
        "--skip-name-resolve"
    ]);
    assert.equal(started.status, 0, started.stderr);
    containerStarted = true;

    const portResult = docker(["port", containerName, "3306/tcp"]);
    assert.equal(portResult.status, 0, portResult.stderr);
    port = Number(portResult.stdout.trim().split(":").at(-1));
    assert.ok(port > 0, "MariaDB container did not publish a TCP port");
    await waitForMariaDb();
});

after(async () => {
    await end(control);
    if (containerStarted) {
        const removed = docker(["rm", "--force", containerName]);
        assert.equal(removed.status, 0, removed.stderr);
        const absent = docker(["inspect", containerName]);
        assert.notEqual(absent.status, 0, "temporary MariaDB container still exists");
    }
    if (fixturesDirectory)
        fs.rmSync(fixturesDirectory, {recursive: true, force: true});
    process.stderr.write("MariaDB integration cleanup: disposable container removed\n");
});

// Catches an accidental server-tag/digest change, native-architecture launch,
// or a driver upgrade that silently drops the deployed mysql@2.18.1 boundary.
test("the pinned linux/amd64 MariaDB server uses the deployed runtime configuration", async () => {
    const packageMetadata = require(path.join(repository, "www/node_modules/mysql/package.json"));
    assert.equal(packageMetadata.version, "2.18.1");
    const versionRows = await query(control, "SELECT VERSION() AS Version");
    assert.match(versionRows[0].Version, /^12\.3\.3-MariaDB/);

    const variables = (await query(control, `
        SELECT @@GLOBAL.sql_mode AS SqlMode,
            @@GLOBAL.character_set_server AS CharacterSetServer,
            @@GLOBAL.collation_server AS CollationServer
    `))[0];
    assert.deepEqual({
        SqlModes: variables.SqlMode.split(",").sort(),
        CharacterSetServer: variables.CharacterSetServer,
        CollationServer: variables.CollationServer
    }, {
        SqlModes: [
            "STRICT_TRANS_TABLES",
            "NO_ZERO_IN_DATE",
            "NO_ZERO_DATE",
            "ERROR_FOR_DIVISION_BY_ZERO",
            "NO_ENGINE_SUBSTITUTION"
        ].sort(),
        CharacterSetServer: "latin1",
        CollationServer: "latin1_swedish_ci"
    });

    const configurationDatabase = quoteIdentifier(databases.configuration);
    try {
        await query(control, `DROP DATABASE IF EXISTS ${configurationDatabase}`);
        await query(control, `CREATE DATABASE ${configurationDatabase} CHARACTER SET utf8mb4`);
        assert.deepEqual(await query(control, `
            SELECT DEFAULT_CHARACTER_SET_NAME AS CharacterSet,
                DEFAULT_COLLATION_NAME AS Collation
            FROM information_schema.schemata
            WHERE SCHEMA_NAME = ?
        `, [databases.configuration]), [{
            CharacterSet: "utf8mb4",
            Collation: "utf8mb4_general_ci"
        }]);
    }
    finally {
        await query(control, `DROP DATABASE IF EXISTS ${configurationDatabase}`);
    }

    const configuredImage = docker([
        "inspect", "--format", "{{.Config.Image}}", containerName
    ]);
    assert.equal(configuredImage.status, 0, configuredImage.stderr);
    assert.equal(configuredImage.stdout.trim(), image);
    const architecture = docker(["exec", containerName, "uname", "-m"]);
    assert.equal(architecture.status, 0, architecture.stderr);
    assert.equal(architecture.stdout.trim(), "x86_64");
});

// Catches migration startup proceeding without the database-scoped named lock
// or returning a pooled connection while it still owns that lock.
test("the migration runner honors and releases MariaDB named locks", async () => {
    await recreateDatabase(databases.locks);
    const holder = await connect({
        host: "127.0.0.1",
        port,
        user: "root",
        password,
        database: databases.locks
    });
    const pool = createPool(databases.locks, 1);
    const emptyMigrations = path.join(fixturesDirectory, "empty");
    fs.mkdirSync(emptyMigrations, {recursive: true});
    const runner = createMigrationRunner({
        pool,
        lockTimeoutSeconds: 0,
        migrationsDirectory: emptyMigrations,
        log: {info() {}}
    });

    try {
        const acquired = await query(holder,
            "SELECT GET_LOCK(CONCAT(DATABASE(), ':legendhub:migrations'), 0) AS Acquired");
        assert.equal(acquired[0].Acquired, 1);
        await assert.rejects(runner.up(), /Unable to acquire the migration lock within 0 seconds/);
        const released = await query(holder,
            "SELECT RELEASE_LOCK(CONCAT(DATABASE(), ':legendhub:migrations')) AS Released");
        assert.equal(released[0].Released, 1);

        await runner.up();
        const free = await query(holder,
            "SELECT IS_FREE_LOCK(CONCAT(DATABASE(), ':legendhub:migrations')) AS IsFree");
        assert.equal(free[0].IsFree, 1);
    }
    finally {
        await end(holder);
        await end(pool);
    }
});

// Catches migration 9 rejecting MariaDB's JSON alias/default metadata, failing
// to repair a partial DDL run, or changing Builder JSON/profile bytes on save.
test("migration 9 retries on MariaDB and preserves Builder documents", async () => {
    await recreateDatabase(databases.builder);
    const pool = createPool(databases.builder);
    try {
        await setUpBuilderLegacySchema(pool);
        await runMigration(pool, 9);

        const jsonColumns = await query(pool, `
            SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_SET_NAME, COLLATION_NAME
            FROM information_schema.columns
            WHERE TABLE_SCHEMA = DATABASE()
                AND ((TABLE_NAME = 'AccountPreferences' AND COLUMN_NAME = 'Payload')
                    OR (TABLE_NAME = 'BuilderImportReceipts'
                        AND COLUMN_NAME = 'ResultPayload'))
            ORDER BY COLUMN_NAME
        `);
        assert.deepEqual(jsonColumns, [
            {
                COLUMN_NAME: "Payload",
                DATA_TYPE: "longtext",
                CHARACTER_SET_NAME: "utf8mb4",
                COLLATION_NAME: "utf8mb4_bin"
            },
            {
                COLUMN_NAME: "ResultPayload",
                DATA_TYPE: "longtext",
                CHARACTER_SET_NAME: "utf8mb4",
                COLLATION_NAME: "utf8mb4_bin"
            }
        ]);
        const checks = await query(pool, `
            SELECT TABLE_NAME, CHECK_CLAUSE
            FROM information_schema.check_constraints
            WHERE CONSTRAINT_SCHEMA = DATABASE()
                AND TABLE_NAME IN ('AccountPreferences', 'BuilderImportReceipts')
            ORDER BY TABLE_NAME
        `);
        assert.equal(checks.length, 2);
        assert.deepEqual(checks.map(row => row.TABLE_NAME),
            ["AccountPreferences", "BuilderImportReceipts"]);
        assert.match(checks[0].CHECK_CLAUSE, /json_valid\s*\(\s*`Payload`\s*\)/i);
        assert.match(checks[1].CHECK_CLAUSE, /json_valid\s*\(\s*`ResultPayload`\s*\)/i);

        const repositoryApi = createBuilderProfileRepository({pool});
        const profilePayload = JSON.stringify({
            version: 7,
            name: "Hero",
            nested: {unknownFutureField: ["α", 0, false, null]},
            equipment: [{id: 2263, affects: {hp: -14}}]
        });
        const timestamp = new Date("2026-08-27T12:34:56.000Z");
        await repositoryApi.insert({
            memberId: 73,
            id: "00000000-0000-4000-8000-000000000073",
            name: "Hero",
            payload: profilePayload,
            payloadVersion: 7,
            payloadBytes: Buffer.byteLength(profilePayload, "utf8"),
            revision: 1,
            createdOn: timestamp,
            updatedOn: timestamp
        });
        await repositoryApi.writePreferences(73, {
            documentVersion: 3,
            payload: {
                version: 3,
                theme: "night",
                future: {accent: "émeraude", enabled: false}
            },
            revision: 4,
            storageGeneration: 5,
            updatedOn: timestamp
        });
        await repositoryApi.writeImportReceipt(73, "A".repeat(64), {
            copied: ["Hero"],
            conflicts: [],
            metadata: {request: 0, accepted: true}
        }, timestamp);

        const profiles = await repositoryApi.list(73);
        assert.equal(profiles.length, 1);
        assert.equal(profiles[0].payload, profilePayload);
        assert.equal(profiles[0].payloadBytes, Buffer.byteLength(profilePayload, "utf8"));
        assert.deepEqual((await repositoryApi.readPreferences(73)).payload, {
            version: 3,
            theme: "night",
            future: {accent: "émeraude", enabled: false}
        });
        assert.deepEqual((await repositoryApi.readImportReceipt(73, "A".repeat(64))).result, {
            copied: ["Hero"],
            conflicts: [],
            metadata: {request: 0, accepted: true}
        });

        await query(pool, `
            DELETE FROM MigrationRuns WHERE MigrationId = 9;
            DELETE FROM Migrations WHERE Id = 9;
            DROP TABLE BuilderImportReceipts;
        `);
        await runMigration(pool, 9);
        assert.deepEqual(await query(pool,
            "SELECT Id FROM Migrations WHERE Id = 9"), [{Id: 9}]);
        assert.deepEqual(await query(pool, `
            SELECT MigrationId, Status, Error
            FROM MigrationRuns WHERE MigrationId = 9
        `), [{MigrationId: 9, Status: "completed", Error: null}]);
        assert.equal((await repositoryApi.list(73))[0].payload, profilePayload);
    }
    finally {
        await end(pool);
    }
});

// Catches migration 11 rejecting MariaDB nullable-default metadata, losing its
// trigger semantics, or failing to repair a partially committed DDL retry.
test("migration 11 creates, verifies, and repairs its MariaDB schema", async () => {
    await recreateDatabase(databases.equipment);
    const pool = createPool(databases.equipment);
    try {
        await setUpEquipmentLegacySchema(pool);
        await runMigration(pool, 11);

        const columns = await query(pool, `
            SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE,
                COLUMN_DEFAULT, CHARACTER_SET_NAME, COLLATION_NAME
            FROM information_schema.columns
            WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME IN ('Items', 'Items_AuditTrail')
                AND COLUMN_NAME IN ('Name', 'Casts', 'Official')
            ORDER BY TABLE_NAME, COLUMN_NAME
        `);
        assert.equal(columns.length, 6);
        for (const column of columns) {
            if (column.COLUMN_NAME === "Official") {
                assert.match(column.COLUMN_TYPE, /^tinyint(?:\(\d+\))?$/);
                assert.equal(column.COLUMN_DEFAULT, "0");
            }
            else {
                assert.equal(column.CHARACTER_SET_NAME, "utf8mb4");
                assert.equal(column.COLLATION_NAME, "utf8mb4_unicode_ci");
            }
        }

        await query(pool, "UPDATE Items SET Name = 'Migrated sword' WHERE Id = 101");
        assert.deepEqual(await query(pool, `
            SELECT ItemId, Name, Official FROM Items_AuditTrail WHERE ItemId = 101
        `), [{ItemId: 101, Name: "Legacy sword", Official: 0}]);
        assert.deepEqual(await query(pool, `
            SELECT ActorId, ObjectId, ObjectType, ObjectPage, ObjectName, Verb
            FROM NotificationQueue
        `), [{
            ActorId: 17,
            ObjectId: 101,
            ObjectType: "item",
            ObjectPage: "items",
            ObjectName: "Legacy sword",
            Verb: "updated"
        }]);

        await query(pool, `
            DELETE FROM MigrationRuns WHERE MigrationId = 11;
            DELETE FROM Migrations WHERE Id = 11;
            DROP TABLE EquipmentSubmissions;
            ALTER TABLE Items MODIFY COLUMN Official TINYINT NOT NULL DEFAULT 1;
        `);
        await runMigration(pool, 11);
        assert.deepEqual(await query(pool, `
            SELECT TABLE_NAME FROM information_schema.tables
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'EquipmentSubmissions'
        `), [{TABLE_NAME: "EquipmentSubmissions"}]);
        assert.deepEqual(await query(pool, `
            SELECT COLUMN_DEFAULT FROM information_schema.columns
            WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = 'Items' AND COLUMN_NAME = 'Official'
        `), [{COLUMN_DEFAULT: "0"}]);
        assert.deepEqual(await query(pool, `
            SELECT MigrationId, Status, Error
            FROM MigrationRuns WHERE MigrationId = 11
        `), [{MigrationId: 11, Status: "completed", Error: null}]);
    }
    finally {
        await end(pool);
    }
});
