"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

async function loadModule() {
    try {
        return await import("../../client/lib/cookie-consent.js");
    }
    catch (error) {
        assert.fail(`native cookie consent module is unavailable: ${error.message}`);
    }
}

test("cookie consent writes the existing secure cookie and removes only its nearest banner", async function() {
    const {initializeCookieConsent} = await loadModule();
    let listener;
    let removed = 0;
    const banner = {remove() { removed++; }};
    const button = {
        addEventListener(type, callback) {
            assert.equal(type, "click");
            listener = callback;
        },
        closest(selector) {
            assert.equal(selector, ".cookie-consent-banner");
            return banner;
        }
    };
    const document = {
        cookie: "",
        querySelectorAll(selector) {
            assert.equal(selector, "[data-cookie-consent]");
            return [button];
        }
    };

    initializeCookieConsent(document);
    listener();

    assert.match(document.cookie, /^cookie-consent=true; Path=\/; SameSite=Lax; Secure; Expires=/);
    assert.equal(removed, 1);
});
