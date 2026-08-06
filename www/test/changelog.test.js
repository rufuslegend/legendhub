"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {loadChangelog} = require("../src/changelog-document");

function temporaryChangelog(t, content) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "legendhub-changelog-"));
    const file = path.join(directory, "CHANGELOG.md");
    fs.writeFileSync(file, content);
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    return file;
}

function loadApplication(changelogPath) {
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (request === "sync-rpc")
            return () => () => [];
        const fromLegacyChangelog = parent?.filename.endsWith("/routes/changelog.js") &&
            (request === "./api/utils" || request === "./api/auth");
        if (fromLegacyChangelog)
            throw new Error(`Public changelog loaded legacy dependency ${request}`);
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        return require("../src/create-app")({
            changelogPath,
            logging: false
        });
    }
    finally {
        Module._load = originalLoad;
    }
}

test("renders changelog Markdown while escaping embedded HTML", (t) => {
    const file = temporaryChangelog(t,
        "# Changelog\n\n## [2.6.0-beta]\n\n- Safer releases\n\n<script>alert(1)</script>\n");
    const document = loadChangelog(file);
    assert.match(document.html, /<h1>Changelog<\/h1>/);
    assert.match(document.html, /<li>Safer releases<\/li>/);
    assert.doesNotMatch(document.html, /<script>/);
    assert.match(document.html, /&lt;script&gt;/);
});

test("rejects missing and empty changelog files", (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "legendhub-changelog-"));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    assert.throws(() => loadChangelog(path.join(directory, "missing.md")), /Unable to read changelog/);
    const empty = path.join(directory, "empty.md");
    fs.writeFileSync(empty, " \n");
    assert.throws(() => loadChangelog(empty), /empty/i);
    const unreadable = path.join(directory, "unreadable.md");
    fs.writeFileSync(unreadable, "# Changelog\n");
    fs.chmodSync(unreadable, 0o000);
    assert.throws(() => loadChangelog(unreadable), /Unable to read changelog/);
    fs.chmodSync(unreadable, 0o600);
});

test("serves the tracked changelog without legacy database routes", async (t) => {
    const changelogPath = temporaryChangelog(t,
        "# Changelog\n\n## [2.6.0-beta]\n\n- Safer releases\n");
    const app = loadApplication(changelogPath);
    const server = await new Promise((resolve) => {
        const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    t.after(() => new Promise((resolve, reject) => server.close(
        (error) => error ? reject(error) : resolve())));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    await t.test("renders the tracked changelog without legacy controls", async () => {
        const response = await fetch(`${baseUrl}/changelog`);
        const body = await response.text();
        assert.equal(response.status, 200);
        assert.match(body, /2\.6\.0-beta/);
        assert.match(body, /Safer releases/);
        assert.doesNotMatch(body, /changelog\/add\.html|changelog\/edit\.html/);
    });

    await t.test("redirects legacy details and retires editor routes", async () => {
        const detail = await fetch(`${baseUrl}/changelog/details.html?id=25`,
            {redirect: "manual"});
        assert.equal(detail.status, 301);
        assert.equal(detail.headers.get("location"), "/changelog");
        assert.equal((await fetch(`${baseUrl}/changelog/add.html`)).status, 404);
        assert.equal((await fetch(`${baseUrl}/changelog/edit.html?id=25`)).status, 404);
    });
});
