"use strict";

const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const {normalizeReturnUrl, requireSameOrigin} = require("../src/routes/request-security");

const indexRoutePath = require.resolve("../src/routes/index");

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
    const router = loadIndexRoute({
        logout: function() {},
        postAsync: async function() {
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
            redirect: function(value) { redirected = value; }
        });
        assert.equal(redirected, expected);
    }
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
