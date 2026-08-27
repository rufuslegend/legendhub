"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {query, withTransaction} = require("../src/routes/api/database");

test("query resolves database results with its default empty values array", async function() {
    let received;
    const results = [{Id: 31}];
    const executor = {
        query: function(sql, values, callback) {
            received = {sql, values};
            callback(null, results);
        }
    };

    assert.equal(await query(executor, "SELECT Id FROM Members"), results);
    assert.deepEqual(received, {
        sql: "SELECT Id FROM Members",
        values: []
    });
});

test("withTransaction commits the operation result before releasing its connection", async function() {
    const events = [];
    const connection = {
        beginTransaction: function(callback) {
            events.push("begin");
            callback(null);
        },
        commit: function(callback) {
            events.push("commit");
            callback(null);
        },
        rollback: function(callback) {
            events.push("rollback");
            callback(null);
        },
        release: function() {
            events.push("release");
        }
    };
    const pool = {
        getConnection: function(callback) {
            events.push("acquire");
            callback(null, connection);
        }
    };

    const result = await withTransaction(pool, async function(receivedConnection) {
        assert.equal(receivedConnection, connection);
        events.push("operation");
        return {memberId: 31};
    });

    assert.deepEqual(result, {memberId: 31});
    assert.deepEqual(events, ["acquire", "begin", "operation", "commit", "release"]);
});

test("withTransaction rolls back and releases when its operation fails", async function() {
    const operationError = new Error("write failed");
    const events = [];
    const connection = {
        beginTransaction: callback => callback(null),
        commit: callback => callback(null),
        rollback: function(callback) {
            events.push("rollback");
            callback(null);
        },
        release: function() {
            events.push("release");
        }
    };
    const pool = {getConnection: callback => callback(null, connection)};

    await assert.rejects(withTransaction(pool, async function() {
        events.push("operation");
        throw operationError;
    }), error => error === operationError);
    assert.deepEqual(events, ["operation", "rollback", "release"]);
});

test("withTransaction preserves both operation and rollback failures", async function() {
    const operationError = new Error("write failed");
    const rollbackError = new Error("rollback failed");
    let released = false;
    const connection = {
        beginTransaction: callback => callback(null),
        commit: callback => callback(null),
        rollback: callback => callback(rollbackError),
        release: function() {
            released = true;
        }
    };
    const pool = {getConnection: callback => callback(null, connection)};

    await assert.rejects(withTransaction(pool, async function() {
        throw operationError;
    }), function(error) {
        assert.equal(error instanceof AggregateError, true);
        assert.deepEqual(error.errors, [operationError, rollbackError]);
        return true;
    });
    assert.equal(released, true);
});

test("withTransaction retains operation and rollback failures when release also fails", async function() {
    const operationError = new Error("write failed");
    const rollbackError = new Error("rollback failed");
    const releaseError = new Error("release failed");
    const connection = {
        beginTransaction: callback => callback(null),
        commit: callback => callback(null),
        rollback: callback => callback(rollbackError),
        release: function() {
            throw releaseError;
        }
    };
    const pool = {getConnection: callback => callback(null, connection)};

    await assert.rejects(withTransaction(pool, async function() {
        throw operationError;
    }), function(error) {
        assert.equal(error instanceof AggregateError, true);
        assert.deepEqual(error.errors, [operationError, rollbackError, releaseError]);
        return true;
    });
});
