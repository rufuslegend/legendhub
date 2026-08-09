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
});
