"use strict";

const fs = require("node:fs");

const scripts = new Map([
    [
        "https://code.jquery.com/jquery-3.7.1.slim.min.js",
        "jquery/dist/jquery.slim.min.js"
    ],
    [
        "https://cdnjs.cloudflare.com/ajax/libs/popper.js/1.14.7/umd/popper.min.js",
        "popper.js/dist/umd/popper.min.js"
    ],
    [
        "https://stackpath.bootstrapcdn.com/bootstrap/4.3.1/js/bootstrap.min.js",
        "bootstrap/dist/js/bootstrap.min.js"
    ],
    [
        "https://ajax.googleapis.com/ajax/libs/angularjs/1.8.0/angular.min.js",
        "angular/angular.min.js"
    ],
    [
        "https://ajax.googleapis.com/ajax/libs/angularjs/1.8.0/angular-cookies.min.js",
        "angular-cookies/angular-cookies.min.js"
    ]
].map(function([url, modulePath]) {
    return [url, fs.readFileSync(require.resolve(modulePath))];
}));

module.exports = async function fulfillLocalBrowserScript(route) {
    const script = scripts.get(route.request().url());
    if (!script)
        return route.abort();

    return route.fulfill({
        body: script,
        contentType: "application/javascript"
    });
};
