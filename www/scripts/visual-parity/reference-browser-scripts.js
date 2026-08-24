"use strict";

const fs = require("node:fs");
const path = require("node:path");

const vendorRoot = path.resolve(__dirname, "../../../scripts/fixtures/visual-parity/angularjs-1.8.0");
const scripts = new Map([
    [
        "https://ajax.googleapis.com/ajax/libs/angularjs/1.8.0/angular.min.js",
        "angular.min.js"
    ],
    [
        "https://ajax.googleapis.com/ajax/libs/angularjs/1.8.0/angular-cookies.min.js",
        "angular-cookies.min.js"
    ],
    [
        "https://ajax.googleapis.com/ajax/libs/angularjs/1.8.0/angular-sanitize.min.js",
        "angular-sanitize.min.js"
    ]
].map(function([url, filename]) {
    return [url, fs.readFileSync(path.join(vendorRoot, filename))];
}));

module.exports = async function fulfillReferenceBrowserScript(route) {
    const script = scripts.get(route.request().url());
    if (!script)
        return false;

    await route.fulfill({
        body: script,
        contentType: "application/javascript"
    });
    return true;
};
