"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "../..");
const themes = ["light", "dark", "solarized-dark", "high-contrast", "glass-blue", "glass-emerald", "glass-ruby", "glass-amethyst", "glass-amber"];

// Catches a Filters grouping change that separates related categories or loses unknown categories.
test("Filters picker shares the approved category stacks", async function() {
    const {categoryStacks} = await import("../client/features/items/item-search-reducer.js");
    const categories = ["Future", "Weapon", "Basic", "Main", "Limits", "Ranged"].map(name => ({name, getItemStatInfo: []}));
    assert.deepEqual(categoryStacks(categories).map(stack => stack.map(category => category.name)), [
        ["Basic"], ["Main", "Limits", "Ranged"], ["Weapon"], ["Future"]
    ]);
});

// Catches removal of the themed Filter picker surfaces used by the controlled React dialog.
test("compiled themes retain Filters picker responsive surfaces", function() {
    for (const theme of themes) {
        const css = fs.readFileSync(path.join(root, `css/dist/css/bootstrap-${theme}.css`), "utf8");
        assert.match(css, /\.modal\[aria-labelledby=filtersModalLabel\] \.filters-picker-grid\s*\{/);
        assert.match(css, /\.filters-picker-grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit, minmax\(12rem, 1fr\)\)/s);
    }
});
