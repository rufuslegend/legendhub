"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const metadata = require("../src/routes/api/migrations/schema-metadata");

test("MariaDB metadata distinguishes SQL NULL from a quoted literal NULL", () => {
    assert.equal(metadata.normalizeActualDefault("NULL", "mariadb"), null);
    assert.equal(metadata.normalizeActualDefault("'NULL'", "mariadb"), "NULL");
});

test("MySQL metadata preserves an unquoted literal NULL", () => {
    assert.equal(metadata.normalizeActualDefault("NULL", "mysql"), "NULL");
});

test("MariaDB metadata removes SQL quoting from string defaults", () => {
    assert.equal(metadata.normalizeActualDefault("'builder''s choice'", "mariadb"),
        "builder's choice");
});
