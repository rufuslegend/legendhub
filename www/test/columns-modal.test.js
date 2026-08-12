"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ejs = require("ejs");

const root = path.join(__dirname, "../..");
const templatePath = path.join(root, "www/src/views/shared/columnsModal.ejs");
const themes = ["light", "dark", "solarized-dark", "glass-blue"];
const rendered = ejs.render(
    fs.readFileSync(templatePath, "utf8"),
    {
        vm: {
            itemStatCategories: [
                {
                    name: "Basic",
                    getItemStatInfo: [{display: "Strength", short: "Str"}]
                },
                {
                    name: "Tank",
                    getItemStatInfo: [{display: "Hit Points", short: "HP"}]
                }
            ],
            selectedColumns: ["Str"]
        }
    },
    {filename: templatePath}
);

function getPickerRule(css, selector) {
    const modal = String.raw`\.modal\[aria-labelledby=(?:"columnsModalLabel"|columnsModalLabel)\]`;
    const match = css.match(new RegExp(`${modal} ${selector}\\s*\\{([^}]*)\\}`));
    assert.ok(match, `missing generated rule for ${selector}`);
    return match[1];
}

test("shared Columns modal renders in an extra-wide dialog", function() {
    assert.match(rendered, /class="modal-dialog modal-xl"/);
    assert.match(rendered, /class="columns-picker-grid"/);
});

test("shared Columns modal renders ordered compact category cards", function() {
    assert.equal((rendered.match(
        /class="columns-picker-category list-group-item"/g) || []).length, 2);
    assert.ok(rendered.indexOf("Basic") < rendered.indexOf("Tank"));
    assert.match(rendered, /<h6 class="columns-picker-category-title">Basic<\/h6>/);
    assert.match(rendered,
        /class="columns-picker-option list-group-item list-group-item-action list-group-item-light"/);
    assert.match(rendered, />Strength<\/span>/);
    assert.match(rendered, />Hit Points<\/span>/);
});

test("shared Columns modal preserves column selection bindings", function() {
    assert.match(rendered, /ng-click="toggleColumn\('Str'\)"/);
    assert.match(rendered, /showColumn\('Str', true\)/);
    assert.match(rendered, /ng-click="resetColumns\(\)"/);
});

test("compiled themes expose the responsive compact picker", function() {
    for (const theme of themes) {
        const css = fs.readFileSync(path.join(
            root, `css/dist/css/bootstrap-${theme}.css`), "utf8");
        const grid = getPickerRule(css, String.raw`\.columns-picker-grid`);
        const title = getPickerRule(css,
            String.raw`\.columns-picker-category-title`);
        const option = getPickerRule(css, String.raw`\.columns-picker-option`);

        assert.match(grid, /display:\s*grid;/);
        assert.match(grid, /align-items:\s*start;/);
        assert.match(grid,
            /grid-template-columns:\s*repeat\(auto-fit, minmax\(12rem, 1fr\)\);/);
        assert.match(title, /font-size:\s*1rem;/);
        assert.match(option, /padding:\s*0\.5rem 0\.75rem;/);
        assert.match(option, /font-size:\s*0\.875rem;/);
    }
});

test("every minified theme is copied into the web app", function() {
    for (const theme of themes) {
        assert.equal(
            fs.readFileSync(path.join(
                root, `css/dist/css/bootstrap-${theme}.min.css`), "utf8"),
            fs.readFileSync(path.join(
                root, `www/src/public/css/bootstrap-${theme}.min.css`), "utf8")
        );
    }
});
