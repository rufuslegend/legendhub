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
    assert.match(markup, /ng-show="glassThemeMenuOpen"/);
    assert.match(markup, /role="group"/);
    assert.match(markup, /aria-label="Glass themes"/);
    assert.match(markup, /ng-repeat="theme in glassThemes"/);
    assert.match(markup, /ng-repeat="theme in standardThemes"/);
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
