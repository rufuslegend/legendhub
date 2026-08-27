"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const {createAccountEmailService} = require("../src/routes/api/account-email-service");
const passwords = require("../src/routes/api/php-password");

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

function createEmailFlowDatabase() {
    const member = {
        Id: 73,
        Username: "Player",
        Password: passwords.hash("secret"),
        Email: "old@example.com",
        NormalizedEmail: "old@example.com",
        EmailVerifiedOn: new Date("2026-08-20T12:00:00.000Z"),
        PendingEmail: null,
        PendingNormalizedEmail: null
    };
    const tokens = [{
        Id: 4,
        MemberId: member.Id,
        Purpose: "change-email",
        Selector: "010101010101",
        HashedValidator: "a".repeat(64),
        PendingEmail: "stale@example.com",
        PendingNormalizedEmail: "stale@example.com",
        CreatedOn: new Date("2026-08-25T10:00:00.000Z"),
        ExpiresOn: new Date("2026-08-27T10:00:00.000Z"),
        ConsumedOn: null
    }, {
        Id: 5,
        MemberId: member.Id,
        Purpose: "verify-email",
        Selector: "020202020202",
        HashedValidator: "b".repeat(64),
        PendingEmail: null,
        PendingNormalizedEmail: null,
        CreatedOn: new Date("2026-08-24T10:00:00.000Z"),
        ExpiresOn: new Date("2026-08-25T10:00:00.000Z"),
        ConsumedOn: new Date("2026-08-24T11:00:00.000Z")
    }];
    const events = [];
    const queries = [];
    let nextTokenId = 6;
    let snapshot;

    const connection = {
        beginTransaction(callback) {
            snapshot = {
                member: {...member},
                tokens: tokens.map(token => ({...token}))
            };
            events.push("begin");
            callback(null);
        },
        commit(callback) {
            events.push("commit");
            snapshot = null;
            callback(null);
        },
        rollback(callback) {
            events.push("rollback");
            Object.assign(member, snapshot.member);
            tokens.splice(0, tokens.length, ...snapshot.tokens);
            snapshot = null;
            callback(null);
        },
        release() {
            events.push("release-connection");
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
                callback(null, [{Released: 1}]);
                return;
            }
            if (sql.includes("FROM Members") && sql.includes("Password") &&
                sql.includes("FOR UPDATE")) {
                callback(null, values[0] === member.Id ? [{...member}] : []);
                return;
            }
            if (sql.includes("FROM Members") && sql.includes("PendingNormalizedEmail") &&
                sql.includes("Id <>")) {
                callback(null, []);
                return;
            }
            if (sql.includes("UPDATE Members") && sql.includes("PendingEmail = ?")) {
                member.PendingEmail = values[0];
                member.PendingNormalizedEmail = values[1];
                events.push("store-pending-email");
                callback(null, {affectedRows: 1});
                return;
            }
            if (sql.includes("DELETE FROM AccountActionTokens")) {
                const [consumedCutoff, expiryCutoff] = values;
                for (let index = tokens.length - 1; index >= 0; index -= 1) {
                    const token = tokens[index];
                    if ((token.ConsumedOn && token.ConsumedOn < consumedCutoff) ||
                        token.ExpiresOn < expiryCutoff) {
                        tokens.splice(index, 1);
                    }
                }
                events.push("cleanup-action-tokens");
                callback(null, {affectedRows: 1});
                return;
            }
            if (sql.includes("UPDATE AccountActionTokens") && sql.includes("Purpose = ?") &&
                !sql.includes("Purpose IN")) {
                for (const token of tokens) {
                    if (token.MemberId === values[1] && token.Purpose === values[2] &&
                        token.ConsumedOn === null) {
                        token.ConsumedOn = values[0];
                    }
                }
                events.push("invalidate-action-tokens");
                callback(null, {affectedRows: 1});
                return;
            }
            if (sql.includes("INSERT INTO AccountActionTokens")) {
                tokens.push({
                    Id: nextTokenId++,
                    MemberId: values[0],
                    Purpose: values[1],
                    Selector: values[2],
                    HashedValidator: values[3],
                    PendingEmail: values[4],
                    PendingNormalizedEmail: values[5],
                    RequestIPHash: values[6],
                    CreatedOn: values[7],
                    ExpiresOn: values[8],
                    ConsumedOn: null
                });
                events.push("insert-action-token");
                callback(null, {affectedRows: 1, insertId: nextTokenId - 1});
                return;
            }
            if (sql.includes("FROM AccountActionTokens") && sql.includes("FOR UPDATE")) {
                const token = tokens.find(candidate => candidate.Selector === values[0] &&
                    ["verify-email", "change-email"].includes(candidate.Purpose));
                callback(null, token ? [{...token}] : []);
                return;
            }
            if (sql.includes("FROM Members") && sql.includes("WHERE Id = ?") &&
                sql.includes("FOR UPDATE")) {
                callback(null, values[0] === member.Id ? [{...member}] : []);
                return;
            }
            if (sql.includes("UPDATE Members") && sql.includes("EmailVerifiedOn = ?") &&
                sql.includes("PendingEmail = NULL")) {
                member.Email = values[0];
                member.NormalizedEmail = values[1];
                member.EmailVerifiedOn = values[2];
                member.PendingEmail = null;
                member.PendingNormalizedEmail = null;
                events.push("promote-pending-email");
                callback(null, {affectedRows: 1});
                return;
            }
            if (sql.includes("UPDATE Members") && sql.includes("EmailVerifiedOn = ?")) {
                member.EmailVerifiedOn = values[0];
                events.push("verify-active-email");
                callback(null, {affectedRows: 1});
                return;
            }
            if (sql.includes("UPDATE AccountActionTokens") && sql.includes("Purpose IN")) {
                for (const token of tokens) {
                    if (token.MemberId === values[1] && token.ConsumedOn === null)
                        token.ConsumedOn = values[0];
                }
                events.push("consume-sibling-tokens");
                callback(null, {affectedRows: 1});
                return;
            }
            callback(new Error(`Unexpected email-flow query: ${sql}`));
        }
    };

    return {
        pool: {getConnection(callback) { callback(null, connection); }},
        member,
        tokens,
        events,
        queries
    };
}

function createEmailFlowService(database) {
    const deliveries = [];
    const rateLimitInputs = [];
    return {
        service: createAccountEmailService({
            pool: database.pool,
            mailer: {
                async sendVerification(message) {
                    database.events.push("send-verification");
                    deliveries.push({kind: "verification", ...message});
                },
                async sendEmailChanged(message) {
                    database.events.push("send-email-change-verification");
                    deliveries.push({kind: "email-change-verification", ...message});
                },
                async sendEmailChangeNotice(message) {
                    database.events.push("send-email-change-notice");
                    deliveries.push({kind: "email-change-notice", ...message});
                }
            },
            rateLimiter: {
                async recordAndCheck(input) {
                    database.events.push("rate-limit");
                    rateLimitInputs.push(input);
                }
            },
            clock: () => NOW,
            randomBytes: size => Buffer.alloc(size, 9)
        }),
        deliveries,
        rateLimitInputs
    };
}

// Catches replacing an active verified address before proof of control,
// storing a raw token, or notifying the old address before the commit.
test("email change keeps the verified address active until token verification", async function() {
    const database = createEmailFlowDatabase();
    const {service, deliveries, rateLimitInputs} = createEmailFlowService(database);
    const auth = {
        memberId: database.member.Id,
        username: database.member.Username,
        email: database.member.Email,
        emailVerified: true,
        pendingEmail: null
    };

    assert.deepEqual(await service.requestEmailChange({
        auth,
        currentPassword: "secret",
        email: " New@Example.COM ",
        ipHash: IP_HASH
    }), {success: true, pendingEmail: "New@Example.COM"});

    assert.equal(database.member.Email, "old@example.com");
    assert.equal(database.member.NormalizedEmail, "old@example.com");
    assert.equal(database.member.PendingEmail, "New@Example.COM");
    assert.equal(database.member.PendingNormalizedEmail, "new@example.com");
    assert.deepEqual(rateLimitInputs, [{
        purpose: "change-email",
        identity: "new@example.com",
        ipHash: IP_HASH
    }]);

    const created = database.tokens.find(token => token.Selector === "090909090909");
    const deliveredToken = deliveries[0].token;
    assert.equal(created.Purpose, "change-email");
    assert.equal(created.HashedValidator,
        "3d25bc5d4f789541b4a89d47d46a33fc2f21ef8787b657fc0f2d56e079bfb88b");
    assert.equal(JSON.stringify(created).includes(deliveredToken), false);
    assert.equal(database.events.indexOf("commit") <
        database.events.indexOf("send-email-change-verification"), true);

    const verificationEventStart = database.events.length;
    assert.deepEqual(await service.verifyEmailToken(deliveredToken), {
        success: true,
        message: "Your email address has been verified."
    });

    assert.equal(database.member.Email, "New@Example.COM");
    assert.equal(database.member.NormalizedEmail, "new@example.com");
    assert.equal(database.member.PendingEmail, null);
    assert.equal(database.member.PendingNormalizedEmail, null);
    assert.deepEqual(database.member.EmailVerifiedOn, NOW);
    assert.equal(database.tokens.every(token => token.ConsumedOn !== null), true);
    assert.deepEqual(deliveries.at(-1), {
        kind: "email-change-notice",
        to: "old@example.com",
        username: "Player"
    });
    assert.equal(database.events.lastIndexOf("commit") <
        database.events.indexOf("send-email-change-notice"), true);
    assert.deepEqual(database.events.slice(verificationEventStart), [
        "begin",
        "cleanup-action-tokens",
        "promote-pending-email",
        "consume-sibling-tokens",
        "commit",
        "release-connection",
        "send-email-change-notice"
    ]);
});

// Catches treating a password-protected mutation as authorized solely by an
// existing login session or retaining a claim after invalid credentials.
test("email change rejects an invalid current password before claiming the address", async function() {
    const database = createEmailFlowDatabase();
    const {service, deliveries} = createEmailFlowService(database);

    assert.deepEqual(await service.requestEmailChange({
        auth: {
            memberId: database.member.Id,
            username: database.member.Username,
            email: database.member.Email,
            emailVerified: true,
            pendingEmail: null
        },
        currentPassword: "wrong-secret",
        email: "new@example.com",
        ipHash: IP_HASH
    }), {success: false, pendingEmail: null});

    assert.equal(database.member.PendingEmail, null);
    assert.equal(database.tokens.some(token => token.Selector === "090909090909"), false);
    assert.equal(deliveries.length, 0);
    assert.equal(database.events.includes("rollback"), true);
});

// Catches validator equality shortcuts, purpose confusion, token replay, and
// consumption cleanup using wall-clock time rather than the injected clock.
test("verification is purpose-bound, single-use, and cleans retained tokens atomically", async function() {
    const database = createEmailFlowDatabase();
    const {service, deliveries} = createEmailFlowService(database);
    const auth = {
        memberId: database.member.Id,
        username: database.member.Username,
        email: database.member.Email,
        emailVerified: true,
        pendingEmail: null
    };
    await service.requestEmailChange({
        auth,
        currentPassword: "secret",
        email: "new@example.com",
        ipHash: IP_HASH
    });
    const deliveredToken = deliveries[0].token;
    const [selector] = deliveredToken.split("-");

    assert.deepEqual(await service.verifyEmailToken(`${selector}-${"0".repeat(48)}`), {
        success: false,
        message: "This verification link is invalid or has expired."
    });
    assert.equal(database.member.Email, "old@example.com");

    await service.verifyEmailToken(deliveredToken);
    assert.deepEqual(await service.verifyEmailToken(deliveredToken), {
        success: false,
        message: "This verification link is invalid or has expired."
    });
    assert.equal(deliveries.filter(delivery =>
        delivery.kind === "email-change-notice").length, 1);

    const cleanups = database.queries.filter(({sql}) =>
        sql.includes("DELETE FROM AccountActionTokens"));
    assert.equal(cleanups.length >= 2, true);
    assert.deepEqual(cleanups.at(-1).values, [
        new Date("2026-08-25T12:00:00.000Z"),
        new Date("2026-08-25T12:00:00.000Z")
    ]);
});

// Catches deriving storage eligibility from legacy account access rather than
// verified email status, which would gate grandfathered login behavior.
test("account email status grants account storage only to verified email", function() {
    const database = createEmailFlowDatabase();
    const {service} = createEmailFlowService(database);

    assert.deepEqual(service.getAccountEmailStatus({
        email: null,
        emailVerified: false,
        pendingEmail: "new@example.com"
    }), {
        email: null,
        verified: false,
        pendingEmail: "new@example.com",
        canUseAccountStorage: false
    });
    assert.deepEqual(service.getAccountEmailStatus({
        email: "old@example.com",
        emailVerified: true,
        pendingEmail: null
    }), {
        email: "old@example.com",
        verified: true,
        pendingEmail: null,
        canUseAccountStorage: true
    });
    assert.deepEqual(service.getAccountEmailStatus({
        email: null,
        emailVerified: true,
        pendingEmail: null
    }), {
        email: null,
        verified: false,
        pendingEmail: null,
        canUseAccountStorage: false
    });
});

// Catches resend bypassing durable throttling or allowing an earlier token for
// the same pending action to remain usable.
test("resend is durable-rate-limited and replaces the same-action token", async function() {
    const database = createEmailFlowDatabase();
    database.member.PendingEmail = "pending@example.com";
    database.member.PendingNormalizedEmail = "pending@example.com";
    const {service, deliveries, rateLimitInputs} = createEmailFlowService(database);

    assert.deepEqual(await service.resendVerification({
        auth: {
            memberId: database.member.Id,
            username: database.member.Username,
            email: database.member.Email,
            emailVerified: true,
            pendingEmail: database.member.PendingEmail
        },
        ipHash: IP_HASH
    }), {accepted: true});

    assert.deepEqual(rateLimitInputs, [{
        purpose: "change-email",
        identity: "pending@example.com",
        ipHash: IP_HASH
    }]);
    assert.equal(database.tokens.find(token => token.Id === 4).ConsumedOn !== null, true);
    assert.equal(database.tokens.filter(token =>
        token.Purpose === "change-email" && token.ConsumedOn === null).length, 1);
    assert.deepEqual(deliveries[0], {
        kind: "email-change-verification",
        to: "pending@example.com",
        username: "Player",
        token: "090909090909-090909090909090909090909090909090909090909090909"
    });
});

// Catches durable rate-limit storage diagnostics escaping through either
// authenticated email mutation's public GraphQL error.
test("email mutations hide rate-limit database diagnostics", async function() {
    const database = createEmailFlowDatabase();
    const privateDiagnostic = "private AccountActionAttempts driver detail";
    const service = createAccountEmailService({
        pool: database.pool,
        mailer: {},
        rateLimiter: {
            async recordAndCheck() { throw new Error(privateDiagnostic); }
        },
        clock: () => NOW,
        randomBytes: size => Buffer.alloc(size, 9)
    });
    const auth = {
        memberId: database.member.Id,
        username: database.member.Username,
        email: database.member.Email,
        emailVerified: false,
        pendingEmail: null
    };

    await assert.rejects(service.requestEmailChange({
        auth,
        currentPassword: "secret",
        email: "new@example.com",
        ipHash: IP_HASH
    }), error => error.message === "Account email update failed." &&
        !error.message.includes(privateDiagnostic));
    await assert.rejects(service.resendVerification({auth, ipHash: IP_HASH}),
        error => error.message === "Verification could not be resent." &&
            !error.message.includes(privateDiagnostic));
});
