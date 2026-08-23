"use strict";

const assert = require("node:assert/strict");
const ejs = require("ejs");
const path = require("node:path");
const test = require("node:test");

const template = path.join(__dirname, "../src/views/error/401.ejs");

async function renderUnauthorizedPage(user) {
    return ejs.renderFile(template, {
        cookies: {},
        displayDateTime: function() { return "2026-08-22 12:00"; },
        url: {path: "/error/401.html"},
        user,
        version: "test"
    });
}

test("401 page explains an anonymous redirect without legacy permission directives", async function() {
    const html = await renderUnauthorizedPage(null);

    assert.match(html, /You are not logged in\. This is likely the reason why you were redirected to this page\./);
    assert.doesNotMatch(html, /lh-perm-check|ng-cloak/);
});

test("401 page does not show the anonymous explanation to authenticated visitors", async function() {
    const html = await renderUnauthorizedPage({
        moreNotifications: false,
        notifications: [],
        username: "Authenticated Tester"
    });

    assert.doesNotMatch(html, /You are not logged in\. This is likely the reason why you were redirected to this page\./);
    assert.doesNotMatch(html, /lh-perm-check|ng-cloak/);
});
