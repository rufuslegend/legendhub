"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
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

function loadAuthApi(mysql, accountEmailService, passwordRecoveryService = {}) {
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
        if (request === "./password-recovery-service" && parent?.filename === authApiPath) {
            return {
                createPasswordRecoveryService: function() {
                    return passwordRecoveryService;
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

// Catches omission of the public non-null recovery mutations, non-Boolean
// adapters, or failure to pass the request IP hash through the auth boundary.
test("password recovery GraphQL mutations delegate Boolean outcomes", async function() {
    const calls = [];
    const recovery = {
        async requestRecovery(input) {
            calls.push(["request", input]);
            return {accepted: true};
        },
        async resetPassword(input) {
            calls.push(["reset", input]);
            return {success: true};
        }
    };
    const auth = loadAuthApi(mysqlWithMembers([]), {
        register: async function() { return {registered: true}; }
    }, recovery);
    const requestField = auth.mutationFields.requestPasswordRecovery;
    const resetField = auth.mutationFields.resetPassword;

    assert.equal(String(requestField.type), "Boolean!");
    assert.equal(String(requestField.args.identity.type), "String!");
    assert.equal(String(resetField.type), "Boolean!");
    assert.equal(String(resetField.args.token.type), "String!");
    assert.equal(String(resetField.args.newPassword.type), "String!");

    const request = {
        ip: "192.0.2.44",
        headers: {"x-forwarded-for": "203.0.113.99"}
    };
    assert.equal(await requestField.resolve(null, {
        identity: "player@example.com"
    }, request), true);
    assert.equal(await resetField.resolve(null, {
        token: "selector-validator",
        newPassword: "replacement-password"
    }, request), true);
    assert.deepEqual(calls, [["request", {
        identity: "player@example.com",
        ipHash: crypto.createHash("sha1").update("192.0.2.44").digest("hex")
    }], ["reset", {
        token: "selector-validator",
        newPassword: "replacement-password"
    }]]);
});

// Catches client-controlled forwarding headers bypassing the Express trust
// boundary while retaining a direct-socket fallback for non-Express callers.
test("request IP hashing uses trusted Express IP and ignores forwarding headers", function() {
    const auth = loadAuthApi(mysqlWithMembers([]), {
        register: async function() { return {registered: true}; }
    });
    const hash = value => crypto.createHash("sha1").update(value).digest("hex");

    assert.equal(auth.utils.getIPFromRequest({
        ip: "192.0.2.44",
        headers: {"x-forwarded-for": "203.0.113.99"},
        socket: {remoteAddress: "127.0.0.1"}
    }), hash("192.0.2.44"));
    assert.equal(auth.utils.getIPFromRequest({
        headers: {"x-forwarded-for": "203.0.113.99"},
        socket: {remoteAddress: "198.51.100.17"}
    }), hash("198.51.100.17"));
});

function mysqlWithMembers(members) {
    const queries = [];
    const transactionEvents = [];
    const database = {
        queries,
        transactionEvents,
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
    addTransactionSupport(database);
    return database;
}

function mysqlWithAuthToken({storageNamespace = "member-73"} = {}) {
    const token = "existingselector-existingvalidator";
    const expires = new Date("2030-01-01T00:00:00.000Z");
    const hashedValidator = crypto.createHash("sha256")
        .update("existingvalidator")
        .digest("hex");
    const authTokenWrites = [];
    const storageNamespaceWrites = [];
    let active = true;

    const transactionEvents = [];
    const database = {
        token,
        expires,
        authTokenWrites,
        storageNamespaceWrites,
        transactionEvents,
        query(sql, values, callback) {
            if (sql.includes("FROM AuthTokens AT")) {
                callback(null, active ? [{
                    Id: 91,
                    MemberId: 73,
                    Username: "Player",
                    Email: "old@example.com",
                    EmailVerifiedOn: expires,
                    PendingEmail: null,
                    StorageNamespace: storageNamespace,
                    HashedValidator: hashedValidator,
                    Expires: expires,
                    StayLoggedIn: true,
                    Banned: 0
                }] : []);
                return;
            }
            if (sql.startsWith("UPDATE Members SET LastLoginDate")) {
                callback(null, {affectedRows: 1});
                return;
            }
            if (sql.startsWith("UPDATE Members SET StorageNamespace")) {
                storageNamespaceWrites.push({sql, values});
                if (storageNamespace === null)
                    storageNamespace = values[0];
                callback(null, {affectedRows: 1});
                return;
            }
            if (sql.startsWith("SELECT StorageNamespace FROM Members")) {
                callback(null, [{StorageNamespace: storageNamespace}]);
                return;
            }
            if (sql.startsWith("INSERT INTO AuthTokens")) {
                authTokenWrites.push("insert");
                callback(null, {insertId: 92});
                return;
            }
            if (sql.startsWith("DELETE FROM AuthTokens WHERE Id")) {
                authTokenWrites.push("delete");
                if (values[0] === 91)
                    active = false;
                callback(null, {affectedRows: 1});
                return;
            }

            assert.fail(`Unexpected database query: ${sql}`);
        }
    };
    addTransactionSupport(database);
    return database;
}

// Catches rollback-created members retaining a null account-storage identity,
// or a concurrent authentication overwriting a namespace assigned first.
test("session authentication lazily assigns a rollback-created storage namespace atomically", async function() {
    const mysql = mysqlWithAuthToken({storageNamespace: null});
    const auth = loadAuthApi(mysql, {register: async () => ({registered: true})});

    const result = await auth.utils.authToken(
        mysql.token,
        "request-ip-hash",
        false,
        false
    );

    assert.match(result.storageNamespace, /^[0-9a-f]{32}$/);
    assert.equal(mysql.storageNamespaceWrites.length, 1);
    assert.match(mysql.storageNamespaceWrites[0].sql,
        /StorageNamespace\s*=\s*COALESCE\(StorageNamespace,\s*\?\)/i);
    assert.deepEqual(mysql.storageNamespaceWrites[0].values, [
        result.storageNamespace,
        73
    ]);
    const assignment = mysql.authTokenWrites.length === 0 &&
        mysql.transactionEvents.length === 0;
    assert.equal(assignment, true, "lazy assignment neither rotates the session nor opens renewal");
});

// Catches the storage authentication entry point inheriting mutation-style
// renewal by default, while preserving the verified-email and namespace data
// needed to authorize account storage.
test("authenticate defaults to a validated non-renewing storage session", async function() {
    const mysql = mysqlWithAuthToken();
    const auth = loadAuthApi(mysql, {register: async () => ({registered: true})});

    const result = await auth.utils.authenticate({ip: "192.0.2.73"}, mysql.token);

    assert.equal(result.memberId, 73);
    assert.equal(result.emailVerified, true);
    assert.equal(result.storageNamespace, "member-73");
    assert.equal(result.token, mysql.token);
    assert.deepEqual(mysql.authTokenWrites, []);
    assert.deepEqual(mysql.transactionEvents, []);
});

function addTransactionSupport(database) {
    database.getConnection = function(callback) {
        callback(null, {
            query: database.query.bind(database),
            beginTransaction(done) {
                database.transactionEvents.push("begin");
                done(null);
            },
            commit(done) {
                database.transactionEvents.push("commit");
                done(null);
            },
            rollback(done) {
                database.transactionEvents.push("rollback");
                done(null);
            },
            release() {
                database.transactionEvents.push("release");
            }
        });
    };
}

function createAwaitedAuthDatabase({insertError, deferInsert = false, deferCommit = false} = {}) {
    const passwords = require("../src/routes/api/php-password");
    const validator = "existingvalidator";
    const events = [];
    let pendingInsert;
    let pendingCommit;
    let sourceActive = true;
    let replacementActive = false;
    let snapshot;

    const member = {
        Id: 73,
        Username: "Player",
        Email: "player@example.com",
        NormalizedEmail: "player@example.com",
        EmailVerifiedOn: new Date("2026-08-26T00:00:00.000Z"),
        PendingEmail: null,
        StorageNamespace: "member-73",
        Password: passwords.hash("old-password"),
        Banned: 0
    };

    function query(sql, values, callback) {
        if (sql.includes("FROM Members") && sql.includes("WHERE Id = ?")) {
            events.push(sql.includes("FOR UPDATE") ? "select-member-lock" : "select-member-id");
            callback(null, values[0] === member.Id ? [{Id: member.Id}] : []);
            return;
        }
        if (sql.includes("FROM Members") && sql.includes("Username = ?")) {
            events.push(sql.includes("FOR UPDATE") ? "select-member-lock" : "select-member");
            callback(null, [{...member}]);
            return;
        }
        if (sql.includes("FROM AuthTokens AT")) {
            events.push(sql.includes("FOR UPDATE") ? "select-token-lock" : "select-token");
            callback(null, sourceActive ? [{
                Id: 91,
                MemberId: member.Id,
                Username: member.Username,
                Email: member.Email,
                EmailVerifiedOn: member.EmailVerifiedOn,
                PendingEmail: member.PendingEmail,
                StorageNamespace: member.StorageNamespace,
                HashedValidator: crypto.createHash("sha256").update(validator).digest("hex"),
                Expires: new Date("2030-01-01T00:00:00.000Z"),
                StayLoggedIn: true,
                Banned: member.Banned
            }] : []);
            return;
        }
        if (sql.startsWith("UPDATE Members SET LastLoginDate")) {
            events.push("update-last-login");
            callback(null, {affectedRows: 1});
            return;
        }
        if (sql.startsWith("INSERT INTO AuthTokens")) {
            events.push("insert-session");
            const finish = function() {
                if (insertError) {
                    callback(new Error(insertError));
                    return;
                }
                replacementActive = true;
                callback(null, {insertId: 92, affectedRows: 1});
            };
            if (deferInsert)
                pendingInsert = finish;
            else
                finish();
            return;
        }
        if (sql.startsWith("DELETE FROM AuthTokens WHERE Id")) {
            events.push("delete-source-session");
            if (values[0] === 91)
                sourceActive = false;
            callback(null, {affectedRows: 1});
            return;
        }
        assert.fail(`Unexpected database query: ${sql}`);
    }

    const database = {
        events,
        query,
        get sourceActive() { return sourceActive; },
        get replacementActive() { return replacementActive; },
        getConnection(callback) {
            callback(null, {
                query,
                beginTransaction(done) {
                    snapshot = {sourceActive, replacementActive};
                    events.push("begin");
                    done(null);
                },
                commit(done) {
                    events.push("commit");
                    if (deferCommit)
                        pendingCommit = done;
                    else
                        done(null);
                },
                rollback(done) {
                    events.push("rollback");
                    sourceActive = snapshot.sourceActive;
                    replacementActive = snapshot.replacementActive;
                    done(null);
                },
                release() {
                    events.push("release");
                }
            });
        },
        releaseInsert() {
            if (pendingInsert) {
                const finish = pendingInsert;
                pendingInsert = undefined;
                finish();
            }
        },
        releaseCommit() {
            if (pendingCommit) {
                const finish = pendingCommit;
                pendingCommit = undefined;
                finish(null);
            }
        }
    };
    return {database, validator};
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
            },
            getBuilderAccountSummary: {
                profiles: [{
                    id: "profile-1",
                    name: "Hero",
                    revision: 4,
                    updatedOn: "2026-08-28T00:00:00.000Z",
                    payload: "7*private-builder-payload*"
                }],
                usedBytes: 4096,
                quotaBytes: 10_485_760,
                storageGeneration: 7,
                memberId: 7,
                storageNamespace: "private-namespace"
            }
        };
    });
    let rendered;

    await getAccountRouteHandler(router)(
        {cookies: {loginToken: "account-token"}},
        {
            locals: {user: {
                memberId: 7,
                email: "player@example.com",
                emailVerified: true,
                canUseAccountStorage: true,
                storageNamespace: "private-namespace"
            }},
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
    assert.deepEqual(rendered.locals.vm.builderStorage, {
        enabled: true,
        profiles: [{
            id: "profile-1",
            name: "Hero",
            revision: 4,
            updatedOn: "2026-08-28T00:00:00.000Z"
        }],
        usedBytes: 4096,
        quotaBytes: 10_485_760,
        storageGeneration: 7
    });
    for (const field of ["email", "verified", "pendingEmail", "canUseAccountStorage"])
        assert.match(captured.query, new RegExp(`\\b${field}\\b`));
    for (const field of ["id", "name", "revision", "updatedOn", "usedBytes",
        "quotaBytes", "storageGeneration", "profileCount"]) {
        assert.match(captured.query, new RegExp(`\\b${field}\\b`));
    }
    assert.match(captured.query, /getBuilderAccountSummary/);
    assert.doesNotMatch(captured.query, /getBuilderAccountState/);
    assert.doesNotMatch(captured.query,
        /\b(payload|preferences|memberId|storageNamespace)\b/);
    assert.doesNotMatch(captured.query, /account-token/);
    assert.equal(captured.ip, undefined);
    assert.deepEqual(captured.variables, {
        authToken: "account-token",
        includeBuilderStorage: true
    });
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

// Catches preemptive authentication-token rotation making the browser's
// current cookie unusable when either fallible email service rejects.
test("account email mutation failures preserve the current authentication token", async function() {
    const {ConflictError, TooManyRequestsError} = require("../src/routes/api/utils");
    const cases = [{
        name: "email conflict",
        field: "requestEmailChange",
        args: {currentPassword: "current-secret", email: "claimed@example.com"},
        error: new ConflictError("That email address is unavailable.")
    }, {
        name: "email change service failure",
        field: "requestEmailChange",
        args: {currentPassword: "current-secret", email: "new@example.com"},
        error: new Error("email change service failed")
    }, {
        name: "resend rate limit",
        field: "resendVerification",
        args: {},
        error: new TooManyRequestsError("Try again later.")
    }, {
        name: "resend service failure",
        field: "resendVerification",
        args: {},
        error: new Error("resend service failed")
    }];

    for (const scenario of cases) {
        const mysql = mysqlWithAuthToken();
        const accountEmailService = {
            async requestEmailChange() {
                throw scenario.error;
            },
            async resendVerification() {
                throw scenario.error;
            }
        };
        const auth = loadAuthApi(mysql, accountEmailService);
        const account = loadAccountApi(mysql, auth, accountEmailService);

        await assert.rejects(
            account.mutationFields[scenario.field].resolve(null, {
                authToken: mysql.token,
                ...scenario.args
            }, {headers: {"x-forwarded-for": "192.0.2.73"}}),
            error => error === scenario.error,
            scenario.name
        );
        assert.deepEqual(mysql.authTokenWrites, [], scenario.name);

        const authenticated = await auth.utils.authToken(
            mysql.token,
            "request-ip-hash",
            false,
            false
        );
        assert.equal(authenticated.token, mysql.token, scenario.name);
    }
});

test("successful account email mutations return the unchanged usable token", async function() {
    const mysql = mysqlWithAuthToken();
    const accountEmailService = {
        async requestEmailChange() {
            return {success: true, pendingEmail: "new@example.com"};
        },
        async resendVerification() {
            return {accepted: true};
        }
    };
    const auth = loadAuthApi(mysql, accountEmailService);
    const account = loadAccountApi(mysql, auth, accountEmailService);
    const request = {headers: {"x-forwarded-for": "192.0.2.73"}};

    const change = await account.mutationFields.requestEmailChange.resolve(null, {
        authToken: mysql.token,
        currentPassword: "current-secret",
        email: "new@example.com"
    }, request);
    const resend = await account.mutationFields.resendVerification.resolve(null, {
        authToken: mysql.token
    }, request);

    for (const result of [change, resend]) {
        assert.equal(result.tokenRenewal.token, mysql.token);
        assert.equal(result.tokenRenewal.expires, mysql.expires);
    }
    assert.deepEqual(mysql.authTokenWrites, []);
    const authenticated = await auth.utils.authToken(
        mysql.token,
        "request-ip-hash",
        false,
        false
    );
    assert.equal(authenticated.token, mysql.token);
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
    const calls = [];
    const account = loadAccountApi({
        query: function(sql, values, callback) {
            assert.fail(`Unexpected database query: ${sql}`);
        }
    }, {
        types: {tokenRenewalType: require("graphql").GraphQLString},
        utils: {
            changePassword: async function(...values) {
                calls.push(values);
                return {
                    success: values[2] === "current-password",
                    tokenRenewal: {token: values[1], expires: null}
                };
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
        tokenRenewal: {token: "account-token", expires: null}
    });
    assert.deepEqual(successful, {
        success: true,
        tokenRenewal: {token: "account-token", expires: null}
    });
    assert.deepEqual(calls, [
        [{}, "account-token", "incorrect-password", "new-password"],
        [{}, "account-token", "current-password", "new-password"]
    ]);
});

// Catches login resolving before the session insert and transaction commit,
// which lets a reset delete current sessions before the late insert appears.
test("login awaits locked transactional session issuance through commit", async function() {
    const {database} = createAwaitedAuthDatabase({
        deferInsert: true,
        deferCommit: true
    });
    const auth = loadAuthApi(database, {register: async () => ({registered: true})});
    let settled = false;
    const login = auth.utils.authLogin(
        "Player", "old-password", false, "ip-hash"
    ).then(function(result) {
        settled = true;
        return result;
    });

    await new Promise(resolve => setImmediate(resolve));
    const settledBeforeInsert = settled;
    database.releaseInsert();
    await new Promise(resolve => setImmediate(resolve));
    const settledBeforeCommit = settled;
    database.releaseCommit();
    const result = await login;

    assert.equal(settledBeforeInsert, false);
    assert.equal(settledBeforeCommit, false);
    assert.match(result.token, /^[0-9a-f]{12}-[0-9a-f]{48}$/);
    assert.deepEqual(database.events, [
        "begin",
        "select-member-lock",
        "update-last-login",
        "insert-session",
        "commit",
        "release"
    ]);
});

// Catches a failed login-token insert being ignored while a public success is
// returned instead of rolling back behind the stable auth failure.
test("login session insert failure rolls back and stays generic", async function() {
    const privateDiagnostic = "private login session insert diagnostic";
    const {database} = createAwaitedAuthDatabase({insertError: privateDiagnostic});
    const auth = loadAuthApi(database, {register: async () => ({registered: true})});

    await assert.rejects(
        auth.utils.authLogin("Player", "old-password", false, "ip-hash"),
        error => error.message === "Invalid username or password." &&
            !error.message.includes(privateDiagnostic)
    );
    assert.equal(database.replacementActive, false);
    assert.deepEqual(database.events, [
        "begin",
        "select-member-lock",
        "update-last-login",
        "insert-session",
        "rollback",
        "release"
    ]);
});

// Catches renewal resolving before replacement insert/source deletion commit,
// which permits a late replacement session to survive password reset.
test("renewal awaits locked transactional replacement through commit", async function() {
    const {database, validator} = createAwaitedAuthDatabase({
        deferInsert: true,
        deferCommit: true
    });
    const auth = loadAuthApi(database, {register: async () => ({registered: true})});
    let settled = false;
    const renewal = auth.utils.authToken(
        `existingselector-${validator}`, "ip-hash", true, false
    ).then(function(result) {
        settled = true;
        return result;
    });

    await new Promise(resolve => setImmediate(resolve));
    const settledBeforeInsert = settled;
    database.releaseInsert();
    await new Promise(resolve => setImmediate(resolve));
    const settledBeforeCommit = settled;
    database.releaseCommit();
    const result = await renewal;

    assert.equal(settledBeforeInsert, false);
    assert.equal(settledBeforeCommit, false);
    assert.match(result.token, /^[0-9a-f]{12}-[0-9a-f]{48}$/);
    assert.equal(database.sourceActive, false);
    assert.equal(database.replacementActive, true);
    assert.deepEqual(database.events, [
        "begin",
        "select-token",
        "select-member-lock",
        "select-token-lock",
        "update-last-login",
        "insert-session",
        "delete-source-session",
        "commit",
        "release"
    ]);
});

// Catches renewal deleting the source or returning replacement credentials
// after a failed insert instead of rolling the transaction back generically.
test("renewal insert failure rolls back and preserves its source session", async function() {
    const privateDiagnostic = "private renewal insert diagnostic";
    const {database, validator} = createAwaitedAuthDatabase({
        insertError: privateDiagnostic
    });
    const auth = loadAuthApi(database, {register: async () => ({registered: true})});

    await assert.rejects(
        auth.utils.authToken(
            `existingselector-${validator}`, "ip-hash", true, false),
        error => error.message === "Invalid token" &&
            !error.message.includes(privateDiagnostic)
    );
    assert.equal(database.sourceActive, true);
    assert.equal(database.replacementActive, false);
    assert.deepEqual(database.events, [
        "begin",
        "select-token",
        "select-member-lock",
        "select-token-lock",
        "update-last-login",
        "insert-session",
        "rollback",
        "release"
    ]);
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
        [" PLAYER@EXAMPLE.COM ", "player@example.com", " PLAYER@EXAMPLE.COM "],
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
        Username: " LegacyPlayer",
        NormalizedEmail: null,
        EmailVerifiedOn: null,
        Password: passwords.hash(password),
        Banned: 0
    }]);
    const auth = loadAuthApi(mysql, {register: async () => ({registered: true})});

    assert.ok(await auth.utils.authLogin(
        " LegacyPlayer", password, false, "ip-hash"));
    const lookup = mysql.queries.find(({sql}) => sql.includes("FROM Members"));
    assert.match(lookup.sql, /WHERE Username = \?/);
    assert.deepEqual(lookup.values, [" LegacyPlayer"]);
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
