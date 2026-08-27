"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {normalizeEmail} = require("../src/routes/api/email-address");
const {BadRequestError} = require("../src/routes/api/utils");

test("normalizeEmail preserves provider-significant characters while trimming and lowercasing", function() {
    assert.deepEqual(normalizeEmail("  Player+Work@Example.COM  "), {
        display: "Player+Work@Example.COM",
        normalized: "player+work@example.com"
    });
});

test("normalizeEmail rejects missing or malformed addresses with the public bad-request error", function() {
    for (const value of [undefined, "", "not-an-address"]) {
        assert.throws(function() {
            normalizeEmail(value);
        }, function(error) {
            assert.equal(error instanceof BadRequestError, true);
            assert.equal(error.extensions.code, 400);
            assert.match(error.message, /valid email/i);
            return true;
        });
    }
});

test("normalizeEmail rejects an otherwise valid address over 254 UTF-8 bytes", function() {
    const address = `${"a".repeat(243)}@example.com`;

    assert.equal(Buffer.byteLength(address, "utf8"), 255);
    assert.throws(function() {
        normalizeEmail(address);
    }, /valid email/i);
});
