"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const expandedPath = path.join(
    root, "css/dist/css/bootstrap-high-contrast.css");
const minifiedPath = path.join(
    root, "css/dist/css/bootstrap-high-contrast.min.css");
const minifiedMapPath = `${minifiedPath}.map`;
const publicPath = path.join(
    root, "www/src/public/css/bootstrap-high-contrast.min.css");
const publicMapPath = `${publicPath}.map`;

function luminance(hex) {
    const value = hex.replace("#", "");
    const full = value.length === 3
        ? value.split("").map(function(character) {
            return character + character;
        }).join("")
        : value;
    const channels = [0, 2, 4].map(function(index) {
        const channel = Number.parseInt(full.slice(index, index + 2), 16) / 255;
        return channel <= .04045
            ? channel / 12.92
            : ((channel + .055) / 1.055) ** 2.4;
    });

    return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
}

function contrast(first, second) {
    const values = [luminance(first), luminance(second)].sort(function(a, b) {
        return b - a;
    });
    return (values[0] + .05) / (values[1] + .05);
}

function customProperty(css, name) {
    const match = css.match(new RegExp(`${name}:\\s*(#[0-9a-f]{3,6})`));
    assert.ok(match, `${name} must be emitted as a hex color`);
    return match[1];
}

function lastRuleContaining(css, selector) {
    const selectorIndex = css.lastIndexOf(selector);
    assert.ok(selectorIndex >= 0, `missing compiled selector ${selector}`);
    const openingBrace = css.indexOf("{", selectorIndex);
    const closingBrace = css.indexOf("}", openingBrace);
    assert.ok(openingBrace >= 0 && closingBrace > openingBrace,
        `missing rule body for ${selector}`);
    return css.slice(openingBrace + 1, closingBrace);
}

test("High Contrast build ships complete browser assets", function() {
    for (const artifact of [
        expandedPath,
        `${expandedPath}.map`,
        minifiedPath,
        minifiedMapPath,
        publicPath,
        publicMapPath
    ]) {
        assert.ok(fs.existsSync(artifact),
            `missing ${path.relative(root, artifact)}`);
        assert.ok(fs.statSync(artifact).size > 0,
            `empty ${path.relative(root, artifact)}`);
    }

    const expanded = fs.readFileSync(expandedPath, "utf8");
    const minified = fs.readFileSync(minifiedPath, "utf8");
    const expandedMap = JSON.parse(fs.readFileSync(
        `${expandedPath}.map`, "utf8"));
    const minifiedMap = JSON.parse(fs.readFileSync(
        minifiedMapPath, "utf8"));

    assert.equal(minified,
        fs.readFileSync(publicPath, "utf8"));
    assert.equal(fs.readFileSync(minifiedMapPath, "utf8"),
        fs.readFileSync(publicMapPath, "utf8"));
    assert.match(minified,
        /sourceMappingURL=bootstrap-high-contrast\.min\.css\.map/);
    assert.ok(expandedMap.sources.some(function(source) {
        return source.endsWith("_high-contrast-theme.scss");
    }));
    assert.ok(expandedMap.sources.some(function(source) {
        return source.endsWith("_high-contrast-chrome.scss");
    }));
    assert.deepEqual(minifiedMap.sources, ["bootstrap-high-contrast.css"]);
    assert.deepEqual(minifiedMap.sourcesContent, [expanded]);
});

test("High Contrast compiled palette meets its accessibility contract", function() {
    assert.ok(fs.existsSync(expandedPath),
        "build bootstrap-high-contrast.css before checking its palette");
    const css = fs.readFileSync(expandedPath, "utf8");
    const black = customProperty(css, "--hc-bg");

    assert.equal(black, "#000");
    for (const name of [
        "--hc-fg", "--hc-accent", "--hc-accent-bright", "--hc-muted"
    ]) {
        assert.ok(contrast(customProperty(css, name), black) >= 7,
            `${name} must reach 7:1 against black`);
    }
    assert.ok(contrast(customProperty(css, "--hc-border"), black) >= 3,
        "panel borders must reach 3:1 against black");

    for (const name of [
        "--hc-red", "--hc-green", "--hc-yellow", "--hc-blue",
        "--hc-magenta", "--hc-cyan"
    ]) {
        assert.ok(contrast(customProperty(css, name), black) >= 7,
            `${name} must reach 7:1 against black`);
    }
});

test("High Contrast renders flat chrome and a universal gold focus ring", function() {
    assert.ok(fs.existsSync(expandedPath),
        "build bootstrap-high-contrast.css before checking its chrome");
    const css = fs.readFileSync(expandedPath, "utf8");

    assert.match(css,
        /body\s*\{[^}]*color:\s*#fff;[^}]*background-color:\s*#000;/);
    assert.match(css,
        /\.navbar\.bg-dark,[^{]*\{[^}]*background-color:\s*#000\s*!important;/);
    assert.match(css,
        /\.card,[^{]*\{[^}]*background-image:\s*none;/);
    assert.match(css,
        /:focus-visible\s*\{[^}]*outline:\s*2px solid #ffd75e;[^}]*outline-offset:\s*2px;/);
    assert.match(lastRuleContaining(css, "):focus-visible"),
        /box-shadow:\s*none;/);
    const customControlFocus = lastRuleContaining(css,
        ".custom-control-input:focus-visible ~ .custom-control-label::before");
    assert.match(customControlFocus, /outline:\s*2px solid #ffd75e;/);
    assert.match(customControlFocus, /outline-offset:\s*2px;/);
    assert.match(customControlFocus, /box-shadow:\s*none;/);
    assert.doesNotMatch(css,
        /:focus-visible\s*\{[^}]*outline:\s*(?:0|none);/);
});

test("High Contrast button interaction states retain AAA text contrast", function() {
    const css = fs.readFileSync(expandedPath, "utf8");
    const brightButtons = {
        primary: "#ffe9b0",
        secondary: "#b0b0b0",
        success: "#3ddb3d",
        info: "#3ae0e0",
        warning: "#e8e83a",
        danger: "#ff6e5e",
        light: "#e0e0e0"
    };

    for (const [name, background] of Object.entries(brightButtons)) {
        for (const [state, selector] of [
            ["hover", `.btn-${name}:hover`],
            ["active", `.btn-${name}:not(:disabled):not(.disabled):active`]
        ]) {
            const rule = lastRuleContaining(css, selector);
            assert.match(rule, /color:\s*#000;/,
                `${name} ${state} text must stay black`);
            assert.match(rule, new RegExp(
                `background-color:\\s*${background};`),
            `${name} ${state} must keep its AAA background`);
        }
        assert.ok(contrast("#000", background) >= 7,
            `${name} button must reach 7:1`);
    }

    const darkButton = lastRuleContaining(css,
        ".btn-dark,\n.btn-outline-dark");
    assert.match(darkButton, /color:\s*#fff;/);
    assert.match(darkButton, /border-color:\s*#8a8a8a;/);
});

test("High Contrast captions retain AAA text contrast", function() {
    const css = fs.readFileSync(expandedPath, "utf8");

    for (const selector of [".blockquote-footer", ".figure-caption"]) {
        const rule = lastRuleContaining(css, `${selector} {`);
        const color = rule.match(/color:\s*(#[0-9a-f]{3,6});/);
        assert.ok(color, `${selector} must emit a hex text color`);
        assert.ok(contrast(color[1], "#000") >= 7,
            `${selector} must reach 7:1 against black`);
    }
});
