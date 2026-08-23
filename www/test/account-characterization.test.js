"use strict";

const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

const routePath = require.resolve("../src/routes/account");
const accountApiPath = require.resolve("../src/routes/api/account");

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

function loadAccountApi(mysql, auth) {
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (request === "./mysql-connection" && parent.filename === accountApiPath)
            return mysql;
        if (request === "./auth" && parent.filename === accountApiPath)
            return auth;

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
    const router = loadAccountRoute(async function(query) {
        for (const setting of Object.keys(notificationSettings))
            assert.match(query, new RegExp(`\\b${setting}\\b`));
        return {getNotificationSettings: notificationSettings};
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
