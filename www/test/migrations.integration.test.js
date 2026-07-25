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
