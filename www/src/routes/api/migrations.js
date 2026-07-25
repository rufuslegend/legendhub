const fs = require("fs");
const mysqlPool = require("./mysql-multi-connection");

let migrations = [];

exports.up = async function() {
    const connection = await getConnection();

    try {
        const tables = await query(connection, "SELECT table_name FROM information_schema.tables");
        if (!tables.find((table) => table.table_name === "Migrations")) {
            await query(
                connection,
                "CREATE TABLE Migrations (Id INT NOT NULL, Name VARCHAR(255) NOT NULL, RunOn DATE NOT NULL, PRIMARY KEY (id))"
            );
        }

        migrations = await query(connection, "SELECT * FROM Migrations ORDER BY Id DESC");
        const latestMigrationId = migrations.length > 0 ? migrations[0].Id : 0;
        await runMigration(connection, latestMigrationId + 1);
    }
    finally {
        connection.release();
    }
};

function getConnection() {
    return new Promise(function(resolve, reject) {
        mysqlPool.getConnection(function(error, connection) {
            if (error)
                reject(error);
            else
                resolve(connection);
        });
    });
}

function query(connection, sql, values = []) {
    return new Promise(function(resolve, reject) {
        connection.query(sql, values, function(error, results, _fields) {
            if (error)
                reject(error);
            else
                resolve(results);
        });
    });
}

function beginTransaction(connection) {
    return new Promise(function(resolve, reject) {
        connection.beginTransaction(function(error) {
            if (error)
                reject(error);
            else
                resolve();
        });
    });
}

function commit(connection) {
    return new Promise(function(resolve, reject) {
        connection.commit(function(error) {
            if (error)
                reject(error);
            else
                resolve();
        });
    });
}

function rollback(connection) {
    return new Promise(function(resolve) {
        connection.rollback(resolve);
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
    const migration = require(nextMigrationFile);

    await beginTransaction(connection);
    try {
        await query(connection, `
            SET @DISABLE_NOTIFICATIONS = 1;
            ${migration.up()}
            SET @DISABLE_NOTIFICATIONS = NULL;
        `);
        await commit(connection);
        await query(
            connection,
            "INSERT INTO Migrations (Id, Name, RunOn) VALUES (?, ?, ?)",
            [migrationId, nextMigrationFile, new Date()]
        );
    }
    catch (error) {
        console.error(`Error running migration '${nextMigrationFile}': ${error}`);
        await rollback(connection);
        throw error;
    }

    await runMigration(connection, migrationId + 1);
}
