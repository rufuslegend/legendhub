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
    return {
        result,
        sendStatus(status) {
            result.status = status;
            return this;
        },
        render(view, locals) {
            result.rendered = {view, locals};
            return this;
        }
    };
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

// Catches consuming successfully but failing to render the service's generic
// result, or passing the token anywhere other than the service boundary.
test("same-origin POST consumes once and renders the action result", async function() {
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
        require(createAppPath)({
            accountEmailService: {verifyEmailToken: async function() {}},
            logError: function() {}
        });
    }
    finally {
        Module._load = originalLoad;
        delete require.cache[createAppPath];
    }

    for (const path of [
        "/verify-email.html",
        "/VERIFY-EMAIL.HTML",
        "/verify-email.html/"
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
