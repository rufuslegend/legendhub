"use strict";

const assert = require("node:assert/strict");
const ejs = require("ejs");
const path = require("node:path");
const test = require("node:test");

const headerPath = path.join(__dirname, "../src/views/shared/header.ejs");
const metaPath = path.join(__dirname, "../src/views/shared/meta.ejs");
const scriptsPath = path.join(__dirname, "../src/views/shared/scripts.ejs");

async function renderHeader() {
    return ejs.renderFile(headerPath, {user: null, url: {path: "/"}});
}

async function renderMeta({accountPreferenceContext, cookieTheme}) {
    const {normalizeTheme} = require("../src/view-helpers");
    return ejs.renderFile(metaPath, {
        accountPreferenceContext,
        cookies: cookieTheme ? {theme: cookieTheme} : {},
        normalizeTheme,
        title: "Theme test",
        version: "test"
    });
}

async function renderScripts(accountPreferenceContext) {
    const {serializeJsonForHtml} = require("../src/view-helpers");
    return ejs.renderFile(scriptsPath, {
        accountPreferenceContext,
        serializeJsonForHtml,
        version: "test"
    });
}

test("server-rendered header provides all native theme choices with a collapsed Glass group", async function() {
    const html = await renderHeader();

    assert.match(html, /id="glassThemeToggle"/);
    assert.match(html, /aria-expanded="false"/);
    assert.match(html, /aria-controls="glassThemeChoices"/);
    assert.match(html, /id="glassThemeChoices"[^>]*hidden/);
    assert.match(html, /fa-caret-right/);
    for (const [name, slug] of [
        ["Blue", "glass-blue"],
        ["Emerald", "glass-emerald"],
        ["Ruby", "glass-ruby"],
        ["Amethyst", "glass-amethyst"],
        ["Amber", "glass-amber"],
        ["Light", "light"],
        ["Dark", "dark"],
        ["Solarized Dark", "solarized-dark"],
        ["High Contrast", "high-contrast"]
    ]) {
        assert.match(html, new RegExp(`data-theme="${slug}"[^>]*>${name}<`));
    }
    assert.doesNotMatch(html, /\bng-(?:click|if|repeat|class|attr)-/);
});

// Catches a verified account rendering its stale device cookie theme before
// the synchronized account preference, while preserving anonymous behavior.
test("account theme wins during server render and anonymous theme still uses cookie", async function() {
    const account = await renderMeta({
        accountPreferenceContext: {
            enabled: true,
            payload: {
                version: 1,
                theme: "dark",
                itemsPerPage: 20,
                itemColumns: [],
                builderColumns: {},
                selectedProfileId: null,
                selectedVariant: null
            },
            revision: 4,
            storageGeneration: 2
        },
        cookieTheme: "light"
    });
    assert.match(account, /bootstrap-dark\.min\.css/);
    assert.doesNotMatch(account, /bootstrap-light\.min\.css/);

    const anonymous = await renderMeta({
        accountPreferenceContext: {enabled: false, payload: null, revision: 0, storageGeneration: 0},
        cookieTheme: "light"
    });
    assert.match(anonymous, /bootstrap-light\.min\.css/);
});

// Catches the shared bootstrap serializing auth identity, credentials, opaque
// namespaces, account profile payloads, or arbitrary future route locals.
test("account preference bootstrap whitelists only public preference state", async function() {
    const html = await renderScripts({
        enabled: true,
        payload: {
            version: 1,
            theme: "dark",
            itemsPerPage: 50,
            itemColumns: ["Name"],
            builderColumns: {},
            selectedProfileId: null,
            selectedVariant: null
        },
        revision: 7,
        storageGeneration: 3,
        email: "private@example.test",
        loginToken: "private-token",
        memberId: 91,
        storageNamespace: "private-namespace",
        profiles: [{payload: "private-payload"}]
    });
    const match = html.match(/data-account-preferences>([^<]+)<\/script>/);
    assert.ok(match);
    assert.deepEqual(JSON.parse(match[1]), {
        enabled: true,
        payload: {
            version: 1,
            theme: "dark",
            itemsPerPage: 50,
            itemColumns: ["Name"],
            builderColumns: {},
            selectedProfileId: null,
            selectedVariant: null
        },
        revision: 7,
        storageGeneration: 3
    });
    for (const privateValue of [
        "private@example.test", "private-token", "private-namespace", "private-payload"
    ])
        assert.equal(html.includes(privateValue), false);
});
