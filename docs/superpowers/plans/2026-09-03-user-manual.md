# LegendHUB User Manual Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish one canonical, text-only LegendHUB user manual for players, account holders, and community contributors at `/manual/`.

**Architecture:** Store the manual at `docs/user-manual.md`, extend the existing server-side Markdown renderer with opt-in heading metadata, and load the manual through a focused document module and Express router. Render the article and generated table of contents in the existing EJS shell, then package the Markdown source in the web image.

**Tech Stack:** Node.js 22, Express 5, EJS 6, markdown-it 15, Node test runner, Playwright, axe-core, Docker

**Spec:** `docs/superpowers/specs/2026-09-03-user-manual-design.md`

## Global Constraints

- The first edition covers ordinary visitors, players, account holders, and signed-in community contributors.
- Do not include deployment, database, backup, importer-operation, role-management, permission-management, or other administrator procedures.
- Keep exactly one canonical manual source at `docs/user-manual.md`.
- Render the manual on the server at `/manual/` through LegendHUB's existing safe Markdown pipeline.
- Keep the first edition text-only; do not add screenshots or image assets.
- Use plain, player-friendly language and exact current interface labels.
- Describe current observable behavior and do not present suspected bugs or uncertain semantics as intentional rules.
- Describe official imported item protection with an explicit “for now” caveat.
- Put advanced item-search syntax and important Builder formulas and caps in reference appendices.
- A missing, unreadable, empty, or structurally invalid manual must fail clearly during application startup.
- Update root `CHANGELOG.md` because the manual and navigation link are player-facing.
- Do not modify root `docker-compose-prod.yaml`.
- Do not push, publish images, deploy, or create a release tag without separate authorization for that action.

## File Structure

- Create `docs/user-manual.md`: the single source for player and contributor documentation.
- Modify `www/src/markdown.js`: add opt-in deterministic heading IDs, metadata, and responsive document tables without changing existing `renderMarkdown()` output.
- Create `www/src/manual-document.js`: validate and render the manual and build its two-level contents.
- Create `www/src/routes/manual.js`: expose the public route.
- Create `www/src/views/manual/index.ejs`: render the manual in the shared shell.
- Modify `www/src/create-app.js` and `www/src/views/shared/header.ejs`: mount and link the Manual.
- Create `www/test/manual-content.test.js`, `www/test/manual.test.js`, and `www/test/manual-packaging.test.js`.
- Modify `www/test/markdown.test.js`: cover heading metadata.
- Create `www/accessibility/manual.spec.js` and modify `www/accessibility/high-contrast.spec.js`.
- Modify `www/Dockerfile`, `.dockerignore`, `scripts/publish-images.sh`, and its behavioral test: package and protect the source.
- Modify `AGENTS.md` and `CHANGELOG.md`: record the maintenance and release contracts.

## Preparation

- [ ] Confirm the work starts from the current local `master`, which contains the approved design and implementation-plan commits, and preserve the two unrelated untracked August 31 specification files.
- [ ] Create and switch to `feat/user-manual` before changing application or manual files:

```bash
git status --short --branch
git switch -c feat/user-manual
```

---

### Task 1: Add opt-in Markdown document rendering

**Files:**
- Modify: `www/src/markdown.js`
- Modify: `www/test/markdown.test.js`

**Interfaces:**
- Consumes: existing `renderMarkdown(source: string): string`.
- Produces: `renderMarkdownDocument(source: string, options?: {headingLevels?: number[]}): {html: string, headings: Array<{level: number, id: string, title: string}>}`.
- Gives tables rendered through `renderMarkdownDocument()` the existing Bootstrap `table table-sm table-bordered` classes and wraps each in `table-responsive`.
- Preserves: `renderMarkdown()` remains byte-for-byte unchanged for existing callers.

- [ ] **Step 1: Write the failing heading-metadata test**

Update the import and add this test to `www/test/markdown.test.js`:

```javascript
const {
    renderMarkdown,
    renderMarkdownDocument
} = require("../src/markdown");

test("renders stable unique heading anchors and metadata on request", function() {
    const document = renderMarkdownDocument(
        "## Quick Start\n\n" +
        "### Search & Filters\n\n" +
        "## Quick Start\n\n" +
        "### Café gear\n\n" +
        "### Ready :smile:\n",
        {headingLevels: [2, 3]}
    );

    assert.deepEqual(document.headings, [
        {level: 2, id: "quick-start", title: "Quick Start"},
        {level: 3, id: "search-filters", title: "Search & Filters"},
        {level: 2, id: "quick-start-2", title: "Quick Start"},
        {level: 3, id: "cafe-gear", title: "Café gear"},
        {level: 3, id: "ready", title: "Ready 😄"}
    ]);
    assert.match(document.html, /<h2 id="quick-start">Quick Start<\/h2>/);
    assert.match(document.html, /<h3 id="search-filters">Search &amp; Filters<\/h3>/);
    assert.match(document.html, /<h2 id="quick-start-2">Quick Start<\/h2>/);
    assert.match(document.html, /<h3 id="cafe-gear">Café gear<\/h3>/);
    assert.match(document.html, /<h3 id="ready">Ready 😄<\/h3>/);
});

test("keeps generated heading IDs unique when text resembles a suffix", function() {
    const document = renderMarkdownDocument(
        "## Foo\n\n## Foo 2\n\n## Foo\n"
    );

    assert.deepEqual(document.headings.map(heading => heading.id), [
        "foo", "foo-2", "foo-3"
    ]);
});

test("makes document tables responsive without changing standard rendering", function() {
    const source = "| Ability | Effect |\n| --- | --- |\n| Focus | +1 |\n";
    const document = renderMarkdownDocument(source);

    assert.match(document.html,
        /<div class="table-responsive"><table class="table table-sm table-bordered">/);
    assert.doesNotMatch(renderMarkdown(source), /table-responsive|class="table/);
});
```

Keep the existing exact-output `renderMarkdown()` test unchanged.

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
cd www
node --test test/markdown.test.js
```

Expected: FAIL because `renderMarkdownDocument` is not exported.

- [ ] **Step 3: Implement document rendering**

In `www/src/markdown.js`:

1. Add `plainHeadingText(inlineToken)` to join `text`, `code_inline`, and `emoji` child content.
2. Add `slugHeading(title)` that normalizes with `NFKD`, removes combining marks, lowercases, replaces each non-alphanumeric run with one hyphen, trims hyphens, and falls back to `section`.
3. Register a markdown-it core rule after the installed `emoji` rule so metadata sees the same emoji text that will be rendered. It must do nothing unless `state.env.legendhubHeadings` exists. For requested levels, set the heading-open token's `id` and collect `{level, id, title}`.
4. Track every emitted ID as well as the next suffix for each base slug. Advance until the candidate is unused, so `Foo`, `Foo 2`, `Foo` becomes `foo`, `foo-2`, `foo-3` rather than emitting `foo-2` twice.
5. Override `table_open` and `table_close` with rules guarded by `env.legendhubDocument`. The guarded path wraps the table in `<div class="table-responsive">` and adds `table table-sm table-bordered` to the table token; the unguarded path delegates to `self.renderToken()` unchanged.
6. Add:

```javascript
function renderMarkdownDocument(source, options = {}) {
    const headingLevels = Array.isArray(options.headingLevels) ?
        options.headingLevels : [2, 3];
    const collector = {
        headingLevels: new Set(headingLevels),
        headings: [],
        slugCounts: new Map(),
        usedIds: new Set()
    };
    const html = renderer.render(source || "", {
        legendhubDocument: true,
        legendhubHeadings: collector
    });
    return {html, headings: collector.headings};
}

exports.renderMarkdown = renderMarkdown;
exports.renderMarkdownDocument = renderMarkdownDocument;
```

Do not add a dependency. Preserve the legacy-inline whitelist and raw-HTML escaping.

- [ ] **Step 4: Run Markdown tests and confirm GREEN**

```bash
cd www
node --test test/markdown.test.js
```

Expected: all Markdown tests pass.

- [ ] **Step 5: Commit**

```bash
git add www/src/markdown.js www/test/markdown.test.js
git commit -m "feat: add markdown heading anchors"
```

---

### Task 2: Write the canonical user manual

**Files:**
- Create: `docs/user-manual.md`
- Create: `www/test/manual-content.test.js`

**Interfaces:**
- Consumes: the approved specification and current player-visible behavior.
- Produces: one standalone Markdown document beginning with exactly one `# LegendHUB User Manual`.
- Produces these exact H2 headings in order: `Welcome and Quick Start`, `Finding Game Information`, `Using the Character Builder`, `Accounts and Preferences`, `Contributing Information`, `Troubleshooting`, and `Reference`.

- [ ] **Step 1: Write the failing content contract**

Create `www/test/manual-content.test.js`:

```javascript
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

    assert.match(source, /sword, strength > 15/);
    assert.match(source, /Submitted by <name> via LegendMUD Import/);
    assert.match(source, /protected[^.]*for now/i);
    assert.match(source, /three[- ]hand/i);
    assert.match(source, /10 MB/);
    assert.doesNotMatch(source, /!\[[^\]]*\]\(/);
});
```

- [ ] **Step 2: Run the content test and confirm RED**

```bash
cd www
node --test test/manual-content.test.js
```

Expected: FAIL with `ENOENT`.

- [ ] **Step 3: Author the manual**

Create `docs/user-manual.md` with the exact H1/H2 contract above and task-oriented H3 headings.

The **Welcome and Quick Start** section must explain LegendHUB's purpose, public use without an account, community records versus official imports, and link to Builder, Items, Mobs, Quests, Wiki, Login, Changelog, and Send Feedback.

The **Finding Game Information** section must cover:

- recently modified defaults, 20-result pages, paging, sorting, same-tab record links, and new-tab actions;
- Item name/stat search, filters, mandatory Name column, visible-column persistence, shareable URLs, two-second mouse/keyboard previews, Escape dismissal, and no touch preview;
- Item details, multiple slots, notes, related records, history, official status, and attribution;
- Mob era/area and name search; Quest era/area, Stat filter, and title/whois/area/content search; Wiki category/subcategory, title/tag/content search, and pinned/locked indicators;
- narrow-screen category overlays.

The **Using the Character Builder** section must cover:

- browser-local versus verified-account storage, explicit browser-profile copying, autosave status, and no Save button;
- character and variant add/select/rename/delete, cloning, and primary variants;
- six base stats, valid 198/244 totals, zero-sum KSM movement capped at three points, quest modifiers/resources, and era abilities;
- multi-slot equipment, row-wide Choose Item, compatible results, sorting, paging, search, removal, details, and previews;
- Shield, Wield, and three Hold positions sharing three hands; normal items cost one and two-handed items cost two;
- locks, confirmed lock/unlock-all, Clear Items preserving locks, and Runecraft Customizer;
- totals, parenthetical values, red warnings, Unique, wield-weight requirement, limited items, caps, alignment errors, and deleted equipment;
- export scopes, import overwrite choices, sharing via encoded strings, retry/conflict/quota guidance, and the 10 MB limit.

The **Accounts and Preferences** section must cover:

- registration, email verification/replacement/resend, username-or-verified-email login, Stay logged in, logout, password change, and recovery;
- verification requirements for recovery and synchronized Builder storage;
- storage usage/profile count, export-all, confirmed synchronized-data deletion, and preserved browser copies;
- all current themes;
- Pop-up stat windows defaulting on and Hide zeros in equipment tables defaulting off while Rent remains visible;
- eight Item/Mob/Quest/Wiki Added/Updated notification choices and privacy/cookie behavior.

The **Contributing Information** section must cover:

- login requirements for ordinary Item, Mob, Quest, and Wiki additions, edits, and revision restores;
- each editor's visible fields and item relationships;
- Markdown/emoji preview, public modifier/date, history, and “Use this version”;
- additional delete permission;
- official imports protected from edit/delete/restore **for now**;
- exact visible template `Submitted by <name> via LegendMUD Import`.

The **Troubleshooting** section must give concrete remedies for missing browser data, consent, storage-mode changes, load/retry failures, sync conflicts, quota/revision/generation errors, imports, invalid search syntax, preview availability, expired account links, and feedback.

Under **Reference**, add these H3 sections:

- `Item-search expression syntax`: plain names; `=`, `>`, `<`, `>=`, `<=`; signed/decimal values; case-insensitive labels/aliases; comma/`and`; `or`; precedence; parentheses; and `sword, strength > 15`. Do not promise `!=`, quoted strings, or free-form name clauses joined with `and`.
- `Builder calculations`: state the level-50 model and document the formulas below.
- `Terms and abbreviations`: AC, KSM, HP, Mana, Mv, HPR, MAR, MVR, cap, variant, official item, browser-local data, and synchronized data.

The calculation reference must include:

- dependent calculations use the Builder's capped final primary-stat totals, not uncapped raw sums;
- primary cap `100 + Increased Potential rank + matching item cap bonuses`;
- hit equipment cap `30 + max(Dexterity - 90, 0)`;
- damage equipment cap `30 + max(Strength - 90, 0)`;
- spell damage and spell critical equipment caps `40`;
- regeneration allowance `20 - high-stat contribution`, where that contribution is `trunc((stat - 75) / 5)` above 79;
- mana reduction cap `50`;
- Battle Training natural mitigation `trunc(max(Constitution - 75, 0) / 5)`;
- mitigation cap `trunc(max(min(Constitution, 70) - 30, 0) / 2)`, plus 10 with Battle Training;
- AC warning below `-250`, without claiming the current Builder clamps it;
- HP `216 + 5 × effective Constitution + Quest HP`, with Constitution points above 90 counted twice;
- Mana `296 + 5 × Mind + Quest Mana`;
- Movement `346 + 5 × Dexterity + Quest Mv`;
- natural Hit `trunc((Dexterity - 1) / 3)` and Dam `trunc((Strength - 1) / 3)`;
- melee damage cap starting at 102, adding `trunc((Strength - 50) / 2)` above 50, another `trunc((Strength - 99) / 2)` above 100, and 64 for an equipped two-handed Wield weapon;
- natural AC `100 - trunc((Dexterity - 30) / 2)`;
- natural spell damage `trunc((Mind - 52) / 2)`;
- natural spell critical `trunc((Mind - 60) / 4) + trunc(max(Perception - 60, 0) / 8) + trunc(max(Spirit - 60, 0) / 8) + 5`;
- compact tables for HPR/MAR/MVR from `calculateNaturalStatBonus()`, plus era-ability ordering and rank limits from `getEraAbilities()` and per-rank effects verified against `calculateEraAbilityBonus()` and `www/test/game-stats.test.js`;
- parenthetical totals as capped normal-equipment contribution and Alignment `ERROR` as no compatible alignment.

Use concise tables where they reduce repetition. Do not include implementation paths, database columns, internal identities, role names, screenshots, or future promises.

- [ ] **Step 4: Run and inspect**

```bash
cd www
node --test test/manual-content.test.js
rg -n '^#{1,3} ' ../docs/user-manual.md
```

Expected: test passes and heading order matches the contract.

- [ ] **Step 5: Commit**

```bash
git add docs/user-manual.md www/test/manual-content.test.js
git commit -m "docs: add LegendHUB user manual"
```

---

### Task 3: Serve the manual with generated navigation

**Files:**
- Create: `www/src/manual-document.js`
- Create: `www/src/routes/manual.js`
- Create: `www/src/views/manual/index.ejs`
- Create: `www/test/manual.test.js`
- Modify: `www/src/create-app.js`
- Modify: `www/src/views/shared/header.ejs`

**Interfaces:**
- Consumes: `renderMarkdownDocument(source, {headingLevels: [2, 3]})`.
- Consumes: `docs/user-manual.md` or a test-injected `manualPath`.
- Produces: `loadManual(filePath?: string): {source: string, title: string, html: string, toc: Array<{id: string, title: string, children: Array<{id: string, title: string}>}>}`.
- Produces: `createManualRouter(options?: {manualPath?: string})`.
- Extends: `createApp(options)` with optional `manualPath`.

- [ ] **Step 1: Write failing loader and route tests**

Create `www/test/manual.test.js`:

```javascript
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
```

- [ ] **Step 2: Run the test and confirm RED**

```bash
cd www
node --test test/manual.test.js
```

Expected: FAIL because `www/src/manual-document.js` does not exist.

- [ ] **Step 3: Implement the loader**

Create `www/src/manual-document.js`:

```javascript
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {renderMarkdownDocument} = require("./markdown");

function defaultManualPath() {
    return process.env.USER_MANUAL_PATH ||
        path.resolve(__dirname, "../../docs/user-manual.md");
}

function buildTableOfContents(headings) {
    const toc = [];
    let section = null;
    for (const heading of headings) {
        if (heading.level === 2) {
            section = {
                id: heading.id,
                title: heading.title,
                children: []
            };
            toc.push(section);
            continue;
        }
        if (!section) {
            throw new Error(
                `User manual heading "${heading.title}" appears before a level-two section`
            );
        }
        section.children.push({id: heading.id, title: heading.title});
    }
    return toc;
}

function loadManual(filePath = defaultManualPath()) {
    let source;
    try {
        source = fs.readFileSync(filePath, "utf8");
    }
    catch (error) {
        throw new Error(
            `Unable to read user manual at ${filePath}: ${error.message}`,
            {cause: error}
        );
    }
    if (!source.trim())
        throw new Error(`User manual at ${filePath} is empty`);

    const titleMatch = source.match(/^# ([^\r\n]+)(?:\r?\n|$)/);
    const levelOneHeadings = source.match(/^# [^\r\n]+/gm) || [];
    if (!titleMatch || levelOneHeadings.length !== 1) {
        throw new Error(
            `User manual at ${filePath} must begin with exactly one level-one heading`
        );
    }

    const title = titleMatch[1].trim();
    const body = source.slice(titleMatch[0].length).replace(/^\s+/, "");
    const rendered = renderMarkdownDocument(body, {
        headingLevels: [2, 3]
    });
    return {
        source,
        title,
        html: rendered.html,
        toc: buildTableOfContents(rendered.headings)
    };
}

exports.loadManual = loadManual;
```

This removes the source H1 from `html` so the view emits exactly one escaped H1 before the contents.

- [ ] **Step 4: Implement router, view, app wiring, and navigation**

Create `www/src/routes/manual.js`:

```javascript
"use strict";

const express = require("express");
const {loadManual} = require("../manual-document");

module.exports = function createManualRouter(options = {}) {
    const router = express.Router();
    const document = loadManual(options.manualPath);

    router.get(["/", "/index.html"], function(req, res) {
        res.render("manual/index", {
            title: "User Manual",
            vm: document
        });
    });

    return router;
};
```

Create `www/src/views/manual/index.ejs`:

```ejs
<!doctype html>
<html lang="en">
    <head>
        <%-include("../shared/meta")-%>
        <link href="https://www.legendhub.org/manual/" rel="canonical">
    </head>
    <body>
        <%-include("../shared/header")-%>
        <main class="container">
            <article class="card">
                <div class="card-body manual">
                    <h1><%=vm.title%></h1>
                    <nav aria-label="Manual contents" class="mb-4">
                        <h2 class="h4">On this page</h2>
                        <ul>
                            <%for (const section of vm.toc) {%>
                            <li>
                                <a href="#<%-section.id%>"><%=section.title%></a>
                                <%if (section.children.length) {%>
                                <ul>
                                    <%for (const child of section.children) {%>
                                    <li><a href="#<%-child.id%>"><%=child.title%></a></li>
                                    <%}%>
                                </ul>
                                <%}%>
                            </li>
                            <%}%>
                        </ul>
                    </nav>
                    <%-vm.html%>
                </div>
            </article>
        </main>
        <%-include("../shared/footer")-%>
        <%-include("../shared/scripts")-%>
    </body>
</html>
```

In `www/src/create-app.js`, import `createManualRouter`, then mount it immediately after `authRouter`. This keeps the route public while allowing signed-in readers to receive the same account-aware shared navigation and theme preferences as other public content pages:

```javascript
app.use("/manual", createManualRouter({
    manualPath: options.manualPath
}));
```

In `www/src/views/shared/header.ejs`, add immediately after Wiki:

```ejs
<li class="nav-item">
    <a class="nav-link" href="/manual/">Manual</a>
</li>
```

- [ ] **Step 5: Run focused route and regression tests**

```bash
cd www
node --test test/manual.test.js test/manual-content.test.js \
  test/markdown.test.js test/changelog.test.js test/smoke.test.js
```

Expected: all pass; existing Changelog content rendering remains unchanged.

- [ ] **Step 6: Commit**

```bash
git add www/src/manual-document.js www/src/routes/manual.js \
  www/src/views/manual/index.ejs www/src/create-app.js \
  www/src/views/shared/header.ejs www/test/manual.test.js
git commit -m "feat: serve the user manual"
```

---

### Task 4: Package and maintain the manual as a release input

**Files:**
- Create: `www/test/manual-packaging.test.js`
- Modify: `scripts/test/publish-images.test.js`
- Modify: `.dockerignore`
- Modify: `www/Dockerfile`
- Modify: `scripts/publish-images.sh`
- Modify: `AGENTS.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `docs/user-manual.md`.
- Produces: `/app/docs/user-manual.md` and `USER_MANUAL_PATH=/app/docs/user-manual.md` in the final web image.
- Extends: the publish script's dirty-input check to include `docs/user-manual.md`.

- [ ] **Step 1: Write the failing packaging contract**

Create `www/test/manual-packaging.test.js`:

```javascript
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "../..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("web image packages the canonical user manual", function() {
    assert.match(read(".dockerignore"), /^!docs\/$/m);
    assert.match(read(".dockerignore"), /^!docs\/user-manual\.md$/m);
    assert.match(read("www/Dockerfile"),
        /^COPY docs\/user-manual\.md \.\/docs\/user-manual\.md$/m);
    assert.match(read("www/Dockerfile"),
        /^ENV USER_MANUAL_PATH=\/app\/docs\/user-manual\.md$/m);
});

test("publishing and guidance treat the manual as a release input", function() {
    assert.match(read("scripts/publish-images.sh"),
        /docs\/user-manual\.md/);
    assert.match(read("AGENTS.md"),
        /player workflows[^\n]+docs\/user-manual\.md/i);
    assert.match(read("CHANGELOG.md"),
        /user manual|Manual page/i);
});
```

In `scripts/test/publish-images.test.js`, extend the existing dirty root web-image input cases:

```javascript
test("refuses dirty root web-image inputs before invoking Docker", async (t) => {
    for (const dirtyPath of [
        "CHANGELOG.md",
        ".dockerignore",
        "docs/user-manual.md"
    ]) {
        await t.test(dirtyPath, () => {
            const result = runPublisher(` M ${dirtyPath}\n`);
            assert.notEqual(result.status, 0);
            assert.match(result.stderr, new RegExp(dirtyPath.replace(".", "\\.")));
            assert.equal(readDockerLog(), "");
        });
    }
});
```

- [ ] **Step 2: Run the test and confirm RED**

```bash
node --test www/test/manual-packaging.test.js \
  scripts/test/publish-images.test.js
```

Expected: the packaging assertions and the new `docs/user-manual.md` publishing-guard case fail.

- [ ] **Step 3: Package the source**

Add to `.dockerignore` after `!CHANGELOG.md`:

```text
!docs/
!docs/user-manual.md
```

Add to the final stage of `www/Dockerfile` after the Changelog copy:

```dockerfile
COPY docs/user-manual.md ./docs/user-manual.md
ENV USER_MANUAL_PATH=/app/docs/user-manual.md
```

Retain the existing `CHANGELOG_PATH` and entrypoint.

- [ ] **Step 4: Protect publishing and future maintenance**

Add `docs/user-manual.md` to the explicit path list in `scripts/publish-images.sh`:

```bash
dirty="$(git status --porcelain=v1 --untracked-files=all -- \
  .dockerignore CHANGELOG.md docs/user-manual.md www python mysql)"
```

Add this bullet to `AGENTS.md` immediately after the Changelog convention:

```markdown
- Changes to documented player workflows, interface labels, account or contributor behavior, search syntax, or Builder calculations must update `docs/user-manual.md` in the same release.
```

Add under `3.1.0-beta` → `Added` in `CHANGELOG.md`:

```markdown
- Added a browser-readable User Manual covering game-data browsing, the Character Builder, accounts and preferences, community contributions, troubleshooting, search syntax, and important Builder calculations.
```

- [ ] **Step 5: Run packaging and shell checks**

```bash
node --test www/test/manual-packaging.test.js \
  scripts/test/publish-images.test.js
bash -n scripts/publish-images.sh
git diff --check
```

Expected: tests pass, shell syntax is valid, and no whitespace errors appear.

- [ ] **Step 6: Build and inspect the web image**

```bash
docker build --platform linux/amd64 \
  --file www/Dockerfile \
  --tag legendhub-www:user-manual-test .
docker run --rm --entrypoint sh legendhub-www:user-manual-test \
  -c 'test -s /app/docs/user-manual.md && grep -q "^# LegendHUB User Manual" /app/docs/user-manual.md'
```

Expected: image build succeeds and inspection exits 0.

- [ ] **Step 7: Commit**

```bash
git add .dockerignore www/Dockerfile scripts/publish-images.sh \
  scripts/test/publish-images.test.js AGENTS.md CHANGELOG.md \
  www/test/manual-packaging.test.js
git commit -m "build: package the user manual"
```

---

### Task 5: Verify accessibility, responsiveness, and the complete release

**Files:**
- Create: `www/accessibility/manual.spec.js`
- Modify: `www/accessibility/high-contrast.spec.js`

**Interfaces:**
- Consumes: public `/manual/`.
- Verifies: one H1, the `Manual contents` landmark, stable targets, desktop and narrow layouts, keyboard links, and WCAG A/AA checks.

- [ ] **Step 1: Add Manual to the High Contrast scan**

Add to the `pages` array in `www/accessibility/high-contrast.spec.js`:

```javascript
{
    heading: "LegendHUB User Manual",
    name: "manual",
    path: "/manual/"
},
```

- [ ] **Step 2: Write responsive contents tests**

Create `www/accessibility/manual.spec.js` using the `sync-rpc` stub and Express lifecycle pattern from `www/accessibility/high-contrast.spec.js`. Define `baseUrl` in `beforeAll`, close the server in `afterAll`, and add:

```javascript
for (const viewport of [
    {width: 1280, height: 900},
    {width: 375, height: 812}
]) {
    test(`Manual contents work at ${viewport.width}px`,
        async function({page}) {
            await page.setViewportSize(viewport);
            const response = await page.goto(baseUrl + "/manual/");
            expect(response).not.toBeNull();
            expect(response.status()).toBe(200);

            await expect(page.getByRole("heading", {
                level: 1,
                name: "LegendHUB User Manual"
            })).toHaveCount(1);
            const contents = page.getByRole("navigation", {
                name: "Manual contents"
            });
            await expect(contents).toBeVisible();

            const builderLink = contents.getByRole("link", {
                name: "Using the Character Builder",
                exact: true
            });
            await builderLink.focus();
            await expect(builderLink).toBeFocused();
            await builderLink.press("Enter");
            await expect(page).toHaveURL(
                /#using-the-character-builder$/
            );
            await expect(
                page.locator("#using-the-character-builder")
            ).toBeVisible();

            const overflows = await page.evaluate(function() {
                return document.documentElement.scrollWidth >
                    document.documentElement.clientWidth;
            });
            expect(overflows).toBe(false);
        });
}
```

- [ ] **Step 3: Run focused browser checks**

```bash
cd www
npx playwright test accessibility/manual.spec.js \
  accessibility/high-contrast.spec.js
```

Expected: both viewport tests pass and Manual has no detectable WCAG A/AA violations in High Contrast.

- [ ] **Step 4: Commit**

```bash
git add www/accessibility/manual.spec.js \
  www/accessibility/high-contrast.spec.js
git commit -m "test: cover user manual accessibility"
```

- [ ] **Step 5: Run full verification**

```bash
cd www
npm test
npm run test:a11y
npm run build:client
cd ..
node --test scripts/test/*.test.js
git diff --check
git status --short --branch
```

Expected:

- the Node suite passes with only documented existing skips;
- the Playwright suite passes with only documented existing skips;
- the Vite production build succeeds;
- `git diff --check` is clean;
- only planned changes and the two unrelated untracked August 31 specification files appear.

- [ ] **Step 6: Review the rendered manual**

Open `/manual/` locally and confirm:

- contents links reach unique headings;
- application links target current routes;
- desktop and narrow layouts read well in Dark and High Contrast;
- exactly one H1 appears;
- no screenshot, admin procedure, deployment command, database instruction, internal role name, or unsupported search operator appears;
- official protection includes “for now”;
- formulas agree with `www/src/public/js/services/game-stats.js` and its tests;
- Manual appears after Wiki throughout the shared shell.

Correct content errors in `docs/user-manual.md` with matching contract-test changes, rerun Tasks 2 and 5 checks, and use a focused `docs: correct user manual ...` commit.

---

## Completion Criteria

- `docs/user-manual.md` is the only canonical manual source.
- `/manual/` renders it with one H1 and generated two-level contents.
- Manual appears in global navigation after Wiki.
- All approved player, account, contributor, troubleshooting, search, and calculation topics are covered.
- Admin operations and screenshots are absent.
- Missing or invalid source fails clearly at startup.
- The web image contains `/app/docs/user-manual.md`.
- Publishing refuses a dirty manual input.
- Targeted, full Node, full accessibility, production-build, and Docker packaging checks pass.
- `CHANGELOG.md` and `AGENTS.md` carry release and maintenance contracts.
- No push, image publication, deployment, or release tag occurs without explicit authorization.
