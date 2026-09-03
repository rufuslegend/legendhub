"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

function temporaryManual(t, content) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "legendhub-manual-"));
    const file = path.join(directory, "user-manual.md");
    fs.writeFileSync(file, content);
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    return file;
}

function loadApplication(manualPath) {
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (request === "sync-rpc")
            return () => () => [];
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        return require("../src/create-app")({manualPath, logging: false});
    }
    finally {
        Module._load = originalLoad;
    }
}

test("loads a titled manual and builds nested contents", function(t) {
    const {loadManual} = require("../src/manual-document");
    const file = temporaryManual(t,
        "# LegendHUB User Manual\n\n" +
        "## Quick Start\n\nWelcome.\n\n" +
        "### Find an item\n\nUse Items.\n\n" +
        "## Reference\n\nDetails.\n");
    const document = loadManual(file);

    assert.equal(document.title, "LegendHUB User Manual");
    assert.deepEqual(document.toc, [
        {
            id: "quick-start",
            title: "Quick Start",
            children: [{id: "find-an-item", title: "Find an item"}]
        },
        {id: "reference", title: "Reference", children: []}
    ]);
    assert.doesNotMatch(document.html, /<h1/);
    assert.match(document.html, /<h2 id="quick-start">Quick Start<\/h2>/);
});

test("rejects missing, empty, incorrectly titled, and misnested manuals", function(t) {
    const {loadManual} = require("../src/manual-document");
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "legendhub-manual-"));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    assert.throws(() => loadManual(path.join(directory, "missing.md")),
        /Unable to read user manual/);
    const empty = temporaryManual(t, " \n");
    assert.throws(() => loadManual(empty), /empty/i);
    const untitled = temporaryManual(t, "## Quick Start\n");
    assert.throws(() => loadManual(untitled),
        /must begin with exactly one level-one heading/i);
    const duplicateTitle = temporaryManual(t,
        "# LegendHUB User Manual\n\n# Duplicate title\n");
    assert.throws(() => loadManual(duplicateTitle),
        /must begin with exactly one level-one heading/i);
    const misnested = temporaryManual(t,
        "# LegendHUB User Manual\n\n### Orphan task\n");
    assert.throws(() => loadManual(misnested),
        /before a level-two section/i);
});

test("fails application startup when the configured manual is missing", function(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "legendhub-manual-"));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));

    assert.throws(
        () => loadApplication(path.join(directory, "missing.md")),
        /Unable to read user manual/
    );
});

test("serves the public manual and global navigation", async function(t) {
    const file = temporaryManual(t,
        "# LegendHUB User Manual\n\n" +
        "## Quick Start\n\n<script>alert(1)</script>\n\n" +
        "### Find an item\n\nUse [Items](/items/).\n");
    const app = loadApplication(file);
    const server = await new Promise(resolve => {
        const listening = app.listen(0, "127.0.0.1",
            () => resolve(listening));
    });
    t.after(() => new Promise((resolve, reject) => server.close(
        error => error ? reject(error) : resolve())));
    const baseUrl = "http://127.0.0.1:" + server.address().port;

    for (const pathname of ["/manual", "/manual/", "/manual/index.html"]) {
        const response = await fetch(baseUrl + pathname);
        const body = await response.text();
        assert.equal(response.status, 200);
        assert.match(body, /<h1[^>]*>LegendHUB User Manual<\/h1>/);
        assert.match(body, /aria-label="Manual contents"/);
        assert.match(body, /href="#quick-start"/);
        assert.match(body, /href="#find-an-item"/);
        assert.match(body, /<h2 id="quick-start">Quick Start<\/h2>/);
        assert.match(body, /href="\/manual\/"[^>]*>Manual<\/a>/);
        assert.doesNotMatch(body, /<script>alert/);
        assert.match(body, /&lt;script&gt;/);
    }
});
