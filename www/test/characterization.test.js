const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

test("PHP-compatible password hashes can be created and verified", function() {
    const passwords = require("../src/routes/api/php-password");
    const hash = passwords.hash("correct horse battery staple");

    assert.match(hash, /^\$2y\$/);
    assert.equal(passwords.verify("correct horse battery staple", hash), true);
    assert.equal(passwords.verify("wrong password", hash), false);
});

test("EJS renders the home page and its shared includes", async function() {
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
    assert.match(html, /Builder/);
    assert.match(html, /Cookie Policy/);
});

test("fatal error page renders without request locals", async function() {
    const ejs = require("ejs");
    const html = await ejs.renderFile(path.join(__dirname, "../src/views/error/fatal.ejs"));

    assert.match(html, /<title>Fatal Error \| LegendHUB<\/title>/);
    assert.match(html, /A fatal error has occurred/);
});

test("API error types retain their public status codes", function() {
    const {
        NotFoundError,
        TooManyRequestsError,
        UnauthorizedError
    } = require("../src/routes/api/utils");

    assert.equal(new NotFoundError().extensions.code, 404);
    assert.equal(new TooManyRequestsError().extensions.code, 429);
    assert.equal(new UnauthorizedError().extensions.code, 401);
});
