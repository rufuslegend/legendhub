"use strict";

const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const {normalizeReturnUrl, requireSameOrigin} = require("../src/routes/request-security");
const createAccountActionsRouter = require("../src/routes/account-actions");

const indexRoutePath = require.resolve("../src/routes/index");
const authRoutePath = require.resolve("../src/routes/auth");

function loadIndexRoute({logout, postAsync}) {
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (parent?.filename === indexRoutePath && request === "./api/auth")
            return {utils: {logout}};
        if (parent?.filename === indexRoutePath && request === "./api/utils")
            return {postAsync};
        if (parent?.filename === indexRoutePath && request === "./api/mysql-connection")
            return {};
        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        delete require.cache[indexRoutePath];
        return require(indexRoutePath);
    }
    finally {
        Module._load = originalLoad;
    }
}

function loadAuthRoute({authToken, getPermissions, postAsync}) {
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (parent?.filename === authRoutePath && request === "./api/auth") {
            return {utils: {
                authToken,
                getIPFromRequest: function() { return "request-ip-hash"; },
                getPermissions
            }};
        }
        if (parent?.filename === authRoutePath && request === "./api/utils")
            return {postAsync};
        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        delete require.cache[authRoutePath];
        return require(authRoutePath);
    }
    finally {
        Module._load = originalLoad;
    }
}

function routeHandlers(router, path, method) {
    const layer = router.stack.find(function(candidate) {
        return candidate.route && candidate.route.path.includes(path) &&
            candidate.route.methods[method];
    });
    return layer?.route.stack.map(stackLayer => stackLayer.handle) || [];
}

async function runHandlers(handlers, req, res) {
    let index = 0;
    async function next(error) {
        if (error) throw error;
        const handler = handlers[index++];
        if (handler)
            await handler(req, res, next);
    }
    await next();
}

test("normalizeReturnUrl keeps local paths and rejects external redirect forms", function() {
    assert.equal(normalizeReturnUrl("/items/details.html?id=7"), "/items/details.html?id=7");
    assert.equal(normalizeReturnUrl("/"), "/");

    for (const value of [
        "https://attacker.invalid/path",
        "//attacker.invalid/path",
        "\\\\attacker.invalid/path",
        "/\\attacker.invalid/path",
        "\u0000/hidden",
        ["/items/", "//attacker.invalid"],
        null,
        undefined
    ]) {
        assert.equal(normalizeReturnUrl(value), "/", `rejected ${JSON.stringify(value)}`);
    }
});

test("requireSameOrigin accepts same-site origin evidence and rejects missing or foreign sources", function() {
    function invoke(origin, referer) {
        let nextCalled = false;
        let status;
        const req = {
            protocol: "https",
            get: function(name) {
                if (name === "host") return "legendhub.example:7443";
                if (name === "origin") return origin;
                if (name === "referer") return referer;
                return undefined;
            }
        };
        requireSameOrigin(req, {
            sendStatus: function(value) {
                status = value;
            }
        }, function() {
            nextCalled = true;
        });
        return {nextCalled, status};
    }

    assert.deepEqual(invoke("https://legendhub.example:7443"), {
        nextCalled: true,
        status: undefined
    });
    assert.deepEqual(invoke(undefined, "https://legendhub.example:7443/login.html"), {
        nextCalled: true,
        status: undefined
    });
    assert.deepEqual(invoke("https://attacker.invalid"), {
        nextCalled: false,
        status: 403
    });
    assert.deepEqual(invoke(undefined), {
        nextCalled: false,
        status: 403
    });
    assert.deepEqual(invoke(undefined, "https://attacker.invalid/login.html"), {
        nextCalled: false,
        status: 403
    });
    assert.deepEqual(invoke(undefined, "not a URL"), {
        nextCalled: false,
        status: 403
    });
    assert.deepEqual(invoke("not a URL"), {
        nextCalled: false,
        status: 403
    });
});

test("login redirects only to normalized local return URLs", async function() {
    const requests = [];
    const router = loadIndexRoute({
        logout: function() {},
        postAsync: async function(query, ip, variables) {
            requests.push({query, ip, variables});
            return {authLogin: {token: "renewed", expires: null}};
        }
    });
    const handlers = routeHandlers(router, "/login.html", "post");

    for (const [returnUrl, expected] of [
        ["/items/details.html?id=7", "/items/details.html?id=7"],
        ["https://attacker.invalid/after-login", "/"],
        ["//attacker.invalid/after-login", "/"],
        ["\\\\attacker.invalid/after-login", "/"]
    ]) {
        let redirected;
        await runHandlers(handlers, {
            body: {login_username: "Archivist", login_password: "secret", returnUrl},
            ip: "192.0.2.7",
            protocol: "https",
            get: function(name) {
                if (name === "host") return "legendhub.example";
                if (name === "origin") return "https://legendhub.example";
            }
        }, {
            cookie: function() {},
            clearCookie: function() {},
            redirect: function(value) { redirected = value; }
        });
        assert.equal(redirected, expected);
    }

    assert.equal(requests.every(({query}) =>
        query.includes("$identity") && query.includes("authLogin(identity: $identity")), true);
    assert.equal(requests.every(({variables}) =>
        variables.identity === "Archivist" && !("username" in variables)), true);
});

// Catches a prior-session dismissal suppressing the required prompt after a
// fresh successful login, or being cleared after a failed login instead.
test("successful login clears only the prior email-prompt dismissal", async function() {
    const router = loadIndexRoute({
        logout: function() {},
        postAsync: async function() {
            return {authLogin: {token: "new-session", expires: null}};
        }
    });
    const handlers = routeHandlers(router, "/login.html", "post");
    const cleared = [];
    const cookies = [];

    await runHandlers(handlers, {
        body: {login_username: "LegacyMember", login_password: "secret"},
        ip: "192.0.2.7",
        protocol: "https",
        get: function(name) {
            return {host: "legendhub.example", origin: "https://legendhub.example"}[name];
        }
    }, {
        clearCookie: function(name, options) { cleared.push({name, options}); },
        cookie: function(name, value, options) { cookies.push({name, value, options}); },
        redirect: function() {}
    });

    assert.deepEqual(cleared, [{
        name: "emailPromptDismissed",
        options: {
            path: "/",
            secure: true,
            httpOnly: true,
            sameSite: "lax"
        }
    }]);
    assert.equal(cookies.some(cookie => cookie.name === "loginToken"), true);
});

// Catches an unverified/verified mismatch being passed to Plan 2, including a
// stray verification timestamp granting account storage without an address.
test("authentication locals expose verified-email-only account storage eligibility", async function() {
    const users = [{
        memberId: 7,
        username: "VerifiedMember",
        email: "verified@example.test",
        emailVerified: true
    }, {
        memberId: 8,
        username: "GrandfatheredMember",
        email: null,
        emailVerified: true
    }];

    for (const [index, expected] of [
        [0, {emailVerified: true, canUseAccountStorage: true}],
        [1, {emailVerified: false, canUseAccountStorage: false}]
    ]) {
        const middleware = loadAuthRoute({
            authToken: async function() { return {...users[index]}; },
            getPermissions: async function() { return {}; },
            postAsync: async function() {
                return {getNotifications: {moreResults: false, results: []}};
            }
        });
        const res = {locals: {}};
        await middleware({
            cookies: {loginToken: "session-token"},
            ip: "192.0.2.7"
        }, res, function(error) {
            if (error) throw error;
        });
        assert.deepEqual({
            emailVerified: res.locals.user.emailVerified,
            canUseAccountStorage: res.locals.user.canUseAccountStorage
        }, expected);
    }
});

// Catches registration reaching GraphQL without an address, dropping entered
// values after validation, or omitting resend guidance after committed signup.
test("registration requires email, preserves entered identity fields, and passes email to GraphQL", async function() {
    const apiRequests = [];
    const router = loadIndexRoute({
        logout: function() {},
        postAsync: async function(query, ip, variables) {
            apiRequests.push({query, ip, variables});
            return {register: true};
        }
    });
    const handlers = routeHandlers(router, "/login.html", "post");
    const baseRequest = {
        ip: "192.0.2.7",
        protocol: "https",
        get: function(name) {
            if (name === "host") return "legendhub.example";
            if (name === "origin") return "https://legendhub.example";
        }
    };

    let missingEmailRender;
    await runHandlers(handlers, {
        ...baseRequest,
        body: {
            register_username: "Player",
            register_email: "",
            register_password: "long-password",
            register_confirmPassword: "long-password",
            "g-recaptcha-response": "ok"
        }
    }, {
        render: function(view, locals) { missingEmailRender = {view, locals}; }
    });
    assert.equal(apiRequests.length, 0);
    assert.equal(missingEmailRender.view, "login");
    assert.match(missingEmailRender.locals.vm.register_error, /email/i);
    assert.deepEqual(missingEmailRender.locals.vm.body, {
        login_username: "",
        register_username: "Player",
        register_email: ""
    });

    let successfulRender;
    await runHandlers(handlers, {
        ...baseRequest,
        body: {
            register_username: "Player",
            register_email: "Player@example.com",
            register_password: "long-password",
            register_confirmPassword: "long-password",
            "g-recaptcha-response": "ok"
        }
    }, {
        render: function(view, locals) { successfulRender = {view, locals}; }
    });

    assert.equal(apiRequests.length, 1);
    assert.match(apiRequests[0].query, /\$email: String!/);
    assert.match(apiRequests[0].query, /register\(username: \$username, email: \$email/);
    assert.deepEqual(apiRequests[0].variables, {
        username: "Player",
        email: "Player@example.com",
        password: "long-password",
        recaptcha: "ok"
    });
    assert.match(successfulRender.locals.vm.login_message, /verify/i);
    assert.match(successfulRender.locals.vm.login_message, /resend/i);
});

test("login and registration reject cross-site submission before authentication", async function() {
    let apiCalls = 0;
    const router = loadIndexRoute({
        logout: function() {},
        postAsync: async function() {
            apiCalls += 1;
            return {authLogin: {token: "attacker-session", expires: null}};
        }
    });
    const handlers = routeHandlers(router, "/login.html", "post");

    for (const origin of ["https://attacker.invalid", undefined]) {
        let status;
        await runHandlers(handlers, {
            body: {login_username: "Attacker", login_password: "secret"},
            ip: "192.0.2.9",
            protocol: "https",
            get: function(name) {
                if (name === "host") return "legendhub.example";
                if (name === "origin") return origin;
            }
        }, {
            cookie: function() {},
            redirect: function() {},
            sendStatus: function(value) { status = value; }
        });

        assert.equal(status, 403);
    }
    assert.equal(apiCalls, 0);
});

test("logout is POST-only and rejects a foreign origin before ending the session", async function() {
    let logoutCalls = 0;
    const router = loadIndexRoute({
        logout: function() { logoutCalls += 1; },
        postAsync: async function() {}
    });

    assert.equal(routeHandlers(router, "/logout.html", "get").length, 0);
    const handlers = routeHandlers(router, "/logout.html", "post");
    assert.equal(handlers.length >= 2, true);

    let status;
    await runHandlers(handlers, {
        cookies: {loginToken: "session-token"},
        protocol: "https",
        get: function(name) {
            if (name === "host") return "legendhub.example";
            if (name === "origin") return "https://attacker.invalid";
        }
    }, {
        sendStatus: function(value) { status = value; }
    });

    assert.equal(status, 403);
    assert.equal(logoutCalls, 0);
});

// Catches dismissal becoming persistent, script-readable, cross-site
// writable, or redirectable off-site.
test("email prompt dismissal is an authenticated same-origin session cookie", async function() {
    const router = createAccountActionsRouter({
        passwordRecoveryService: {},
        getIPFromRequest: function() { return "request-ip-hash"; }
    });
    assert.equal(routeHandlers(router, "/dismiss-email-prompt", "get").length, 0);
    const handlers = routeHandlers(router, "/dismiss-email-prompt", "post");
    assert.equal(handlers.length >= 2, true);

    let foreignStatus;
    let foreignCookieWrites = 0;
    await runHandlers(handlers, {
        body: {returnUrl: "/items/"},
        protocol: "https",
        get: function(name) {
            return {host: "legendhub.example", origin: "https://attacker.invalid"}[name];
        },
        res: {},
        cookies: {}
    }, {
        locals: {user: {memberId: 7, emailVerified: false}},
        cookie: function() { foreignCookieWrites += 1; },
        sendStatus: function(value) { foreignStatus = value; }
    });
    assert.equal(foreignStatus, 403);
    assert.equal(foreignCookieWrites, 0);

    const written = [];
    let redirected;
    await runHandlers(handlers, {
        body: {returnUrl: "https://attacker.invalid/after-dismiss"},
        protocol: "https",
        get: function(name) {
            return {host: "legendhub.example", origin: "https://legendhub.example"}[name];
        }
    }, {
        locals: {user: {memberId: 7, emailVerified: false}},
        cookie: function(name, value, options) { written.push({name, value, options}); },
        redirect: function(value) { redirected = value; }
    });

    assert.deepEqual(written, [{
        name: "emailPromptDismissed",
        value: "true",
        options: {
            path: "/",
            secure: true,
            httpOnly: true,
            sameSite: "lax"
        }
    }]);
    assert.equal(Object.hasOwn(written[0].options, "expires"), false);
    assert.equal(Object.hasOwn(written[0].options, "maxAge"), false);
    assert.equal(redirected, "/");
});

// Catches logout leaving a prompt dismissal behind so that the next login no
// longer displays the verification invitation.
test("logout clears the email-prompt dismissal with the session", async function() {
    let logoutCalls = 0;
    const router = loadIndexRoute({
        logout: function() { logoutCalls += 1; },
        postAsync: async function() {}
    });
    const cleared = [];
    let redirected;
    await runHandlers(routeHandlers(router, "/logout.html", "post"), {
        cookies: {loginToken: "session-token", emailPromptDismissed: "true"},
        protocol: "https",
        get: function(name) {
            return {host: "legendhub.example", origin: "https://legendhub.example"}[name];
        }
    }, {
        clearCookie: function(name, options) { cleared.push({name, options}); },
        redirect: function(value) { redirected = value; }
    });

    assert.equal(logoutCalls, 1);
    assert.deepEqual(cleared, [{name: "loginToken", options: {path: "/"}}, {
        name: "emailPromptDismissed",
        options: {
            path: "/",
            secure: true,
            httpOnly: true,
            sameSite: "lax"
        }
    }]);
    assert.equal(redirected, "/");
});
