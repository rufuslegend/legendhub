"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const themes = [
    "dark",
    "glass-amber",
    "glass-amethyst",
    "glass-blue",
    "glass-emerald",
    "glass-ruby",
    "high-contrast",
    "light",
    "solarized-dark"
];

function rulesForSelector(css, expectedSelector) {
    return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(function(match) {
        return {
            declarations: match[2],
            selectors: match[1].split(",").map(function(selector) {
                return selector.replace(/\s+/g, " ").trim();
            })
        };
    }).filter(function(rule) {
        return rule.selectors.includes(expectedSelector);
    });
}

test("item sort controls look like table headings in every theme", function() {
    const component = fs.readFileSync(path.join(
        root, "www/client/features/items/ItemSearch.jsx"), "utf8");

    assert.match(component,
        /<button type="button" className="item-sort-button" aria-label=\{`Sort by \$\{stat\.display\}`\}/,
        "item headings must use the scoped sort control");
    assert.doesNotMatch(component,
        /className="btn btn-link text-reset p-0" aria-label=\{`Sort by/,
        "item headings must not inherit generic Bootstrap button chrome");

    for (const theme of themes) {
        const css = fs.readFileSync(path.join(
            root, `css/dist/css/bootstrap-${theme}.css`), "utf8");
        const rule = rulesForSelector(css, ".item-sort-button").at(-1);

        assert.ok(rule, `${theme} must style item sort controls`);
        assert.match(rule.declarations, /padding:\s*0;/);
        assert.match(rule.declarations, /font:\s*inherit;/);
        assert.match(rule.declarations, /color:\s*inherit;/);
        assert.match(rule.declarations, /cursor:\s*pointer;/);
        assert.match(rule.declarations, /background:\s*transparent;/);
        assert.match(rule.declarations, /border:\s*0;/);
        assert.match(rule.declarations, /box-shadow:\s*none;/);
        assert.doesNotMatch(rule.declarations, /outline:\s*(?:0|none)/,
            `${theme} must retain keyboard focus visibility`);
    }
});
