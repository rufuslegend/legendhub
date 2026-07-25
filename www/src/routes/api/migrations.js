const fs = require("fs");
const mysqlPool = require("./mysql-multi-connection");

let migrations = [];

exports.up = async function() {
    const connection = await getConnection();

    try {
        const tables = await query(
            connection,
            "inspect the migration table",
            "SELECT table_name FROM information_schema.tables"
        );
        if (!tables.find((table) => table.table_name === "Migrations")) {
            await query(
                connection,
                "create the migration table",
                "CREATE TABLE Migrations (Id INT NOT NULL, Name VARCHAR(255) NOT NULL, RunOn DATE NOT NULL, PRIMARY KEY (id))"
            );
        }

        migrations = await query(
            connection,
            "read migration history",
            "SELECT * FROM Migrations ORDER BY Id DESC"
        );
        const latestMigrationId = migrations.length > 0 ? migrations[0].Id : 0;
        await runMigration(connection, latestMigrationId + 1);
    }
    finally {
        connection.release();
    }
};

exports.close = function() {
    return new Promise(function(resolve, reject) {
        mysqlPool.end(function(error) {
            if (error)
                reject(new Error("Unable to close the migration database pool", {cause: error}));
            else
                resolve();
        });
    });
};

function getConnection() {
    return new Promise(function(resolve, reject) {
        mysqlPool.getConnection(function(error, connection) {
            if (error)
                reject(new Error("Unable to acquire a database connection for migrations", {cause: error}));
            else
                resolve(connection);
        });
    });
}

function query(connection, operation, sql, values = []) {
    return new Promise(function(resolve, reject) {
        connection.query(sql, values, function(error, results, _fields) {
            if (error)
                reject(new Error(`Unable to ${operation}`, {cause: error}));
            else
                resolve(results);
        });
    });
}

function beginTransaction(connection, migrationId) {
    return new Promise(function(resolve, reject) {
        connection.beginTransaction(function(error) {
            if (error)
                reject(new Error(`Unable to begin transaction for migration ${migrationId}`, {cause: error}));
            else
                resolve();
        });
    });
}

function commit(connection, migrationId) {
    return new Promise(function(resolve, reject) {
        connection.commit(function(error) {
            if (error)
                reject(new Error(`Unable to commit migration ${migrationId}`, {cause: error}));
            else
                resolve();
        });
    });
}

function rollback(connection, migrationId) {
    return new Promise(function(resolve, reject) {
        connection.rollback(function(error) {
            if (error)
                reject(new Error(`Unable to roll back migration ${migrationId}`, {cause: error}));
            else
                resolve();
        });
    });
}

async function runMigration(connection, migrationId) {
    // extra fail safe to prevent migrations from running twice
    while (migrations.find((migration) => migration.Id === migrationId))
        migrationId++;

    const nextMigrationFile = `${__dirname}/migrations/${migrationId}.js`;
    if (!fs.existsSync(nextMigrationFile))
        return;

    console.info(`Running migration '${nextMigrationFile}'...`);
    let migration;
    try {
        migration = require(nextMigrationFile);
    }
    catch (error) {
        throw new Error(`Unable to load migration ${migrationId} from '${nextMigrationFile}'`, {cause: error});
    }

    await beginTransaction(connection, migrationId);
    try {
        await query(
            connection,
            `run migration ${migrationId}`,
            `
                SET @DISABLE_NOTIFICATIONS = 1;
                ${migration.up()}
                SET @DISABLE_NOTIFICATIONS = NULL;
            `
        );
        await commit(connection, migrationId);
        await query(
            connection,
            `record migration ${migrationId}`,
            "INSERT INTO Migrations (Id, Name, RunOn) VALUES (?, ?, ?)",
            [migrationId, nextMigrationFile, new Date()]
        );
    }
    catch (error) {
        const migrationError = new Error(
            `Migration ${migrationId} from '${nextMigrationFile}' failed`,
            {cause: error}
        );

        try {
            await rollback(connection, migrationId);
        }
        catch (rollbackError) {
            throw new AggregateError(
                [migrationError, rollbackError],
                `Migration ${migrationId} failed and could not be rolled back`
            );
        }

        throw migrationError;
    }

    await runMigration(connection, migrationId + 1);
}
