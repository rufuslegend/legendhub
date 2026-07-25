const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

function loadMigrationModule(mysqlPool) {
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (request === "./mysql-multi-connection")
            return mysqlPool;

        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        delete require.cache[require.resolve("../src/routes/api/migrations")];
        return require("../src/routes/api/migrations");
    }
    finally {
        Module._load = originalLoad;
    }
}

test("application waits for migrations before listening", async function() {
    const events = [];
    let finishMigration;
    const migrationFinished = new Promise(function(resolve) {
        finishMigration = resolve;
    });
    const expectedServer = {};
    const startup = require("../src/app");
    const startPromise = startup.start({
        migrate: async function() {
            events.push("migration started");
            await migrationFinished;
            events.push("migration finished");
        },
        createApplication: function() {
            events.push("application created");
            return {
                listen: function(_port, callback) {
                    events.push("server listening");
                    callback();
                    return expectedServer;
                }
            };
        },
        port: 8080,
        log: function() {}
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(events, ["migration started"]);

    finishMigration();
    const server = await startPromise;

    assert.equal(server, expectedServer);
    assert.deepEqual(events, [
        "migration started",
        "migration finished",
        "application created",
        "server listening"
    ]);
});

test("numeric port configuration is normalized before listening", async function() {
    let listeningPort;
    const startup = require("../src/app");
    const expectedServer = {};
    const server = await startup.start({
        port: "8080",
        migrate: async function() {},
        createApplication: function() {
            return {
                listen: function(port, callback) {
                    listeningPort = port;
                    callback();
                    return expectedServer;
                }
            };
        },
        log: function() {}
    });

    assert.equal(server, expectedServer);
    assert.equal(listeningPort, 8080);
});

test("invalid ports fail before migrations or application creation", async function(t) {
    const invalidPorts = [
        null,
        "",
        "not-a-port",
        "80.5",
        0,
        -1,
        1.5,
        65536
    ];
    const startup = require("../src/app");

    for (const port of invalidPorts) {
        await t.test(`rejects ${JSON.stringify(port)}`, async function() {
            let migrationStarted = false;
            let applicationCreated = false;

            await assert.rejects(
                startup.start({
                    port,
                    migrate: async function() {
                        migrationStarted = true;
                    },
                    createApplication: function() {
                        applicationCreated = true;
                    }
                }),
                /PORT must be an integer between 1 and 65535/
            );

            assert.equal(migrationStarted, false);
            assert.equal(applicationCreated, false);
        });
    }
});

test("missing PORT fails before migrations", async function() {
    const startup = require("../src/app");
    const originalPort = process.env.PORT;
    let migrationStarted = false;

    try {
        delete process.env.PORT;
        await assert.rejects(
            startup.start({
                migrate: async function() {
                    migrationStarted = true;
                }
            }),
            /PORT must be an integer between 1 and 65535; received undefined/
        );
        assert.equal(migrationStarted, false);
    }
    finally {
        if (originalPort === undefined)
            delete process.env.PORT;
        else
            process.env.PORT = originalPort;
    }
});

test("migration promise resolves only after database work finishes", async function() {
    let finishReadingMigrations;
    let released = false;
    const connection = {
        query: function(sql, _values, callback) {
            if (sql.includes("information_schema.tables")) {
                callback(null, [{table_name: "Migrations"}]);
                return;
            }

            if (sql.includes("SELECT * FROM Migrations")) {
                finishReadingMigrations = callback;
                return;
            }

            throw new Error(`Unexpected query: ${sql}`);
        },
        release: function() {
            released = true;
        }
    };
    const migrations = loadMigrationModule({
        getConnection: function(callback) {
            callback(null, connection);
        }
    });

    let resolved = false;
    const migrationPromise = migrations.up().then(function() {
        resolved = true;
    });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(resolved, false);
    assert.equal(released, false);
    assert.equal(typeof finishReadingMigrations, "function");

    finishReadingMigrations(null, [{Id: 7}]);
    await migrationPromise;

    assert.equal(resolved, true);
    assert.equal(released, true);
});

test("startup failure never creates the application or opens its port", async function() {
    const migrationError = new Error("database unavailable");
    let applicationCreated = false;
    const startup = require("../src/app");

    await assert.rejects(
        startup.start({
            port: 8080,
            migrate: async function() {
                throw migrationError;
            },
            createApplication: function() {
                applicationCreated = true;
            }
        }),
        migrationError
    );

    assert.equal(applicationCreated, false);
});

test("main reports startup failure, closes the database pool, and sets a failure status", async function() {
    const startupError = new Error("migration failed");
    const logEntries = [];
    let databaseClosed = false;
    let applicationCreated = false;
    const originalExitCode = process.exitCode;
    const startup = require("../src/app");

    try {
        process.exitCode = 0;
        const server = await startup.main({
            port: 8080,
            migrate: async function() {
                throw startupError;
            },
            createApplication: function() {
                applicationCreated = true;
            },
            closeDatabase: async function() {
                databaseClosed = true;
            },
            logError: function(...args) {
                logEntries.push(args);
            }
        });

        assert.equal(server, undefined);
        assert.equal(applicationCreated, false);
        assert.equal(databaseClosed, true);
        assert.equal(process.exitCode, 1);
        assert.deepEqual(logEntries, [
            ["Application startup failed:", startupError]
        ]);
    }
    finally {
        process.exitCode = originalExitCode || 0;
    }
});

test("migration errors retain context and release the connection", async function() {
    const databaseError = new Error("query failed");
    let released = false;
    const connection = {
        query: function(_sql, _values, callback) {
            callback(databaseError);
        },
        release: function() {
            released = true;
        }
    };
    const migrations = loadMigrationModule({
        getConnection: function(callback) {
            callback(null, connection);
        }
    });

    await assert.rejects(migrations.up(), function(error) {
        assert.equal(error.message, "Unable to inspect the migration table");
        assert.equal(error.cause, databaseError);
        return true;
    });
    assert.equal(released, true);
});

test("database pool closure is awaitable", async function() {
    let finishClosing;
    const migrations = loadMigrationModule({
        end: function(callback) {
            finishClosing = callback;
        }
    });
    let closed = false;
    const closePromise = migrations.close().then(function() {
        closed = true;
    });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(closed, false);
    assert.equal(typeof finishClosing, "function");

    finishClosing();
    await closePromise;
    assert.equal(closed, true);
});

test("rollback errors do not hide the original migration failure", async function() {
    const migrationDatabaseError = new Error("migration query failed");
    const rollbackDatabaseError = new Error("rollback failed");
    let released = false;
    const connection = {
        query: function(sql, _values, callback) {
            if (sql.includes("information_schema.tables")) {
                callback(null, [{table_name: "Migrations"}]);
                return;
            }
            if (sql.includes("SELECT * FROM Migrations")) {
                callback(null, []);
                return;
            }

            callback(migrationDatabaseError);
        },
        beginTransaction: function(callback) {
            callback();
        },
        rollback: function(callback) {
            callback(rollbackDatabaseError);
        },
        release: function() {
            released = true;
        }
    };
    const migrations = loadMigrationModule({
        getConnection: function(callback) {
            callback(null, connection);
        }
    });

    await assert.rejects(migrations.up(), function(error) {
        assert.equal(error instanceof AggregateError, true);
        assert.match(error.message, /Migration 1 failed and could not be rolled back/);
        assert.equal(error.errors.length, 2);
        assert.equal(error.errors[0].cause.cause, migrationDatabaseError);
        assert.equal(error.errors[1].cause, rollbackDatabaseError);
        return true;
    });
    assert.equal(released, true);
});
