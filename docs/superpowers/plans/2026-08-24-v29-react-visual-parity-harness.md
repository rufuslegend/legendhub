# LegendHUB 2.9-to-React Visual Parity Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one safe local command that renders the frozen Angular 2.9.0 release and the current React candidate from identical state, captures deterministic desktop/mobile screenshots and structural snapshots, and produces a consolidated parity report.

**Architecture:** A declarative scenario manifest drives a Playwright capture engine shared with the existing computed-style audit. Pure modules compare structural snapshots and PNG buffers and render a self-contained HTML report. A tested Compose overlay and Bash orchestrator create two isolated HTTPS stacks from one snapshot, run the comparison, and remove only those disposable stacks.

**Tech Stack:** Bash, Docker Compose, MySQL 5.7, Nginx 1.27, Node.js 22, Playwright 1.62, Node's built-in test runner, `pixelmatch` 7.2, `pngjs` 7.0

**Spec:** `docs/superpowers/specs/2026-08-23-v29-react-visual-parity-harness-design.md`

## Global Constraints

- The automated reference is exactly `v2.9.0^{commit}` = `0cab3ac95826a53de19b3146d277e7056495210f`.
- `https://legendhub.org` is the ultimate visible and behavioral source of truth when it differs from the frozen local reference.
- Use isolated projects named `legendhub-parity-reference` and `legendhub-parity-candidate`; never target `legendhub-local`.
- Mount `data/local-stack/backups/dunwich-latest.sql.gz`, the local certificate, its key, and the parity fixture read-only.
- Start only `mysql`, `www`, and `nginx`; do not start Python, backup, or content-sync services.
- Use separate Playwright browser contexts and unique localhost HTTPS ports (`7443` reference, `7444` candidate).
- Treat the detached reference checkout as read-only and fail if it is modified or resolves to the wrong commit.
- `smoke` means Glass Blue at `1280x720` and `375x667`; `full` means all nine themes at both viewports.
- Runs report differences by default. Only `--fail-on-diff` makes findings fail the command.
- Preserve security and nonvisual semantic improvements; do not use the harness to undo them or introduce accessibility-driven visual redesign during parity work.
- Write generated artifacts only below ignored `data/parity-report/`.
- Do not print environment files, database contents, passwords, tokens, or credentials.
- Do not touch root `docker-compose-prod.yaml`.
- Do not push, publish images, deploy, tag, or change any remote environment without separate authorization.

## File and Interface Map

- `www/scripts/visual-parity/config.js` owns CLI parsing, constants, manifest validation, and matrix expansion.
- `www/scripts/visual-parity/scenarios.js` owns the declarative user-visible scenario matrix and selector mappings.
- `www/scripts/visual-parity/structure.js` owns DOM/style capture, structural comparison, and finding consolidation.
- `www/scripts/visual-parity/images.js` owns PNG dimension checks, pixel comparison, and highlighted diff buffers.
- `www/scripts/visual-parity/report.js` owns artifact persistence, JSON findings, and the self-contained escaped HTML report.
- `www/scripts/visual-parity/capture.js` owns browser contexts, deterministic state, actions, readiness, capture, and per-scenario results.
- `www/scripts/audit-visual-parity.js` is the browser/report CLI used by the stack orchestrator.
- `www/scripts/audit-ui-parity.js` remains the URL-to-URL computed-style CLI, delegating shared comparison logic to `structure.js`.
- `scripts/fixtures/visual-parity.sql` creates deterministic local-only account, notification, item, mob, quest, wiki, and history records.
- `docker-compose.parity.yaml` is the production-shaped, three-service parity overlay usable with either checkout's base Compose file.
- `nginx/parity.conf` is the shared HTTPS reverse-proxy configuration.
- `scripts/run-visual-parity.sh` owns reference checkout validation, the two Compose lifecycles, readiness, capture invocation, and cleanup.
- `scripts/test/visual-parity-compose.test.js` and `scripts/test/visual-parity-operator.test.js` protect stack isolation and destructive-action boundaries.
- `www/test/visual-parity-*.test.js` and `www/test/fixtures/visual-parity/` protect pure comparison, report, manifest, and controlled-browser behavior.

---

### Task 1: Define the CLI and Scenario Contract

**Files:**
- Create: `www/scripts/visual-parity/config.js`
- Create: `www/scripts/visual-parity/scenarios.js`
- Create: `www/test/visual-parity-config.test.js`

**Interfaces:**
- Produces: `parseVisualParityArgs(argv)` returning `{referenceBaseUrl, candidateBaseUrl, referenceSha, candidateSha, mode, outputDir, failOnDiff}`.
- Produces: `validateManifest(scenarios)` returning the validated array or throwing a path-specific error.
- Produces: `buildCaptureMatrix({mode, scenarios})` returning `{scenario, theme, viewportName, viewport}` entries.
- Produces: `THEMES`, `VIEWPORTS`, `REFERENCE_SHA`, `SCENARIOS`, and the closed action/target schema consumed by Tasks 2 and 4.

- [ ] **Step 1: Write failing CLI, manifest, and matrix tests**

Create `www/test/visual-parity-config.test.js` with literal cases proving:

```js
assert.deepEqual(parseVisualParityArgs([
    "--reference-base-url=https://localhost:7443",
    "--candidate-base-url=https://localhost:7444/",
    "--reference-sha=0cab3ac95826a53de19b3146d277e7056495210f",
    "--candidate-sha=1111111111111111111111111111111111111111",
    "--mode=smoke",
    "--output-dir=data/parity-report/test-run",
    "--fail-on-diff"
]), {
    referenceBaseUrl: "https://localhost:7443",
    candidateBaseUrl: "https://localhost:7444",
    referenceSha: "0cab3ac95826a53de19b3146d277e7056495210f",
    candidateSha: "1111111111111111111111111111111111111111",
    mode: "smoke",
    outputDir: "data/parity-report/test-run",
    failOnDiff: true
});

assert.deepEqual(
    buildCaptureMatrix({mode: "smoke", scenarios: [{name: "home"}]}),
    [
        {scenario: {name: "home"}, theme: "glass-blue", viewportName: "desktop", viewport: {width: 1280, height: 720}},
        {scenario: {name: "home"}, theme: "glass-blue", viewportName: "mobile", viewport: {width: 375, height: 667}}
    ]
);
assert.equal(buildCaptureMatrix({mode: "full", scenarios: [{name: "home"}]}).length, 18);
```

Also reject a missing URL, non-HTTPS local URL, missing or malformed 40-character SHA, wrong reference SHA, unknown option, mode outside `smoke|full`, duplicate scenario name, undeclared action type, missing readiness selector, missing capture target, missing side-specific selector, and masks broader than a declared selector.

- [ ] **Step 2: Run the focused test and capture RED**

Run:

```bash
cd www
node --test test/visual-parity-config.test.js
```

Expected: FAIL because `scripts/visual-parity/config.js` and `scenarios.js` do not exist.

- [ ] **Step 3: Implement constants, strict CLI parsing, and schema validation**

Implement these fixed values in `config.js`:

```js
const REFERENCE_SHA = "0cab3ac95826a53de19b3146d277e7056495210f";
const THEMES = [
    "light", "dark", "solarized-dark", "high-contrast", "glass-blue",
    "glass-emerald", "glass-ruby", "glass-amethyst", "glass-amber"
];
const VIEWPORTS = {
    desktop: {width: 1280, height: 720},
    mobile: {width: 375, height: 667}
};
const ACTION_TYPES = new Set(["click", "fill", "hover", "press", "select", "set-builder-state"]);
```

Normalize trailing slashes, require HTTPS, require both full SHAs, require the reference SHA to equal `REFERENCE_SHA`, default to `mode: "smoke"`, default `outputDir` to `data/parity-report/<UTC timestamp>`, and leave `failOnDiff` false unless explicitly supplied. Validation must report the scenario name and invalid property.

- [ ] **Step 4: Declare the complete initial scenario matrix**

In `scenarios.js`, declare these stable scenario names and routes, with reference/candidate selectors for each readiness point, action, capture region, mask, and structural target:

```text
home-shell                    /
login                         /login.html
registration-panel            /login.html                 click Register
notifications-popover         /                            authenticated, click bell
notifications-list            /notifications/              authenticated
account-settings              /account/                    authenticated
changelog                     /changelog/
builder-populated             /builder/                    seeded cln/scl state
builder-columns               /builder/                    click Hide/Show Columns
builder-item-picker           /builder/                    click Light slot item
builder-warning               /builder/                    choose limited fixture and hover warning
items-results                 /items/?search=Parity
items-columns                 /items/?search=Parity        click Columns
items-filters                 /items/?search=Parity        click Filters
item-details                  /items/details.html?id=900001
item-history                  /items/history.html?id=900001
item-editor                   /items/edit.html?id=900001    authenticated
mobs-results                  /mobs/?search=Parity
mob-details                   /mobs/details.html?id=900001
mob-history                   /mobs/history.html?id=900001
mob-editor                    /mobs/edit.html?id=900001     authenticated
quests-results                /quests/?search=Parity
quest-details                 /quests/details.html?id=900001
quest-history                 /quests/history.html?id=900001
quest-editor                  /quests/edit.html?id=900001   authenticated
wiki-results                  /wiki/?search=Parity
wiki-details                  /wiki/details.html?id=900001
wiki-history                  /wiki/history.html?id=900001
wiki-editor                   /wiki/edit.html?id=900001     authenticated
wiki-smithing-format          /wiki/details.html?id=900002
responsive-navigation         /                            mobile click navbar toggler
```

Each scenario must include `ready`, `capture: {kind: "page"|"locator", selector?}`, and at least one structural target. Mask only the CAPTCHA iframe/container, timestamps, and any external widget rectangle. Use selector pairs such as `{reference: "...", candidate: "..."}` wherever Angular and React differ.

- [ ] **Step 5: Run GREEN and commit the contract**

Run:

```bash
cd www
node --test test/visual-parity-config.test.js
```

Expected: PASS with two smoke matrix entries per scenario and eighteen full matrix entries per scenario.

Commit:

```bash
git add www/scripts/visual-parity/config.js \
  www/scripts/visual-parity/scenarios.js \
  www/test/visual-parity-config.test.js
git commit -m "test: define visual parity scenario contract"
```

---

### Task 2: Extract and Expand Structural Comparison

**Files:**
- Create: `www/scripts/visual-parity/structure.js`
- Create: `www/test/visual-parity-structure.test.js`
- Modify: `www/scripts/audit-ui-parity.js`
- Modify: `www/test/ui-parity-audit.test.js`

**Interfaces:**
- Consumes: validated target definitions and theme/viewport identity from Task 1.
- Produces: `captureStructuralTargets(page, scenario, side, identity)` returning serializable target snapshots.
- Produces: `compareStructuralSnapshots(reference, candidate, {geometryTolerance})` returning normalized finding records.
- Produces: `consolidateFindings(findings)` grouping identical root differences with sorted occurrences.

- [ ] **Step 1: Write failing structural regressions**

Create literal reference/candidate snapshots that exercise every strict property:

```js
const reference = [{
    scenario: "builder-populated",
    target: "equipment headers",
    theme: "glass-blue",
    viewport: "desktop",
    text: "Slot Lock Name Str",
    icons: ["fa-lock", "fa-search"],
    childOrder: ["Slot", "Lock", "Name", "Str"],
    visible: true,
    wrapping: {lineCount: 1, scrollWidth: 420, clientWidth: 420},
    styles: {textAlign: "center", whiteSpace: "nowrap"},
    rect: {x: 10, y: 20, width: 420, height: 32}
}];
```

Assert separate findings for missing target, normalized visible text, icon identity, child order, visibility, wrapping line count, computed style, and geometry beyond one pixel. Assert `0.75px` geometry drift is ignored. Assert the same property mismatch across two themes consolidates into one finding with two sorted occurrences.

- [ ] **Step 2: Run the focused tests and capture RED**

Run:

```bash
cd www
node --test test/visual-parity-structure.test.js test/ui-parity-audit.test.js
```

Expected: FAIL because the structural module is absent and the legacy audit only compares style/rect values.

- [ ] **Step 3: Implement DOM capture and pure comparison**

Capture these values for each first-matching visible target:

```js
{
    text: element.innerText.replace(/\s+/g, " ").trim(),
    icons: Array.from(element.querySelectorAll("i[class], svg[data-icon]"), iconIdentity),
    childOrder: Array.from(element.children, childIdentity),
    visible: Boolean(element.getClientRects().length) && style.visibility !== "hidden",
    wrapping: {
        lineCount: Math.max(1, Math.round(element.getBoundingClientRect().height /
            parseFloat(style.lineHeight))),
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth
    },
    styles: Object.fromEntries(STYLE_PROPERTIES.map(name => [name, style[name]])),
    rect: {x: rect.x, y: rect.y, width: rect.width, height: rect.height}
}
```

Use explicit target flags to select which text/icon/order/wrapping properties are strict. Never silently omit a missing selector: emit a `property: "target"` finding.

- [ ] **Step 4: Preserve the existing computed-style CLI through delegation**

Replace the duplicated comparison in `audit-ui-parity.js` with imports from `structure.js`. Keep its existing arguments, JSON shape, `--fail-on-diff` behavior, and exported `buildAuditResult`, `compareSnapshots`, and `parseArguments` compatibility so existing operator usage and tests do not break.

- [ ] **Step 5: Run GREEN and commit**

Run:

```bash
cd www
node --test test/visual-parity-structure.test.js test/ui-parity-audit.test.js
```

Expected: PASS, including all pre-existing UI parity assertions.

Commit:

```bash
git add www/scripts/visual-parity/structure.js \
  www/test/visual-parity-structure.test.js \
  www/scripts/audit-ui-parity.js www/test/ui-parity-audit.test.js
git commit -m "feat: compare visual parity structure"
```

---

### Task 3: Compare PNGs and Render the Report

**Files:**
- Create: `www/scripts/visual-parity/images.js`
- Create: `www/scripts/visual-parity/report.js`
- Create: `www/test/visual-parity-images.test.js`
- Create: `www/test/visual-parity-report.test.js`
- Create: `www/test/fixtures/visual-parity/reference.png`
- Create: `www/test/fixtures/visual-parity/candidate.png`
- Create: `www/test/fixtures/visual-parity/different-size.png`
- Modify: `www/package.json`
- Modify: `www/package-lock.json`

**Interfaces:**
- Consumes: reference/candidate PNG buffers and consolidated structural findings from Task 2.
- Produces: `comparePngBuffers(reference, candidate, options)` returning `{width, height, diffPixels, diffRatio, dimensionMismatch, diffPng}`.
- Produces: `writeParityReport({outputDir, metadata, results})` writing `findings.json` and `index.html` and returning their paths.

- [ ] **Step 1: Add exact image dependencies**

Run from `www`:

```bash
npm install --save-dev --save-exact pixelmatch@7.2.0 pngjs@7.0.0
```

Expected: only `www/package.json` and `www/package-lock.json` change; `pixelmatch` is loaded with dynamic `import()` from CommonJS.

- [ ] **Step 2: Create literal PNG fixtures and failing image tests**

Generate the committed fixtures with this one-time Node command: reference has sixteen white pixels, candidate has one red pixel and fifteen white pixels, and different-size is `5x4`.

```bash
node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const {PNG} = require("pngjs");
const root = path.join("test", "fixtures", "visual-parity");
fs.mkdirSync(root, {recursive: true});
function write(name, width, height, changedPixel) {
    const png = new PNG({width, height});
    png.data.fill(255);
    if (changedPixel) {
        png.data[0] = 255;
        png.data[1] = 0;
        png.data[2] = 0;
        png.data[3] = 255;
    }
    fs.writeFileSync(path.join(root, name), PNG.sync.write(png));
}
write("reference.png", 4, 4, false);
write("candidate.png", 4, 4, true);
write("different-size.png", 5, 4, false);
NODE
```

Test:

```js
const result = await comparePngBuffers(reference, candidate, {threshold: 0.1});
assert.equal(result.diffPixels, 1);
assert.equal(result.diffRatio, 1 / 16);
assert.equal(result.dimensionMismatch, false);
assert.ok(PNG.sync.read(result.diffPng).data.some(channel => channel !== 255));

const mismatch = await comparePngBuffers(reference, differentSize);
assert.equal(mismatch.dimensionMismatch, true);
assert.equal(mismatch.diffPixels, 20);
```

Also prove identical images yield zero pixels and a valid diff PNG.

- [ ] **Step 3: Write failing report tests**

Use a temporary output directory and one repeated root finding. Assert:

```js
assert.equal(fs.existsSync(path.join(outputDir, "findings.json")), true);
assert.equal(fs.existsSync(path.join(outputDir, "index.html")), true);
assert.match(html, /0cab3ac95826a53de19b3146d277e7056495210f/);
assert.match(html, /reference\/builder-populated--glass-blue--desktop\.png/);
assert.match(html, /candidate\/builder-populated--glass-blue--desktop\.png/);
assert.match(html, /diff\/builder-populated--glass-blue--desktop\.png/);
assert.equal((html.match(/equipment headers/g) || []).length, 1);
assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
```

- [ ] **Step 4: Run both tests and capture RED**

Run:

```bash
cd www
node --test test/visual-parity-images.test.js test/visual-parity-report.test.js
```

Expected: FAIL because `images.js` and `report.js` do not exist.

- [ ] **Step 5: Implement strict dimensions, anti-alias tolerance, and safe HTML**

Use `PNG.sync.read/write` and `pixelmatch(reference.data, candidate.data, diff.data, width, height, {threshold: 0.1, includeAA: false})`. A dimension mismatch must create a full-canvas highlighted diff instead of cropping. Write images under `reference/`, `candidate/`, and `diff/`; structural JSON under `structure/`; and report files at the run root.

The report header must include exact SHAs, UTC time, mode, Playwright/Chromium version, operating system, viewport, and theme. Group findings by scenario and then root property. All text and attributes must pass one local `escapeHtml()` function; artifact links must be relative paths beneath `outputDir`.

- [ ] **Step 6: Run GREEN and commit**

Run:

```bash
cd www
node --test test/visual-parity-images.test.js test/visual-parity-report.test.js
```

Expected: PASS and no artifacts outside each test's temporary directory.

Commit:

```bash
git add www/package.json www/package-lock.json \
  www/scripts/visual-parity/images.js www/scripts/visual-parity/report.js \
  www/test/visual-parity-images.test.js www/test/visual-parity-report.test.js \
  www/test/fixtures/visual-parity
git commit -m "feat: report visual parity image differences"
```

---

### Task 4: Implement Deterministic Browser Capture

**Files:**
- Create: `www/scripts/visual-parity/capture.js`
- Create: `www/scripts/audit-visual-parity.js`
- Create: `www/test/visual-parity-capture.test.js`
- Modify: `www/package.json`

**Interfaces:**
- Consumes: Task 1 matrix, Task 2 structural capture, and Task 3 image/report functions.
- Produces: `runVisualParity(options)` returning `{exitCode, metadata, results, reportPaths}`, where harness errors always exit `2`, accepted differences exit `0`, and differences under `--fail-on-diff` exit `1`.
- Produces: `npm run parity:visual -- --reference-base-url=... --candidate-base-url=...`.

- [ ] **Step 1: Write a controlled two-server browser integration test**

Start two ephemeral `http.createServer` instances. Serve identical stable HTML except the reference target has `background:#fff` and candidate has `background:#f00`. Supply one literal scenario and run Chromium through `runVisualParity()`.

Assert the run creates both screenshots, a nonempty highlighted diff, both structural JSON files, one consolidated finding, and the HTML report. Run again with identical HTML and assert zero findings. Run the differing case with `failOnDiff: false` and `true` and assert exit codes `0` and `1` respectively.

- [ ] **Step 2: Run the integration test and capture RED**

Run:

```bash
cd www
node --test test/visual-parity-capture.test.js
```

Expected: FAIL because `capture.js` and the CLI do not exist.

- [ ] **Step 3: Implement one context per deployment and deterministic setup**

For every matrix entry, create separate reference and candidate contexts with the same viewport, device scale factor `1`, locale `en-US`, timezone `America/Chicago`, reduced motion, theme cookie, and cookie-consent cookie. Add the exact Builder state used by the existing browser regression:

```js
const BUILDER_LISTS = "6*Hero~Tank~1c0K0K0K0J0J1-10000___00H00N00T00000100.00s00o00o-BHKAA_00t00u00v00w_______00p00q01b________________*Hero~Caster~0U0m0U0U0U0U000000___0000000000000000000f__00g_______________________________*Scout~Original~0X0X0X0X0X0X000000___0000000000000000000f__________________________________*";
await page.addInitScript(({lists}) => {
    localStorage.setItem("cln", lists);
    localStorage.setItem("scl", "Hero!Tank");
}, {lists: BUILDER_LISTS});
```

For authenticated scenarios, log in independently on each stack with `ParityEditor` / `ParityPass!`, require a redirect away from `/login.html`, and retain only that deployment's storage/cookies in its context.

- [ ] **Step 4: Implement readiness, actions, stability, and capture**

For each side:

1. Navigate and require HTTP status below 400.
2. Wait for the side-specific readiness selector to be visible.
3. Execute only validated action types.
4. Await `document.fonts.ready` and zero in-flight same-origin requests for 250 ms.
5. Inject a capture-only stylesheet that disables animation, transition, caret, and smooth scrolling.
6. Wait for every mask and capture locator to settle at the same bounding box for two animation frames.
7. Capture the page/locator and structural targets.

Fulfill the exact pinned jQuery 3.7.1, Popper 1.14.7, and Bootstrap 4.3.1 CDN URLs from local `node_modules` using the established mapping in `accessibility/support/local-browser-scripts.js`. Allow the explicitly masked reCAPTCHA hosts and abort every other third-party request. Do not replace application-owned CSS, JavaScript, API calls, or HTML. A missing selector, failed action, HTTP error, browser console error, or application request failure must become a scenario error in the report rather than a silent skip and must exit `2` even in report-only mode.

- [ ] **Step 5: Wire CLI help and npm script**

Add:

```json
"parity:visual": "node scripts/audit-visual-parity.js"
```

The CLI must print only the report path, finding/error counts, and exit status summary. `--help` documents URL, mode, output, and failure options. It must always close contexts and Chromium in `finally`.

- [ ] **Step 6: Run GREEN and commit**

Run:

```bash
cd www
node --test test/visual-parity-config.test.js \
  test/visual-parity-structure.test.js \
  test/visual-parity-images.test.js \
  test/visual-parity-report.test.js \
  test/visual-parity-capture.test.js
```

Expected: PASS for both deliberate-difference and restored-parity browser cases.

Commit:

```bash
git add www/scripts/audit-visual-parity.js \
  www/scripts/visual-parity/capture.js \
  www/test/visual-parity-capture.test.js \
  www/package.json www/package-lock.json
git commit -m "feat: capture deterministic visual parity states"
```

---

### Task 5: Add the Deterministic Fixture and Compose Overlay

**Files:**
- Create: `scripts/fixtures/visual-parity.sql`
- Create: `docker-compose.parity.yaml`
- Create: `nginx/parity.conf`
- Create: `scripts/test/visual-parity-compose.test.js`

**Interfaces:**
- Consumes: `LEGENDHUB_PARITY_STATE_DIR`, `LEGENDHUB_PARITY_FIXTURE`, `LEGENDHUB_PARITY_NGINX_CONFIG`, and `LEGENDHUB_PARITY_HTTPS_PORT` supplied by Task 6.
- Produces: a production-built HTTPS stack initialized from `01-dunwich.sql.gz` then `02-visual-parity.sql`, with only `mysql`, `www`, and `nginx` started by the operator.
- Produces: stable entity ID `900001`, Smithing wiki ID `900002`, and local login `ParityEditor` / `ParityPass!` for Task 4 scenarios.

- [ ] **Step 1: Write failing rendered-Compose tests**

Render the overlay once with the current base file and once with `git show v2.9.0:docker-compose.yaml` copied to a temporary checkout fixture. For both, assert:

```js
assert.equal(config.services.mysql.image, "mysql:5.7.44");
assert.equal(config.services.www.ports, undefined);
assert.equal(config.services.www.volumes, undefined);
assert.equal(config.services.nginx.ports[0].published, "7443");
assert.equal(config.services.mysql.volumes.find(v => v.target.endsWith("01-dunwich.sql.gz")).read_only, true);
assert.equal(config.services.mysql.volumes.find(v => v.target.endsWith("02-visual-parity.sql")).read_only, true);
assert.equal(config.services.nginx.volumes.every(v => v.read_only), true);
assert.equal(config.services.www.environment.RECAPTCHA_SITEKEY,
    "6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI");
```

Also assert the reference and candidate rendered configs use distinct project names, ports, networks, and volume names; both point to the same absolute snapshot and fixture; neither contains `/tmp/`; and `docker-compose-prod.yaml` is absent from every command fixture.

- [ ] **Step 2: Run the Compose test and capture RED**

Run:

```bash
node --test scripts/test/visual-parity-compose.test.js
```

Expected: FAIL because the parity overlay, fixture, and Nginx config do not exist.

- [ ] **Step 3: Create the local-only SQL fixture**

Use explicit high IDs and only schema-compatible columns. The fixture must contain these deterministic records:

```sql
INSERT INTO Members (Id, Username, Password, Banned, ReCaptcha)
VALUES (900001, 'ParityEditor',
  '$2y$10$LgwWXz73HTNYbu9ONw/Kqe739jIzuV8XU4ef/Fc4mORGYLqWTBejK', 0, 0);
INSERT INTO MemberRoleMap (MemberId, RoleId) VALUES (900001, 2);
INSERT INTO NotificationSettings (Id, MemberId, ItemAdded, ItemUpdated,
  MobAdded, MobUpdated, QuestAdded, QuestUpdated, WikiPageAdded,
  WikiPageUpdated, ChangelogAdded)
VALUES (900001, 900001, 1, 1, 1, 1, 1, 1, 1, 1, 1);

INSERT INTO Items (Id, Name, Slot, Strength, Hit, Dam, Hp, Rent, Notes,
  ModifiedBy, ModifiedOn, AlignRestriction, IsLight, IsLimited)
VALUES (900001, 'Parity lantern', 0, 3, 2, 1, 10, 125,
  'First line\nSecond line', 'ParityEditor', '2026-01-02 03:04:05', 0, 1, 1);
INSERT INTO Mobs (Id, Name, Xp, AreaId, Gold, ModifiedOn, ModifiedBy, Notes, Aggro)
VALUES (900001, 'Parity sentry', 450, 1, 12, '2026-01-02 03:04:05',
  'ParityEditor', 'Mob notes\nSecond line', 0);
INSERT INTO Quests (Id, Title, AreaId, Content, ModifiedOn, ModifiedBy, Whoises, Stat)
VALUES (900001, 'Parity errand', 1, 'Quest line one\nQuest line two',
  '2026-01-02 03:04:05', 'ParityEditor', 'parity', 0);
INSERT INTO WikiPages (Id, Title, CategoryId, SubCategoryId, Tags, Content,
  ModifiedOn, ModifiedBy)
VALUES
  (900001, 'Parity wiki page', 1, 1, 'parity', 'Wiki line one\nWiki line two',
   '2026-01-02 03:04:05', 'ParityEditor'),
  (900002, 'Smithing 90+ parity', 1, 1, 'smithing parity',
   'You will use the following commands:\nrecipe smithing\nrecipe smithing [name]\nsmith [tool/component] [component]',
   '2026-01-02 03:04:05', 'ParityEditor');
```

Use these exact audit and notification inserts after the primary entities:

```sql
INSERT INTO Items_AuditTrail
  (Id, ItemId, Name, Slot, Strength, Hit, Dam, Hp, Rent, Notes,
   ModifiedBy, ModifiedOn, AlignRestriction, IsLight, IsLimited)
VALUES
  (900001, 900001, 'Parity lantern', 0, 3, 2, 1, 10, 125,
   'Earlier item notes', 'ParityEditor', '2026-01-01 03:04:05', 0, 1, 1);
INSERT INTO Mobs_AuditTrail
  (Id, MobId, Name, Xp, AreaId, Gold, ModifiedOn, ModifiedBy, Notes, Aggro)
VALUES
  (900001, 900001, 'Parity sentry', 400, 1, 10,
   '2026-01-01 03:04:05', 'ParityEditor', 'Earlier mob notes', 0);
INSERT INTO Quests_AuditTrail
  (Id, QuestId, Title, AreaId, Content, ModifiedOn, ModifiedBy, Whoises, Stat)
VALUES
  (900001, 900001, 'Parity errand', 1, 'Earlier quest text',
   '2026-01-01 03:04:05', 'ParityEditor', 'parity', 0);
INSERT INTO WikiPages_AuditTrail
  (Id, WikiPageId, Title, CategoryId, SubCategoryId, Tags, Content,
   ModifiedOn, ModifiedBy)
VALUES
  (900001, 900001, 'Parity wiki page', 1, 1, 'parity',
   'Earlier wiki text', '2026-01-01 03:04:05', 'ParityEditor'),
  (900002, 900002, 'Smithing 90+ parity', 1, 1, 'smithing parity',
   'Earlier smithing text', '2026-01-01 03:04:05', 'ParityEditor');
INSERT INTO NotificationChanges
  (Id, ActorId, ObjectId, ObjectType, ObjectPage, ObjectName, Verb, CreatedOn)
VALUES
  (900001, 900001, 900001, 'item', 'items', 'Parity lantern', 'updated',
   '2026-01-02 03:04:05');
INSERT INTO Notifications (Id, NotificationChangeId, MemberId, `Read`)
VALUES (900001, 900001, 900001, 0);
```

The SQL must not query or rewrite production records and must contain no token.

- [ ] **Step 4: Implement the overlay and Nginx proxy**

In `docker-compose.parity.yaml`:

- pin MySQL to `mysql:5.7.44`;
- override MySQL volumes with its named database/log volumes, checkout MySQL config read-only, the absolute snapshot at `/docker-entrypoint-initdb.d/01-dunwich.sql.gz`, and the absolute fixture at `/docker-entrypoint-initdb.d/02-visual-parity.sql`;
- reset all `www` ports and volumes so the Dockerfile produces the tested bundle;
- supply Google's published reCAPTCHA test keys;
- add Nginx `1.27-alpine` bound to `127.0.0.1:${LEGENDHUB_PARITY_HTTPS_PORT}:443` with the config/cert/key all read-only.

Use the same proxy headers as `nginx/local.conf`. Do not add bind mounts for application source.

- [ ] **Step 5: Run GREEN and commit**

Run:

```bash
node --test scripts/test/visual-parity-compose.test.js
LEGENDHUB_PARITY_STATE_DIR="$PWD/data/local-stack" \
LEGENDHUB_PARITY_FIXTURE="$PWD/scripts/fixtures/visual-parity.sql" \
LEGENDHUB_PARITY_NGINX_CONFIG="$PWD/nginx/parity.conf" \
LEGENDHUB_PARITY_HTTPS_PORT=7444 \
docker compose --project-name legendhub-parity-candidate \
  --env-file data/local-stack/local.env \
  -f docker-compose.yaml -f docker-compose.parity.yaml config --quiet
```

Expected: PASS without starting or changing any container.

Commit:

```bash
git add scripts/fixtures/visual-parity.sql docker-compose.parity.yaml \
  nginx/parity.conf scripts/test/visual-parity-compose.test.js
git commit -m "feat: define isolated visual parity stacks"
```

---

### Task 6: Build the Safe Dual-Stack Operator

**Files:**
- Create: `scripts/run-visual-parity.sh`
- Create: `scripts/test/visual-parity-operator.test.js`

**Interfaces:**
- Consumes: Task 5 overlay and Task 4 `npm run parity:visual` command.
- Produces: `./scripts/run-visual-parity.sh [--mode smoke|full] [--keep] [--fail-on-diff]`.
- Produces: exact reference and candidate URLs and SHAs passed to the capture CLI.

- [ ] **Step 1: Write a fake-Git/fake-Docker/fake-npm operator test**

Follow the null-delimited command-log pattern in `scripts/test/deploy-test.test.js`. Prove the operator:

- requires nonempty local env, snapshot, certificate, and key before Git/Docker;
- resolves `v2.9.0^{commit}` and rejects anything except the fixed 40-character SHA;
- creates/reuses `.worktrees/parity-v2.9.0` detached at that SHA;
- rejects a dirty reference worktree;
- rejects occupied ports `7443` or `7444` before Compose startup;
- rejects retained/stale containers, networks, or volumes bearing either parity project label and prints the exact safe cleanup command;
- renders and starts exactly `mysql www nginx` for each exact project name;
- invokes the visual CLI only after both `/` readiness probes succeed;
- passes full SHAs, distinct HTTPS URLs, selected mode, report directory, and optional failure mode;
- on success, startup failure, capture failure, and TERM/INT, runs `down --volumes --remove-orphans` for only the two exact parity projects;
- with `--keep`, preserves only those two projects and prints the exact follow-up log/down commands;
- never executes a command containing `legendhub-local` or `docker-compose-prod.yaml`;
- never includes values from the environment file in stdout/stderr.

- [ ] **Step 2: Run the operator test and capture RED**

Run:

```bash
node --test scripts/test/visual-parity-operator.test.js
```

Expected: FAIL because `scripts/run-visual-parity.sh` does not exist.

- [ ] **Step 3: Implement strict argument and state validation**

Use `set -euo pipefail`, a fixed project-name allowlist, and a cleanup trap. Resolve paths without repurposing `HOME` or `CODEX_HOME`. The reference worktree path is derived from the common Git directory's parent, not from the current worktree's nesting.

Validate project names with exact string equality immediately before every destructive Compose call:

```bash
case "$project_name" in
  legendhub-parity-reference|legendhub-parity-candidate) ;;
  *) printf 'visual-parity: refusing unsafe project name\n' >&2; exit 1 ;;
esac
```

Never remove the reference worktree automatically. A modified cached reference is an actionable failure, not something to reset.
Likewise, never silently reuse a retained parity database: fail preflight if either exact project already owns containers, networks, or volumes so both databases always begin empty.

- [ ] **Step 4: Implement two isolated Compose lifecycles**

For each checkout, pass its own base Compose as the first `-f` file and the candidate's absolute parity overlay as the second. Export absolute snapshot, fixture, Nginx, cert, and key paths. Use `--project-directory` for the checkout, exact `--project-name`, and explicit service arguments:

```bash
docker compose ... up --build -d mysql www nginx
```

Poll `https://localhost:7443/` and `https://localhost:7444/` without `-k`; the trusted mkcert certificate must validate. On readiness timeout, print only project/service status and bounded logs, never environment content.

- [ ] **Step 5: Invoke capture and guarantee cleanup**

Create `data/parity-report/<UTC timestamp>-<candidate short SHA>/`, then invoke:

```bash
npm --prefix "$candidate_root/www" run parity:visual -- \
  --reference-base-url=https://localhost:7443 \
  --candidate-base-url=https://localhost:7444 \
  --reference-sha="$reference_sha" \
  --candidate-sha="$candidate_sha" \
  --mode="$mode" \
  --output-dir="$report_dir"
```

Append `--fail-on-diff` only when requested. Preserve the capture exit status after cleanup. Default cleanup removes the two projects' containers, networks, and volumes. `--keep` prints exact `docker compose ... logs` and `down --volumes --remove-orphans` commands without executing them.

- [ ] **Step 6: Run GREEN, syntax check, and commit**

Run:

```bash
bash -n scripts/run-visual-parity.sh
node --test scripts/test/visual-parity-operator.test.js \
  scripts/test/visual-parity-compose.test.js
```

Expected: PASS for success, all failure cleanup paths, interruption, and `--keep`.

Commit:

```bash
git add scripts/run-visual-parity.sh scripts/test/visual-parity-operator.test.js
git commit -m "feat: orchestrate disposable visual parity stacks"
```

---

### Task 7: Exercise the Real Smoke Matrix and Document Operations

**Files:**
- Modify: `www/scripts/visual-parity/scenarios.js`
- Modify: `www/test/visual-parity-config.test.js`
- Modify: `DEVELOPMENT.md`

**Interfaces:**
- Consumes: the complete one-command harness from Tasks 1-6.
- Produces: a reviewed real `smoke` report and operator documentation for `smoke`, `full`, `--keep`, report triage, live-production arbitration, and later `--fail-on-diff` use.

- [ ] **Step 1: Commit the implementation before the reproducible run**

Run:

```bash
git status --short
git log -1 --format='%H %s'
```

Expected: no uncommitted tracked changes, so the report's candidate SHA identifies exactly what Docker builds.

- [ ] **Step 2: Run the real smoke comparison and inspect every failure**

Run:

```bash
./scripts/run-visual-parity.sh --mode smoke
```

Expected: both stacks initialize independently from the same snapshot and fixture; all scenarios generate reference, candidate, diff, structural JSON, and HTML entries; stacks and volumes are removed afterward. Visual differences are expected and must remain report findings, not harness failures.

For each scenario error, distinguish a bad selector/readiness/action from a genuine missing UI. Fix only harness selectors or deterministic setup in this task. Do not make React parity fixes as part of harness implementation.

- [ ] **Step 3: Mutate one controlled selector to prove a real missing target is detected**

Temporarily change one candidate selector in `scenarios.js` to `[data-parity-deliberately-missing]`, rerun `./scripts/run-visual-parity.sh --mode smoke`, and confirm the report contains `property: "target", candidate: "missing"`. Restore the selector and rerun smoke to return to the genuine report. Do not commit the mutation.

- [ ] **Step 4: Run the real full theme matrix**

Run:

```bash
./scripts/run-visual-parity.sh --mode full
```

Expected: all nine named themes run at both viewports for every scenario, the report metadata records `mode: full`, and every scenario/theme/viewport cell has reference, candidate, diff, and structural artifacts or an explicit scenario error. Inspect the matrix summary for missing cells before accepting the run.

- [ ] **Step 5: Document exact operator workflow**

Add a `Local Angular-to-React visual parity` section to `DEVELOPMENT.md` with:

```bash
# fast Glass Blue matrix, automatic cleanup
./scripts/run-visual-parity.sh --mode smoke

# all nine themes at desktop and mobile
./scripts/run-visual-parity.sh --mode full

# retain both disposable stacks for manual inspection
./scripts/run-visual-parity.sh --mode smoke --keep

# release-gate behavior after the accepted report is clean
./scripts/run-visual-parity.sh --mode full --fail-on-diff
```

Document report location, 7443/7444 URLs, exact cleanup behavior, `legendhub.org` arbitration, the narrow mask policy, and the rule that `--fail-on-diff` is not enabled until accepted findings reach zero.

- [ ] **Step 6: Run focused and repository-wide verification**

Run from the repository root:

```bash
node --test scripts/test/visual-parity-compose.test.js \
  scripts/test/visual-parity-operator.test.js
node --test scripts/test/*.test.js
bash -n scripts/run-visual-parity.sh

cd www
npm test
npm run test:a11y
npm audit --audit-level=critical

cd ../css
npm test

cd ..
node scripts/verify-release-version.js
git diff --check
git status --short
```

Expected: all new focused tests pass; all existing Node and Playwright tests pass apart from the one documented expected skip; critical audit is clean; CSS lint passes; release verification prints `3.0.0`; `git diff --check` is silent. If the known macOS Bash `mapfile` incompatibility still affects unrelated content-sync source-gateway cases, record its exact test names and confirm the parity-focused script tests are green rather than altering unrelated deployment tooling.

- [ ] **Step 7: Review generated and sensitive state boundaries**

Confirm:

```bash
git status --short --ignored data/parity-report data/local-stack
git diff --name-only master...HEAD
git diff --unified=0 master...HEAD | \
  rg -n '^\+.*(ghp_|github_pat_|MYSQL_PASSWORD=[^$<{]|GITHUB_TOKEN=[^$<{]|RECAPTCHA_SECRET=[^$<{])' || true
```

Expected: reports/local state are ignored; no report PNG/JSON/HTML is tracked; the diff scan prints no possible production secret; `docker-compose-prod.yaml` is untouched; no publish, deploy, tag, or remote command exists in the implementation diff.

- [ ] **Step 8: Commit documentation and final selector stabilization**

```bash
git add DEVELOPMENT.md www/scripts/visual-parity/scenarios.js \
  www/test/visual-parity-config.test.js
git commit -m "docs: document visual parity workflow"
```

Run `git status --short` again. Expected: clean worktree. Stop for review; do not push or deploy.
