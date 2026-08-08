const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

function loadAppWithoutDatabaseMetadataQuery(options = {}) {
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
            ...options,
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
        const response = await fetch(`${baseUrl}/`, {
            headers: {
                "Accept-Encoding": "gzip"
            }
        });
        assert.equal(response.status, 200);
        assert.match(response.headers.get("content-type"), /^text\/html/);
        assert.equal(response.headers.get("content-encoding"), "gzip");
        assert.equal(response.headers.get("x-powered-by"), null);
        assert.equal(response.headers.get("x-content-type-options"), "nosniff");
        assert.equal(response.headers.get("x-frame-options"), null);
        assert.equal(
            response.headers.get("content-security-policy"),
            "frame-ancestors 'self' https://play.legendmud.org " +
                "https://legend.dunwichmass.com:8000 http://localhost:5173"
        );
        assert.equal(response.headers.get("strict-transport-security"), null);
        const body = await response.text();
        assert.match(body, /Welcome to LegendHUB!/);
        assert.match(body, /https:\/\/github\.com\/rufuslegend\/legendhub/);
        assert.doesNotMatch(body, /topmudsites|>Vote!?<|discordapp\.com\/widget/i);
    });

    await t.test("serves forms that do not have a request body on GET", async function() {
        const loginResponse = await fetch(`${baseUrl}/login.html`);
        assert.equal(loginResponse.status, 200);
        assert.match(loginResponse.headers.get("content-type"), /^text\/html/);
        assert.match(await loginResponse.text(), /<form[^>]+action="\/login\.html"/);

        const feedbackResponse = await fetch(`${baseUrl}/feedback.html`);
        assert.equal(feedbackResponse.status, 200);
        assert.match(feedbackResponse.headers.get("content-type"), /^text\/html/);
        assert.match(await feedbackResponse.text(), /Send Feedback/);
    });

    await t.test("serves a static asset", async function() {
        const response = await fetch(`${baseUrl}/robots.txt`);
        assert.equal(response.status, 200);
        assert.match(await response.text(), /Sitemap: https:\/\/www\.legendhub\.org\/sitemap\.xml/);

        const sourceMapResponse = await fetch(`${baseUrl}/css/bootstrap-light.min.css.map`);
        assert.equal(sourceMapResponse.status, 200);
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

    await t.test("returns JSON and preserves status for malformed API requests", async function() {
        const response = await fetch(`${baseUrl}/api`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: "{not valid json"
        });

        assert.equal(response.status, 400);
        assert.match(response.headers.get("content-type"), /^application\/json/);
        assert.deepEqual(await response.json(), {
            errors: [{
                message: "Invalid request body.",
                code: 400
            }]
        });
    });

    await t.test("returns JSON for oversized API request bodies", async function() {
        const response = await fetch(`${baseUrl}/api`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                value: "x".repeat(110 * 1024)
            })
        });

        assert.equal(response.status, 413);
        assert.match(response.headers.get("content-type"), /^application\/json/);
        assert.deepEqual(await response.json(), {
            errors: [{
                message: "Request body is too large.",
                code: 413
            }]
        });
    });

    await t.test("renders unsupported HTML error statuses without converting them to 500", async function() {
        const response = await fetch(`${baseUrl}/login.html`, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: `value=${"x".repeat(110 * 1024)}`
        });

        assert.equal(response.status, 413);
        assert.match(response.headers.get("content-type"), /^text\/html/);
        assert.match(await response.text(), /Request body is too large/);
    });

    await t.test("renders the current 404 page", async function() {
        const response = await fetch(`${baseUrl}/this-page-does-not-exist`);
        assert.equal(response.status, 404);
        assert.match(await response.text(), /The page you are looking for does not exist/);
    });

    await t.test("production blocks source maps and enables transport security", async function(t) {
        const productionApp = loadAppWithoutDatabaseMetadataQuery({
            environment: "production"
        });
        const productionServer = await new Promise(function(resolve) {
            const listeningServer = productionApp.listen(0, "127.0.0.1", function() {
                resolve(listeningServer);
            });
        });
        t.after(function() {
            return new Promise(function(resolve, reject) {
                productionServer.close(function(error) {
                    if (error)
                        reject(error);
                    else
                        resolve();
                });
            });
        });

        const productionUrl = `http://127.0.0.1:${productionServer.address().port}`;
        const mapResponse = await fetch(`${productionUrl}/css/bootstrap-light.min.css.map?source=true`);
        assert.equal(mapResponse.status, 404);

        const homeResponse = await fetch(`${productionUrl}/`);
        assert.equal(homeResponse.status, 200);
        assert.equal(
            homeResponse.headers.get("strict-transport-security"),
            "max-age=31536000; includeSubDomains"
        );
    });
});
