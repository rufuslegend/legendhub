"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const cssRoot = path.resolve(__dirname, "../../css/dist/css");
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

function rules(css) {
    return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(function(match) {
        return {
            declarations: match[2],
            selectors: match[1].split(",").map(function(selector) {
                return selector.replace(/\s+/g, " ").trim();
            })
        };
    });
}

test("all themes let direct React mounts absorb unused viewport height", function() {
    for (const theme of themes) {
        const css = fs.readFileSync(path.join(cssRoot, `bootstrap-${theme}.css`), "utf8");
        const flexRule = rules(css).find(function(rule) {
            return rule.selectors.includes("body > [data-react-root]");
        });

        assert.ok(flexRule, `${theme} must grow direct React roots`);
        assert.match(flexRule.declarations, /flex:\s*1 0 auto;/,
            `${theme} React roots must absorb the space above the footer`);
    }
});
