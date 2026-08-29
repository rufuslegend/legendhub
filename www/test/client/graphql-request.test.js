"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

async function loadModule() {
    return import("../../client/lib/graphql-request.js");
}

async function loadRootModule() {
    return import("../../client/lib/mount-react-root.js");
}

function response(body, status = 200) {
    return {
        status,
        json: async function() { return body; }
    };
}

test("React root props require exactly one named root", async function() {
    const {readRootProps} = await loadRootModule();
    const root = {getAttribute: function() { return "account-settings"; }};
    const props = {
        getAttribute: function() { return "account-settings"; },
        textContent: '{"enabled":true}'
    };
    const document = {
        querySelectorAll: function(selector) {
            if (selector === "[data-react-root]") return [root];
            if (selector === "[data-react-props]") return [props];
            assert.fail(`unexpected selector ${selector}`);
        }
    };

    assert.deepEqual(readRootProps({name: "account-settings", document}), {
        root,
        props: {enabled: true}
    });
    assert.throws(function() {
        readRootProps({
            name: "account-settings",
            document: {querySelectorAll: function() { return []; }}
        });
    }, /Missing React root/);
    assert.throws(function() {
        readRootProps({
            name: "account-settings",
            document: {
                querySelectorAll: function(selector) {
                    return selector === "[data-react-root]" ? [root, root] : [];
                }
            }
        });
    }, /Duplicate React root/);
});

test("React root props default to an empty object and reject duplicate or invalid JSON", async function() {
    const {readRootProps} = await loadRootModule();
    const root = {getAttribute: function() { return "account-settings"; }};
    const document = {
        querySelectorAll: function(selector) {
            return selector === "[data-react-root]" ? [root] : [];
        }
    };

    assert.deepEqual(readRootProps({name: "account-settings", document}), {root, props: {}});
    assert.throws(function() {
        readRootProps({
            name: "account-settings",
            document: {
                querySelectorAll: function(selector) {
                    if (selector === "[data-react-root]") return [root];
                    return [
                        {getAttribute: function() { return "account-settings"; }},
                        {getAttribute: function() { return "account-settings"; }}
                    ];
                }
            }
        });
    }, /Duplicate React props/);
    assert.throws(function() {
        readRootProps({
            name: "account-settings",
            document: {
                querySelectorAll: function(selector) {
                    if (selector === "[data-react-root]") return [root];
                    return [{
                        getAttribute: function() { return "account-settings"; },
                        textContent: "not JSON"
                    }];
                }
            }
        });
    }, /Invalid React props/);
});

test("GraphQL request POSTs same-origin JSON and returns data", async function(t) {
    const originalFetch = globalThis.fetch;
    t.after(function() { globalThis.fetch = originalFetch; });
    let request;
    globalThis.fetch = async function(url, options) {
        request = {url, options};
        return response({data: {saved: true}});
    };
    const {graphqlRequest} = await loadModule();

    const data = await graphqlRequest({
        query: "query Save($name: String!) { save(name: $name) }",
        variables: {name: "Aster"}
    });

    assert.deepEqual(data, {saved: true});
    assert.equal(request.url, "/api");
    assert.deepEqual(request.options, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        credentials: "same-origin",
        signal: undefined,
        body: JSON.stringify({
            query: "query Save($name: String!) { save(name: $name) }",
            variables: {name: "Aster"}
        })
    });
});

test("GraphQL request normalizes GraphQL and unexpected response errors", async function(t) {
    const originalFetch = globalThis.fetch;
    t.after(function() { globalThis.fetch = originalFetch; });
    const {graphqlRequest, GraphQLRequestError} = await loadModule();

    globalThis.fetch = async function() {
        return response({errors: [{
            message: "The saved setting is invalid.",
            code: 429
        }]});
    };
    await assert.rejects(
        graphqlRequest({query: "query { settings }"}),
        function(error) {
            assert.ok(error instanceof GraphQLRequestError);
            assert.equal(error.message, "The saved setting is invalid.");
            assert.deepEqual(error.errors, [{
                message: "The saved setting is invalid.",
                code: 429
            }]);
            return true;
        }
    );

    globalThis.fetch = async function() { return response({}); };
    await assert.rejects(
        graphqlRequest({query: "query { settings }"}),
        /The server returned an invalid response\./
    );

    globalThis.fetch = async function() { return response(null); };
    await assert.rejects(
        graphqlRequest({query: "query { settings }"}),
        function(error) {
            assert.ok(error instanceof GraphQLRequestError);
            assert.equal(error.message, "The server returned an invalid response.");
            return true;
        }
    );
});

// Production break caught: non-2xx status is discarded, so Builder 409/413
// application failures look like empty network errors and retry automatically.
test("GraphQL request preserves safe non-2xx status codes without reading diagnostics", async function(t) {
    const originalFetch = globalThis.fetch;
    t.after(function() { globalThis.fetch = originalFetch; });
    const {graphqlRequest, GraphQLRequestError} = await loadModule();

    for (const code of [409, 413]) {
        globalThis.fetch = async function() {
            return response({errors: [{message: "private server diagnostic"}]}, code);
        };
        await assert.rejects(
            graphqlRequest({query: "mutation { saveBuilder }"}),
            function(error) {
                assert.ok(error instanceof GraphQLRequestError);
                assert.equal(error.message, "The request could not be completed.");
                assert.equal(error.code, code);
                assert.deepEqual(error.errors, []);
                return true;
            }
        );
    }
});

test("GraphQL request normalizes malformed JSON responses", async function(t) {
    const originalFetch = globalThis.fetch;
    t.after(function() { globalThis.fetch = originalFetch; });
    const {graphqlRequest, GraphQLRequestError} = await loadModule();

    globalThis.fetch = async function() {
        return {
            status: 200,
            json: async function() {
                throw new SyntaxError("Unexpected token '<'");
            }
        };
    };

    await assert.rejects(
        graphqlRequest({query: "query { settings }"}),
        function(error) {
            assert.ok(error instanceof GraphQLRequestError);
            assert.equal(error.message, "The server returned an invalid response.");
            assert.deepEqual(error.errors, []);
            return true;
        }
    );
});

test("GraphQL request normalizes malformed GraphQL error entries", async function(t) {
    const originalFetch = globalThis.fetch;
    t.after(function() { globalThis.fetch = originalFetch; });
    const {graphqlRequest, GraphQLRequestError} = await loadModule();

    globalThis.fetch = async function() {
        return response({errors: [null, {}, {message: "A valid error."}]});
    };

    await assert.rejects(
        graphqlRequest({query: "query { settings }"}),
        function(error) {
            assert.ok(error instanceof GraphQLRequestError);
            assert.equal(error.message, "The request could not be completed.");
            assert.deepEqual(error.errors, [
                {message: "The request could not be completed."},
                {message: "The request could not be completed."},
                {message: "A valid error."}
            ]);
            return true;
        }
    );
});

test("GraphQL request preserves abort errors", async function(t) {
    const originalFetch = globalThis.fetch;
    t.after(function() { globalThis.fetch = originalFetch; });
    const abortError = new DOMException("The operation was aborted.", "AbortError");
    globalThis.fetch = async function() { throw abortError; };
    const {graphqlRequest} = await loadModule();

    await assert.rejects(graphqlRequest({query: "query { settings }"}), function(error) {
        assert.equal(error, abortError);
        return true;
    });
});

test("GraphQL request redirects unauthorized responses to the existing error page", async function(t) {
    const originalFetch = globalThis.fetch;
    const originalWindow = globalThis.window;
    t.after(function() {
        globalThis.fetch = originalFetch;
        globalThis.window = originalWindow;
    });
    let redirect;
    globalThis.window = {location: {assign: function(path) { redirect = path; }}};
    globalThis.fetch = async function() { return response({}, 403); };
    const {graphqlRequest} = await loadModule();

    await assert.rejects(graphqlRequest({query: "query { settings }"}), /Authorization required\./);
    assert.equal(redirect, "/error/401.html");
});

test("GraphQL request redirects HTTP-200 authorization errors to the existing error page", async function(t) {
    const originalFetch = globalThis.fetch;
    const originalWindow = globalThis.window;
    t.after(function() {
        globalThis.fetch = originalFetch;
        globalThis.window = originalWindow;
    });
    let redirect;
    globalThis.window = {location: {assign: function(path) { redirect = path; }}};
    const {graphqlRequest, GraphQLRequestError} = await loadModule();

    for (const code of [401, 403]) {
        redirect = undefined;
        globalThis.fetch = async function() {
            return response({
                data: {updatePassword: null},
                errors: [{
                    message: "Invalid token",
                    path: ["updatePassword"],
                    code
                }]
            });
        };

        await assert.rejects(
            graphqlRequest({query: "mutation UpdatePassword { updatePassword }"}),
            function(error) {
                assert.ok(error instanceof GraphQLRequestError);
                assert.equal(error.message, "Authorization required.");
                return true;
            }
        );
        assert.equal(redirect, "/error/401.html");
    }
});
