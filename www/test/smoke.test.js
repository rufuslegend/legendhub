const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

function loadAppWithoutDatabaseMetadataQuery() {
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (request === "sync-rpc")
            return function() {
                return function() {
                    return [];
                };
            };

        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        return require("../src/create-app")({
            logging: false
        });
    }
    finally {
        Module._load = originalLoad;
    }
}

test("application HTTP smoke test", async function(t) {
    const app = loadAppWithoutDatabaseMetadataQuery();
    const server = await new Promise(function(resolve) {
        const listeningServer = app.listen(0, "127.0.0.1", function() {
            resolve(listeningServer);
        });
    });
    t.after(function() {
        return new Promise(function(resolve, reject) {
            server.close(function(error) {
                if (error)
                    reject(error);
                else
                    resolve();
            });
        });
    });

    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    await t.test("serves the home page", async function() {
        const response = await fetch(`${baseUrl}/`);
        assert.equal(response.status, 200);
        assert.match(response.headers.get("content-type"), /^text\/html/);
        assert.match(await response.text(), /Welcome to LegendHUB!/);
    });

    await t.test("serves a static asset", async function() {
        const response = await fetch(`${baseUrl}/robots.txt`);
        assert.equal(response.status, 200);
        assert.match(await response.text(), /Sitemap: https:\/\/www\.legendhub\.org\/sitemap\.xml/);
    });

    await t.test("serves the GraphQL endpoint", async function() {
        const response = await fetch(`${baseUrl}/api`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                query: "{ __typename }"
            })
        });

        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
            data: {
                __typename: "Query"
            }
        });
    });

    await t.test("serves the GraphQL explorer", async function() {
        const response = await fetch(`${baseUrl}/api`, {
            headers: {
                "Accept": "text/html"
            }
        });
        assert.equal(response.status, 200);
        assert.match(await response.text(), /Ruru/);
    });

    await t.test("rejects multiple mutations in one operation", async function() {
        const response = await fetch(`${baseUrl}/api`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                query: "mutation { first: authLogin { token } second: authLogin { token } }"
            })
        });
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.match(body.errors[0].message, /Multiple mutation operations are not allowed/);
        assert.equal(body.errors[0].code, 500);
    });

    await t.test("renders the current 404 page", async function() {
        const response = await fetch(`${baseUrl}/this-page-does-not-exist`);
        assert.equal(response.status, 404);
        assert.match(await response.text(), /The page you are looking for does not exist/);
    });
});
