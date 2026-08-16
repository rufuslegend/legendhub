"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ejs = require("ejs");

const root = path.join(__dirname, "../..");
const templatePath = path.join(root, "www/src/views/shared/columnsModal.ejs");
const themes = ["light", "dark", "solarized-dark", "glass-blue"];
const pickerSurfaces = {
    light: {modal: "#f8f9fa", category: "#fff"},
    dark: {modal: "#212529", category: "#343a40"},
    "solarized-dark": {modal: "#002b36", category: "#073642"},
    "glass-blue": {modal: "#060b12", category: "#0a1522"}
};

function category(name, short = name, display = `${name} Stat`) {
    return {
        name,
        getItemStatInfo: [{display, short}]
    };
}

function renderCategories(categories, selectedColumns = []) {
    return ejs.render(
        fs.readFileSync(templatePath, "utf8"),
        {
            vm: {
                itemStatCategories: categories,
                selectedColumns
            }
        },
        {filename: templatePath}
    );
}

function renderedStackNames(html) {
    const starts = Array.from(html.matchAll(
        /<div class="columns-picker-stack">/g), match => match.index);

    return starts.map((start, index) => {
        const end = starts[index + 1] ?? html.length;
        return Array.from(
            html.slice(start, end).matchAll(
                /<h6 class="columns-picker-category-title">([^<]+)<\/h6>/g),
            match => match[1]
        );
    });
}

const rendered = renderCategories([
    category("Basic", "Str", "Strength"),
    category("Tank", "HP", "Hit Points")
], ["Str"]);

function getPickerRule(css, selector) {
    const modal = String.raw`\.modal\[aria-labelledby=(?:"columnsModalLabel"|columnsModalLabel)\]`;
    const match = css.match(new RegExp(`${modal} ${selector}\\s*\\{([^}]*)\\}`));
    assert.ok(match, `missing generated rule for ${selector}`);
    return match[1];
}

function getDesktopPickerDialogRules(css) {
    const modal = String.raw`\.modal\[aria-labelledby=(?:"columnsModalLabel"|columnsModalLabel)\]`;
    const match = css.match(new RegExp(
        String.raw`@media \(min-width: 768px\) \{\s*` +
        String.raw`\.modal-xl\s*\{([^}]*)\}\s*` +
        `${modal} \\.modal-dialog\\s*\\{([^}]*)\\}\\s*\\}`
    ));
    assert.ok(match, "missing desktop Columns picker dialog rule");
    return {general: match[1], picker: match[2]};
}

test("shared Columns modal renders in an extra-wide dialog", function() {
    assert.match(rendered, /class="modal-dialog modal-xl"/);
    assert.match(rendered, /class="columns-picker-grid"/);
});

test("shared Columns modal renders a compact right-aligned reset toolbar", function() {
    const toolbar = rendered.match(
        /<div class="columns-picker-toolbar">([\s\S]*?)<\/div>/);

    assert.ok(toolbar, "missing Columns picker toolbar");
    assert.match(toolbar[1],
        /<p class="columns-picker-toolbar-copy text-body">\s*Select columns to show and hide from the following:\s*<\/p>/);
    assert.doesNotMatch(toolbar[1], /\btext-info\b/);

    const reset = toolbar[1].match(/<button\b[^>]*>Reset to defaults<\/button>/);
    assert.ok(reset, "missing compact reset button");
    assert.match(reset[0], /\btype="button"/);
    assert.match(reset[0], /\bclass="[^"]*\bcolumns-picker-reset\b[^"]*\bbtn-sm\b[^"]*"/);
    assert.match(reset[0], /\bng-click="resetColumns\(\)"/);
    assert.doesNotMatch(reset[0], /\bcol-12\b/);
    assert.doesNotMatch(reset[0], /\bbtn-block\b/);
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

test("shared Columns modal renders the approved category stacks", function() {
    const html = renderCategories([
        "Basic", "Main", "Limits", "Regen", "Melee", "Mage", "Tank",
        "Ranged", "Weapon"
    ].map(name => category(name)));

    assert.deepEqual(renderedStackNames(html), [
        ["Basic"],
        ["Main", "Limits", "Ranged"],
        ["Regen", "Tank", "Melee"],
        ["Mage", "Weapon"]
    ]);
});

test("shared Columns modal omits missing known categories and empty stacks", function() {
    const html = renderCategories([
        category("Basic"),
        category("Limits"),
        category("Weapon")
    ]);

    assert.deepEqual(renderedStackNames(html), [
        ["Basic"],
        ["Limits"],
        ["Weapon"]
    ]);
});

test("shared Columns modal appends unknown categories after configured stacks", function() {
    const html = renderCategories([
        category("Future Two"),
        category("Weapon"),
        category("Tank"),
        category("Basic"),
        category("Ranged"),
        category("Main"),
        category("Future One"),
        category("Melee"),
        category("Limits"),
        category("Mage"),
        category("Regen")
    ]);

    assert.deepEqual(renderedStackNames(html), [
        ["Basic"],
        ["Main", "Limits", "Ranged"],
        ["Regen", "Tank", "Melee"],
        ["Mage", "Weapon"],
        ["Future Two"],
        ["Future One"]
    ]);
});

test("shared Columns modal exposes picker choices as native buttons", function() {
    const pickerOptions = rendered.match(
        /<[^>]*class="[^"]*\bcolumns-picker-option\b[^"]*"[^>]*>/g) || [];

    assert.equal(pickerOptions.length, 2);
    for (const pickerOption of pickerOptions) {
        assert.match(pickerOption, /^<button\b/);
        assert.match(pickerOption, /\btype="button"/);
    }
});

test("shared Columns modal preserves column selection bindings", function() {
    assert.match(rendered, /ng-click="toggleColumn\('Str'\)"/);
    assert.match(rendered, /showColumn\('Str', true\)/);
    assert.match(rendered, /ng-click="resetColumns\(\)"/);
});

test("shared Columns modal uses colored eye icons for column visibility", function() {
    const html = renderCategories([
        category("Basic", "Str", "Strength")
    ], ["Str"]);
    const option = html.match(
        /<button\b[^>]*\bcolumns-picker-option\b[^>]*>([\s\S]*?)<\/button>/);

    assert.ok(option, "missing rendered Columns picker option");
    assert.match(option[1],
        /<svg\b[^>]*ng-if="showColumn\('Str', true\)"[^>]*class="columns-picker-visibility-icon text-success ml-2"[^>]*aria-hidden="true"[^>]*focusable="false"[^>]*>/);
    assert.match(option[1],
        /<path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0-4 0"\s*\/>/);
    assert.match(option[1],
        /<path d="M21 12q-3\.6 6-9 6t-9-6q3\.6-6 9-6t9 6"\s*\/>/);
    assert.match(option[1],
        /<svg\b[^>]*ng-if="!showColumn\('Str', true\)"[^>]*class="columns-picker-visibility-icon text-danger ml-2"[^>]*aria-hidden="true"[^>]*focusable="false"[^>]*>/);
    assert.match(option[1],
        /<path[^>]*d="M21 9q-3\.6 4-9 4T3 9m0 6l2\.5-3\.8M21 14\.976L18\.508 11\.2M9 17l\.5-4m5\.5 4l-\.5-4"\s*\/>/);
    assert.equal((option[1].match(/viewBox="0 0 24 24"/g) || []).length, 2);
    assert.equal((option[1].match(/stroke="currentColor"/g) || []).length, 2);
    assert.doesNotMatch(option[1], /\b(?:fas|fa-check|fa-times)\b/);
});

test("compiled themes expose the responsive compact picker", function() {
    for (const theme of themes) {
        const css = fs.readFileSync(path.join(
            root, `css/dist/css/bootstrap-${theme}.css`), "utf8");
        const desktopDialog = getDesktopPickerDialogRules(css);
        assert.match(desktopDialog.general, /width:\s*90%;/);
        assert.match(desktopDialog.general, /max-width:\s*1800px;/);
        assert.match(desktopDialog.picker, /width:\s*50%;/);
        assert.match(desktopDialog.picker, /max-width:\s*none;/);
        const toolbar = getPickerRule(css,
            String.raw`\.columns-picker-toolbar`);
        const toolbarCopy = getPickerRule(css,
            String.raw`\.columns-picker-toolbar-copy`);
        const reset = getPickerRule(css,
            String.raw`\.columns-picker-reset`);
        const modalBody = getPickerRule(css, String.raw`\.modal-body`);
        const grid = getPickerRule(css, String.raw`\.columns-picker-grid`);
        const stack = getPickerRule(css, String.raw`\.columns-picker-stack`);
        const category = getPickerRule(css,
            String.raw`\.columns-picker-category`);
        const title = getPickerRule(css,
            String.raw`\.columns-picker-category-title`);
        const option = getPickerRule(css, String.raw`\.columns-picker-option`);
        const visibilityIcon = getPickerRule(css,
            String.raw`\.columns-picker-visibility-icon`);

        assert.match(toolbar, /display:\s*flex;/);
        assert.match(toolbar, /align-items:\s*center;/);
        assert.match(toolbar, /gap:\s*1rem;/);
        assert.match(toolbar, /margin-bottom:\s*1rem;/);
        assert.match(toolbarCopy, /flex:\s*1 1 auto;/);
        assert.match(toolbarCopy, /min-width:\s*0;/);
        assert.match(toolbarCopy, /margin-bottom:\s*0;/);
        assert.match(reset, /flex:\s*0 0 auto;/);
        assert.match(modalBody, new RegExp(
            `background-color:\\s*${pickerSurfaces[theme].modal};`));
        assert.match(grid, /display:\s*grid;/);
        assert.match(grid, /align-items:\s*start;/);
        assert.match(grid,
            /grid-template-columns:\s*repeat\(auto-fit, minmax\(12rem, 1fr\)\);/);
        assert.match(stack, /display:\s*flex;/);
        assert.match(stack, /flex-direction:\s*column;/);
        assert.match(stack, /gap:\s*1rem;/);
        assert.match(category, new RegExp(
            `background-color:\\s*${pickerSurfaces[theme].category};`));
        assert.match(title, /font-size:\s*1\.2rem;/);
        assert.match(option, /padding:\s*0\.5rem 0\.75rem;/);
        assert.match(option, /font-size:\s*0\.875rem;/);
        assert.match(visibilityIcon, /flex:\s*0 0 auto;/);
        assert.match(visibilityIcon, /width:\s*1em;/);
        assert.match(visibilityIcon, /height:\s*1em;/);
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
