const fs = require("fs");
const path = require("path");
const mysqlPool = require("./mysql-multi-connection");

const LOCK_NAME_SUFFIX = ":legendhub:migrations";
const DEFAULT_LOCK_TIMEOUT_SECONDS = 60;
const TRANSACTIONAL = "transactional";
const NON_TRANSACTIONAL = "non-transactional";
const LEGACY_NON_TRANSACTIONAL = "legacy-non-transactional";
const LEGACY_NON_TRANSACTIONAL_MIGRATIONS = new Set([1, 6]);

const defaultRunner = createMigrationRunner();

exports.up = defaultRunner.up;
exports.close = defaultRunner.close;
exports.run = runDefaultMigrations;
exports.createMigrationRunner = createMigrationRunner;

async function runDefaultMigrations() {
    let migrationError;

    try {
        await defaultRunner.up();
    }
    catch (error) {
        migrationError = error;
    }

    try {
        await defaultRunner.close();
    }
    catch (closeError) {
        if (migrationError) {
            throw new AggregateError(
                [migrationError, closeError],
                "Migrations failed and the migration database pool could not be closed"
            );
        }
        throw closeError;
    }

    if (migrationError)
        throw migrationError;
}

function createMigrationRunner(options = {}) {
    const pool = options.pool || mysqlPool;
    const migrationsDirectory = options.migrationsDirectory || path.join(__dirname, "migrations");
    const lockTimeoutSeconds = options.lockTimeoutSeconds ?? DEFAULT_LOCK_TIMEOUT_SECONDS;
    const log = options.log || console;

    if (!Number.isInteger(lockTimeoutSeconds) || lockTimeoutSeconds < 0)
        throw new Error("Migration lock timeout must be a non-negative integer");

    return {
        up: async function() {
            const connection = await getConnection(pool);
            let lockHeld = false;
            let migrationError;

            try {
                await acquireLock(connection, lockTimeoutSeconds);
                lockHeld = true;
                await ensureMigrationTables(connection);

                const migrations = await query(
                    connection,
                    "read migration history",
                    "SELECT * FROM Migrations ORDER BY Id ASC"
                );
                const nextMigrationId = validateMigrationHistory(migrations);
                await backfillMigrationRuns(connection);
                await runMigrations(connection, migrationsDirectory, nextMigrationId, log);
            }
            catch (error) {
                migrationError = error;
            }

            const cleanupErrors = await cleanUpConnection(connection, lockHeld);
            if (migrationError && cleanupErrors.length > 0)
                throw new AggregateError(
                    [migrationError, ...cleanupErrors],
                    "Migrations failed and the migration connection could not be cleaned up"
                );
            if (migrationError)
                throw migrationError;
            if (cleanupErrors.length > 0)
                throw new AggregateError(cleanupErrors, "Unable to clean up the migration connection");
        },

        close: function() {
            return closePool(pool);
        }
    };
}

function validateMigrationHistory(migrations) {
    const missingRanges = [];
    let expectedId = 1;

    for (const migration of migrations) {
        const migrationId = migration.Id;
        if (!Number.isInteger(migrationId) || migrationId < 1)
            throw new Error(`Migration history contains invalid Id '${String(migrationId)}'`);
        if (migrationId < expectedId)
            throw new Error(`Migration history contains duplicate or unordered Id ${migrationId}`);
        if (migrationId > expectedId) {
            missingRanges.push(
                migrationId === expectedId + 1
                    ? String(expectedId)
                    : `${expectedId}-${migrationId - 1}`
            );
        }

        expectedId = migrationId + 1;
    }

    if (missingRanges.length > 0) {
        throw new Error(
            `Migration history is invalid; missing migration IDs: ${missingRanges.join(", ")}`
        );
    }

    return expectedId;
}

function closePool(pool) {
    return new Promise(function(resolve, reject) {
        pool.end(function(error) {
            if (error)
                reject(new Error("Unable to close the migration database pool", {cause: error}));
            else
                resolve();
        });
    });
}

function getConnection(pool) {
    return new Promise(function(resolve, reject) {
        pool.getConnection(function(error, connection) {
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

async function acquireLock(connection, timeoutSeconds) {
    const results = await query(
        connection,
        "acquire the migration lock",
        "SELECT GET_LOCK(CONCAT(DATABASE(), ?), ?) AS Acquired",
        [LOCK_NAME_SUFFIX, timeoutSeconds]
    );

    if (!results[0] || results[0].Acquired !== 1)
        throw new Error(`Unable to acquire the migration lock within ${timeoutSeconds} seconds`);
}

async function releaseLock(connection) {
    const results = await query(
        connection,
        "release the migration lock",
        "SELECT RELEASE_LOCK(CONCAT(DATABASE(), ?)) AS Released",
        [LOCK_NAME_SUFFIX]
    );

    if (!results[0] || results[0].Released !== 1)
        throw new Error("The migration connection did not own the migration lock during cleanup");
}

async function cleanUpConnection(connection, lockHeld) {
    const errors = [];

    try {
        await clearNotificationSuppression(connection);
    }
    catch (error) {
        errors.push(error);
    }

    if (lockHeld) {
        try {
            await releaseLock(connection);
        }
        catch (error) {
            errors.push(error);
        }
    }

    try {
        connection.release();
    }
    catch (error) {
        errors.push(new Error("Unable to release the migration database connection", {cause: error}));
    }

    return errors;
}

async function ensureMigrationTables(connection) {
    await query(
        connection,
        "create the migration table",
        `
            CREATE TABLE IF NOT EXISTS Migrations (
                Id INT NOT NULL,
                Name VARCHAR(255) NOT NULL,
                RunOn DATE NOT NULL,
                PRIMARY KEY (Id)
            ) ENGINE=InnoDB
        `
    );
    await query(
        connection,
        "create the migration run table",
        `
            CREATE TABLE IF NOT EXISTS MigrationRuns (
                MigrationId INT NOT NULL,
                Name VARCHAR(255) NOT NULL,
                Mode VARCHAR(32) NOT NULL,
                Status VARCHAR(16) NOT NULL,
                StartedOn DATETIME NOT NULL,
                CompletedOn DATETIME NULL,
                Error TEXT NULL,
                PRIMARY KEY (MigrationId)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `
    );
}

async function backfillMigrationRuns(connection) {
    await query(
        connection,
        "backfill migration run history",
        `
            INSERT INTO MigrationRuns
                (MigrationId, Name, Mode, Status, StartedOn, CompletedOn, Error)
            SELECT Id, Name, 'legacy', 'completed', RunOn, RunOn, NULL
            FROM Migrations
            ON DUPLICATE KEY UPDATE
                Name = VALUES(Name),
                Status = 'completed',
                CompletedOn = COALESCE(MigrationRuns.CompletedOn, VALUES(CompletedOn)),
                Error = NULL
        `
    );
}

async function runMigrations(connection, migrationsDirectory, migrationId, log) {
    const nextMigrationFile = path.join(migrationsDirectory, `${migrationId}.js`);
    if (!fs.existsSync(nextMigrationFile))
        return;

    log.info(`Running migration '${nextMigrationFile}'...`);
    const migration = loadMigration(nextMigrationFile, migrationId);
    const mode = getMigrationMode(migration, migrationId);
    const previousRun = await getMigrationRun(connection, migrationId);

    if (previousRun && previousRun.Status === "completed")
        throw new Error(`Migration ${migrationId} is marked complete without a Migrations history record`);
    if (
        mode === LEGACY_NON_TRANSACTIONAL &&
        previousRun &&
        ["started", "failed"].includes(previousRun.Status)
    ) {
        throw new Error(
            `Legacy non-transactional migration ${migrationId} previously ${previousRun.Status}; ` +
            "inspect the database and recover it manually before continuing"
        );
    }

    await recordMigrationStarted(connection, migrationId, nextMigrationFile, mode);

    try {
        if (mode === TRANSACTIONAL)
            await runTransactionalMigration(connection, migration, migrationId, nextMigrationFile);
        else if (mode === NON_TRANSACTIONAL)
            await runNonTransactionalMigration(connection, migration, migrationId, nextMigrationFile);
        else
            await runLegacyNonTransactionalMigration(connection, migration, migrationId, nextMigrationFile);
    }
    catch (error) {
        const migrationError = new Error(
            `Migration ${migrationId} from '${nextMigrationFile}' failed`,
            {cause: error}
        );

        try {
            await recordMigrationFailed(connection, migrationId, migrationError);
        }
        catch (recordError) {
            throw new AggregateError(
                [migrationError, recordError],
                `Migration ${migrationId} failed and its failure could not be recorded`
            );
        }

        throw migrationError;
    }

    await runMigrations(connection, migrationsDirectory, migrationId + 1, log);
}

function loadMigration(migrationFile, migrationId) {
    try {
        return require(migrationFile);
    }
    catch (error) {
        throw new Error(`Unable to load migration ${migrationId} from '${migrationFile}'`, {cause: error});
    }
}

function getMigrationMode(migration, migrationId) {
    if (migration.mode === TRANSACTIONAL || migration.mode === NON_TRANSACTIONAL)
        return migration.mode;
    if (migration.mode !== undefined)
        throw new Error(`Migration ${migrationId} has unsupported mode '${migration.mode}'`);
    if (migrationId > 7)
        throw new Error(
            `Migration ${migrationId} must declare mode '${TRANSACTIONAL}' or '${NON_TRANSACTIONAL}'`
        );

    return LEGACY_NON_TRANSACTIONAL_MIGRATIONS.has(migrationId)
        ? LEGACY_NON_TRANSACTIONAL
        : TRANSACTIONAL;
}

async function getMigrationRun(connection, migrationId) {
    const results = await query(
        connection,
        `read run state for migration ${migrationId}`,
        "SELECT * FROM MigrationRuns WHERE MigrationId = ?",
        [migrationId]
    );
    return results[0];
}

async function recordMigrationStarted(connection, migrationId, migrationFile, mode) {
    await query(
        connection,
        `record the start of migration ${migrationId}`,
        `
            INSERT INTO MigrationRuns
                (MigrationId, Name, Mode, Status, StartedOn, CompletedOn, Error)
            VALUES (?, ?, ?, 'started', NOW(), NULL, NULL)
            ON DUPLICATE KEY UPDATE
                Name = VALUES(Name),
                Mode = VALUES(Mode),
                Status = 'started',
                StartedOn = NOW(),
                CompletedOn = NULL,
                Error = NULL
        `,
        [migrationId, migrationFile, mode]
    );
}

async function recordMigrationFailed(connection, migrationId, error) {
    await query(
        connection,
        `record the failure of migration ${migrationId}`,
        `
            UPDATE MigrationRuns
            SET Status = 'failed', CompletedOn = NULL, Error = ?
            WHERE MigrationId = ?
        `,
        [formatError(error), migrationId]
    );
}

function formatError(error) {
    const messages = [];
    let currentError = error;

    while (currentError) {
        if (currentError.message && !messages.includes(currentError.message))
            messages.push(currentError.message);
        currentError = currentError.cause;
    }

    return messages.join(": ").slice(0, 16000);
}

async function runTransactionalMigration(connection, migration, migrationId, migrationFile) {
    assertMigrationUpFunction(migration, migrationId);
    const sql = migration.up();
    if (typeof sql !== "string" || sql.trim() === "")
        throw new Error(`Transactional migration ${migrationId} must return a non-empty SQL string`);
    assertTransactionalSql(sql, migrationId);

    await beginTransaction(connection, migrationId);
    try {
        await withNotificationsDisabled(connection, migrationId, async function() {
            await query(connection, `run migration ${migrationId}`, sql);
        });
        await recordMigrationCompleted(connection, migrationId, migrationFile);
        await commit(connection, migrationId);
    }
    catch (error) {
        try {
            await rollback(connection, migrationId);
        }
        catch (rollbackError) {
            throw new AggregateError(
                [error, rollbackError],
                `Migration ${migrationId} failed and could not be rolled back`
            );
        }

        throw error;
    }
}

function assertTransactionalSql(sql, migrationId) {
    const sqlWithoutComments = sql
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/--[^\r\n]*/g, "");
    const implicitCommitStatement = /(?:^|;)\s*(ALTER|CREATE|DROP|RENAME|TRUNCATE)\b/i.exec(
        sqlWithoutComments
    );

    if (implicitCommitStatement) {
        throw new Error(
            `Transactional migration ${migrationId} contains ${implicitCommitStatement[1].toUpperCase()} DDL; ` +
            `declare mode '${NON_TRANSACTIONAL}' and implement state-aware up and verify functions`
        );
    }
}

async function runNonTransactionalMigration(connection, migration, migrationId, migrationFile) {
    assertMigrationUpFunction(migration, migrationId);
    if (typeof migration.verify !== "function")
        throw new Error(`Non-transactional migration ${migrationId} must export a verify function`);

    const context = createMigrationContext(connection, migrationId);
    if (!await verifyMigration(migration, context, migrationId)) {
        await withNotificationsDisabled(connection, migrationId, async function() {
            const result = await migration.up(context);
            if (result !== undefined)
                throw new Error(
                    `Non-transactional migration ${migrationId} must execute through its migration context`
                );
        });

        if (!await verifyMigration(migration, context, migrationId))
            throw new Error(`Non-transactional migration ${migrationId} did not reach its verified state`);
    }

    await finalizeNonTransactionalMigration(connection, migrationId, migrationFile);
}

function createMigrationContext(connection, migrationId) {
    return Object.freeze({
        query: function(operation, sql, values = []) {
            if (typeof operation !== "string" || operation.trim() === "")
                throw new Error(`Migration ${migrationId} query operations require a description`);
            return query(connection, `${operation} for migration ${migrationId}`, sql, values);
        }
    });
}

async function verifyMigration(migration, context, migrationId) {
    const verified = await migration.verify(context);
    if (typeof verified !== "boolean")
        throw new Error(`Migration ${migrationId} verify function must return a boolean`);
    return verified;
}

async function runLegacyNonTransactionalMigration(connection, migration, migrationId, migrationFile) {
    assertMigrationUpFunction(migration, migrationId);
    const sql = migration.up();
    if (typeof sql !== "string" || sql.trim() === "")
        throw new Error(`Legacy migration ${migrationId} must return a non-empty SQL string`);

    await withNotificationsDisabled(connection, migrationId, async function() {
        await query(connection, `run migration ${migrationId}`, sql);
    });
    await finalizeNonTransactionalMigration(connection, migrationId, migrationFile);
}

function assertMigrationUpFunction(migration, migrationId) {
    if (typeof migration.up !== "function")
        throw new Error(`Migration ${migrationId} must export an up function`);
}

async function recordMigrationCompleted(connection, migrationId, migrationFile) {
    await query(
        connection,
        `record migration ${migrationId}`,
        "INSERT INTO Migrations (Id, Name, RunOn) VALUES (?, ?, ?)",
        [migrationId, migrationFile, new Date()]
    );
    await query(
        connection,
        `record completion of migration ${migrationId}`,
        `
            UPDATE MigrationRuns
            SET Status = 'completed', CompletedOn = NOW(), Error = NULL
            WHERE MigrationId = ?
        `,
        [migrationId]
    );
}

async function finalizeNonTransactionalMigration(connection, migrationId, migrationFile) {
    await beginTransaction(connection, migrationId);

    try {
        await recordMigrationCompleted(connection, migrationId, migrationFile);
        await commit(connection, migrationId);
    }
    catch (error) {
        try {
            await rollback(connection, migrationId);
        }
        catch (rollbackError) {
            throw new AggregateError(
                [error, rollbackError],
                `Migration ${migrationId} reached its target state but its history could not be recorded`
            );
        }

        throw error;
    }
}

async function withNotificationsDisabled(connection, migrationId, operation) {
    await query(
        connection,
        `disable notifications for migration ${migrationId}`,
        "SET @DISABLE_NOTIFICATIONS = 1"
    );
    let operationError;

    try {
        return await operation();
    }
    catch (error) {
        operationError = error;
        throw error;
    }
    finally {
        try {
            await clearNotificationSuppression(connection);
        }
        catch (cleanupError) {
            if (operationError) {
                throw new AggregateError(
                    [operationError, cleanupError],
                    `Migration ${migrationId} failed and notification suppression could not be cleared`
                );
            }
            throw cleanupError;
        }
    }
}

function clearNotificationSuppression(connection) {
    return query(
        connection,
        "clear migration notification suppression",
        "SET @DISABLE_NOTIFICATIONS = NULL"
    );
}
