const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

async function renderHome(cookies = {}) {
    const ejs = require("ejs");
    return ejs.renderFile(path.join(__dirname, "../src/views/index.ejs"), {
        cookies,
        showDiscordWidget: false,
        title: "Home",
        url: {path: "/"},
        user: null,
        version: "test"
    });
}

test("PHP-compatible password hashes can be created and verified", function() {
    const passwords = require("../src/routes/api/php-password");
    const hash = passwords.hash("correct horse battery staple");

    assert.match(hash, /^\$2y\$/);
    assert.equal(passwords.verify("correct horse battery staple", hash), true);
    assert.equal(passwords.verify("wrong password", hash), false);
});

test("EJS renders the home page and its shared includes", async function() {
    const html = await renderHome();

    assert.match(html, /Welcome to LegendHUB!/);
    assert.match(html, /Builder/);
    assert.match(html, /Cookie Policy/);
});

test("Glass Blue is the default while saved themes remain unchanged", async function() {
    const defaultHtml = await renderHome();
    assert.match(defaultHtml,
        /href="\/css\/bootstrap-glass-blue\.min\.css\?v=test"/);
    assert.match(defaultHtml,
        /<meta property="theme-color" content="#0d1f30" \/>/);

    for (const theme of ["light", "dark", "solarized-dark"]) {
        const html = await renderHome({theme});
        assert.match(html, new RegExp(
            `href="/css/bootstrap-${theme}\\.min\\.css\\?v=test"`));
        assert.doesNotMatch(html, /bootstrap-glass-blue\.min\.css/);
    }
});

test("theme chooser exposes the Glass family and preserves standard choices", function() {
    const source = fs.readFileSync(path.join(
        __dirname, "../src/public/js/apps/legendwiki-app.js"), "utf8");
    assert.match(source,
        /\$scope\.glassThemes = \['Glass Blue', 'Glass Emerald', 'Glass Ruby', 'Glass Amethyst', 'Glass Amber'\]/);
    assert.match(source,
        /\$scope\.standardThemes = \['Light', 'Dark', 'Solarized Dark'\]/);
    assert.match(source, /toLowerCase\(\)\.replace\(\/\\s\/g, '-'\)/);
});

test("installable app metadata uses the Glass Blue browser colors", function() {
    const manifest = JSON.parse(fs.readFileSync(path.join(
        __dirname, "../src/public/site.webmanifest"), "utf8"));
    assert.equal(manifest.theme_color, "#0d1f30");
    assert.equal(manifest.background_color, "#05070b");
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
