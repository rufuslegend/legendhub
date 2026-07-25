const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const {createMigrationRunner} = require("../src/routes/api/migrations");

function createPool(queryHandler) {
    const events = [];
    const connection = {
        query: function(sql, values, callback) {
            events.push({type: "query", sql, values});
            queryHandler(sql, values, callback);
        },
        beginTransaction: function(callback) {
            events.push({type: "begin"});
            callback();
        },
        commit: function(callback) {
            events.push({type: "commit"});
            callback();
        },
        rollback: function(callback) {
            events.push({type: "rollback"});
            callback();
        },
        release: function() {
            events.push({type: "release"});
        }
    };
    const pool = {
        getConnection: function(callback) {
            callback(null, connection);
        },
        end: function(callback) {
            callback();
        }
    };

    return {pool, events};
}

function successfulQueryHandler(sql, _values, callback) {
    if (sql.includes("GET_LOCK")) {
        callback(null, [{Acquired: 1}]);
        return;
    }
    if (sql.includes("RELEASE_LOCK")) {
        callback(null, [{Released: 1}]);
        return;
    }
    if (sql.includes("SELECT * FROM Migrations ORDER BY")) {
        callback(null, []);
        return;
    }
    if (sql.includes("SELECT * FROM MigrationRuns WHERE")) {
        callback(null, []);
        return;
    }

    callback(null, []);
}

function fixtureDirectory(name) {
    return path.join(__dirname, "..", "test-fixtures", "migrations", name);
}

function findEventIndex(events, predicate) {
    const index = events.findIndex(predicate);
    assert.notEqual(index, -1);
    return index;
}

test("transactional changes and completion history commit atomically", async function() {
    const {pool, events} = createPool(successfulQueryHandler);
    const migrations = createMigrationRunner({
        pool,
        migrationsDirectory: fixtureDirectory("transactional-success"),
        log: {info: function() {}}
    });

    await migrations.up();

    const begin = findEventIndex(events, (event) => event.type === "begin");
    const migrationSql = findEventIndex(
        events,
        (event) => event.type === "query" && event.sql.includes("UPDATE MigrationTest")
    );
    const completionHistory = findEventIndex(
        events,
        (event) => event.type === "query" && event.sql.includes("INSERT INTO Migrations")
    );
    const completionStatus = findEventIndex(
        events,
        (event) => event.type === "query" &&
            event.sql.includes("UPDATE MigrationRuns") &&
            event.sql.includes("Status = 'completed'")
    );
    const commit = findEventIndex(events, (event) => event.type === "commit");
    const releaseLock = findEventIndex(
        events,
        (event) => event.type === "query" && event.sql.includes("RELEASE_LOCK")
    );
    const releaseConnection = findEventIndex(events, (event) => event.type === "release");

    assert.ok(begin < migrationSql);
    assert.ok(migrationSql < completionHistory);
    assert.ok(completionHistory < completionStatus);
    assert.ok(completionStatus < commit);
    assert.ok(commit < releaseLock);
    assert.ok(releaseLock < releaseConnection);
});

test("migration startup stops when another process owns the advisory lock", async function() {
    const {pool, events} = createPool(function(sql, _values, callback) {
        if (sql.includes("GET_LOCK")) {
            callback(null, [{Acquired: 0}]);
            return;
        }

        callback(null, []);
    });
    const migrations = createMigrationRunner({
        pool,
        lockTimeoutSeconds: 0,
        migrationsDirectory: fixtureDirectory("transactional-success"),
        log: {info: function() {}}
    });

    await assert.rejects(
        migrations.up(),
        /Unable to acquire the migration lock within 0 seconds/
    );

    assert.equal(
        events.some(
            (event) => event.type === "query" &&
                event.sql.includes("CREATE TABLE IF NOT EXISTS Migrations")
        ),
        false
    );
    assert.equal(
        events.some(
            (event) => event.type === "query" && event.sql.includes("RELEASE_LOCK")
        ),
        false
    );
    assert.equal(events.at(-1).type, "release");
});

test("transactional migrations reject MySQL DDL before executing it", async function() {
    const {pool, events} = createPool(successfulQueryHandler);
    const migrations = createMigrationRunner({
        pool,
        migrationsDirectory: fixtureDirectory("transactional-ddl"),
        log: {info: function() {}}
    });

    await assert.rejects(migrations.up(), function(error) {
        assert.match(error.message, /Migration 1 .* failed/);
        assert.match(
            error.cause.message,
            /contains ALTER DDL; declare mode 'non-transactional'/
        );
        return true;
    });

    assert.equal(events.some((event) => event.type === "begin"), false);
    assert.equal(
        events.some(
            (event) => event.type === "query" && event.sql.includes("ALTER TABLE MigrationTest")
        ),
        false
    );
    assert.equal(
        events.some(
            (event) => event.type === "query" &&
                event.sql.includes("Status = 'failed'")
        ),
        true
    );
});
