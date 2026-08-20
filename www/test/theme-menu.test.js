"use strict";

const assert = require("node:assert/strict");
const ejs = require("ejs");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const headerPath = path.join(__dirname, "../src/views/shared/header.ejs");
const appPath = path.join(
    __dirname, "../src/public/js/apps/legendwiki-app.js");

function renderClientHeader() {
    let registerTemplates;
    const app = {};
    for (const method of [
        "config", "constant", "controller", "directive", "factory", "run"
    ]) {
        app[method] = function(implementation) {
            if (method === "run") registerTemplates = implementation;
            return app;
        };
    }

    vm.runInNewContext(fs.readFileSync(appPath, "utf8"), {
        angular: {module: function() { return app; }},
        console,
        location: {search: ""}
    });

    let header;
    registerTemplates({
        put: function(name, markup) {
            if (name === "header.html") header = markup;
        }
    });
    return header;
}

function assertGlassSubmenu(markup) {
    assert.match(markup,
        /<button[^>]*id="themeDropdown"[^>]*aria-label="Choose theme"[^>]*>/);
    assert.match(markup, /<button[^>]*class="[^"]*dropdown-item[^"]*"[^>]*>/);
    assert.match(markup, /ng-click="toggleGlassThemeMenu\(\$event\)"/);
    assert.match(markup,
        /ng-attr-aria-expanded="\{\{glassThemeMenuOpen\}\}"/);
    assert.match(markup, /aria-controls="glassThemeChoices"/);
    assert.match(markup,
        /ng-class="glassThemeMenuOpen \? 'fa-caret-down' : 'fa-caret-right'"/);
    assert.match(markup, /id="glassThemeChoices"/);
    assert.match(markup, /ng-if="glassThemeMenuOpen"/);
    assert.doesNotMatch(markup, /ng-show="glassThemeMenuOpen"/);
    assert.match(markup, /role="group"/);
    assert.match(markup, /aria-label="Glass themes"/);
    assert.match(markup, /ng-repeat="theme in glassThemes"/);
    assert.match(markup, /ng-repeat="theme in standardThemes"/);
}

function bootstrapKeyboardItems(markup, glassMenuOpen) {
    const menu = markup.match(
        /<div class="dropdown-menu dropdown-menu-right"[^>]*>([\s\S]*?)<\/div>\s*<\/li>/);
    assert.ok(menu, "missing theme dropdown menu");

    const visibleMarkup = glassMenuOpen
        ? menu[1]
        : menu[1].replace(
            /<div[^>]*ng-if="glassThemeMenuOpen"[^>]*>[\s\S]*?<\/div>/,
            "");

    return Array.from(visibleMarkup.matchAll(
        /<(?:a|button)[^>]*class="[^"]*dropdown-item[^"]*"[^>]*>/g),
    match => match[0]);
}

test("server-rendered header exposes an accessible inline Glass submenu", async function() {
    const html = await ejs.renderFile(headerPath, {
        user: null,
        url: {path: "/"}
    });

    assertGlassSubmenu(html);
});

test("client-generated header exposes the same Glass submenu", function() {
    assertGlassSubmenu(renderClientHeader());
});

test("collapsed Glass hues are absent from Bootstrap keyboard navigation", async function() {
    const serverHeader = await ejs.renderFile(headerPath, {
        user: null,
        url: {path: "/"}
    });

    for (const markup of [serverHeader, renderClientHeader()]) {
        const collapsed = bootstrapKeyboardItems(markup, false);
        assert.equal(collapsed.length, 2);
        assert.match(collapsed[0], /toggleGlassThemeMenu/);
        assert.match(collapsed[1], /standardThemes/);
        assert.doesNotMatch(collapsed.join("\n"), /glassThemes/);

        const expanded = bootstrapKeyboardItems(markup, true);
        assert.equal(expanded.length, 3);
        assert.match(expanded[1], /glassThemes/);
    }
});
