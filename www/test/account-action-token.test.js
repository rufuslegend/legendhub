"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
    createActionToken,
    hashValidator,
    parseActionToken
} = require("../src/routes/api/account-action-token");

test("createActionToken returns a selector-validator token with only the validator hash for storage", function() {
    const result = createActionToken({
        randomBytes: size => Buffer.alloc(size, 7),
        now: new Date("2026-08-26T12:00:00Z"),
        lifetimeMs: 60 * 60 * 1000
    });

    assert.deepEqual(result, {
        selector: "070707070707",
        validator: "070707070707070707070707070707070707070707070707",
        token: "070707070707-070707070707070707070707070707070707070707070707",
        hashedValidator: "1059d8ae4558846cee243e1a6ce73a06f50791ddd0a1dea6b3f27dccce29d08e",
        expiresOn: new Date("2026-08-26T13:00:00Z")
    });
});

test("parseActionToken restores the selector and validator from a generated token", function() {
    assert.deepEqual(parseActionToken(
        "070707070707-070707070707070707070707070707070707070707070707"
    ), {
        selector: "070707070707",
        validator: "070707070707070707070707070707070707070707070707"
    });
});

test("hashValidator produces the SHA-256 digest used for database comparison", function() {
    assert.equal(
        hashValidator("070707070707070707070707070707070707070707070707"),
        "1059d8ae4558846cee243e1a6ce73a06f50791ddd0a1dea6b3f27dccce29d08e"
    );
});
