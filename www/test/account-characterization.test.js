"use strict";

const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

const routePath = require.resolve("../src/routes/account");
const accountApiPath = require.resolve("../src/routes/api/account");
const authApiPath = require.resolve("../src/routes/api/auth");

function loadAccountRoute(postAsync) {
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (request === "./api/utils" && parent.filename === routePath)
            return {postAsync};
        if (request === "./api/auth" && parent.filename === routePath)
            return {};

        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        delete require.cache[routePath];
        return require(routePath);
    }
    finally {
        Module._load = originalLoad;
    }
}

function loadAccountApi(mysql, auth, accountEmailService = {}) {
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (request === "./mysql-connection" && parent.filename === accountApiPath)
            return mysql;
        if (request === "./auth" && parent.filename === accountApiPath)
            return auth;
        if (request === "./account-email-service" && parent.filename === accountApiPath) {
            return {
                createAccountEmailService: function() {
                    return accountEmailService;
                }
            };
        }
        if (request === "./account-rate-limit" && parent.filename === accountApiPath) {
            return {
                createAccountRateLimiter: function() {
                    return {recordAndCheck: async function() {}};
                }
            };
        }

        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        delete require.cache[accountApiPath];
        return require(accountApiPath);
    }
    finally {
        Module._load = originalLoad;
    }
}

function loadAuthApi(mysql, accountEmailService) {
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (request === "./mysql-connection" && parent?.filename === authApiPath)
            return mysql;
        if (request === "./account-email-service" && parent?.filename === authApiPath) {
            return {
                createAccountEmailService: function() {
                    return accountEmailService;
                }
            };
        }

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

function mysqlWithMembers(members) {
    const queries = [];
    return {
        queries,
        query: function(sql, values, callback) {
            queries.push({sql, values});
            if (sql.includes("FROM Members") && sql.includes("NormalizedEmail") &&
                sql.includes("Username = ?")) {
                const usernameMatches = members.filter(member => member.Username === values[0]);
                const emailMatches = members.filter(member =>
                    member.NormalizedEmail === values[1] && member.EmailVerifiedOn &&
                    !usernameMatches.includes(member));
                callback(null, [...usernameMatches, ...emailMatches].slice(0, 1));
                return;
            }
            if (sql.includes("FROM Members") && sql.includes("NormalizedEmail")) {
                callback(null, members.filter(member =>
                    member.NormalizedEmail === values[0] && member.EmailVerifiedOn));
                return;
            }
            if (sql.includes("FROM Members") && sql.includes("Username")) {
                callback(null, members.filter(member => member.Username === values[0]));
                return;
            }
            callback(null, {affectedRows: 1, insertId: 101});
        }
    };
}

function getAccountRouteHandler(router) {
    return router.stack.find(function(layer) {
        return layer.route && layer.route.path.includes("/");
    }).route.stack[0].handle;
}

test("account route renders all notification settings", async function() {
    const notificationSettings = {
        itemAdded: true,
        itemUpdated: false,
        mobAdded: false,
        mobUpdated: true,
        questAdded: true,
        questUpdated: false,
        wikiPageAdded: true,
        wikiPageUpdated: false,
        changelogAdded: true
    };
    let captured;
    const router = loadAccountRoute(async function(query, ip, variables) {
        captured = {query, ip, variables};
        for (const setting of Object.keys(notificationSettings))
            assert.match(query, new RegExp(`\\b${setting}\\b`));
        return {
            getNotificationSettings: notificationSettings,
            getAccountEmailStatus: {
                email: "player@example.com",
                verified: true,
                pendingEmail: null,
                canUseAccountStorage: true
            }
        };
    });
    let rendered;

    await getAccountRouteHandler(router)(
        {cookies: {loginToken: "account-token"}},
        {
            locals: {user: {memberId: 7}},
            redirect: function() {
                assert.fail("an authenticated account request must not redirect");
            },
            render: function(view, locals) {
                rendered = {view, locals};
            }
        },
        function(error) {
            throw error;
        }
    );

    assert.equal(rendered.view, "account/index");
    assert.deepEqual(rendered.locals.vm.notificationSettings, notificationSettings);
    assert.deepEqual(rendered.locals.vm.emailStatus, {
        email: "player@example.com",
        verified: true,
        pendingEmail: null,
        canUseAccountStorage: true
    });
    for (const field of ["email", "verified", "pendingEmail", "canUseAccountStorage"])
        assert.match(captured.query, new RegExp(`\\b${field}\\b`));
    assert.doesNotMatch(captured.query, /account-token/);
    assert.equal(captured.ip, undefined);
    assert.deepEqual(captured.variables, {authToken: "account-token"});
});

// Catches account email queries/mutations bypassing the established auth and
// email-service boundaries or dropping the structured status contract.
test("account email GraphQL fields authenticate and delegate structured status and mutations", async function() {
    const authResult = {
        memberId: 73,
        username: "Player",
        email: "old@example.com",
        emailVerified: true,
        pendingEmail: null,
        ip: "request-ip-hash",
        token: "renewed-token",
        expires: "2030-01-01T00:00:00.000Z"
    };
    const calls = [];
    const emailStatus = {
        email: "old@example.com",
        verified: true,
        pendingEmail: null,
        canUseAccountStorage: true
    };
    const accountEmailService = {
        getAccountEmailStatus(auth) {
            calls.push({operation: "status", auth});
            return emailStatus;
        },
        async requestEmailChange(input) {
            calls.push({operation: "change", input});
            return {success: true, pendingEmail: "new@example.com"};
        },
        async resendVerification(input) {
            calls.push({operation: "resend", input});
            return {accepted: true};
        }
    };
    const account = loadAccountApi({query() {
        assert.fail("the email service owns account email database work");
    }}, {
        types: {tokenRenewalType: require("graphql").GraphQLString},
        utils: {
            authQuery: async function() { return authResult; },
            authMutation: async function() { return authResult; }
        }
    }, accountEmailService);

    const statusField = account.queryFields.getAccountEmailStatus;
    for (const field of ["email", "verified", "pendingEmail", "canUseAccountStorage"])
        assert.ok(statusField.type.ofType.getFields()[field]);
    assert.deepEqual(await statusField.resolve(null, {
        authToken: "account-token"
    }, {}), emailStatus);

    const change = await account.mutationFields.requestEmailChange.resolve(null, {
        authToken: "account-token",
        currentPassword: "current-secret",
        email: "new@example.com"
    }, {});
    assert.deepEqual(change, {
        success: true,
        pendingEmail: "new@example.com",
        tokenRenewal: {
            token: "renewed-token",
            expires: "2030-01-01T00:00:00.000Z"
        }
    });

    const resend = await account.mutationFields.resendVerification.resolve(null, {
        authToken: "account-token"
    }, {});
    assert.deepEqual(resend, {
        accepted: true,
        tokenRenewal: {
            token: "renewed-token",
            expires: "2030-01-01T00:00:00.000Z"
        }
    });
    assert.deepEqual(calls, [{operation: "status", auth: authResult}, {
        operation: "change",
        input: {
            auth: authResult,
            currentPassword: "current-secret",
            email: "new@example.com",
            ipHash: "request-ip-hash"
        }
    }, {
        operation: "resend",
        input: {auth: authResult, ipHash: "request-ip-hash"}
    }]);
});

test("notification mutation preserves every boolean field", async function() {
    const notificationSettings = {
        itemAdded: true,
        itemUpdated: false,
        mobAdded: true,
        mobUpdated: false,
        questAdded: true,
        questUpdated: false,
        wikiPageAdded: true,
        wikiPageUpdated: false
    };
    const queries = [];
    const authResult = {
        memberId: 73,
        token: "renewed-token",
        expires: "2030-01-01T00:00:00.000Z"
    };
    const account = loadAccountApi({
        query: function(sql, values, callback) {
            queries.push({sql, values});
            callback(null, {affectedRows: 1});
        }
    }, {
        types: {tokenRenewalType: require("graphql").GraphQLString},
        utils: {
            authMutation: async function() {
                return authResult;
            }
        }
    });

    const result = await account.mutationFields.updateNotificationSettings.resolve(
        null,
        {authToken: "account-token", ...notificationSettings},
        {}
    );

    assert.deepEqual(result, {
        token: authResult.token,
        expires: authResult.expires
    });
    assert.equal(queries.length, 1);
    assert.deepEqual(queries[0].values, [
        true, false, true, false, true, false, true, false, 73
    ]);
});

test("password mutation distinguishes invalid and successful passwords", async function() {
    const passwords = require("../src/routes/api/php-password");
    const existingHash = passwords.hash("current-password");
    const updates = [];
    const authResult = {
        memberId: 19,
        token: "renewed-token",
        expires: null
    };
    const account = loadAccountApi({
        query: function(sql, values, callback) {
            if (sql.startsWith("SELECT Password")) {
                callback(null, [{Password: existingHash}]);
                return;
            }

            if (sql.startsWith("UPDATE Members SET Password")) {
                updates.push(values);
                callback(null, {affectedRows: 1});
                return;
            }

            assert.fail(`Unexpected database query: ${sql}`);
        }
    }, {
        types: {tokenRenewalType: require("graphql").GraphQLString},
        utils: {
            authMutation: async function() {
                return authResult;
            }
        }
    });
    const resolve = account.mutationFields.updatePassword.resolve;

    const invalid = await resolve(null, {
        authToken: "account-token",
        currentPassword: "incorrect-password",
        newPassword: "new-password"
    }, {});
    const successful = await resolve(null, {
        authToken: "account-token",
        currentPassword: "current-password",
        newPassword: "new-password"
    }, {});

    assert.deepEqual(invalid, {
        success: false,
        tokenRenewal: {token: authResult.token, expires: authResult.expires}
    });
    assert.equal(updates.length, 1);
    assert.equal(updates[0][1], authResult.memberId);
    assert.equal(passwords.verify("new-password", updates[0][0]), true);
    assert.deepEqual(successful, {
        success: true,
        tokenRenewal: {token: authResult.token, expires: authResult.expires}
    });
});

// Catches a single username query path, accepting unverified/pending email,
// or failing to apply trim-plus-lowercase normalization to email identity.
test("login accepts a verified normalized email but rejects pending email", async function() {
    const passwords = require("../src/routes/api/php-password");
    const password = "correct-password";
    const hash = passwords.hash(password);
    const mysql = mysqlWithMembers([{
        Id: 7,
        Username: "Player",
        NormalizedEmail: "player@example.com",
        PendingNormalizedEmail: "pending@example.com",
        EmailVerifiedOn: new Date("2026-08-26T00:00:00Z"),
        Password: hash,
        Banned: 0
    }]);
    const auth = loadAuthApi(mysql, {register: async () => ({registered: true})});

    assert.ok(await auth.utils.authLogin(
        " PLAYER@EXAMPLE.COM ", password, false, "ip-hash"));
    await assert.rejects(
        auth.utils.authLogin("pending@example.com", password, false, "ip-hash"),
        error => error.message === "Invalid username or password."
    );

    const identityQueries = mysql.queries.filter(({sql}) => sql.includes("FROM Members"));
    assert.equal(identityQueries.every(({sql}) =>
        sql.includes("EmailVerifiedOn IS NOT NULL") && !sql.includes("PendingNormalizedEmail")), true);
    assert.deepEqual(identityQueries.map(({values}) => values), [
        ["PLAYER@EXAMPLE.COM", "player@example.com", "PLAYER@EXAMPLE.COM"],
        ["pending@example.com", "pending@example.com", "pending@example.com"]
    ]);
});

// Catches omitted or non-string GraphQL passwords reaching bcrypt inside an
// asynchronous MySQL callback, where they can throw and disclose account state.
test("login rejects a missing or non-string password generically before querying", async function() {
    const passwords = require("../src/routes/api/php-password");
    for (const password of [undefined, null, 7, {}]) {
        let queryCount = 0;
        const auth = loadAuthApi({
            query: function(sql, values, callback) {
                queryCount += 1;
                callback(null, [{
                    Id: 7,
                    Username: "Player",
                    Password: passwords.hash("correct-password"),
                    Banned: 0
                }]);
            }
        }, {register: async () => ({registered: true})});

        await assert.rejects(
            auth.utils.authLogin("Player", password, false, "ip-hash"),
            error => error.message === "Invalid username or password."
        );
        assert.equal(queryCount, 0);
    }
});

// Catches locked-account enumeration through a credential-dependent public
// message instead of the binding generic authentication failure.
test("login uses the exact generic failure for a locked matching account", async function() {
    const passwords = require("../src/routes/api/php-password");
    const password = "correct-password";
    const mysql = mysqlWithMembers([{
        Id: 70,
        Username: "LockedPlayer",
        NormalizedEmail: "locked@example.com",
        EmailVerifiedOn: new Date("2026-08-26T00:00:00Z"),
        Password: passwords.hash(password),
        Banned: 1
    }]);
    const auth = loadAuthApi(mysql, {register: async () => ({registered: true})});

    await assert.rejects(
        auth.utils.authLogin("locked@example.com", password, false, "ip-hash"),
        error => error.message === "Invalid username or password."
    );
});

// Catches email support accidentally making username login conditional on a
// verified address, which would lock out grandfathered accounts.
test("username login remains valid for a grandfathered member without email", async function() {
    const passwords = require("../src/routes/api/php-password");
    const password = "correct-password";
    const mysql = mysqlWithMembers([{
        Id: 8,
        Username: "LegacyPlayer",
        NormalizedEmail: null,
        EmailVerifiedOn: null,
        Password: passwords.hash(password),
        Banned: 0
    }]);
    const auth = loadAuthApi(mysql, {register: async () => ({registered: true})});

    assert.ok(await auth.utils.authLogin(
        " LegacyPlayer ", password, false, "ip-hash"));
    const lookup = mysql.queries.find(({sql}) => sql.includes("FROM Members"));
    assert.match(lookup.sql, /WHERE Username = \?/);
    assert.deepEqual(lookup.values, ["LegacyPlayer"]);
});

// Catches routing every @ identity exclusively to normalized email, which
// would lock out a grandfathered account whose exact username contains @.
test("an @ identity prefers an exact legacy username over verified email only", async function() {
    const passwords = require("../src/routes/api/php-password");
    const password = "correct-password";
    const mysql = mysqlWithMembers([{
        Id: 81,
        Username: "Legacy@Player",
        NormalizedEmail: null,
        EmailVerifiedOn: null,
        Password: passwords.hash(password),
        Banned: 0
    }, {
        Id: 82,
        Username: "DifferentPlayer",
        NormalizedEmail: "legacy@player",
        EmailVerifiedOn: new Date("2026-08-26T00:00:00Z"),
        Password: passwords.hash("different-password"),
        Banned: 0
    }, {
        Id: 83,
        Username: "UnverifiedPlayer",
        NormalizedEmail: "unverified@example.com",
        PendingNormalizedEmail: "pending@example.com",
        EmailVerifiedOn: null,
        Password: passwords.hash(password),
        Banned: 0
    }]);
    const auth = loadAuthApi(mysql, {register: async () => ({registered: true})});

    assert.ok(await auth.utils.authLogin(
        "Legacy@Player", password, false, "ip-hash"));
    for (const identity of ["unverified@example.com", "pending@example.com"]) {
        await assert.rejects(
            auth.utils.authLogin(identity, password, false, "ip-hash"),
            error => error.message === "Invalid username or password."
        );
    }

    const lookups = mysql.queries.filter(({sql}) => sql.includes("FROM Members"));
    assert.equal(lookups.every(({sql}) =>
        sql.includes("Username = ?") &&
        sql.includes("NormalizedEmail = ? AND EmailVerifiedOn IS NOT NULL") &&
        /ORDER BY[\s\S]+Username = \?/i.test(sql) &&
        /LIMIT 1/i.test(sql)), true);
    assert.deepEqual(lookups[0].values, [
        "Legacy@Player", "legacy@player", "Legacy@Player"
    ]);
});

// Catches removing the legacy GraphQL username argument or letting it override
// the new identity argument when both are supplied by an older/newer client mix.
test("GraphQL login resolves identity first and retains optional username compatibility", async function() {
    const passwords = require("../src/routes/api/php-password");
    const password = "correct-password";
    const mysql = mysqlWithMembers([{
        Id: 9,
        Username: "LegacyPlayer",
        NormalizedEmail: "player@example.com",
        EmailVerifiedOn: new Date("2026-08-26T00:00:00Z"),
        Password: passwords.hash(password),
        Banned: 0
    }]);
    const auth = loadAuthApi(mysql, {register: async () => ({registered: true})});
    const loginField = auth.mutationFields.authLogin;

    assert.equal(loginField.args.username.type.toString(), "String");
    assert.ok(await loginField.resolve(null, {
        identity: "PLAYER@example.com",
        username: "wrong-legacy-value",
        password,
        stayLoggedIn: false
    }, {headers: {"x-forwarded-for": "192.0.2.7"}}));
    assert.deepEqual(mysql.queries.find(({sql}) =>
        sql.includes("FROM Members")).values, [
        "PLAYER@example.com", "player@example.com", "PLAYER@example.com"
    ]);
});

// Catches the GraphQL adapter omitting required registration email or storing
// a plaintext password instead of passing the existing compatible hash.
test("registration GraphQL adapter requires email and delegates an unverified account claim", async function(t) {
    const passwords = require("../src/routes/api/php-password");
    let registrationInput;
    const service = {
        register: async function(input) {
            registrationInput = input;
            return {registered: true};
        }
    };
    const mysql = mysqlWithMembers([]);
    const auth = loadAuthApi(mysql, service);
    t.mock.method(global, "fetch", async function() {
        return {json: async () => ({success: true})};
    });

    const registerField = auth.mutationFields.register;
    assert.equal(registerField.args.email.type.toString(), "String!");
    const result = await registerField.resolve(null, {
        username: "Player",
        email: "Player@example.com",
        password: "long-password",
        recaptcha: "ok"
    }, {headers: {"x-forwarded-for": "192.0.2.7"}});

    assert.equal(result, true);
    assert.equal(registrationInput.username, "Player");
    assert.equal(registrationInput.email, "Player@example.com");
    assert.equal(registrationInput.recaptchaVerified, true);
    assert.equal(registrationInput.ipHash.length, 40);
    assert.equal(passwords.verify("long-password", registrationInput.passwordHash), true);
    assert.equal(mysql.queries.length, 0,
        "the service owns transactional registration database work");
});

// Catches measuring a stripped username while persisting the original value,
// which can create new accounts that the login identity router cannot reach.
test("registration rejects non-alphanumeric usernames before service storage", async function(t) {
    let registrations = 0;
    const auth = loadAuthApi(mysqlWithMembers([]), {
        register: async function() {
            registrations += 1;
            return {registered: true};
        }
    });
    t.mock.method(global, "fetch", async function() {
        return {json: async () => ({success: true})};
    });

    for (const username of ["Player Name", "Player@Name", "Player-Name", " Player"]) {
        const result = await auth.mutationFields.register.resolve(null, {
            username,
            email: "player@example.com",
            password: "long-password",
            recaptcha: "ok"
        }, {headers: {"x-forwarded-for": "192.0.2.7"}});
        assert.equal(result.message, "Username may contain only letters and numbers.");
    }
    assert.equal(registrations, 0);
});
