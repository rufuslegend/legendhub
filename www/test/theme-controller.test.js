"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadHeaderController(jquery) {
    let headerController;
    const app = {};

    for (const method of [
        "config", "constant", "controller", "directive", "factory", "run"
    ]) {
        app[method] = function(name, implementation) {
            if (method === "controller" && name === "header")
                headerController = implementation;
            return app;
        };
    }

    const source = fs.readFileSync(path.join(
        __dirname, "../src/public/js/apps/legendwiki-app.js"), "utf8");
    const context = vm.createContext({
        $: jquery,
        angular: {module: function() { return app; }},
        console,
        Date,
        location: {search: ""},
        window: {location: {pathname: "/", search: ""}}
    });

    vm.runInContext(source, context);
    assert.equal(typeof headerController, "function");
    return headerController;
}

function createHeaderScope(hasConsent) {
    let stylesheetHref;
    const cookieWrites = [];
    const jquery = function(selector) {
        return {
            attr: function(name, value) {
                if (selector === 'link[id="theme"]' && name === "href")
                    stylesheetHref = value;
                return this;
            },
            contents: function() { return []; },
            html: function() { return ""; },
            on: function() { return this; },
            popover: function() { return this; }
        };
    };
    const cookies = {
        get: function(name) {
            return name === "cookie-consent" && hasConsent ? "true" : undefined;
        },
        put: function(...args) { cookieWrites.push(args); }
    };
    const scope = {};
    const HeaderController = loadHeaderController(jquery);

    HeaderController(scope, function() {}, cookies, function() {}, {links: []});
    scope.initialize();
    cookieWrites.length = 0;

    return {
        cookieWrites,
        getStylesheetHref: function() { return stylesheetHref; },
        scope
    };
}

function chooseTheme(hasConsent, theme) {
    const header = createHeaderScope(hasConsent);
    header.scope.setTheme(theme);

    return {
        cookieWrites: header.cookieWrites,
        stylesheetHref: header.getStylesheetHref()
    };
}

test("theme choices separate the Glass family from standard themes", function() {
    const {scope} = createHeaderScope(false);

    assert.deepEqual(Array.from(scope.glassThemes), [
        "Glass Blue",
        "Glass Emerald",
        "Glass Ruby",
        "Glass Amethyst",
        "Glass Amber"
    ]);
    assert.deepEqual(Array.from(scope.standardThemes), [
        "Light", "Dark", "Solarized Dark"
    ]);
    assert.equal(scope.glassThemeMenuOpen, false);
});

test("Glass submenu toggles without closing its parent dropdown", function() {
    const {scope} = createHeaderScope(false);
    let prevented = 0;
    let stopped = 0;
    const event = {
        preventDefault: function() { prevented++; },
        stopPropagation: function() { stopped++; }
    };

    scope.toggleGlassThemeMenu(event);
    assert.equal(scope.glassThemeMenuOpen, true);
    assert.equal(prevented, 1);
    assert.equal(stopped, 1);

    scope.toggleGlassThemeMenu();
    assert.equal(scope.glassThemeMenuOpen, false);
});

test("theme choices apply immediately while persistence remains consent-gated", function() {
    const temporary = chooseTheme(false, "Solarized Dark");
    assert.equal(temporary.stylesheetHref,
        "/css/bootstrap-solarized-dark.min.css");
    assert.equal(temporary.cookieWrites.length, 0);

    const persistent = chooseTheme(true, "Glass Blue");
    assert.equal(persistent.stylesheetHref,
        "/css/bootstrap-glass-blue.min.css");
    assert.equal(persistent.cookieWrites.length, 1);
    assert.equal(persistent.cookieWrites[0][0], "theme");
    assert.equal(persistent.cookieWrites[0][1], "glass-blue");

    const emerald = chooseTheme(true, "Glass Emerald");
    assert.equal(emerald.stylesheetHref,
        "/css/bootstrap-glass-emerald.min.css");
    assert.equal(emerald.cookieWrites[0][1], "glass-emerald");
});
