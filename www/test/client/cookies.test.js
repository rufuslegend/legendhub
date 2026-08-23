"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

async function loadModule() {
    return import("../../client/lib/cookies.js");
}

test("parseCookieHeader decodes cookie values and ignores malformed segments", async function() {
    const {parseCookieHeader} = await loadModule();

    assert.deepEqual(parseCookieHeader("theme=Glass%20Blue; cookie-consent=true; malformed"), {
        theme: "Glass Blue",
        "cookie-consent": "true"
    });
    assert.deepEqual(parseCookieHeader(), {});
});

test("formatCookie encodes values and preserves secure defaults", async function() {
    const {formatCookie} = await loadModule();

    assert.equal(
        formatCookie("theme", "Glass Blue & Gold"),
        "theme=Glass%20Blue%20%26%20Gold; Path=/; SameSite=Lax; Secure"
    );
});

test("formatCookie allows the existing expiration option", async function() {
    const {formatCookie} = await loadModule();
    const expires = new Date("2030-01-01T00:00:00.000Z");

    assert.equal(
        formatCookie("loginToken", "renewed-token", {expires}),
        "loginToken=renewed-token; Path=/; SameSite=Lax; Secure; Expires=Tue, 01 Jan 2030 00:00:00 GMT"
    );
});
