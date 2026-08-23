"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "../..");
const themes = ["light", "dark", "solarized-dark", "high-contrast", "glass-blue", "glass-emerald", "glass-ruby", "glass-amethyst", "glass-amber"];

async function stacks(categories) {
    return (await import("../client/features/items/item-search-reducer.js")).categoryStacks(categories).map(stack => stack.map(category => category.name));
}

// Catches the React Columns dialog grouping categories in database order rather than the established picker order.
test("Columns picker preserves the approved category stacks", async function() {
    const names = ["Future Two", "Weapon", "Tank", "Basic", "Ranged", "Main", "Future One", "Melee", "Limits", "Mage", "Regen"];
    assert.deepEqual(await stacks(names.map(name => ({name, getItemStatInfo: []}))), [
        ["Basic"], ["Main", "Limits", "Ranged"], ["Regen", "Tank", "Melee"], ["Mage", "Weapon"], ["Future Two"], ["Future One"]
    ]);
});

// Catches removal of the responsive CSS hooks used by the controlled React Columns dialog.
test("compiled themes retain Columns picker responsive surfaces", function() {
    for (const theme of themes) {
        const css = fs.readFileSync(path.join(root, `css/dist/css/bootstrap-${theme}.css`), "utf8");
        assert.match(css, /\.modal\[aria-labelledby=columnsModalLabel\] \.columns-picker-grid\s*\{/);
        assert.match(css, /\.columns-picker-grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit, minmax\(12rem, 1fr\)\)/s);
    }
});
