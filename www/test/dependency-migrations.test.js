const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

test("PHP-compatible password hashes can be created and verified", function() {
    const passwords = require("../src/routes/api/php-password");
    const hash = passwords.hash("correct horse battery staple");

    assert.match(hash, /^\$2y\$/);
    assert.equal(passwords.verify("correct horse battery staple", hash), true);
    assert.equal(passwords.verify("wrong password", hash), false);
});

test("EJS renders the home page and its includes", async function() {
    const ejs = require("ejs");
    const html = await ejs.renderFile(path.join(__dirname, "../src/views/index.ejs"), {
        cookies: {},
        title: "Home",
        url: {
            path: "/"
        },
        user: null,
        version: "test"
    });

    assert.match(html, /Welcome to LegendHUB!/);
});

test("GraphQL and Ruru middleware handle requests", async function(t) {
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

    const express = require("express");
    let api;
    try {
        api = require("../src/routes/api");
    }
    finally {
        Module._load = originalLoad;
    }

    const app = express();
    app.use(express.json());
    app.use("/api", api);

    const server = await new Promise(function(resolve) {
        const listeningServer = app.listen(0, function() {
            resolve(listeningServer);
        });
    });
    t.after(function() {
        server.close();
    });

    const address = `http://127.0.0.1:${server.address().port}/api`;
    const graphqlResponse = await fetch(address, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            query: "{ __typename }"
        })
    });
    assert.equal(graphqlResponse.status, 200);
    assert.deepEqual(await graphqlResponse.json(), {
        data: {
            __typename: "Query"
        }
    });

    const ruruResponse = await fetch(address, {
        headers: {
            "Accept": "text/html"
        }
    });
    assert.equal(ruruResponse.status, 200);
    assert.match(await ruruResponse.text(), /Ruru/);
});
