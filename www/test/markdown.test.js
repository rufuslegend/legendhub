"use strict";

const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");

const {renderMarkdown} = require("../src/markdown");

// Catches a renderer mutation that drops standard Markdown formatting or links.
test("renders expected Markdown formatting", function() {
    const html = renderMarkdown(
        "# Field Notes\n\nThe **amber ward** restores [focus](https://example.test/guide)."
    );

    assert.equal(html,
        "<h1>Field Notes</h1>\n" +
        "<p>The <strong>amber ward</strong> restores " +
        "<a href=\"https://example.test/guide\">focus</a>.</p>\n");
});

// Catches a renderer mutation that permits unsafe Markdown link protocols.
test("does not render unsafe Markdown links", function() {
    const html = renderMarkdown("[dangerous link](javascript:alert(1))");

    assert.equal(html, "<p>[dangerous link](javascript:alert(1))</p>\n");
    assert.doesNotMatch(html, /href=/i);
});

// Catches a renderer mutation that permits raw script elements into page output.
test("escapes raw script tags", function() {
    const html = renderMarkdown("<script>alert(1)</script>");

    assert.equal(html, "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>\n");
    assert.doesNotMatch(html, /<script\b/i);
});

// Catches a renderer mutation that treats event-handler attributes as executable HTML.
test("does not create elements with inline event handlers", function() {
    const html = renderMarkdown(
        "<a href=\"https://example.test\" onclick=\"alert(1)\">click</a>"
    );

    assert.doesNotMatch(html, /<a\b[^>]*\sonclick=/i);
    assert.match(html, /&lt;a href=&quot;/);
});

// Catches a renderer mutation that allows dangerous raw HTML elements through unchanged.
test("escapes dangerous raw HTML", function() {
    const html = renderMarkdown("<img src=x onerror=alert(1)>");

    assert.equal(html, "<p>&lt;img src=x onerror=alert(1)&gt;</p>\n");
    assert.doesNotMatch(html, /<img\b/i);
});

function loadAppWithoutDatabaseMetadataQuery() {
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (request === "sync-rpc")
            return () => () => [];
        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        return require("../src/create-app")({logging: false});
    }
    finally {
        Module._load = originalLoad;
    }
}

function detailFixture(query) {
    const timestamp = "2026-08-22T12:00:00.000Z";
    if (query.includes("getItemById")) {
        return {
            getItemById: {
                ac: 0,
                alignRestriction: 0,
                constitution: 0,
                dexterity: 0,
                getHistories: [{
                    id: 1101,
                    item: {modifiedBy: "Archivist", modifiedOn: timestamp}
                }],
                getMob: null,
                getQuest: null,
                id: 101,
                mind: 0,
                modifiedBy: "Archivist",
                modifiedOn: timestamp,
                name: "Ember lantern",
                netStat: 0,
                notes: "# Ember notes\n\n**Server-rendered item text**",
                perception: 0,
                rent: 5,
                slot: 0,
                spirit: 0,
                strength: 0,
                uniqueWear: false,
                value: 0,
                weight: 1
            },
            getItemStatCategories: []
        };
    }
    if (query.includes("getMobById")) {
        return {
            getMobById: {
                aggro: false,
                areaId: 11,
                areaName: "Thebes",
                eraId: 1,
                eraName: "Ancient",
                getHistories: [{
                    id: 1201,
                    mob: {modifiedBy: "Archivist", modifiedOn: timestamp}
                }],
                getItems: [],
                gold: 12,
                id: 201,
                modifiedBy: "Archivist",
                modifiedOn: timestamp,
                name: "Test sentry",
                notes: "# Sentry notes\n\n**Server-rendered mob text**",
                xp: 450
            }
        };
    }
    if (query.includes("getQuestById")) {
        return {
            getQuestById: {
                areaId: 11,
                areaName: "Thebes",
                eraId: 1,
                eraName: "Ancient",
                getHistories: [{
                    id: 1301,
                    quest: {modifiedBy: "Archivist", modifiedOn: timestamp}
                }],
                getItems: [],
                id: 301,
                modifiedBy: "Archivist",
                modifiedOn: timestamp,
                stat: false,
                title: "A representative quest",
                whoises: "Sentry",
                content: "# Quest briefing\n\n**Server-rendered quest text**"
            }
        };
    }
    if (query.includes("getWikiPageById")) {
        return {
            getWikiPageById: {
                categoryId: 4,
                categoryName: "Guides",
                content: "# Guide text\n\n**Server-rendered wiki text**",
                getHistories: [{
                    id: 1401,
                    wikiPage: {modifiedBy: "Archivist", modifiedOn: timestamp}
                }],
                id: 401,
                modifiedBy: "Archivist",
                modifiedOn: timestamp,
                subcategoryId: 41,
                subcategoryName: "Getting Started",
                title: "A representative wiki page"
            }
        };
    }
    throw new Error("No detail fixture matches the GraphQL query.");
}

// Catches routes that pass raw Markdown to display templates, restore AngularJS display roots,
// or drop the native history disclosure's accessible name.
test("detail pages contain rendered Markdown and history links without JavaScript", async function(t) {
    const app = loadAppWithoutDatabaseMetadataQuery();
    const apiUtils = require("../src/routes/api/utils");
    const originalPostAsync = apiUtils.postAsync;
    apiUtils.postAsync = async function(query) {
        return detailFixture(query);
    };
    t.after(function() {
        apiUtils.postAsync = originalPostAsync;
    });

    const server = await new Promise(function(resolve) {
        const listeningServer = app.listen(0, "127.0.0.1", function() {
            resolve(listeningServer);
        });
    });
    t.after(function() {
        return new Promise(function(resolve, reject) {
            server.close(function(error) {
                if (error)
                    reject(error);
                else
                    resolve();
            });
        });
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const pages = [
        {path: "/items/details.html?id=101", heading: "Ember notes", historyId: 1101, historyLabel: "Show 1 item revisions"},
        {path: "/mobs/details.html?id=201", heading: "Sentry notes", historyId: 1201, historyLabel: "Show 1 mob revisions"},
        {path: "/quests/details.html?id=301", heading: "Quest briefing", historyId: 1301, historyLabel: "Show 1 quest revisions"},
        {path: "/wiki/details.html?id=401", heading: "Guide text", historyId: 1401, historyLabel: "Show 1 wiki revisions"}
    ];

    for (const page of pages) {
        const response = await fetch(`${baseUrl}${page.path}`);
        const html = await response.text();

        assert.equal(response.status, 200, page.path);
        assert.match(html, new RegExp(`<h1>${page.heading}</h1>`), page.path);
        assert.match(html, new RegExp(`/history\\.html\\?id=${page.historyId}`), page.path);
        assert.match(html, new RegExp(`aria-label="${page.historyLabel}"`), page.path);
        assert.doesNotMatch(html, /<body\b[^>]*\bng-app=/i, page.path);
    }
});
