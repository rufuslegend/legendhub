"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const {createAccountRateLimiter} = require("../src/routes/api/account-rate-limit");

function createPool(counts = {}) {
    const queries = [];
    const state = {
        withinMinute: counts.withinMinute || 0,
        identityHour: counts.identityHour || 0,
        ipHour: counts.ipHour || 0
    };
    const connection = {
        beginTransaction(callback) { callback(null); },
        commit(callback) { callback(null); },
        rollback(callback) { callback(null); },
        release() {},
        query(sql, values, callback) {
            queries.push({sql, values});
            if (sql.includes("COUNT(*) AS Count")) {
                if (sql.includes("RequestIPHash"))
                    callback(null, [{Count: state.ipHour}]);
                else if (sql.includes("INTERVAL 1 HOUR"))
                    callback(null, [{Count: state.identityHour}]);
                else
                    callback(null, [{Count: state.withinMinute}]);
                return;
            }
            if (sql.includes("INSERT INTO AccountActionAttempts")) {
                state.withinMinute++;
                state.identityHour++;
                state.ipHour++;
            }
            callback(null, {affectedRows: 1});
        }
    };
    return {
        pool: {getConnection(callback) { callback(null, connection); }},
        queries
    };
}

const input = Object.freeze({
    purpose: "verify-email",
    identity: "player@example.com",
    ipHash: "0123456789012345678901234567890123456789"
});

test("rate limiter blocks the second delivery inside sixty seconds", async function() {
    const database = createPool();
    const limiter = createAccountRateLimiter({pool: database.pool, clock: () => new Date("2026-08-26T12:00:00Z")});

    await limiter.recordAndCheck(input);
    await assert.rejects(
        limiter.recordAndCheck(input),
        error => error.extensions.code === 429 && error.message === "Try again later."
    );
});

test("rate limiter accepts delivery below all identity and IP limits", async function() {
    const database = createPool({identityHour: 4, ipHour: 19});
    const now = new Date("2026-08-26T12:00:00Z");
    const limiter = createAccountRateLimiter({pool: database.pool, clock: () => now});

    await limiter.recordAndCheck(input);

    const insert = database.queries.find(({sql}) => sql.includes("INSERT INTO AccountActionAttempts"));
    assert.ok(insert);
    assert.deepEqual(insert.values, [
        "verify-email",
        crypto.createHash("sha256").update("player@example.com").digest("hex"),
        input.ipHash,
        now
    ]);
});

test("rate limiter blocks an identity after five deliveries in one hour", async function() {
    const database = createPool({identityHour: 5});
    const limiter = createAccountRateLimiter({pool: database.pool, clock: () => new Date("2026-08-26T12:00:00Z")});

    await assert.rejects(limiter.recordAndCheck(input), error => error.extensions.code === 429);
});

test("rate limiter blocks an IP after twenty deliveries in one hour", async function() {
    const database = createPool({ipHour: 20});
    const limiter = createAccountRateLimiter({pool: database.pool, clock: () => new Date("2026-08-26T12:00:00Z")});

    await assert.rejects(limiter.recordAndCheck(input), error => error.extensions.code === 429);
});

test("accepted rate-limit writes remove attempts older than twenty-four hours", async function() {
    const database = createPool();
    const now = new Date("2026-08-26T12:00:00Z");
    const limiter = createAccountRateLimiter({pool: database.pool, clock: () => now});

    await limiter.recordAndCheck(input);

    const cleanup = database.queries.find(({sql}) => sql.includes("DELETE FROM AccountActionAttempts"));
    assert.ok(cleanup);
    assert.deepEqual(cleanup.values, [new Date("2026-08-25T12:00:00Z")]);
});
