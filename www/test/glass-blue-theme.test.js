"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const sourceRoot = path.join(root, "css/scss");
const distRoot = path.join(root, "css/dist/css");
const publicRoot = path.join(root, "www/src/public/css");

function findCssBlock(css, header, startIndex, useLastMatch = false) {
    const headerIndex = useLastMatch
        ? css.lastIndexOf(header)
        : css.indexOf(header, startIndex);
    assert.ok(headerIndex >= 0, `missing CSS block ${header}`);

    const openBrace = css.indexOf("{", headerIndex + header.length);
    assert.ok(openBrace >= 0, `missing opening brace for ${header}`);

    let depth = 1;
    for (let index = openBrace + 1; index < css.length; index++) {
        if (css[index] === "{")
            depth++;
        else if (css[index] === "}")
            depth--;

        if (depth === 0) {
            return {
                body: css.slice(openBrace + 1, index),
                end: index + 1,
                start: headerIndex
            };
        }
    }

    assert.fail(`missing closing brace for ${header}`);
}

function cssRules(css) {
    return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(function(match) {
        return {
            declarations: match[2],
            selectors: match[1].split(",").map(function(selector) {
                return selector.replace(/\s+/g, " ").trim();
            })
        };
    });
}

function rulesForSelector(css, expectedSelector) {
    return cssRules(css).filter(function(rule) {
        return rule.selectors.includes(expectedSelector);
    });
}

function assertFocusWidth(css, selector) {
    const rules = rulesForSelector(css, selector);
    assert.ok(rules.length > 0, `missing focus rule ${selector}`);
    assert.match(rules.at(-1).declarations,
        /box-shadow:[^;]*0 0 0 3\.2px(?:\s|,)/,
        `${selector} must retain a 3.2px focus ring`);
}

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
        /\.navbar-toggler:focus\s*\{[\s\S]*border-color:\s*#58aaff;[\s\S]*outline:\s*0;/);
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

    const densityBlock = findCssBlock(
        expanded, "@media (min-width: 768px)", 0, true);
    const mobileBlock = findCssBlock(
        expanded, "@media (max-width: 767px)", densityBlock.end);
    const density = densityBlock.body;

    assert.match(density, /html\s*\{\s*font-size:\s*75%;/);
    for (const selector of ["html", "body"]) {
        const densityRules = rulesForSelector(density, selector);
        if (selector === "body") {
            assert.ok(densityRules.every(function(rule) {
                return !/font-size\s*:/.test(rule.declarations);
            }), "desktop density must not override body font-size");
        }

        const mobileRules = rulesForSelector(mobileBlock.body, selector);
        assert.ok(mobileRules.every(function(rule) {
            return !/font-size\s*:/.test(rule.declarations);
        }), `mobile ${selector} rules must retain the base font size`);
    }
    assert.match(density,
        /\.container,[\s\S]*\.container-fluid\s*\{[\s\S]*padding-right:\s*11\.25px;[\s\S]*padding-left:\s*11\.25px;/);
    assert.match(density,
        /\.row:not\(\.no-gutters\)\s*\{[\s\S]*margin-right:\s*-11\.25px;[\s\S]*margin-left:\s*-11\.25px;/);
    assert.match(density,
        /\.breadcrumbList\s*\{[\s\S]*padding:\s*3\.75px 11\.25px;/);
    assert.match(density,
        /\.categoryListContainer\s*\{[\s\S]*padding:\s*0 22\.5px 0 11\.25px;/);
    assert.match(density,
        /\.cookie-consent-banner\s*\{[\s\S]*padding:\s*7\.5px 0;/);
    const outsideDensity = expanded.slice(0, densityBlock.start)
        + expanded.slice(densityBlock.end);
    assert.doesNotMatch(outsideDensity, /html\s*\{\s*font-size:\s*75%;/,
        "desktop density must not leak into base or mobile styles");
    assert.ok(rulesForSelector(outsideDensity, "body").some(function(rule) {
        return /font-size:\s*1rem;/.test(rule.declarations);
    }), "base body font size must remain 1rem");
});

test("Glass Blue keeps its full focus vocabulary at 3.2px", function() {
    const expanded = fs.readFileSync(path.join(
        distRoot, "bootstrap-glass-blue.css"), "utf8");

    for (const selector of [
        ".was-validated .form-control:valid:focus",
        ".form-control.is-invalid:focus",
        ".custom-control-input:focus ~ .custom-control-label::before",
        ".btn-primary:not(:disabled):not(.disabled):active:focus",
        ".show > .btn-primary.dropdown-toggle:focus",
        "a.badge-primary:focus",
        ".navbar-dark .navbar-toggler:focus",
        ".form-control:focus",
        ".btn-primary:focus",
        ".page-link:focus"
    ])
        assertFocusWidth(expanded, selector);
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
