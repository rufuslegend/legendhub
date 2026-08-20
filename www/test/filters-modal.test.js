"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ejs = require("ejs");

const root = path.join(__dirname, "../..");
const templatePath = path.join(root, "www/src/views/shared/filtersModal.ejs");
const themes = [
    "light", "dark", "solarized-dark", "glass-blue", "glass-emerald",
    "glass-ruby", "glass-amethyst", "glass-amber"
];
const pickerSurfaces = {
    light: {modal: "#f8f9fa", category: "#fff"},
    dark: {modal: "#212529", category: "#343a40"},
    "solarized-dark": {modal: "#002b36", category: "#073642"},
    "glass-blue": {modal: "#060b12", category: "#0a1522"},
    "glass-emerald": {modal: "#06120b", category: "#0a2215"},
    "glass-ruby": {modal: "#12060a", category: "#220a13"},
    "glass-amethyst": {modal: "#0b0612", category: "#150a22"},
    "glass-amber": {modal: "#120e06", category: "#221a0a"}
};

function stat(display, variable, type = "int") {
    return {display, var: variable, type};
}

function category(name, stats = [stat(`${name} Stat`, name)]) {
    return {name, getItemStatInfo: stats};
}

function renderCategories(categories, selectedFilters = {}) {
    return ejs.render(
        fs.readFileSync(templatePath, "utf8"),
        {
            vm: {
                itemStatCategories: categories,
                selectedFilters,
                constants: {
                    selectShortOptions: {
                        slot: ["Head", "Body"]
                    }
                }
            }
        },
        {filename: templatePath}
    );
}

function renderedStackNames(html) {
    const starts = Array.from(html.matchAll(
        /<div class="filters-picker-stack">/g), match => match.index);

    return starts.map((start, index) => {
        const end = starts[index + 1] ?? html.length;
        return Array.from(
            html.slice(start, end).matchAll(
                /<h6 class="filters-picker-category-title">([^<]+)<\/h6>/g),
            match => match[1]
        );
    });
}

function getPickerRule(css, selector) {
    const modal = String.raw`\.modal\[aria-labelledby=(?:"filtersModalLabel"|filtersModalLabel)\]`;
    const match = css.match(new RegExp(`${modal} ${selector}\\s*\\{([^}]*)\\}`));
    assert.ok(match, `missing generated Filters rule for ${selector}`);
    return match[1];
}

function getRuleBodyStartingWith(css, selector) {
    const start = css.indexOf(selector);
    assert.notEqual(start, -1, `missing generated rule beginning ${selector}`);
    const openBrace = css.indexOf("{", start + selector.length);
    const closeBrace = css.indexOf("}", openBrace + 1);
    assert.notEqual(openBrace, -1, `missing opening brace after ${selector}`);
    assert.notEqual(closeBrace, -1, `missing closing brace after ${selector}`);
    return css.slice(openBrace + 1, closeBrace);
}

function getCssBlockBodies(css, header) {
    const bodies = [];
    let searchFrom = 0;

    while (true) {
        const headerIndex = css.indexOf(header, searchFrom);
        if (headerIndex === -1) {
            return bodies;
        }

        const openBrace = css.indexOf("{", headerIndex + header.length);
        assert.notEqual(openBrace, -1, `missing opening brace for ${header}`);

        let depth = 1;
        let index = openBrace + 1;
        while (index < css.length && depth > 0) {
            if (css[index] === "{") {
                depth++;
            } else if (css[index] === "}") {
                depth--;
            }
            index++;
        }

        assert.equal(depth, 0, `unterminated CSS block for ${header}`);
        bodies.push(css.slice(openBrace + 1, index - 1));
        searchFrom = index;
    }
}

function getDesktopDialogRule(css) {
    const modal = String.raw`\.modal\[aria-labelledby=(?:"filtersModalLabel"|filtersModalLabel)\]`;
    const desktopBlock = getCssBlockBodies(css, "@media (min-width: 768px)")
        .find(body => new RegExp(`${modal} \\.modal-dialog\\s*\\{`).test(body));
    assert.ok(desktopBlock,
        "missing desktop media block containing Filters picker dialog rule");
    const match = desktopBlock.match(new RegExp(
        `${modal} \\.modal-dialog\\s*\\{([^}]*)\\}`
    ));
    assert.ok(match, "missing desktop Filters picker dialog rule");
    return match[1];
}

const rendered = renderCategories([
    category("Basic", [stat("Strength", "strength")]),
    category("Weapon", [stat("Slot", "slot", "select")])
], {strength: []});

test("shared Filters modal uses the compact picker shell and toolbar", function() {
    assert.match(rendered, /class="modal-dialog modal-xl"/);
    assert.match(rendered, /class="filters-picker-grid"/);

    const toolbar = rendered.match(
        /<div class="filters-picker-toolbar">([\s\S]*?)<\/div>/);
    assert.ok(toolbar, "missing Filters picker toolbar");
    assert.match(toolbar[1],
        /<p class="filters-picker-toolbar-copy text-body">\s*Select filters to narrow item search results\. Search again to apply changes\.\s*<\/p>/);
    assert.doesNotMatch(toolbar[1], /\btext-info\b/);

    const reset = toolbar[1].match(/<button\b[^>]*>Reset to defaults<\/button>/);
    assert.ok(reset, "missing compact Filters reset button");
    assert.match(reset[0], /\btype="button"/);
    assert.match(reset[0], /\bclass="[^"]*\bfilters-picker-reset\b[^"]*\bbtn-sm\b[^"]*"/);
    assert.match(reset[0], /\bng-click="resetFilters\(\)"/);
    assert.doesNotMatch(reset[0], /\b(?:col-12|btn-block)\b/);
});

test("shared Filters modal renders the same approved category stacks", function() {
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

test("shared Filters modal keeps unknown categories in their source order", function() {
    const html = renderCategories([
        category("Future Two"),
        category("Weapon"),
        category("Basic"),
        category("Future One")
    ]);

    assert.deepEqual(renderedStackNames(html), [
        ["Basic"],
        ["Weapon"],
        ["Future Two"],
        ["Future One"]
    ]);
});

test("shared Filters modal preserves toggle and dropdown bindings", function() {
    assert.match(rendered,
        /class="filters-picker-option list-group-item list-group-item-action list-group-item-light"/);
    assert.match(rendered, /ng-click="toggleFilter\('strength'\)"/);
    assert.match(rendered, /isFilterEnabled\('strength', true\)/);
    assert.match(rendered,
        /ng-attr-aria-pressed="\{\{isFilterEnabled\('strength', true\)\}\}"/);
    assert.match(rendered, /'text-success fa-check'/);
    assert.match(rendered, /'text-danger fa-times'/);
    assert.match(rendered,
        /class="filters-picker-option list-group-item list-group-item-action list-group-item-light" ng-model="multiValueFilters\['slot'\]"/);
    assert.match(rendered, /ng-change="onFilterDropdownChange\('slot'\)"/);
    assert.match(rendered, /<option value="0">Head<\/option>/);
});

test("compiled themes expose responsive themed Filters picker surfaces", function() {
    for (const theme of themes) {
        const css = fs.readFileSync(path.join(
            root, `css/dist/css/bootstrap-${theme}.css`), "utf8");

        assert.match(getDesktopDialogRule(css), /width:\s*50%;/);
        assert.match(getDesktopDialogRule(css), /max-width:\s*none;/);
        assert.match(getPickerRule(css, String.raw`\.modal-body`), new RegExp(
            `background-color:\\s*${pickerSurfaces[theme].modal};`));
        assert.match(getPickerRule(css, String.raw`\.filters-picker-grid`),
            /grid-template-columns:\s*repeat\(auto-fit, minmax\(12rem, 1fr\)\);/);
        assert.match(getPickerRule(css, String.raw`\.filters-picker-stack`),
            /flex-direction:\s*column;/);
        assert.match(getPickerRule(css, String.raw`\.filters-picker-category`),
            new RegExp(`background-color:\\s*${pickerSurfaces[theme].category};`));
        assert.match(getPickerRule(css, String.raw`\.filters-picker-category-title`),
            /font-size:\s*1\.2rem;/);
        assert.match(getPickerRule(css, String.raw`\.filters-picker-option`),
            /font-size:\s*0\.875rem;/);
    }
});

test("Glass Blue gives Filters choices the same dark material as Columns", function() {
    const css = fs.readFileSync(path.join(
        root, "css/dist/css/bootstrap-glass-blue.css"), "utf8");
    const modal = String.raw`\.modal\[aria-labelledby=(?:"filtersModalLabel"|filtersModalLabel)\]`;
    const rule = css.match(new RegExp(
        `${modal} \\.list-group-item-light\\s*\\{([^}]*)\\}`));

    assert.ok(rule, "missing dark Filters choice rule");
    assert.match(rule[1], /color:\s*#d7e5f2;/);
    assert.match(rule[1], /background-color:\s*#02050a;/);
});

test("every Glass hue keeps Columns and Filters choices dark in every state", function() {
    const glassSurfaces = {
        "glass-blue": {normal: "#02050a", active: "#18314a"},
        "glass-emerald": {normal: "#020a05", active: "#184a31"},
        "glass-ruby": {normal: "#0a0205", active: "#4a1827"},
        "glass-amethyst": {normal: "#05020a", active: "#31184a"},
        "glass-amber": {normal: "#0a0602", active: "#4a3a18"}
    };

    for (const [theme, surfaces] of Object.entries(glassSurfaces)) {
        const css = fs.readFileSync(path.join(
            root, `css/dist/css/bootstrap-${theme}.css`), "utf8");

        for (const [modalLabel, pickerClass] of [
            ["columnsModalLabel", "columns-picker-option"],
            ["filtersModalLabel", "filters-picker-option"]
        ]) {
            const selector = `.modal[aria-labelledby=${modalLabel}] .${pickerClass}`;
            assert.match(getRuleBodyStartingWith(css, selector),
                new RegExp(`background-color:\\s*${surfaces.normal};`));
            for (const state of ["hover", "focus"]) {
                assert.match(getRuleBodyStartingWith(css,
                    `${selector}.list-group-item-action:${state}`),
                /background-color:\s*var\(--glass-wash\);/);
            }
            assert.match(getRuleBodyStartingWith(css,
                `${selector}.list-group-item-action:active`),
                new RegExp(`background-color:\\s*${surfaces.active};`));
        }
    }
});

test("Dark themes keep Columns and Filters choices dark in every state", function() {
    const darkSurfaces = {
        dark: {normal: "#212529", hover: "#495057", active: "#007bff"},
        "solarized-dark": {
            normal: "#05232b",
            hover: "#586e75",
            active: "#268bd2"
        }
    };

    for (const [theme, surfaces] of Object.entries(darkSurfaces)) {
        const css = fs.readFileSync(path.join(
            root, `css/dist/css/bootstrap-${theme}.css`), "utf8");

        for (const [modalLabel, pickerClass] of [
            ["columnsModalLabel", "columns-picker-option"],
            ["filtersModalLabel", "filters-picker-option"]
        ]) {
            const selector = `.modal[aria-labelledby=${modalLabel}] .${pickerClass}`;
            assert.match(getRuleBodyStartingWith(css, selector),
                new RegExp(`background-color:\\s*${surfaces.normal};`));
            assert.match(getRuleBodyStartingWith(css,
                `${selector}.list-group-item-action:hover`),
                new RegExp(`background-color:\\s*${surfaces.hover};`));
            assert.match(getRuleBodyStartingWith(css,
                `${selector}.list-group-item-action:focus`),
                new RegExp(`background-color:\\s*${surfaces.hover};`));
            assert.match(getRuleBodyStartingWith(css,
                `${selector}.list-group-item-action:active`),
                new RegExp(`background-color:\\s*${surfaces.active};`));
        }
    }
});
