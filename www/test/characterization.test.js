const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

async function renderHome(cookies = {}) {
    const ejs = require("ejs");
    const {normalizeTheme} = require("../src/view-helpers");
    return ejs.renderFile(path.join(__dirname, "../src/views/index.ejs"), {
        cookies,
        normalizeTheme,
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

    for (const theme of ["light", "dark", "solarized-dark", "high-contrast"]) {
        const html = await renderHome({theme});
        assert.match(html, new RegExp(
            `href="/css/bootstrap-${theme}\\.min\\.css\\?v=test"`));
        assert.doesNotMatch(html, /bootstrap-glass-blue\.min\.css/);
    }
});

test("theme chooser exposes the Glass family and preserves standard choices", async function() {
    const html = await renderHome();

    for (const theme of [
        "glass-blue", "glass-emerald", "glass-ruby", "glass-amethyst", "glass-amber",
        "light", "dark", "solarized-dark", "high-contrast"
    ]) {
        assert.match(html, new RegExp(`data-theme="${theme}"`));
    }
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

test("authorized content pages render named delete buttons with valid closing tags", async function() {
    const ejs = require("ejs");
    const {normalizeTheme} = require("../src/view-helpers");
    const shared = {
        cookies: {},
        displayDateTime: function() { return ""; },
        normalizeTheme,
        permissions: {hasPermission: function() { return true; }},
        title: "Details",
        url: {path: "/details.html"},
        user: null,
        version: "test"
    };
    const fixtures = [
        ["items", "item", {
            item: {
                id: 7, name: "Test item", slot: 0, rent: 0, ac: 0,
                strength: 0, mind: 0, dexterity: 0, constitution: 0,
                perception: 0, spirit: 0, getHistories: [], getMob: null,
                getQuest: null, modifiedBy: "Tester", notes: ""
            },
            itemNotesHtml: "", statCategories: [],
            constants: {selectOptions: {
                alignRestriction: ["No Align Restriction"],
                slot: ["Light"]
            }}
        }],
        ["mobs", "mob", {
            mob: {
                id: 7, name: "Test mob", getItems: [], getHistories: [],
                modifiedBy: "Tester", notes: ""
            },
            mobNotesHtml: "", constants: {selectOptions: {slot: ["Light"]}}
        }],
        ["quests", "quest", {
            quest: {
                id: 7, title: "Test quest", getItems: [], getHistories: [],
                modifiedBy: "Tester", content: ""
            },
            questContentHtml: "", constants: {selectOptions: {slot: ["Light"]}}
        }],
        ["wiki", "wiki page", {
            wikiPage: {
                id: 7, title: "Test page", getHistories: [],
                modifiedBy: "Tester", content: ""
            },
            wikiContentHtml: ""
        }]
    ];

    for (const [directory, resourceName, vm] of fixtures) {
        const html = await ejs.renderFile(path.join(
            __dirname, `../src/views/${directory}/display.ejs`), {
            ...shared,
            locals: shared,
            vm
        });
        assert.match(html, new RegExp(
            `<button[^>]+data-target="#deleteModal"[^>]+aria-label="Delete ${resourceName}"[^>]*>` +
            `<i[^>]+aria-hidden="true"[^>]*><\\/i><\\/button>`));
    }
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
