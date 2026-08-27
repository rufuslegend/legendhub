"use strict";

const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const createAccountActionsRouter = require("../src/routes/account-actions");
const createAppPath = require.resolve("../src/create-app");

function routeLayer(router, method, path) {
    return router.stack.find(layer =>
        layer.route?.path === path && layer.route.methods[method]);
}

function responseDouble() {
    const result = {status: null, rendered: null};
    const headers = new Map();
    const clearedCookies = [];
    return {
        result,
        headers,
        clearedCookies,
        locals: {cookies: {}},
        set(name, value) {
            headers.set(name.toLowerCase(), value);
            return this;
        },
        sendStatus(status) {
            result.status = status;
            return this;
        },
        render(view, locals) {
            result.rendered = {view, locals};
            return this;
        },
        clearCookie(name, options) {
            clearedCookies.push({name, options});
            return this;
        }
    };
}

// Catches token-bearing action pages inheriting the site's same-origin
// referrer policy and disclosing the raw GET URL to a later navigation.
test("token action pages suppress referrers", function() {
    const router = createAccountActionsRouter({
        accountEmailService: {},
        passwordRecoveryService: {},
        getIPFromRequest: function() { return "request-ip-hash"; }
    });

    for (const path of ["/verify-email.html", "/reset-password.html"]) {
        const response = responseDouble();
        routeLayer(router, "get", path).route.stack[0].handle({
            query: {token: "selector-raw-validator"}
        }, response);
        assert.equal(response.headers.get("referrer-policy"), "no-referrer", path);
    }
});

test("token action results keep referrers suppressed", async function() {
    const router = createAccountActionsRouter({
        accountEmailService: {
            async verifyEmailToken() {
                return {success: true, message: "verified"};
            }
        },
        passwordRecoveryService: {
            async resetPassword() { return {success: true}; }
        },
        getIPFromRequest: function() { return "request-ip-hash"; }
    });
    const requests = {
        "/verify-email.html": {token: "selector-raw-validator"},
        "/reset-password.html": {
            token: "selector-raw-validator",
            newPassword: "replacement-password",
            confirmPassword: "replacement-password"
        }
    };

    for (const path of Object.keys(requests)) {
        const response = responseDouble();
        await runHandlers(routeLayer(router, "post", path), {
            protocol: "https",
            body: requests[path],
            get(name) {
                return {host: "legendhub.org", origin: "https://legendhub.org"}[name];
            }
        }, response);
        assert.equal(response.headers.get("referrer-policy"), "no-referrer", path);
    }
});

function runHandlers(layer, request, response) {
    let index = 0;
    async function next(error) {
        if (error)
            throw error;
        const handler = layer.route.stack[index++]?.handle;
        if (handler)
            await handler(request, response, next);
    }
    return next();
}

// Catches link scanners consuming a one-time token merely by following the
// emailed URL instead of requiring an explicit confirmation POST.
test("GET verification renders confirmation without consuming the token", function() {
    let consumed = 0;
    const router = createAccountActionsRouter({
        accountEmailService: {
            async verifyEmailToken() { consumed += 1; }
        }
    });
    const layer = routeLayer(router, "get", "/verify-email.html");
    const response = responseDouble();

    layer.route.stack[0].handle({query: {token: "selector-validator"}}, response);

    assert.equal(consumed, 0);
    assert.deepEqual(response.result.rendered, {
        view: "account-actions/verify-email",
        locals: {
            title: "Verify Email",
            vm: {token: "selector-validator"}
        }
    });
});

// Catches omission or reordering of same-origin enforcement on the public
// token-consumption endpoint.
test("POST verification rejects cross-site requests before token consumption", function() {
    let consumed = 0;
    const router = createAccountActionsRouter({
        accountEmailService: {
            async verifyEmailToken() { consumed += 1; }
        }
    });
    const layer = routeLayer(router, "post", "/verify-email.html");
    const response = responseDouble();
    const request = {
        protocol: "https",
        body: {token: "selector-validator"},
        get(name) {
            return {
                host: "legendhub.org",
                origin: "https://attacker.example"
            }[name];
        }
    };

    layer.route.stack[0].handle(request, response, function() {
        assert.fail("a cross-site request must not reach token consumption");
    });

    assert.equal(response.result.status, 403);
    assert.equal(consumed, 0);
});

// Catches consuming successfully but rendering the pre-verification account
// prompt/navigation. The valid browser session remains available to rebuild
// fresh locals on the next request.
test("same-origin verification renders a deliberate post-transition auth state", async function() {
    const consumed = [];
    const router = createAccountActionsRouter({
        accountEmailService: {
            async verifyEmailToken(token) {
                consumed.push(token);
                return {
                    success: true,
                    message: "Your email address has been verified."
                };
            }
        }
    });
    const layer = routeLayer(router, "post", "/verify-email.html");
    const response = responseDouble();
    response.locals.user = {
        memberId: 7,
        username: "Player",
        emailVerified: false,
        pendingEmail: "new@example.com"
    };
    response.locals.permissions = {account: true};
    response.locals.cookies.loginToken = "still-valid-session";
    const request = {
        protocol: "https",
        body: {token: "selector-validator"},
        get(name) {
            return {
                host: "legendhub.org",
                origin: "https://legendhub.org"
            }[name];
        }
    };
    let nextHandler;

    layer.route.stack[0].handle(request, response, function() {
        nextHandler = layer.route.stack[1].handle;
    });
    await nextHandler(request, response, function(error) {
        throw error;
    });

    assert.deepEqual(consumed, ["selector-validator"]);
    assert.equal(Object.hasOwn(response.locals, "user"), false);
    assert.equal(Object.hasOwn(response.locals, "permissions"), false);
    assert.equal(Object.hasOwn(response.locals.cookies, "loginToken"), false);
    assert.deepEqual(response.clearedCookies, [],
        "email verification does not invalidate the browser session");
    assert.deepEqual(response.result.rendered, {
        view: "account-actions/action-result",
        locals: {
            title: "Email Verified",
            vm: {
                success: true,
                message: "Your email address has been verified."
            }
        }
    });
});

// Catches the HTTP request logger persisting a raw action token from the
// verification URL while preserving logs for ordinary application routes.
test("request logging omits the token-bearing verification endpoint", function() {
    let loggerOptions;
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (request === "morgan" && parent?.filename === createAppPath) {
            return function(_format, options) {
                loggerOptions = options;
                return function(_req, _res, next) { next(); };
            };
        }
        if (request === "sync-rpc")
            return function() { return function() { return []; }; };
        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        delete require.cache[createAppPath];
        const app = require(createAppPath)({
            accountEmailService: {verifyEmailToken: async function() {}},
            passwordRecoveryService: {},
            logError: function() {}
        });
        assert.equal(app.get("trust proxy"), 1,
            "only the directly connected reverse proxy may supply the client IP");
    }
    finally {
        Module._load = originalLoad;
        delete require.cache[createAppPath];
    }

    for (const path of [
        "/verify-email.html",
        "/VERIFY-EMAIL.HTML",
        "/verify-email.html/",
        "/reset-password.html",
        "/RESET-PASSWORD.HTML",
        "/reset-password.html/"
    ]) {
        assert.equal(loggerOptions.skip({
            path,
            originalUrl: `${path}?token=selector-raw-validator`
        }), true, `${path} must not be logged`);
    }
    assert.equal(loggerOptions.skip({
        path: "/account/",
        originalUrl: "/account/?section=email"
    }), false);
});

// Catches GET/link scanners mutating recovery state or omission of the public
// form pages and their opaque token handoff.
test("password recovery GET pages render forms without requesting or consuming", function() {
    let requested = 0;
    let consumed = 0;
    const router = createAccountActionsRouter({
        passwordRecoveryService: {
            async requestRecovery() { requested += 1; },
            async resetPassword() { consumed += 1; }
        },
        getIPFromRequest: function() { return "request-ip-hash"; }
    });
    const forgotResponse = responseDouble();
    const resetResponse = responseDouble();

    routeLayer(router, "get", "/forgot-password.html").route.stack[0].handle(
        {query: {}}, forgotResponse);
    routeLayer(router, "get", "/reset-password.html").route.stack[0].handle(
        {query: {token: "selector-validator"}}, resetResponse);

    assert.equal(requested, 0);
    assert.equal(consumed, 0);
    assert.deepEqual(forgotResponse.result.rendered, {
        view: "account-actions/forgot-password",
        locals: {title: "Forgot Password", vm: {message: null}}
    });
    assert.deepEqual(resetResponse.result.rendered, {
        view: "account-actions/reset-password",
        locals: {
            title: "Reset Password",
            vm: {token: "selector-validator", message: null, success: false}
        }
    });
});

// Catches cross-site form submissions reaching either recovery mutation.
test("password recovery POST routes reject cross-site requests before mutation", async function() {
    const calls = [];
    const router = createAccountActionsRouter({
        passwordRecoveryService: {
            async requestRecovery(input) { calls.push(["request", input]); },
            async resetPassword(input) { calls.push(["reset", input]); }
        },
        getIPFromRequest: function() { return "request-ip-hash"; }
    });
    const request = {
        protocol: "https",
        body: {
            identity: "private@example.com",
            token: "selector-validator",
            newPassword: "replacement-password",
            confirmPassword: "replacement-password"
        },
        get(name) {
            return {host: "legendhub.org", origin: "https://attacker.example"}[name];
        }
    };

    for (const path of ["/forgot-password.html", "/reset-password.html"]) {
        const response = responseDouble();
        await runHandlers(routeLayer(router, "post", path), request, response);
        assert.equal(response.result.status, 403);
    }
    assert.deepEqual(calls, []);
});

// Catches identity-dependent route output, leaking the submitted identity, or
// failing to use the hashed request IP at the service boundary.
test("same-origin recovery request renders one generic response", async function() {
    const calls = [];
    const router = createAccountActionsRouter({
        passwordRecoveryService: {
            async requestRecovery(input) {
                calls.push(input);
                return {accepted: true};
            }
        },
        getIPFromRequest: function() { return "request-ip-hash"; }
    });
    const request = {
        protocol: "https",
        body: {identity: "private@example.com"},
        get(name) {
            return {host: "legendhub.org", origin: "https://legendhub.org"}[name];
        }
    };
    const response = responseDouble();

    await runHandlers(routeLayer(router, "post", "/forgot-password.html"), request, response);

    assert.deepEqual(calls, [{
        identity: "private@example.com",
        ipHash: "request-ip-hash"
    }]);
    assert.deepEqual(response.result.rendered, {
        view: "account-actions/forgot-password",
        locals: {
            title: "Forgot Password",
            vm: {
                message: "If that account has a verified email address, password reset instructions have been sent."
            }
        }
    });
    assert.equal(JSON.stringify(response.result).includes("private@example.com"), false);
});

// Catches the reset route creating a login token, losing the password fields,
// or giving a browser anything except an explicit fresh-sign-in outcome.
test("same-origin reset delegates once and requires a fresh sign-in", async function() {
    const calls = [];
    const router = createAccountActionsRouter({
        passwordRecoveryService: {
            async resetPassword(input) {
                calls.push(input);
                return {success: true};
            }
        },
        getIPFromRequest: function() { return "request-ip-hash"; }
    });
    const request = {
        protocol: "https",
        cookies: {loginToken: "now-invalid-session"},
        body: {
            token: "selector-validator",
            newPassword: "replacement-password",
            confirmPassword: "replacement-password"
        },
        get(name) {
            return {host: "legendhub.org", origin: "https://legendhub.org"}[name];
        }
    };
    const response = responseDouble();
    response.locals.cookies = request.cookies;
    response.locals.user = {memberId: 7, username: "Player"};
    response.locals.permissions = {account: true};

    await runHandlers(routeLayer(router, "post", "/reset-password.html"), request, response);

    assert.deepEqual(calls, [{
        token: "selector-validator",
        newPassword: "replacement-password"
    }]);
    assert.deepEqual(response.clearedCookies, [{
        name: "loginToken",
        options: {path: "/"}
    }]);
    assert.equal(Object.hasOwn(request.cookies, "loginToken"), false);
    assert.equal(Object.hasOwn(response.locals, "user"), false);
    assert.equal(Object.hasOwn(response.locals, "permissions"), false);
    assert.deepEqual(response.result.rendered, {
        view: "account-actions/reset-password",
        locals: {
            title: "Password Changed",
            vm: {
                token: "",
                success: true,
                message: "Your password has been changed. Sign in again to continue."
            }
        }
    });
});
