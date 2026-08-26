"use strict";

const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const resources = [
    {name: "items", field: "Item"},
    {name: "mobs", field: "Mob"},
    {name: "quests", field: "Quest"},
    {name: "wiki", field: "WikiPage"}
];

function loadResourceRoute(resource, postAsync, handleNotifications) {
    const routePath = require.resolve(`../src/routes/${resource.name}`);
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (parent?.filename === routePath && request === "./api/utils") {
            return {
                handleNotifications: handleNotifications || async function(_token, notifications) {
                    return notifications;
                },
                postAsync
            };
        }
        if (parent?.filename === routePath && request === "./api/items") {
            return {
                constants: {},
                fragment: "fragment ItemAll on Item { id }"
            };
        }
        if (parent?.filename === routePath && request === "../markdown")
            return {renderMarkdown: value => value};
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

function request(origin) {
    return {
        body: {id: "7"},
        cookies: {loginToken: "route-secret-token"},
        ip: "192.0.2.17",
        protocol: "https",
        get: function(name) {
            if (name === "host") return "legendhub.example";
            if (name === "origin") return origin;
        }
    };
}

function response() {
    return {
        locals: {user: {notifications: []}},
        cookie: function() {},
        redirect: function() {},
        sendStatus: function(value) { this.status = value; }
    };
}

test("content delete and revert endpoints are POST-only and reject cross-origin requests", async function() {
    for (const resource of resources) {
        let calls = 0;
        const router = loadResourceRoute(resource, async function() {
            calls += 1;
            return {};
        });

        for (const path of ["/delete.html", "/revert.html"]) {
            assert.equal(routeHandlers(router, path, "get").length, 0,
                `${resource.name}${path} must not accept GET`);
            const handlers = routeHandlers(router, path, "post");
            assert.equal(handlers.length >= 2, true,
                `${resource.name}${path} must enforce origin before mutation`);
            const res = response();
            await runHandlers(handlers, request("https://attacker.invalid"), res);
            assert.equal(res.status, 403);
            assert.equal(calls, 0);
        }
    }
});

test("content mutations keep session tokens and numeric ids in GraphQL variables", async function() {
    for (const resource of resources) {
        for (const action of ["delete", "revert"]) {
            let captured;
            const field = `${action}${resource.field}`;
            const router = loadResourceRoute(resource, async function(query, ip, variables) {
                captured = {query, ip, variables};
                if (action === "delete")
                    return {[field]: {token: "renewed", expires: null}};
                return {[field]: {id: 7, tokenRenewal: {token: "renewed", expires: null}}};
            });
            const handlers = routeHandlers(router, `/${action}.html`, "post");
            await runHandlers(handlers, request("https://legendhub.example"), response());

            assert.equal(captured.ip, "192.0.2.17");
            assert.doesNotMatch(captured.query, /route-secret-token/);
            assert.doesNotMatch(captured.query, /\bid\s*:\s*7\b/);
            assert.deepEqual(captured.variables, action === "delete" ? {
                authToken: "route-secret-token",
                id: 7
            } : {
                authToken: "route-secret-token",
                historyId: 7
            });
        }
    }
});

test("content detail, history, and edit routes pass numeric ids as GraphQL variables", async function() {
    for (const resource of resources) {
        const endpointFields = [
            {path: "/details.html", field: `get${resource.field}ById`, authenticated: false},
            {path: "/history.html", field: `get${resource.field}HistoryById`, authenticated: false},
            {path: "/edit.html", field: `get${resource.field}ById`, authenticated: true}
        ];

        for (const endpoint of endpointFields) {
            const sentinel = new Error("stop after query capture");
            let captured;
            const router = loadResourceRoute(resource, async function(query, ip, variables) {
                captured = {query, ip, variables};
                throw sentinel;
            });
            const handler = routeHandlers(router, endpoint.path, "get")[0];
            let forwardedError;
            await handler({
                cookies: {},
                ip: "192.0.2.21",
                query: {id: "7"}
            }, {
                locals: {
                    url: {path: `${resource.name}${endpoint.path}`},
                    user: endpoint.authenticated ? {notifications: []} : null
                },
                redirect: function() {
                    assert.fail("authenticated edit route must not redirect");
                }
            }, function(error) {
                forwardedError = error;
            });

            assert.equal(forwardedError, sentinel);
            assert.match(captured.query, new RegExp(`\\b${endpoint.field}\\s*\\(id:\\s*\\$id\\)`));
            assert.doesNotMatch(captured.query, /\bid\s*:\s*7\b/);
            assert.deepEqual(captured.variables, {id: 7});
        }
    }
});

test("authenticated detail routes use one numeric id for notifications and content lookup", async function() {
    for (const resource of resources) {
        const sentinel = new Error("stop after query capture");
        let notificationId;
        let variables;
        const router = loadResourceRoute(resource, async function(_query, _ip, nextVariables) {
            variables = nextVariables;
            throw sentinel;
        }, async function(_token, notifications, _objectType, objectId) {
            notificationId = objectId;
            return notifications;
        });
        const handler = routeHandlers(router, "/details.html", "get")[0];
        let forwardedError;

        await handler({
            cookies: {loginToken: "session-token"},
            ip: "192.0.2.22",
            query: {id: "7"}
        }, {
            locals: {
                user: {notifications: [{id: 1}]}
            }
        }, function(error) {
            forwardedError = error;
        });

        assert.equal(forwardedError, sentinel);
        assert.equal(notificationId, 7, `${resource.name} notification id`);
        assert.deepEqual(variables, {id: 7}, `${resource.name} detail id`);
    }
});

test("Items list normalizes malformed and repeated public query parameters", async function() {
    let captured;
    const router = loadResourceRoute(resources[0], async function(query, ip, variables) {
        captured = {query, ip, variables};
        return {
            getItems: {items: [], moreResults: false},
            getItemStatCategories: [],
            getItemStatInfo: []
        };
    });
    const handler = routeHandlers(router, "/", "get")[0];
    let rendered;
    await handler({
        cookies: {},
        query: {
            filters: ["slot_3", "isLight"],
            page: "not-a-page",
            search: ["first", "second"],
            sortAsc: "yes",
            sortBy: ["name", "slot"]
        }
    }, {
        render: function(view, locals) { rendered = {view, locals}; }
    }, function(error) {
        if (error) throw error;
    });

    assert.deepEqual(captured.variables, {
        searchString: null,
        filterString: null,
        sortBy: null,
        sortAsc: null,
        page: 1,
        rows: 20
    });
    assert.equal(rendered.view, "items/index");
    assert.equal(rendered.locals.title, "Recent Items");
    assert.equal(rendered.locals.vm.urls.canonical, "/items/index.html?page=1");
});
