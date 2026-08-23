"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("item routes do not dump item records to the process console", function() {
    const source = fs.readFileSync(path.join(__dirname, "../src/routes/items.js"), "utf8");
    assert.equal(/\bconsole\.log\s*\(/.test(source), false);
});
