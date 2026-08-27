"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const {createAccountEmailService} = require("../src/routes/api/account-email-service");

const NOW = new Date("2026-08-26T12:00:00.000Z");
const IP_HASH = "0123456789012345678901234567890123456789";
const RAW_TOKEN = "070707070707-070707070707070707070707070707070707070707070707";

function createRegistrationDatabase({
    duplicateEmail = false,
    duplicateUsername = false,
    bannedIP = false,
    releaseLockFails = false
} = {}) {
    const events = [];
    const queries = [];
    const connection = {
        beginTransaction(callback) {
            events.push("begin");
            callback(null);
        },
        commit(callback) {
            events.push("commit");
            callback(null);
        },
        rollback(callback) {
            events.push("rollback");
            callback(null);
        },
        release() {
            events.push("release-connection");
        },
        destroy() {
            events.push("destroy-connection");
        },
        query(sql, values, callback) {
            queries.push({sql, values});
            if (sql.includes("GET_LOCK")) {
                events.push("acquire-email-lock");
                callback(null, [{Acquired: 1}]);
                return;
            }
            if (sql.includes("RELEASE_LOCK")) {
                events.push("release-email-lock");
                if (releaseLockFails) {
                    callback(new Error("lock release failed"));
                    return;
                }
                callback(null, [{Released: 1}]);
                return;
            }
            if (sql.includes("FROM Members") && sql.includes("NormalizedEmail")) {
                callback(null, duplicateEmail ? [{Id: 99}] : []);
                return;
            }
            if (sql.includes("FROM BannedIPs")) {
                callback(null, bannedIP ? [{Id: 3}] : []);
                return;
            }
            if (sql.includes("FROM Members") && sql.includes("Username")) {
                callback(null, duplicateUsername ? [{Id: 17}] : []);
                return;
            }
            if (sql.includes("INSERT INTO Members")) {
                events.push("insert-member");
                callback(null, {insertId: 41, affectedRows: 1});
                return;
            }
            if (sql.includes("INSERT INTO MemberRoleMap"))
                events.push("insert-role");
            if (sql.includes("INSERT INTO NotificationSettings"))
                events.push("insert-notifications");
            if (sql.includes("DELETE FROM AccountActionTokens"))
                events.push("cleanup-action-tokens");
            if (sql.includes("INSERT INTO AccountActionTokens"))
                events.push("insert-verification-token");
            callback(null, {affectedRows: 1});
        }
    };
    return {
        pool: {getConnection(callback) { callback(null, connection); }},
        events,
        queries
    };
}

function createService(database, {mailFails = false} = {}) {
    const deliveries = [];
    const rateLimitInputs = [];
    return {
        service: createAccountEmailService({
            pool: database.pool,
            mailer: {
                sendVerification: async function(message) {
                    database.events.push("send-verification");
                    deliveries.push(message);
                    if (mailFails)
                        throw new Error("SMTP delivery unavailable for a private recipient");
                }
            },
            rateLimiter: {
                recordAndCheck: async function(input) {
                    database.events.push("rate-limit");
                    rateLimitInputs.push(input);
                }
            },
            clock: () => NOW,
            randomBytes: size => Buffer.alloc(size, 7)
        }),
        deliveries,
        rateLimitInputs
    };
}

// Catches registration splitting member setup/token creation across commits or
// storing a raw validator instead of its digest.
test("registration transaction stores an unverified normalized email and hashed verification token", async function() {
    const database = createRegistrationDatabase();
    const {service, deliveries, rateLimitInputs} = createService(database);

    const result = await service.register({
        username: "Player",
        email: "  Player+Work@Example.COM  ",
        passwordHash: "stored-password-hash",
        recaptchaVerified: true,
        ipHash: IP_HASH
    });

    assert.deepEqual(result, {registered: true});
    assert.deepEqual(rateLimitInputs, [{
        purpose: "verify-email",
        identity: "player+work@example.com",
        ipHash: IP_HASH
    }]);

    const lock = database.queries.find(({sql}) => sql.includes("GET_LOCK"));
    assert.match(lock.sql, /GET_LOCK\s*\(\s*SHA2\s*\(\s*\?\s*,\s*256\s*\)/i);
    assert.deepEqual(lock.values, ["player+work@example.com"]);

    const duplicateCheck = database.queries.find(({sql}) =>
        sql.includes("FROM Members") && sql.includes("PendingNormalizedEmail"));
    assert.match(duplicateCheck.sql, /FOR UPDATE/i);
    assert.deepEqual(duplicateCheck.values, [
        "player+work@example.com", "player+work@example.com"
    ]);

    const memberInsert = database.queries.find(({sql}) => sql.includes("INSERT INTO Members"));
    assert.match(memberInsert.sql,
        /Email,\s*NormalizedEmail,\s*EmailVerifiedOn,\s*StorageNamespace/i);
    assert.deepEqual(memberInsert.values, [
        "Player",
        "stored-password-hash",
        "Player+Work@Example.COM",
        "player+work@example.com",
        null,
        "07070707070707070707070707070707"
    ]);

    const tokenInsert = database.queries.find(({sql}) =>
        sql.includes("INSERT INTO AccountActionTokens"));
    assert.deepEqual(tokenInsert.values, [
        41,
        "verify-email",
        "070707070707",
        "1059d8ae4558846cee243e1a6ce73a06f50791ddd0a1dea6b3f27dccce29d08e",
        null,
        null,
        IP_HASH,
        NOW,
        new Date("2026-08-27T12:00:00.000Z")
    ]);
    assert.equal(JSON.stringify(tokenInsert.values).includes(RAW_TOKEN), false);
    assert.deepEqual(deliveries, [{
        to: "Player+Work@Example.COM",
        username: "Player",
        token: RAW_TOKEN
    }]);

    assert.deepEqual(database.events, [
        "rate-limit",
        "acquire-email-lock",
        "begin",
        "insert-member",
        "insert-role",
        "insert-notifications",
        "cleanup-action-tokens",
        "insert-verification-token",
        "commit",
        "release-email-lock",
        "release-connection",
        "send-verification"
    ]);
});

// Catches cleanup using wall-clock time, deleting all expired tokens
// immediately, or omitting the consumed-token retention boundary.
test("verification-token creation removes consumed or expired tokens older than twenty-four hours", async function() {
    const database = createRegistrationDatabase();
    const {service} = createService(database);

    await service.register({
        username: "Player",
        email: "player@example.com",
        passwordHash: "stored-password-hash",
        recaptchaVerified: true,
        ipHash: IP_HASH
    });

    const cleanup = database.queries.find(({sql}) =>
        sql.includes("DELETE FROM AccountActionTokens"));
    assert.match(cleanup.sql, /ConsumedOn\s+IS\s+NOT\s+NULL/i);
    assert.match(cleanup.sql, /ExpiresOn/i);
    assert.deepEqual(cleanup.values, [
        new Date("2026-08-25T12:00:00.000Z"),
        new Date("2026-08-25T12:00:00.000Z")
    ]);
});

// Catches checking only active email or relying on two independent unique
// indexes, either of which permits an active/pending cross-column duplicate.
test("registration transaction rejects an email already active or pending", async function() {
    const database = createRegistrationDatabase({duplicateEmail: true});
    const {service, deliveries} = createService(database);

    await assert.rejects(service.register({
        username: "OtherPlayer",
        email: "PLAYER@example.com",
        passwordHash: "stored-password-hash",
        recaptchaVerified: true,
        ipHash: IP_HASH
    }), function(error) {
        assert.equal(error.extensions.code, 409);
        assert.equal(error.message.includes("player@example.com"), false);
        return true;
    });

    assert.equal(database.queries.some(({sql}) => sql.includes("INSERT INTO Members")), false);
    assert.equal(deliveries.length, 0);
    assert.deepEqual(database.events, [
        "rate-limit",
        "acquire-email-lock",
        "begin",
        "rollback",
        "release-email-lock",
        "release-connection"
    ]);
});

// Catches the service migration dropping the pre-3.1 duplicate-username or
// banned-IP registration protections.
test("registration preserves banned-IP and duplicate-username rejection inside the transaction", async function() {
    for (const [databaseOptions, message] of [
        [{bannedIP: true}, "Invalid username."],
        [{duplicateUsername: true}, "Username taken."]
    ]) {
        const database = createRegistrationDatabase(databaseOptions);
        const {service} = createService(database);
        await assert.rejects(service.register({
            username: "Player",
            email: "player@example.com",
            passwordHash: "stored-password-hash",
            recaptchaVerified: true,
            ipHash: IP_HASH
        }), error => error.message === message);
        assert.equal(database.queries.some(({sql}) => sql.includes("INSERT INTO Members")), false);
        assert.equal(database.events.includes("rollback"), true);
    }
});

// Catches attempting delivery before commit or turning an SMTP failure into a
// failed registration that strands a committed-but-reported-failed member.
test("mail failure keeps committed registration successful without exposing delivery details", async function(t) {
    const database = createRegistrationDatabase();
    const {service} = createService(database, {mailFails: true});
    const logged = [];
    t.mock.method(console, "log", (...values) => logged.push(values));
    t.mock.method(console, "error", (...values) => logged.push(values));

    const result = await service.register({
        username: "Player",
        email: "private@example.com",
        passwordHash: "stored-password-hash",
        recaptchaVerified: true,
        ipHash: IP_HASH
    });

    assert.deepEqual(result, {registered: true});
    assert.equal(database.events.indexOf("commit") < database.events.indexOf("send-verification"), true);
    assert.equal(logged.length, 0);
});

// Catches bypassing required email/CAPTCHA validation before any persistent
// claim or delivery side effect.
test("registration requires a valid email and verified CAPTCHA before database work", async function() {
    for (const input of [
        {email: "", recaptchaVerified: true},
        {email: "not-an-address", recaptchaVerified: true},
        {email: "player@example.com", recaptchaVerified: false}
    ]) {
        const database = createRegistrationDatabase();
        const {service} = createService(database);
        await assert.rejects(service.register({
            username: "Player",
            passwordHash: "stored-password-hash",
            ipHash: IP_HASH,
            ...input
        }));
        assert.equal(database.events.length, 0);
    }
});

test("the email lock name is the SHA-256 digest and never includes the address", async function() {
    const database = createRegistrationDatabase();
    const {service} = createService(database);
    await service.register({
        username: "Player",
        email: "player@example.com",
        passwordHash: "stored-password-hash",
        recaptchaVerified: true,
        ipHash: IP_HASH
    });

    const expectedDigest = crypto.createHash("sha256").update("player@example.com").digest("hex");
    const acquire = database.queries.find(({sql}) => sql.includes("GET_LOCK"));
    assert.equal(expectedDigest.length, 64);
    assert.match(acquire.sql, /SHA2\s*\(\s*\?\s*,\s*256\s*\)/i);
    assert.equal(acquire.sql.includes("player@example.com"), false);
});

// Catches returning a connection with a session-scoped named lock to the pool
// when explicit lock release fails.
test("a failed named-lock release destroys the pooled connection", async function() {
    const database = createRegistrationDatabase({releaseLockFails: true});
    const {service} = createService(database);

    assert.deepEqual(await service.register({
        username: "Player",
        email: "player@example.com",
        passwordHash: "stored-password-hash",
        recaptchaVerified: true,
        ipHash: IP_HASH
    }), {registered: true});

    assert.equal(database.events.includes("destroy-connection"), true);
    assert.equal(database.events.includes("release-connection"), false);
    assert.equal(database.events.includes("send-verification"), true);
});
