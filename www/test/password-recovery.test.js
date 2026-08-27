"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const {createPasswordRecoveryService} =
    require("../src/routes/api/password-recovery-service");
const passwords = require("../src/routes/api/php-password");

const NOW = new Date("2026-08-26T12:00:00.000Z");
const IP_HASH = "0123456789012345678901234567890123456789";
const RAW_TOKEN = "070707070707-070707070707070707070707070707070707070707070707";

function createRecoveryDatabase(options = {}) {
    const members = (options.members || [{
        Id: 73,
        Username: "Player",
        Password: passwords.hash("old-password"),
        Email: "Player@Example.com",
        NormalizedEmail: "player@example.com",
        EmailVerifiedOn: new Date("2026-08-20T12:00:00.000Z"),
        PendingEmail: null,
        PendingNormalizedEmail: null,
        Banned: 0
    }]).map(member => ({...member}));
    const actionTokens = (options.actionTokens || [{
        Id: 40,
        MemberId: 73,
        Purpose: "password-reset",
        Selector: "010101010101",
        HashedValidator: "a".repeat(64),
        RequestIPHash: IP_HASH,
        CreatedOn: new Date("2026-08-26T10:00:00.000Z"),
        ExpiresOn: new Date("2026-08-26T13:00:00.000Z"),
        ConsumedOn: null
    }, {
        Id: 39,
        MemberId: 73,
        Purpose: "verify-email",
        Selector: "020202020202",
        HashedValidator: "b".repeat(64),
        RequestIPHash: IP_HASH,
        CreatedOn: new Date("2026-08-24T10:00:00.000Z"),
        ExpiresOn: new Date("2026-08-25T10:00:00.000Z"),
        ConsumedOn: new Date("2026-08-24T11:00:00.000Z")
    }]).map(token => ({...token}));
    const authTokens = (options.authTokens || [
        {Id: 81, MemberId: 73},
        {Id: 82, MemberId: 73},
        {Id: 83, MemberId: 99}
    ]).map(token => ({...token}));
    const events = [];
    const queries = [];
    let nextTokenId = 41;
    let snapshot;

    const connection = {
        beginTransaction(callback) {
            snapshot = {
                members: members.map(member => ({...member})),
                actionTokens: actionTokens.map(token => ({...token})),
                authTokens: authTokens.map(token => ({...token}))
            };
            events.push("begin");
            callback(null);
        },
        commit(callback) {
            events.push("commit");
            snapshot = undefined;
            callback(null);
        },
        rollback(callback) {
            events.push("rollback");
            members.splice(0, members.length, ...snapshot.members);
            actionTokens.splice(0, actionTokens.length, ...snapshot.actionTokens);
            authTokens.splice(0, authTokens.length, ...snapshot.authTokens);
            snapshot = undefined;
            callback(null);
        },
        release() {
            events.push("release");
        },
        query(sql, values, callback) {
            queries.push({sql, values});
            if (options.failOn && sql.includes(options.failOn)) {
                callback(new Error(options.privateDiagnostic || "private SQL diagnostic"));
                return;
            }
            if (sql.includes("FROM Members") && sql.includes("Username = ?") &&
                !sql.includes("AccountActionTokens")) {
                const usernameMatches = members.filter(member =>
                    member.Username === values[0] && !member.Banned);
                const emailMatches = members.filter(member =>
                    member.NormalizedEmail === values[1] && member.EmailVerifiedOn &&
                    !member.Banned && !usernameMatches.includes(member));
                callback(null, [...usernameMatches, ...emailMatches].slice(0, 1));
                return;
            }
            if (sql.includes("DELETE FROM AccountActionTokens")) {
                const [consumedCutoff, expiryCutoff] = values;
                for (let index = actionTokens.length - 1; index >= 0; index -= 1) {
                    const token = actionTokens[index];
                    if ((token.ConsumedOn && token.ConsumedOn < consumedCutoff) ||
                        token.ExpiresOn < expiryCutoff) {
                        actionTokens.splice(index, 1);
                    }
                }
                events.push("cleanup-action-tokens");
                callback(null, {affectedRows: 1});
                return;
            }
            if (sql.includes("UPDATE AccountActionTokens") &&
                sql.includes("Purpose = ?")) {
                for (const token of actionTokens) {
                    if (token.MemberId === values[1] && token.Purpose === values[2] &&
                        token.ConsumedOn === null) {
                        token.ConsumedOn = values[0];
                    }
                }
                events.push("invalidate-reset-tokens");
                callback(null, {affectedRows: 1});
                return;
            }
            if (sql.includes("INSERT INTO AccountActionTokens")) {
                actionTokens.push({
                    Id: nextTokenId++,
                    MemberId: values[0],
                    Purpose: values[1],
                    Selector: values[2],
                    HashedValidator: values[3],
                    RequestIPHash: values[4],
                    CreatedOn: values[5],
                    ExpiresOn: values[6],
                    ConsumedOn: null
                });
                events.push("insert-reset-token");
                callback(null, {affectedRows: 1});
                return;
            }
            if (sql.includes("FROM AccountActionTokens") &&
                sql.includes("JOIN Members")) {
                const token = actionTokens.find(candidate =>
                    candidate.Selector === values[0] &&
                    candidate.Purpose === "password-reset");
                const member = token && members.find(candidate =>
                    candidate.Id === token.MemberId);
                callback(null, token && member ? [{
                    ...token,
                    MemberId: member.Id,
                    Username: member.Username,
                    Email: member.Email,
                    EmailVerifiedOn: member.EmailVerifiedOn
                }] : []);
                return;
            }
            if (sql.includes("UPDATE Members SET Password")) {
                const member = members.find(candidate => candidate.Id === values[1]);
                if (member)
                    member.Password = values[0];
                events.push("update-password");
                callback(null, {affectedRows: member ? 1 : 0});
                return;
            }
            if (sql.includes("DELETE FROM AuthTokens")) {
                for (let index = authTokens.length - 1; index >= 0; index -= 1) {
                    if (authTokens[index].MemberId === values[0])
                        authTokens.splice(index, 1);
                }
                events.push("delete-sessions");
                callback(null, {affectedRows: 2});
                return;
            }
            if (sql.includes("UPDATE AccountActionTokens") &&
                sql.includes("ConsumedOn") && sql.includes("Id = ?")) {
                const token = actionTokens.find(candidate => candidate.Id === values[1]);
                const usable = token && token.ConsumedOn === null;
                if (usable)
                    token.ConsumedOn = values[0];
                events.push("consume-reset-token");
                callback(null, {affectedRows: usable ? 1 : 0});
                return;
            }
            assert.fail(`Unexpected database query: ${sql}`);
        }
    };

    return {
        pool: {getConnection(callback) { callback(null, connection); }},
        members,
        actionTokens,
        authTokens,
        events,
        queries
    };
}

function createService(database, options = {}) {
    const sent = [];
    const rateLimitInputs = [];
    return {
        service: createPasswordRecoveryService({
            pool: database.pool,
            mailer: {
                async sendPasswordReset(message) {
                    database.events.push("send-password-reset");
                    sent.push({kind: "reset", ...message});
                    if (options.mailFails)
                        throw new Error("SMTP failed for private@example.com");
                },
                async sendPasswordChanged(message) {
                    database.events.push("send-password-changed");
                    sent.push({kind: "changed", ...message});
                    if (options.mailFails)
                        throw new Error("SMTP failed for private@example.com");
                }
            },
            rateLimiter: {
                async recordAndCheck(input) {
                    database.events.push("rate-limit");
                    rateLimitInputs.push(input);
                    if (options.rateLimitFails)
                        throw new Error("private rate limiter diagnostic");
                }
            },
            clock: () => NOW,
            randomBytes: size => Buffer.alloc(size, 7)
        }),
        sent,
        rateLimitInputs
    };
}

// Catches identity enumeration through response shape or mail delivery to an
// unverified/pending address while ensuring every accepted request is recorded.
test("recovery response is identical for missing and verified accounts", async function() {
    const database = createRecoveryDatabase();
    const {service, sent, rateLimitInputs} = createService(database);

    assert.deepEqual(await service.requestRecovery({
        identity: "missing@example.com", ipHash: "a"
    }), {accepted: true});
    assert.deepEqual(await service.requestRecovery({
        identity: " Player@Example.COM ", ipHash: "b"
    }), {accepted: true});
    assert.equal(sent.length, 1);
    assert.deepEqual(rateLimitInputs, [{
        purpose: "password-reset",
        identity: "missing@example.com",
        ipHash: "a"
    }, {
        purpose: "password-reset",
        identity: "player@example.com",
        ipHash: "b"
    }]);
    assert.equal(database.events.indexOf("rate-limit") <
        database.events.indexOf("send-password-reset"), true);
});

// Catches pending email being treated as a recovery identity and catches
// dropping deterministic exact-username preference for legacy names with @.
test("recovery uses exact username first and never matches pending or unverified email", async function() {
    const database = createRecoveryDatabase({members: [{
        Id: 73,
        Username: "legacy@example.com",
        Password: passwords.hash("old-password"),
        Email: "legacy-owner@example.net",
        NormalizedEmail: "legacy-owner@example.net",
        EmailVerifiedOn: NOW,
        PendingEmail: null,
        PendingNormalizedEmail: null,
        Banned: 0
    }, {
        Id: 74,
        Username: "EmailOwner",
        Password: passwords.hash("old-password"),
        Email: "legacy@example.com",
        NormalizedEmail: "legacy@example.com",
        EmailVerifiedOn: NOW,
        PendingEmail: null,
        PendingNormalizedEmail: null,
        Banned: 0
    }, {
        Id: 75,
        Username: "PendingOwner",
        Password: passwords.hash("old-password"),
        Email: "unverified@example.com",
        NormalizedEmail: "unverified@example.com",
        EmailVerifiedOn: null,
        PendingEmail: "pending@example.com",
        PendingNormalizedEmail: "pending@example.com",
        Banned: 0
    }]});
    const {service, sent} = createService(database);

    assert.deepEqual(await service.requestRecovery({
        identity: "legacy@example.com", ipHash: "a"
    }), {accepted: true});
    assert.deepEqual(await service.requestRecovery({
        identity: "pending@example.com", ipHash: "b"
    }), {accepted: true});

    assert.deepEqual(sent.map(message => message.to), ["legacy-owner@example.net"]);
    const lookup = database.queries.find(({sql}) =>
        sql.includes("FROM Members") && sql.includes("Username = ?"));
    assert.match(lookup.sql, /EmailVerifiedOn\s+IS\s+NOT\s+NULL/i);
    assert.match(lookup.sql, /ORDER BY\s+CASE\s+WHEN\s+Username\s*=\s*\?/i);
    assert.doesNotMatch(lookup.sql, /PendingNormalizedEmail/i);
});

// Catches reusable parallel reset links, raw-validator storage, wall-clock
// expiry, cleanup outside the creation transaction, or delivery before commit.
test("recovery replaces earlier reset tokens with a hashed one-hour token", async function() {
    const database = createRecoveryDatabase();
    const {service, sent} = createService(database);

    await service.requestRecovery({identity: "Player", ipHash: IP_HASH});

    const resetTokens = database.actionTokens.filter(token =>
        token.MemberId === 73 && token.Purpose === "password-reset");
    assert.equal(resetTokens.length, 2);
    assert.equal(resetTokens[0].ConsumedOn.getTime(), NOW.getTime());
    assert.deepEqual(resetTokens[1], {
        Id: 41,
        MemberId: 73,
        Purpose: "password-reset",
        Selector: "070707070707",
        HashedValidator: "1059d8ae4558846cee243e1a6ce73a06f50791ddd0a1dea6b3f27dccce29d08e",
        RequestIPHash: IP_HASH,
        CreatedOn: NOW,
        ExpiresOn: new Date("2026-08-26T13:00:00.000Z"),
        ConsumedOn: null
    });
    assert.equal(JSON.stringify(database.queries).includes(RAW_TOKEN), false);
    const cleanup = database.queries.find(({sql}) =>
        sql.includes("DELETE FROM AccountActionTokens"));
    assert.deepEqual(cleanup.values, [
        new Date("2026-08-25T12:00:00.000Z"),
        new Date("2026-08-25T12:00:00.000Z")
    ]);
    assert.equal(database.events.indexOf("commit") <
        database.events.indexOf("send-password-reset"), true);
    assert.deepEqual(sent, [{
        kind: "reset",
        to: "Player@Example.com",
        username: "Player",
        token: RAW_TOKEN
    }]);
});

// Catches account existence, SQL, recipient, or SMTP state escaping through a
// valid public recovery request or process diagnostics.
test("valid recovery requests remain generic across throttling, database, and mail failures", async function(t) {
    const writes = [];
    for (const method of ["log", "warn", "error"])
        t.mock.method(console, method, (...values) => writes.push(values));

    for (const scenario of [
        {rateLimitFails: true},
        {database: {failOn: "FROM Members", privateDiagnostic: "private@example.com SQL"}},
        {mailFails: true}
    ]) {
        const database = createRecoveryDatabase(scenario.database);
        const {service} = createService(database, scenario);
        assert.deepEqual(await service.requestRecovery({
            identity: "private@example.com",
            ipHash: IP_HASH
        }), {accepted: true});
    }
    assert.equal(writes.length, 0);
});

// Catches a reset committing password/token state separately from session
// invalidation, allowing token reuse, or issuing a replacement login session.
test("reset consumes the token and invalidates all sessions atomically", async function() {
    const database = createRecoveryDatabase({actionTokens: [{
        Id: 41,
        MemberId: 73,
        Purpose: "password-reset",
        Selector: "070707070707",
        HashedValidator: crypto.createHash("sha256")
            .update(RAW_TOKEN.split("-")[1]).digest("hex"),
        RequestIPHash: IP_HASH,
        CreatedOn: NOW,
        ExpiresOn: new Date("2026-08-26T13:00:00.000Z"),
        ConsumedOn: null
    }]});
    const {service, sent} = createService(database);

    assert.deepEqual(await service.resetPassword({
        token: RAW_TOKEN,
        newPassword: "replacement-password"
    }), {success: true});

    assert.equal(passwords.verify("replacement-password", database.members[0].Password), true);
    assert.equal(passwords.verify("old-password", database.members[0].Password), false);
    assert.deepEqual(database.authTokens, [{Id: 83, MemberId: 99}]);
    assert.equal(database.actionTokens[0].ConsumedOn.getTime(), NOW.getTime());
    assert.equal(database.queries.some(({sql}) =>
        sql.includes("INSERT INTO AuthTokens")), false);
    assert.equal(database.events.indexOf("begin") < database.events.indexOf("update-password"), true);
    assert.equal(database.events.indexOf("update-password") < database.events.indexOf("delete-sessions"), true);
    assert.equal(database.events.indexOf("delete-sessions") < database.events.indexOf("consume-reset-token"), true);
    assert.equal(database.events.indexOf("consume-reset-token") < database.events.indexOf("commit"), true);
    assert.equal(database.events.indexOf("commit") < database.events.indexOf("send-password-changed"), true);
    assert.deepEqual(sent, [{
        kind: "changed",
        to: "Player@Example.com",
        username: "Player"
    }]);

    await assert.rejects(service.resetPassword({
        token: RAW_TOKEN,
        newPassword: "second-password"
    }), /invalid or expired/i);
});

// Catches a failed session purge leaving a changed password or consumed token,
// and catches private transaction diagnostics escaping the service boundary.
test("reset rollback preserves password, sessions, token, and private diagnostics", async function(t) {
    const privateDiagnostic =
        `session delete failed for ${RAW_TOKEN} private@example.com replacement-password`;
    const database = createRecoveryDatabase({
        failOn: "DELETE FROM AuthTokens",
        privateDiagnostic,
        actionTokens: [{
            Id: 41,
            MemberId: 73,
            Purpose: "password-reset",
            Selector: "070707070707",
            HashedValidator: crypto.createHash("sha256")
                .update(RAW_TOKEN.split("-")[1]).digest("hex"),
            RequestIPHash: IP_HASH,
            CreatedOn: NOW,
            ExpiresOn: new Date("2026-08-26T13:00:00.000Z"),
            ConsumedOn: null
        }]
    });
    const {service, sent} = createService(database);
    const writes = [];
    for (const method of ["log", "warn", "error"])
        t.mock.method(console, method, (...values) => writes.push(values));

    await assert.rejects(service.resetPassword({
        token: RAW_TOKEN,
        newPassword: "replacement-password"
    }), error => error.message === "Password reset failed." &&
        !error.message.includes(privateDiagnostic));

    assert.equal(passwords.verify("old-password", database.members[0].Password), true);
    assert.deepEqual(database.authTokens, [
        {Id: 81, MemberId: 73},
        {Id: 82, MemberId: 73},
        {Id: 83, MemberId: 99}
    ]);
    assert.equal(database.actionTokens[0].ConsumedOn, null);
    assert.equal(database.events.includes("rollback"), true);
    assert.equal(database.events.includes("commit"), false);
    assert.deepEqual(sent, []);
    assert.equal(writes.length, 0);
});

// Catches weak-password acceptance, malformed/tampered/expired token use, or
// token cleanup happening outside the reset transaction/injected clock.
test("reset enforces the existing password minimum and rejects unusable tokens generically", async function() {
    const database = createRecoveryDatabase({actionTokens: [{
        Id: 41,
        MemberId: 73,
        Purpose: "password-reset",
        Selector: "070707070707",
        HashedValidator: crypto.createHash("sha256")
            .update(RAW_TOKEN.split("-")[1]).digest("hex"),
        RequestIPHash: IP_HASH,
        CreatedOn: NOW,
        ExpiresOn: new Date("2026-08-26T13:00:00.000Z"),
        ConsumedOn: null
    }, {
        Id: 39,
        MemberId: 73,
        Purpose: "verify-email",
        Selector: "020202020202",
        HashedValidator: "b".repeat(64),
        RequestIPHash: IP_HASH,
        CreatedOn: new Date("2026-08-24T10:00:00.000Z"),
        ExpiresOn: new Date("2026-08-25T10:00:00.000Z"),
        ConsumedOn: new Date("2026-08-24T11:00:00.000Z")
    }]});
    const {service} = createService(database);

    await assert.rejects(service.resetPassword({
        token: RAW_TOKEN,
        newPassword: "short"
    }), /larger than 8 characters/i);
    assert.deepEqual(database.events, []);

    for (const token of ["malformed", RAW_TOKEN.replace(/.$/, "8")]) {
        await assert.rejects(service.resetPassword({
            token,
            newPassword: "replacement-password"
        }), error => /invalid or expired/i.test(error.message) &&
            !error.message.includes(token));
    }

    const cleanup = database.queries.find(({sql}) =>
        sql.includes("DELETE FROM AccountActionTokens"));
    assert.deepEqual(cleanup.values, [
        new Date("2026-08-25T12:00:00.000Z"),
        new Date("2026-08-25T12:00:00.000Z")
    ]);
    const selectorLookup = database.queries.find(({sql}) =>
        sql.includes("JOIN Members"));
    assert.deepEqual(selectorLookup.values, ["070707070707"]);
    assert.equal(JSON.stringify(database.queries).includes(RAW_TOKEN), false);
    assert.equal(database.actionTokens.some(token => token.Id === 39), false,
        "invalid consumption still commits the injected-clock cleanup");
    assert.equal(database.events.includes("commit"), true);
});
