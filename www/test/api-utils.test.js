"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

test("account input errors expose the established GraphQL status codes", function() {
    const {
        BadRequestError,
        ConflictError,
        PayloadTooLargeError
    } = require("../src/routes/api/utils");

    for (const [ErrorType, code] of [
        [BadRequestError, 400],
        [ConflictError, 409],
        [PayloadTooLargeError, 413]
    ]) {
        const error = new ErrorType("public message");
        assert.equal(error.message, "public message");
        assert.equal(error.extensions.code, code);
    }
});

// Catches the server GraphQL proxy dropping route-provided variables from the POST body.
test("postAsync forwards GraphQL variables with the existing query and IP boundary", async function(t) {
    const originalFetch = globalThis.fetch;
    const originalPort = process.env.PORT;
    t.after(function() {
        globalThis.fetch = originalFetch;
        if (originalPort === undefined)
            delete process.env.PORT;
        else
            process.env.PORT = originalPort;
    });

    let request;
    globalThis.fetch = async function(url, options) {
        request = {url, options};
        return {json: async function() { return {data: {revertMob: {id: 201}}}; }};
    };
    process.env.PORT = "43210";
    const apiUtils = require("../src/routes/api/utils");
    const query = "mutation($authToken: String!, $historyId: Int!) { revertMob(authToken: $authToken, historyId: $historyId) { id } }";
    const variables = {authToken: "route-token", historyId: 1201};

    assert.deepEqual(await apiUtils.postAsync(query, "192.0.2.8", variables), {
        revertMob: {id: 201}
    });
    assert.equal(request.url, "http://localhost:43210/api");
    assert.deepEqual(request.options, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-forwarded-for": "192.0.2.8"
        },
        body: JSON.stringify({query, variables})
    });
});

test("handleNotifications marks matching objects with GraphQL variables", async function(t) {
    const apiUtils = require("../src/routes/api/utils");
    const originalPostAsync = apiUtils.postAsync;
    t.after(function() { apiUtils.postAsync = originalPostAsync; });
    let captured;
    apiUtils.postAsync = async function(query, ip, variables) {
        captured = {query, ip, variables};
    };

    const notifications = [
        {objectType: "item", objectId: 7},
        {objectType: "quest", objectId: 8}
    ];
    const remaining = await apiUtils.handleNotifications(
        "notification-secret", notifications, "item", 7);

    assert.deepEqual(remaining, [{objectType: "quest", objectId: 8}]);
    assert.doesNotMatch(captured.query, /notification-secret|objectType:\s*"item"|objectId:\s*7/);
    assert.equal(captured.ip, undefined);
    assert.deepEqual(captured.variables, {
        authToken: "notification-secret",
        objectType: "item",
        objectId: 7
    });
});
