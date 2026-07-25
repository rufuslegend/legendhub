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
