"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const angularPatterns = [
    /\bng-[a-z-]+=/,
    /\bangular\b/,
    /\bangular(?:\.min)?\.js\b/,
    /\bangular-(?:cookies|sanitize)\b/,
    /\bng-showdown\b/,
    /\$(?:scope|http|cookies|compile|sanitize|sce)\b/
];

function walkFiles(directory) {
    return fs.readdirSync(directory, {withFileTypes: true}).flatMap(function(entry) {
        const filePath = path.join(directory, entry.name);
        return entry.isDirectory() ? walkFiles(filePath) : [filePath];
    });
}

test("active browser surfaces contain no AngularJS runtime or adapter references", function() {
    const sourceRoot = path.join(__dirname, "../src");
    const browserSources = ["views", "public/js"].flatMap(function(relativeRoot) {
        return walkFiles(path.join(sourceRoot, relativeRoot));
    }).concat(walkFiles(path.join(__dirname, "../client")), [
        path.join(__dirname, "../package.json"),
        path.join(__dirname, "../accessibility/support/local-browser-scripts.js")
    ]);
    const activeAngularFiles = browserSources.filter(function(filePath) {
        const source = fs.readFileSync(filePath, "utf8");
        return angularPatterns.some(function(pattern) {
            return pattern.test(source);
        });
    }).sort();

    assert.deepEqual(activeAngularFiles, []);
});

test("fatal and generic error templates remain outside AngularJS bootstrapping", function() {
    const viewsRoot = path.join(__dirname, "../src/views/error");

    for (const template of ["fatal.ejs", "generic.ejs"]) {
        assert.doesNotMatch(
            fs.readFileSync(path.join(viewsRoot, template), "utf8"),
            /\bng-app=/,
            `${template} must remain independent of AngularJS`
        );
    }
});
