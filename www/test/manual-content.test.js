"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const manualPath = path.join(__dirname, "../../docs/user-manual.md");
const requiredSections = [
    "Welcome and Quick Start",
    "Finding Game Information",
    "Using the Character Builder",
    "Accounts and Preferences",
    "Contributing Information",
    "Troubleshooting",
    "Reference"
];

test("tracked user manual has the approved structure and links", function() {
    const source = fs.readFileSync(manualPath, "utf8");
    assert.equal((source.match(/^# /gm) || []).length, 1);
    assert.match(source, /^# LegendHUB User Manual$/m);

    const actualSections = Array.from(
        source.matchAll(/^## ([^\r\n]+)\r?$/gm),
        match => match[1]
    );
    assert.deepEqual(actualSections, requiredSections);

    for (const href of [
        "/builder/", "/items/", "/mobs/", "/quests/", "/wiki/",
        "/login.html", "/account/", "/feedback.html", "/changelog"
    ])
        assert.ok(source.includes("](" + href + ")"), "missing link " + href);

    assert.doesNotMatch(source, /!\[[^\]]*\]\(/);
});
