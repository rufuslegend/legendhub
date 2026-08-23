"use strict";

const assert = require("node:assert/strict");
const ejs = require("ejs");
const path = require("node:path");
const test = require("node:test");

const headerPath = path.join(__dirname, "../src/views/shared/header.ejs");

async function renderHeader() {
    return ejs.renderFile(headerPath, {user: null, url: {path: "/"}});
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
