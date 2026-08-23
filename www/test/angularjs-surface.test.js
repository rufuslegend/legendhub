"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const angularPatterns = [
    /\bng-[a-z-]+=/,
    /\bangular\.(?:module|copy)\b/,
    /\$scope\b/,
    /\$http\b/,
    /\$cookies\b/
];

const allowedAngularFiles = [
    "public/js/apps/legendwiki-app.js",
    "public/js/controllers/builder/main.js",
    "public/js/controllers/items/main.js",
    "public/js/controllers/login.js",
    "public/js/ng-showdown.js",
    "public/js/showdown.min.js",
    "views/builder/index.ejs",
    "views/items/index.ejs",
    "views/items/modify.ejs",
    "views/login.ejs",
    "views/mobs/modify.ejs",
    "views/quests/modify.ejs",
    "views/shared/columnsModal.ejs",
    "views/shared/filtersModal.ejs",
    "views/shared/markdown.ejs",
    "views/shared/mobModal.ejs",
    "views/shared/questModal.ejs",
    "views/wiki/modify.ejs"
];

function walkFiles(directory) {
    return fs.readdirSync(directory, {withFileTypes: true}).flatMap(function(entry) {
        const filePath = path.join(directory, entry.name);
        return entry.isDirectory() ? walkFiles(filePath) : [filePath];
    });
}

test("AngularJS surface remains within the migration allowlist", function() {
    const sourceRoot = path.join(__dirname, "../src");
    const activeAngularFiles = ["views", "public/js"].flatMap(function(relativeRoot) {
        return walkFiles(path.join(sourceRoot, relativeRoot));
    }).filter(function(filePath) {
        const source = fs.readFileSync(filePath, "utf8");
        return angularPatterns.some(function(pattern) {
            return pattern.test(source);
        });
    }).map(function(filePath) {
        return path.relative(sourceRoot, filePath).split(path.sep).join("/");
    }).sort();

    assert.deepEqual(activeAngularFiles, allowedAngularFiles);
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
