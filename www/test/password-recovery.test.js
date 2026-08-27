"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const Module = require("node:module");
const test = require("node:test");

const {createPasswordRecoveryService} =
    require("../src/routes/api/password-recovery-service");
const passwords = require("../src/routes/api/php-password");

const NOW = new Date("2026-08-26T12:00:00.000Z");
const IP_HASH = "0123456789012345678901234567890123456789";
const RAW_TOKEN = "070707070707-070707070707070707070707070707070707070707070707";
const authApiPath = require.resolve("../src/routes/api/auth");

function loadAuthApi(mysql) {
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (request === "./mysql-connection" && parent?.filename === authApiPath)
            return mysql;
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        delete require.cache[authApiPath];
        return require(authApiPath);
    }
    finally {
        Module._load = originalLoad;
    }
}

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
            if (sql.includes("SELECT MemberId") &&
                sql.includes("FROM AccountActionTokens") &&
                !sql.includes("FOR UPDATE")) {
                const token = actionTokens.find(candidate =>
                    candidate.Selector === values[0] &&
                    candidate.Purpose === "password-reset");
                events.push("discover-reset-token-member");
                callback(null, token ? [{MemberId: token.MemberId}] : []);
                return;
            }
            if (sql.includes("FROM AccountActionTokens") &&
                sql.includes("JOIN Members")) {
                const token = actionTokens.find(candidate =>
                    candidate.Selector === values[0] &&
                    candidate.Purpose === "password-reset");
                const member = token && members.find(candidate =>
                    candidate.Id === token.MemberId);
                events.push("lock-reset-token");
                events.push("lock-reset-member");
                callback(null, token && member ? [{
                    ...token,
                    MemberId: member.Id,
                    Username: member.Username,
                    Email: member.Email,
                    EmailVerifiedOn: member.EmailVerifiedOn
                }] : []);
                return;
            }
            if (sql.includes("FROM Members") && sql.includes("WHERE Id = ?") &&
                sql.includes("FOR UPDATE")) {
                const member = members.find(candidate => candidate.Id === values[0]);
                events.push("lock-reset-member");
                callback(null, member ? [{...member}] : []);
                return;
            }
            if (sql.includes("FROM AccountActionTokens") &&
                sql.includes("FOR UPDATE")) {
                const token = actionTokens.find(candidate =>
                    candidate.Selector === values[0] &&
                    candidate.MemberId === values[1] &&
                    candidate.Purpose === "password-reset");
                events.push("lock-reset-token");
                callback(null, token ? [{...token}] : []);
                return;
            }
            if (sql.includes("UPDATE Members SET Password")) {
                const member = members.find(candidate => candidate.Id === values[1]);
                if (member) {
                    member.Password = values[0];
                    if (sql.includes("PendingEmail = NULL")) {
                        member.PendingEmail = null;
                        member.PendingNormalizedEmail = null;
                    }
                }
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
                sql.includes("ConsumedOn") && sql.includes("WHERE Id = ?")) {
                const token = actionTokens.find(candidate => candidate.Id === values[1]);
                const usable = token && token.ConsumedOn === null;
                if (usable)
                    token.ConsumedOn = values[0];
                events.push("consume-reset-token");
                callback(null, {affectedRows: usable ? 1 : 0});
                return;
            }
            if (sql.includes("UPDATE AccountActionTokens") &&
                !sql.includes("Purpose = ?")) {
                let affectedRows = 0;
                for (const token of actionTokens) {
                    if (token.MemberId === values[1] && token.ConsumedOn === null) {
                        token.ConsumedOn = values[0];
                        affectedRows += 1;
                    }
                }
                events.push("consume-member-action-tokens");
                callback(null, {affectedRows});
                return;
            }
            assert.fail(`Unexpected database query: ${sql}`);
        }
    };

    return {
        pool: {
            query(sql, values, callback) { connection.query(sql, values, callback); },
            getConnection(callback) { callback(null, connection); }
        },
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
                    if (options.passwordResetDelivery)
                        return options.passwordResetDelivery(message);
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

function createConcurrentSecurityDatabase() {
    const member = {
        Id: 73,
        Username: "Player",
        Password: passwords.hash("old-password"),
        Email: "Player@Example.com",
        NormalizedEmail: "player@example.com",
        EmailVerifiedOn: new Date("2026-08-20T12:00:00.000Z"),
        PendingEmail: null,
        StorageNamespace: "member-73",
        Banned: 0
    };
    const actionToken = {
        Id: 41,
        MemberId: member.Id,
        Purpose: "password-reset",
        Selector: "070707070707",
        HashedValidator: crypto.createHash("sha256")
            .update(RAW_TOKEN.split("-")[1]).digest("hex"),
        ExpiresOn: new Date("2026-08-26T13:00:00.000Z"),
        ConsumedOn: null
    };
    let authTokens = [{
        Id: 91,
        MemberId: member.Id,
        Selector: "existingselector",
        HashedValidator: crypto.createHash("sha256")
            .update("existingvalidator").digest("hex"),
        Expires: new Date("2030-01-01T00:00:00.000Z"),
        StayLoggedIn: true
    }];
    const events = [];
    const memberWaiters = [];
    const lateInserts = [];
    let lockOwner;
    let connectionId = 0;
    let resetUpdateCallback;
    let signalResetUpdate;
    const resetUpdateReached = new Promise(resolve => { signalResetUpdate = resolve; });

    function authRow(token) {
        return {
            Id: token.Id,
            MemberId: member.Id,
            Username: member.Username,
            Email: member.Email,
            EmailVerifiedOn: member.EmailVerifiedOn,
            PendingEmail: member.PendingEmail,
            StorageNamespace: member.StorageNamespace,
            HashedValidator: token.HashedValidator,
            Expires: token.Expires,
            StayLoggedIn: token.StayLoggedIn,
            Banned: member.Banned
        };
    }

    function acquireMember(connection, operation) {
        if (!lockOwner || lockOwner === connection) {
            lockOwner = connection;
            events.push(`member-lock-${connection.id}`);
            operation();
            return;
        }
        events.push(`member-wait-${connection.id}`);
        memberWaiters.push({connection, operation});
    }

    function releaseMember(connection) {
        if (lockOwner !== connection)
            return;
        lockOwner = undefined;
        const next = memberWaiters.shift();
        if (next) {
            lockOwner = next.connection;
            events.push(`member-lock-after-wait-${next.connection.id}`);
            next.operation();
        }
    }

    function executeQuery(connection, sql, values, callback) {
        if (sql.includes("DELETE FROM AccountActionTokens")) {
            callback(null, {affectedRows: 0});
            return;
        }
        if (sql.includes("FROM AccountActionTokens") && sql.includes("JOIN Members")) {
            acquireMember(connection, function() {
                callback(null, actionToken.ConsumedOn ? [] : [{
                    ...actionToken,
                    Username: member.Username,
                    Email: member.Email,
                    EmailVerifiedOn: member.EmailVerifiedOn
                }]);
            });
            return;
        }
        if (sql.includes("SELECT MemberId") &&
            sql.includes("FROM AccountActionTokens") &&
            !sql.includes("FOR UPDATE")) {
            callback(null, actionToken.ConsumedOn
                ? []
                : [{MemberId: actionToken.MemberId}]);
            return;
        }
        if (sql.includes("FROM AccountActionTokens") && sql.includes("FOR UPDATE")) {
            callback(null,
                !actionToken.ConsumedOn && values[1] === actionToken.MemberId
                    ? [{...actionToken}]
                    : []);
            return;
        }
        if (sql.includes("UPDATE Members SET Password")) {
            connection.changes.password = values[0];
            events.push("reset-paused-with-member-lock");
            signalResetUpdate();
            resetUpdateCallback = callback;
            return;
        }
        if (sql.includes("DELETE FROM AuthTokens WHERE MemberId")) {
            connection.changes.deleteAllSessions = true;
            callback(null, {affectedRows: authTokens.length});
            return;
        }
        if (sql.includes("UPDATE AccountActionTokens") &&
            (sql.includes("Id = ?") || sql.includes("MemberId = ?"))) {
            connection.changes.consumeAction = true;
            callback(null, {affectedRows: actionToken.ConsumedOn ? 0 : 1});
            return;
        }
        if (sql.includes("FROM Members") && sql.includes("WHERE Id = ?")) {
            const readMemberId = () => callback(null,
                values[0] === member.Id && !member.Banned ? [{
                    Id: member.Id,
                    Password: member.Password
                }] : []);
            if (sql.includes("FOR UPDATE"))
                acquireMember(connection, readMemberId);
            else
                readMemberId();
            return;
        }
        if (sql.includes("FROM Members") && sql.includes("Username = ?")) {
            const readMember = () => callback(null, [{
                Id: member.Id,
                Password: member.Password,
                Banned: member.Banned
            }]);
            if (sql.includes("FOR UPDATE"))
                acquireMember(connection, readMember);
            else
                readMember();
            return;
        }
        if (sql.includes("FROM AuthTokens AT")) {
            const readToken = function() {
                const token = authTokens.find(candidate =>
                    candidate.Selector === values[0]);
                callback(null, token ? [authRow(token)] : []);
            };
            if (sql.includes("FOR UPDATE")) {
                const source = authTokens.find(candidate =>
                    candidate.Selector === values[0]);
                if (!source) {
                    callback(null, []);
                    return;
                }
                acquireMember(connection, readToken);
            }
            else {
                readToken();
            }
            return;
        }
        if (sql.startsWith("UPDATE Members SET LastLoginDate")) {
            callback(null, {affectedRows: 1});
            return;
        }
        if (sql.startsWith("INSERT INTO AuthTokens")) {
            const insert = function() {
                const token = {
                    Id: 92 + authTokens.length,
                    MemberId: values[2],
                    Selector: values[0],
                    HashedValidator: values[1],
                    StayLoggedIn: values[3],
                    Expires: values[4]
                };
                if (connection)
                    connection.changes.insertSessions.push(token);
                else
                    authTokens.push(token);
                events.push(connection ? "transactional-session-insert" : "late-session-insert");
                callback(null, {affectedRows: 1, insertId: token.Id});
            };
            if (connection)
                insert();
            else
                lateInserts.push(insert);
            return;
        }
        if (sql.startsWith("DELETE FROM AuthTokens WHERE Id")) {
            if (connection)
                connection.changes.deleteSessionIds.push(values[0]);
            else
                authTokens = authTokens.filter(token => token.Id !== values[0]);
            callback(null, {affectedRows: 1});
            return;
        }
        assert.fail(`Unexpected concurrent database query: ${sql}`);
    }

    const pool = {
        query(sql, values, callback) {
            executeQuery(null, sql, values, callback);
        },
        getConnection(callback) {
            const connection = {
                id: ++connectionId,
                changes: {
                    password: undefined,
                    deleteAllSessions: false,
                    insertSessions: [],
                    deleteSessionIds: [],
                    consumeAction: false
                },
                query(sql, values, done) {
                    executeQuery(connection, sql, values, done);
                },
                beginTransaction(done) {
                    events.push(`begin-${connection.id}`);
                    done(null);
                },
                commit(done) {
                    if (connection.changes.password)
                        member.Password = connection.changes.password;
                    if (connection.changes.deleteAllSessions)
                        authTokens = authTokens.filter(token => token.MemberId !== member.Id);
                    if (connection.changes.deleteSessionIds.length > 0) {
                        authTokens = authTokens.filter(token =>
                            !connection.changes.deleteSessionIds.includes(token.Id));
                    }
                    authTokens.push(...connection.changes.insertSessions);
                    if (connection.changes.consumeAction)
                        actionToken.ConsumedOn = NOW;
                    events.push(`commit-${connection.id}`);
                    releaseMember(connection);
                    done(null);
                },
                rollback(done) {
                    events.push(`rollback-${connection.id}`);
                    releaseMember(connection);
                    done(null);
                },
                release() {
                    events.push(`release-${connection.id}`);
                }
            };
            callback(null, connection);
        }
    };

    return {
        pool,
        events,
        resetUpdateReached,
        releaseReset() {
            const callback = resetUpdateCallback;
            resetUpdateCallback = undefined;
            callback(null, {affectedRows: 1});
        },
        releaseLateInserts() {
            for (const insert of lateInserts.splice(0))
                insert();
        },
        get authTokens() { return authTokens.map(token => ({...token})); }
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
        Username: " legacy@example.com",
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
        identity: " legacy@example.com", ipHash: "a"
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

// Catches eligible account latency waiting on SMTP while a missing account can
// return immediately, which makes response timing an account-existence oracle.
test("eligible and missing recovery requests resolve without awaiting SMTP", async function() {
    let releaseDelivery;
    const delivery = new Promise(resolve => { releaseDelivery = resolve; });
    const eligibleDatabase = createRecoveryDatabase();
    const missingDatabase = createRecoveryDatabase({members: []});
    const eligible = createService(eligibleDatabase, {
        passwordResetDelivery: function() { return delivery; }
    });
    const missing = createService(missingDatabase);
    let eligibleSettled = false;
    let missingSettled = false;

    const eligibleRequest = eligible.service.requestRecovery({
        identity: "player@example.com",
        ipHash: "eligible-ip"
    }).then(function(result) {
        eligibleSettled = true;
        return result;
    });
    const missingRequest = missing.service.requestRecovery({
        identity: "missing@example.com",
        ipHash: "missing-ip"
    }).then(function(result) {
        missingSettled = true;
        return result;
    });

    await new Promise(resolve => setImmediate(resolve));
    const stateBeforeDelivery = {eligibleSettled, missingSettled};
    releaseDelivery();
    const [eligibleResult, missingResult] = await Promise.all([
        eligibleRequest,
        missingRequest
    ]);

    assert.deepEqual(stateBeforeDelivery, {
        eligibleSettled: true,
        missingSettled: true
    });
    assert.deepEqual(eligibleResult, {accepted: true});
    assert.deepEqual(missingResult, {accepted: true});
    assert.equal(eligible.sent.length, 1);
    assert.equal(missing.sent.length, 0);
});

// Catches a detached SMTP rejection becoming an unhandled rejection or a
// secret-bearing console write after the generic request already returned.
test("background recovery delivery handles rejection without process output", async function(t) {
    let rejectDelivery;
    const delivery = new Promise((_resolve, reject) => { rejectDelivery = reject; });
    const database = createRecoveryDatabase();
    const {service, sent} = createService(database, {
        passwordResetDelivery: function() { return delivery; }
    });
    const writes = [];
    const unhandled = [];
    const onUnhandled = reason => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    t.after(() => process.removeListener("unhandledRejection", onUnhandled));
    for (const method of ["log", "warn", "error"])
        t.mock.method(console, method, (...values) => writes.push(values));
    let settled = false;

    const request = service.requestRecovery({
        identity: "player@example.com",
        ipHash: IP_HASH
    }).then(function(result) {
        settled = true;
        return result;
    });
    await new Promise(resolve => setImmediate(resolve));
    const settledBeforeRejection = settled;
    rejectDelivery(new Error("SMTP smtp-password private@example.com"));
    const result = await request;
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(settledBeforeRejection, true);
    assert.deepEqual(result, {accepted: true});
    assert.equal(sent.length, 1);
    assert.deepEqual(unhandled, []);
    assert.deepEqual(writes, []);
});

function concurrentRecoveryService(database) {
    return createPasswordRecoveryService({
        pool: database.pool,
        mailer: {
            async sendPasswordReset() {},
            async sendPasswordChanged() {}
        },
        rateLimiter: {async recordAndCheck() {}},
        clock: () => NOW,
        randomBytes: size => Buffer.alloc(size, 7)
    });
}

function createPasswordChangeDatabase() {
    const member = {
        Id: 73,
        Username: "Player",
        Password: passwords.hash("old-password"),
        Email: "player@example.com",
        EmailVerifiedOn: NOW,
        PendingEmail: null,
        StorageNamespace: "member-73",
        Banned: 0
    };
    const authTokens = [{
        Id: 91,
        MemberId: member.Id,
        Selector: "existingselector",
        HashedValidator: crypto.createHash("sha256")
            .update("existingvalidator").digest("hex"),
        Expires: new Date("2030-01-01T00:00:00.000Z"),
        StayLoggedIn: true
    }];
    const actionTokens = [{
        Id: 41,
        MemberId: member.Id,
        Purpose: "password-reset",
        ConsumedOn: null
    }, {
        Id: 42,
        MemberId: member.Id,
        Purpose: "verify-email",
        ConsumedOn: null
    }];
    const events = [];
    let snapshot;

    function authRow(token) {
        return {
            ...token,
            Username: member.Username,
            Email: member.Email,
            EmailVerifiedOn: member.EmailVerifiedOn,
            PendingEmail: member.PendingEmail,
            StorageNamespace: member.StorageNamespace,
            Banned: member.Banned
        };
    }

    function execute(sql, values, callback) {
        if (sql.includes("SELECT AT.MemberId")) {
            const token = authTokens.find(candidate => candidate.Selector === values[0]);
            events.push("discover-session");
            callback(null, token ? [{MemberId: token.MemberId}] : []);
            return;
        }
        if (sql.includes("FROM Members") && sql.includes("WHERE Id = ?") &&
            sql.includes("FOR UPDATE")) {
            events.push("lock-member");
            callback(null, values[0] === member.Id ? [{
                Id: member.Id,
                Password: member.Password
            }] : []);
            return;
        }
        if (sql.includes("FROM AuthTokens AT")) {
            const token = authTokens.find(candidate => candidate.Selector === values[0]);
            events.push("lock-source-session");
            callback(null, token ? [authRow(token)] : []);
            return;
        }
        if (sql.includes("UPDATE Members SET Password")) {
            member.Password = values[0];
            events.push("update-password");
            callback(null, {affectedRows: 1});
            return;
        }
        if (sql.includes("UPDATE AccountActionTokens")) {
            for (const token of actionTokens) {
                if (token.MemberId === values[0] && token.Purpose === "password-reset" &&
                    token.ConsumedOn === null) {
                    token.ConsumedOn = NOW;
                }
            }
            events.push("consume-reset-tokens");
            callback(null, {affectedRows: 1});
            return;
        }
        assert.fail(`Unexpected password-change query: ${sql}`);
    }

    const pool = {
        query: execute,
        getConnection(callback) {
            callback(null, {
                query: execute,
                beginTransaction(done) {
                    snapshot = {
                        password: member.Password,
                        consumedOn: actionTokens.map(token => token.ConsumedOn)
                    };
                    events.push("begin");
                    done(null);
                },
                commit(done) {
                    events.push("commit");
                    done(null);
                },
                rollback(done) {
                    member.Password = snapshot.password;
                    actionTokens.forEach((token, index) => {
                        token.ConsumedOn = snapshot.consumedOn[index];
                    });
                    events.push("rollback");
                    done(null);
                },
                release() { events.push("release"); }
            });
        }
    };

    return {pool, member, authTokens, actionTokens, events};
}

// Catches ordinary password changes pre-rotating the source session, updating
// outside a member-row transaction, or leaving reset links usable.
test("ordinary password change keeps its source session and revokes reset tokens atomically", async function() {
    const database = createPasswordChangeDatabase();
    const auth = loadAuthApi(database.pool);

    const result = await auth.utils.changePassword(
        {ip: "change-ip", headers: {}},
        "existingselector-existingvalidator",
        "old-password",
        "replacement-password"
    );

    assert.deepEqual(result, {
        success: true,
        tokenRenewal: {
            token: "existingselector-existingvalidator",
            expires: new Date("2030-01-01T00:00:00.000Z")
        }
    });
    assert.equal(passwords.verify("replacement-password", database.member.Password), true);
    assert.equal(database.authTokens.length, 1, "the current session remains usable");
    assert.equal(database.actionTokens[0].ConsumedOn !== null, true);
    assert.equal(database.actionTokens[1].ConsumedOn, null,
        "ordinary change revokes reset tokens without consuming email verification");
    assert.deepEqual(database.events, [
        "begin",
        "discover-session",
        "lock-member",
        "lock-source-session",
        "update-password",
        "consume-reset-tokens",
        "commit",
        "release"
    ]);
});

// Catches an old-password login reading before reset commits and inserting a
// new session after reset's member-wide deletion.
test("reset member lock prevents concurrent old-password login from leaving a session", async function() {
    const database = createConcurrentSecurityDatabase();
    const recovery = concurrentRecoveryService(database);
    const auth = loadAuthApi(database.pool);
    const reset = recovery.resetPassword({
        token: RAW_TOKEN,
        newPassword: "replacement-password"
    });
    await database.resetUpdateReached;

    const login = auth.utils.authLogin(
        "Player", "old-password", false, "login-ip"
    ).then(
        result => ({status: "fulfilled", result}),
        error => ({status: "rejected", error})
    );
    await new Promise(resolve => setImmediate(resolve));
    database.releaseReset();
    assert.deepEqual(await reset, {success: true});
    database.releaseLateInserts();
    const outcome = await login;

    assert.equal(outcome.status, "rejected");
    assert.equal(outcome.error.message, "Invalid username or password.");
    assert.deepEqual(database.authTokens, []);
    assert.equal(database.events.includes("member-wait-2"), true);
    assert.equal(database.events.indexOf("commit-1") <
        database.events.indexOf("member-lock-after-wait-2"), true);
});

// Catches an old-password-authorized account mutation waiting behind reset,
// then overwriting the newly reset password after the reset commits.
test("reset member lock prevents a concurrent ordinary password change from overwriting reset", async function() {
    const database = createConcurrentSecurityDatabase();
    const recovery = concurrentRecoveryService(database);
    const auth = loadAuthApi(database.pool);
    const reset = recovery.resetPassword({
        token: RAW_TOKEN,
        newPassword: "replacement-password"
    });
    await database.resetUpdateReached;

    const change = auth.utils.changePassword(
        {ip: "change-ip", headers: {}},
        "existingselector-existingvalidator",
        "old-password",
        "attacker-chosen-password"
    ).then(
        result => ({status: "fulfilled", result}),
        error => ({status: "rejected", error})
    );
    await new Promise(resolve => setImmediate(resolve));
    database.releaseReset();
    assert.deepEqual(await reset, {success: true});
    const outcome = await change;

    assert.equal(outcome.status, "rejected");
    assert.equal(outcome.error.extensions.code, 401);
    assert.deepEqual(database.authTokens, []);
    assert.equal(database.events.includes("member-wait-2"), true);
    assert.equal(database.events.indexOf("commit-1") <
        database.events.indexOf("member-lock-after-wait-2"), true);
});

// Catches renewal reading a source session before reset commits and inserting
// its replacement after reset has already deleted all member sessions.
test("reset member lock prevents concurrent renewal from leaving a replacement session", async function() {
    const database = createConcurrentSecurityDatabase();
    const recovery = concurrentRecoveryService(database);
    const auth = loadAuthApi(database.pool);
    const reset = recovery.resetPassword({
        token: RAW_TOKEN,
        newPassword: "replacement-password"
    });
    await database.resetUpdateReached;

    const renewal = auth.utils.authToken(
        "existingselector-existingvalidator", "renew-ip", true, false
    ).then(
        result => ({status: "fulfilled", result}),
        error => ({status: "rejected", error})
    );
    await new Promise(resolve => setImmediate(resolve));
    database.releaseReset();
    assert.deepEqual(await reset, {success: true});
    database.releaseLateInserts();
    const outcome = await renewal;

    assert.equal(outcome.status, "rejected");
    assert.equal(outcome.error.message, "Invalid token");
    assert.deepEqual(database.authTokens, []);
    assert.equal(database.events.includes("member-wait-2"), true);
    assert.equal(database.events.indexOf("commit-1") <
        database.events.indexOf("member-lock-after-wait-2"), true);
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
    }, {
        Id: 42,
        MemberId: 73,
        Purpose: "change-email",
        Selector: "080808080808",
        HashedValidator: "d".repeat(64),
        RequestIPHash: IP_HASH,
        CreatedOn: NOW,
        ExpiresOn: new Date("2026-08-27T13:00:00.000Z"),
        ConsumedOn: null
    }]});
    database.members[0].PendingEmail = "attacker@example.com";
    database.members[0].PendingNormalizedEmail = "attacker@example.com";
    const {service, sent} = createService(database);

    assert.deepEqual(await service.resetPassword({
        token: RAW_TOKEN,
        newPassword: "replacement-password"
    }), {success: true});

    assert.equal(passwords.verify("replacement-password", database.members[0].Password), true);
    assert.equal(passwords.verify("old-password", database.members[0].Password), false);
    assert.deepEqual(database.authTokens, [{Id: 83, MemberId: 99}]);
    assert.equal(database.actionTokens.every(token =>
        token.ConsumedOn?.getTime() === NOW.getTime()), true);
    assert.equal(database.members[0].PendingEmail, null);
    assert.equal(database.members[0].PendingNormalizedEmail, null);
    assert.equal(database.queries.some(({sql}) =>
        sql.includes("INSERT INTO AuthTokens")), false);
    assert.equal(database.events.indexOf("begin") < database.events.indexOf("update-password"), true);
    assert.equal(database.events.indexOf("update-password") < database.events.indexOf("delete-sessions"), true);
    assert.equal(database.events.indexOf("delete-sessions") <
        database.events.indexOf("consume-member-action-tokens"), true);
    assert.equal(database.events.indexOf("consume-member-action-tokens") <
        database.events.indexOf("commit"), true);
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

// Catches reset taking an action-token lock before the member lock used by an
// ordinary password change, including through retention cleanup in the same
// credential transaction. That inverse ordering can deadlock the two paths.
test("reset releases retention cleanup then locks member before its purpose token", async function() {
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
    const {service} = createService(database);

    assert.deepEqual(await service.resetPassword({
        token: RAW_TOKEN,
        newPassword: "replacement-password"
    }), {success: true});

    assert.deepEqual(database.events.filter(event => [
        "discover-reset-token-member",
        "lock-reset-member",
        "lock-reset-token"
    ].includes(event)), [
        "discover-reset-token-member",
        "lock-reset-member",
        "lock-reset-token"
    ]);
    assert.equal(database.events.indexOf("cleanup-action-tokens") <
        database.events.indexOf("begin"), true,
        "autocommit retention cleanup releases token locks before credential locking");

    const discovery = database.queries.find(({sql}) =>
        sql.includes("SELECT MemberId") && sql.includes("FROM AccountActionTokens"));
    assert.doesNotMatch(discovery.sql, /FOR UPDATE/i);
    const memberLock = database.queries.find(({sql}) =>
        sql.includes("FROM Members") && sql.includes("WHERE Id = ?"));
    assert.match(memberLock.sql, /FOR UPDATE/i);
    const purposeTokenLock = database.queries.find(({sql}) =>
        sql.includes("FROM AccountActionTokens") && sql.includes("FOR UPDATE"));
    assert.match(purposeTokenLock.sql, /Purpose\s*=\s*'password-reset'/i);
    assert.match(purposeTokenLock.sql, /MemberId\s*=\s*\?/i);
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
// retention cleanup using a different clock or retaining locks into reset.
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
        sql.includes("SELECT MemberId") && sql.includes("AccountActionTokens"));
    assert.deepEqual(selectorLookup.values, ["070707070707"]);
    assert.equal(JSON.stringify(database.queries).includes(RAW_TOKEN), false);
    assert.equal(database.actionTokens.some(token => token.Id === 39), false,
        "invalid consumption still commits the injected-clock cleanup");
    assert.equal(database.events.includes("commit"), true);
    assert.equal(database.events.indexOf("cleanup-action-tokens") <
        database.events.indexOf("begin"), true);
});
