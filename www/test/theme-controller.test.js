"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const appPath = path.join(__dirname, "../src/public/js/apps/legendwiki-app.js");

test("the legacy AngularJS app retains shared factories without owning the shared shell", function() {
    const source = fs.readFileSync(appPath, "utf8");

    assert.match(source, /app\.factory\("breadcrumb", breadcrumbFactory\)/);
    assert.match(source, /app\.factory\("categories", categoriesFactory\)/);
    assert.doesNotMatch(source, /app\.controller\("header", HeaderController\)/);
    assert.doesNotMatch(source, /lhCookieConsent|lhPopover/);
});
