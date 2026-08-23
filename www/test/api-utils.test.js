"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

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
