"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const sourceRoot = path.join(root, "css/scss");
const distRoot = path.join(root, "css/dist/css");
const publicRoot = path.join(root, "www/src/public/css");

test("Glass Blue has a standalone source and minification pipeline", function() {
    const entry = fs.readFileSync(path.join(
        sourceRoot, "bootstrap-glass-blue.scss"), "utf8");
    const packageJson = JSON.parse(fs.readFileSync(path.join(
        root, "css/package.json"), "utf8"));

    assert.match(entry, /custom\/themes\/glass-blue-theme/);
    assert.match(entry, /custom\/themes\/glass-blue-chrome/);
    assert.match(packageJson.scripts["build:minify"],
        /bootstrap-glass-blue\.min\.css/);

    const variablesIndex = entry.indexOf(
        '@import "custom/themes/glass-blue-theme";');
    const bootstrapIndex = entry.indexOf('@import "bootstrap/functions";');
    const sharedIndex = entry.indexOf('@import "custom/custom";');
    const chromeIndex = entry.indexOf(
        '@import "custom/themes/glass-blue-chrome";');

    assert.ok(variablesIndex < bootstrapIndex,
        "Glass variables must load before Bootstrap");
    assert.ok(bootstrapIndex < sharedIndex,
        "shared LegendHUB styles must load after Bootstrap");
    assert.ok(sharedIndex < chromeIndex,
        "Glass chrome must load after shared LegendHUB styles");
});

test("Glass Blue source defines its material contract and component coverage", function() {
    const variables = fs.readFileSync(path.join(
        sourceRoot, "custom/themes/_glass-blue-theme.scss"), "utf8");
    const chrome = fs.readFileSync(path.join(
        sourceRoot, "custom/themes/_glass-blue-chrome.scss"), "utf8");

    assert.match(variables, /\$glass-line: #3a6a99/);
    assert.match(variables, /\$body-bg: #05070b/);
    assert.match(variables, /Palatino/);
    assert.match(chrome, /--glass-header-gradient:/);
    assert.match(chrome, /\.breadcrumbNav\.bg-dark/);

    for (const selector of [
        ".navbar", ".breadcrumbNav", ".card", ".btn", ".form-control",
        ".table", ".dropdown-menu", ".pagination", ".alert",
        ".modal-content", ".popover", ".tooltip-inner",
        ".categoryListContainer"
    ])
        assert.ok(chrome.includes(selector), `missing Glass selector ${selector}`);
});

test("Glass Blue preserves contextual and active menu states", function() {
    const chrome = fs.readFileSync(path.join(
        sourceRoot, "custom/themes/_glass-blue-chrome.scss"), "utf8");

    assert.doesNotMatch(chrome,
        /\.list-group-item\s*\{\s*background-color:\s*\$glass-surface;/,
        "generic Glass wells must not replace contextual list-group backgrounds");

    const interactionIndex = chrome.indexOf(".table-hover tbody tr:hover");
    const activeIndex = chrome.indexOf(".dropdown-item.active");
    assert.ok(interactionIndex >= 0, "missing Glass interaction rules");
    assert.ok(activeIndex > interactionIndex,
        "active menu states must be reasserted after generic interactions");
    assert.match(chrome,
        /\.dropdown-item\.active,[\s\S]*\.list-group-item\.active\s*\{[\s\S]*background-color:\s*\$component-active-bg;/);
});

test("Glass Blue keeps pressed list actions readable", function() {
    const expanded = fs.readFileSync(path.join(
        distRoot, "bootstrap-glass-blue.css"), "utf8");
    const pressedRule = expanded.match(
        /\.list-group-item-action:active\s*\{([^}]*)\}/);

    assert.ok(pressedRule, "missing pressed list action rule");
    assert.match(pressedRule[1], /color:\s*#eaf4ff;/);
    assert.match(pressedRule[1], /background-color:\s*#18314a;/);
});

test("Glass Blue draws explicit steel-blue navigation and panel rims", function() {
    const chrome = fs.readFileSync(path.join(
        sourceRoot, "custom/themes/_glass-blue-chrome.scss"), "utf8");

    assert.match(chrome,
        /\.navbar,\s*\.jumbotron\s*\{\s*border:\s*1px solid \$glass-line;/);
    assert.match(chrome,
        /\.breadcrumbNav\s*\{[\s\S]*border-top:\s*1px solid \$glass-line;[\s\S]*border-bottom:\s*1px solid \$glass-line;/);
});

test("Glass Blue uses the dark tooltip material for body and arrows", function() {
    const variables = fs.readFileSync(path.join(
        sourceRoot, "custom/themes/_glass-blue-theme.scss"), "utf8");
    const expanded = fs.readFileSync(path.join(
        distRoot, "bootstrap-glass-blue.css"), "utf8");
    const tooltipStart = expanded.indexOf(".tooltip {");
    const popoverStart = expanded.indexOf(".popover {", tooltipStart);
    const tooltipCss = expanded.slice(tooltipStart, popoverStart);

    assert.match(variables, /\$tooltip-bg:\s*\$glass-well;/);
    assert.match(variables, /\$tooltip-color:\s*\$glass-ink;/);
    for (const side of ["top", "right", "bottom", "left"])
        assert.match(tooltipCss,
            new RegExp(`border-${side}-color: #02050a;`),
            `Glass tooltip ${side} arrow must match its dark well`);
});

test("Glass Blue finishes and focuses the navbar toggler", function() {
    const chrome = fs.readFileSync(path.join(
        sourceRoot, "custom/themes/_glass-blue-chrome.scss"), "utf8");

    assert.match(chrome,
        /\.navbar-toggler\s*\{[\s\S]*background-image:\s*var\(--glass-button-gradient\);[\s\S]*border:\s*1px solid \$glass-line;/);
    assert.match(chrome,
        /\.navbar-toggler:focus\s*\{[\s\S]*border-color:\s*#58aaff;[\s\S]*box-shadow:\s*0 0 0 \.2rem rgba\(88, 170, 255, \.35\);/);
});

test("Glass Blue reserves hover glow for enabled buttons", function() {
    const chrome = fs.readFileSync(path.join(
        sourceRoot, "custom/themes/_glass-blue-chrome.scss"), "utf8");

    assert.doesNotMatch(chrome, /\.btn:hover\s*\{/);
    assert.match(chrome,
        /\.btn:not\(:disabled\):not\(\.disabled\):hover\s*\{/);
    assert.match(chrome,
        /\.btn:disabled,\s*\.btn\.disabled\s*\{[\s\S]*box-shadow:\s*none;/);
});

test("Glass Blue keeps outline-secondary controls readable", function() {
    const expanded = fs.readFileSync(path.join(
        distRoot, "bootstrap-glass-blue.css"), "utf8");
    const outlineRules = [...expanded.matchAll(
        /\.btn-outline-secondary\s*\{([^}]*)\}/g)];

    assert.ok(outlineRules.length > 0, "missing outline-secondary rule");
    const finalRule = outlineRules.at(-1)[1];
    assert.match(finalRule, /color:\s*#adc3d8;/);
    assert.match(finalRule, /border-color:\s*#829db7;/);
});

test("Glass Blue applies balanced density only above mobile", function() {
    const expanded = fs.readFileSync(path.join(
        distRoot, "bootstrap-glass-blue.css"), "utf8");

    assert.doesNotMatch(expanded, /(^|[;{]\s*)zoom\s*:/m);
    assert.doesNotMatch(expanded,
        /(?:^|})\s*(?:html|body)(?:\s*,\s*(?:html|body))*\s*\{[^}]*transform:\s*scale\(/m);

    const densityStart = expanded.lastIndexOf("@media (min-width: 768px)");
    const mobileStart = expanded.indexOf("@media (max-width: 767px)", densityStart);
    assert.ok(densityStart >= 0, "missing desktop Glass density breakpoint");
    assert.ok(mobileStart > densityStart,
        "desktop density must precede and remain separate from mobile rules");
    const density = expanded.slice(densityStart, mobileStart);

    assert.match(density, /html\s*\{\s*font-size:\s*80%;/);
    assert.match(density,
        /body,[\s\S]*\.input-group-text\s*\{\s*font-size:\s*1\.09375rem;/);
    assert.match(density,
        /\.container,[\s\S]*\.container-fluid\s*\{[\s\S]*padding-right:\s*12px;[\s\S]*padding-left:\s*12px;/);
    assert.match(density,
        /\.row:not\(\.no-gutters\)\s*\{[\s\S]*margin-right:\s*-12px;[\s\S]*margin-left:\s*-12px;/);
    assert.match(density,
        /\.breadcrumbList\s*\{[\s\S]*padding:\s*4px 12px;/);
    assert.match(density,
        /\.categoryListContainer\s*\{[\s\S]*padding:\s*0 24px 0 12px;/);
    assert.match(density,
        /\.cookie-consent-banner\s*\{[\s\S]*padding:\s*8px 0;/);
    assert.match(density,
        /\.page-link:focus\s*\{[\s\S]*box-shadow:\s*0 0 0 0?\.25rem rgba\(88, 170, 255, 0?\.35\);/);

    const rootSizeRules = [...expanded.matchAll(
        /html\s*\{\s*font-size:\s*80%;/g)];
    assert.equal(rootSizeRules.length, 1,
        "desktop density must not leak into the mobile base style");
});

test("Glass Blue compacts builder panels and preserves Columns label contrast", function() {
    const expanded = fs.readFileSync(path.join(
        distRoot, "bootstrap-glass-blue.css"), "utf8");

    assert.match(expanded,
        /\.card-header h4,\s*\.card-header \.h4\s*\{\s*font-size:\s*1\.25rem;/);

    const builderPanelRule = expanded.match(
        /body\[ng-controller=(?:"builder"|builder)\] > \.container-fluid > \.row:first-child > \.col-lg-6\s*\{([^}]*)\}/);
    assert.ok(builderPanelRule, "missing compact Glass builder panel rule");
    assert.match(builderPanelRule[1], /padding-right:\s*0\.5rem;/);
    assert.match(builderPanelRule[1], /padding-left:\s*0\.5rem;/);
    assert.match(builderPanelRule[1], /margin-bottom:\s*0\.75rem !important;/);

    assert.match(expanded,
        /\.list-group-item-action h5\s*\{\s*color:\s*inherit;/);
});

test("Glass Blue uses dark material for Columns modal choices", function() {
    const expanded = fs.readFileSync(path.join(
        distRoot, "bootstrap-glass-blue.css"), "utf8");
    const modalSelector = String.raw`\.modal\[aria-labelledby=(?:"columnsModalLabel"|columnsModalLabel)\]`;
    const normalRule = expanded.match(new RegExp(
        `${modalSelector} \\.list-group-item-light\\s*\\{([^}]*)\\}`));
    const hoverRule = expanded.match(new RegExp(
        `${modalSelector} \\.list-group-item-light\\.list-group-item-action:hover,\\s*${modalSelector} \\.list-group-item-light\\.list-group-item-action:focus\\s*\\{([^}]*)\\}`));
    const activeRule = expanded.match(new RegExp(
        `${modalSelector} \\.list-group-item-light\\.list-group-item-action:active,\\s*${modalSelector} \\.list-group-item-light\\.list-group-item-action\\.active\\s*\\{([^}]*)\\}`));

    assert.ok(normalRule, "missing dark Columns modal choice rule");
    assert.match(normalRule[1], /color:\s*#d7e5f2;/);
    assert.match(normalRule[1], /background-color:\s*#02050a;/);
    assert.ok(hoverRule, "missing Columns modal hover/focus rule");
    assert.match(hoverRule[1], /color:\s*#fff;/);
    assert.match(hoverRule[1], /background-color:\s*var\(--glass-wash\);/);
    assert.ok(activeRule, "missing Columns modal active rule");
    assert.match(activeRule[1], /color:\s*#eaf4ff;/);
    assert.match(activeRule[1], /background-color:\s*#18314a;/);
});

test("Glass Blue build artifacts are complete and copied to the web app", function() {
    const artifacts = [
        path.join(distRoot, "bootstrap-glass-blue.css"),
        path.join(distRoot, "bootstrap-glass-blue.css.map"),
        path.join(distRoot, "bootstrap-glass-blue.min.css"),
        path.join(distRoot, "bootstrap-glass-blue.min.css.map"),
        path.join(publicRoot, "bootstrap-glass-blue.min.css"),
        path.join(publicRoot, "bootstrap-glass-blue.min.css.map")
    ];

    for (const artifact of artifacts) {
        assert.ok(fs.statSync(artifact).size > 0,
            `missing or empty artifact ${path.relative(root, artifact)}`);
    }

    assert.equal(
        fs.readFileSync(path.join(distRoot, "bootstrap-glass-blue.min.css"), "utf8"),
        fs.readFileSync(path.join(publicRoot, "bootstrap-glass-blue.min.css"), "utf8")
    );
    assert.equal(
        fs.readFileSync(path.join(distRoot, "bootstrap-glass-blue.min.css.map"), "utf8"),
        fs.readFileSync(path.join(publicRoot, "bootstrap-glass-blue.min.css.map"), "utf8")
    );

    const publicCssPath = path.join(publicRoot, "bootstrap-glass-blue.min.css");
    const publicMapPath = path.join(
        publicRoot, "bootstrap-glass-blue.min.css.map");
    const publicCss = fs.readFileSync(publicCssPath, "utf8");
    const sourceMapReference = publicCss.match(
        /sourceMappingURL=([^\s*]+)\s*\*\//);

    assert.ok(sourceMapReference, "Glass minified CSS must reference its map");
    assert.equal(sourceMapReference[1], "bootstrap-glass-blue.min.css.map");
    assert.equal(path.resolve(path.dirname(publicCssPath), sourceMapReference[1]),
        publicMapPath);
    assert.doesNotThrow(function() {
        JSON.parse(fs.readFileSync(publicMapPath, "utf8"));
    });
});
