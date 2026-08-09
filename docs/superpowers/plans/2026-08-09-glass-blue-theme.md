# Glass Blue Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a complete Glass Blue interface theme, make it the no-preference default, and preserve every existing user's saved theme.

**Architecture:** Build Glass Blue as a fourth standalone Bootstrap stylesheet with a pre-Bootstrap variable partial and a post-Bootstrap chrome partial. The server selects it only when no theme cookie exists; the existing AngularJS theme switcher continues to swap and persist the other standalone stylesheets without layout or route changes.

**Tech Stack:** Bootstrap 4.1.3 SCSS, Dart Sass, PostCSS/Autoprefixer, Lightning CSS, Express 5, EJS 6, AngularJS, Node.js built-in test runner.

## Global Constraints

- Treat `/Users/toddmckimmey/projects/lmproxy` as read-only reference material.
- Preserve Light, Dark, and Solarized Dark byte-for-byte unless the CSS toolchain mechanically regenerates equivalent tracked artifacts.
- Make Glass Blue the default only when the request has no saved theme cookie.
- Keep existing page structure, responsive breakpoints, routes, data, and application behavior unchanged.
- Apply Glass Blue to all shared interface chrome while keeping success, warning, danger, and info semantically recognizable.
- Keep the application version and public changelog section at `2.6.1-beta`.
- Do not touch root `docker-compose-prod.yaml` or any other user-owned untracked file.
- Do not stage the pre-existing trailing-space edit in `docs/superpowers/specs/2026-08-07-builder-capped-roll-stats-design.md`.
- Do not publish, deploy, tag, push, or modify any release tag without separate authorization.
- Use `apply_patch` for repository edits and explicit pathspecs for every Git staging command.

---

## File Structure

- Create `css/scss/bootstrap-glass-blue.scss`: fourth Bootstrap build entrypoint.
- Create `css/scss/custom/themes/_glass-blue-theme.scss`: palette, typography, border, radius, form, and Bootstrap component variables.
- Create `css/scss/custom/themes/_glass-blue-chrome.scss`: Glass-only gradients, shadows, wells, focus states, and shared component selectors.
- Create `www/test/glass-blue-theme.test.js`: source, build-pipeline, generated-artifact, and material-contract regression tests.
- Modify `css/package.json`: minify the fourth compiled stylesheet.
- Modify `www/src/views/shared/meta.ejs`: make Glass Blue the no-cookie stylesheet and align browser theme color.
- Modify `www/src/public/js/apps/legendwiki-app.js`: expose Glass Blue in the existing theme chooser.
- Modify `www/src/public/site.webmanifest`: align installable-app colors with Glass Blue.
- Modify `www/test/characterization.test.js`: cover default selection, saved preferences, menu choices, and metadata.
- Modify `www/test/smoke.test.js`: require the copied Glass Blue source map over HTTP in development.
- Modify `www/test/changelog.test.js` and root `CHANGELOG.md`: record the public-facing theme change.
- Generate `css/dist/css/bootstrap-glass-blue.css`, its source map, its minified output, and its minified source map.
- Generate `www/src/public/css/bootstrap-glass-blue.min.css` and its source map.

### Task 1: Theme selection and metadata contract

**Files:**
- Modify: `www/test/characterization.test.js`
- Modify: `www/src/views/shared/meta.ejs`
- Modify: `www/src/public/js/apps/legendwiki-app.js:449-480`
- Modify: `www/src/public/site.webmanifest`

**Interfaces:**
- Consumes: the existing `cookies.theme` values `light`, `dark`, and `solarized-dark`; the existing `setTheme(theme)` slug conversion.
- Produces: the new `glass-blue` stylesheet slug, an exact four-item theme menu, and Glass Blue metadata defaults used by Task 2's generated asset.

- [ ] **Step 1: Add failing rendering and chooser tests**

Update `www/test/characterization.test.js` to import `node:fs`, centralize home rendering, and add the theme contract:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

async function renderHome(cookies = {}) {
    const ejs = require("ejs");
    return ejs.renderFile(path.join(__dirname, "../src/views/index.ejs"), {
        cookies,
        showDiscordWidget: false,
        title: "Home",
        url: {path: "/"},
        user: null,
        version: "test"
    });
}
```

Change the existing home-rendering test to call `renderHome()`, then add:

```js
test("Glass Blue is the default while saved themes remain unchanged", async function() {
    const defaultHtml = await renderHome();
    assert.match(defaultHtml,
        /href="\/css\/bootstrap-glass-blue\.min\.css\?v=test"/);
    assert.match(defaultHtml,
        /<meta property="theme-color" content="#0d1f30" \/>/);

    for (const theme of ["light", "dark", "solarized-dark"]) {
        const html = await renderHome({theme});
        assert.match(html, new RegExp(
            `href="/css/bootstrap-${theme}\\.min\\.css\\?v=test"`));
        assert.doesNotMatch(html, /bootstrap-glass-blue\.min\.css/);
    }
});

test("theme chooser exposes Glass Blue and preserves the existing choices", function() {
    const source = fs.readFileSync(path.join(
        __dirname, "../src/public/js/apps/legendwiki-app.js"), "utf8");
    assert.match(source,
        /\$scope\.themes = \['Glass Blue', 'Light', 'Dark', 'Solarized Dark'\]/);
    assert.match(source, /toLowerCase\(\)\.replace\(\/\\s\/g, '-'\)/);
});

test("installable app metadata uses the Glass Blue browser colors", function() {
    const manifest = JSON.parse(fs.readFileSync(path.join(
        __dirname, "../src/public/site.webmanifest"), "utf8"));
    assert.equal(manifest.theme_color, "#0d1f30");
    assert.equal(manifest.background_color, "#05070b");
});
```

- [ ] **Step 2: Run the focused test and verify the new contract fails**

Run:

```bash
node --test www/test/characterization.test.js
```

Expected: FAIL because the default link is `bootstrap-dark.min.css`, Glass Blue is absent from `$scope.themes`, and the metadata still uses the old colors.

- [ ] **Step 3: Implement the minimal selection and metadata changes**

In `www/src/views/shared/meta.ejs`, change the theme-color metadata and only the no-cookie fallback:

```ejs
<meta property="theme-color" content="#0d1f30" />

<%if (locals.cookies && locals.cookies.theme) {%>
<link id="theme" rel="stylesheet" href="/css/bootstrap-<%-locals.cookies.theme%>.min.css?v=<%-locals.version%>">
<%}else{%>
<link id="theme" rel="stylesheet" href="/css/bootstrap-glass-blue.min.css?v=<%-locals.version%>">
<%}%>
```

In `HeaderController.initialize`, use the exact menu order:

```js
$scope.themes = ['Glass Blue', 'Light', 'Dark', 'Solarized Dark'];
```

Do not alter `setTheme`; its existing lowercase-and-hyphen conversion already maps `Glass Blue` to `glass-blue` and continues to persist only after cookie consent.

Replace `www/src/public/site.webmanifest` with the same manifest data and these colors:

```json
{"name":"LegendHUB","short_name":"LegendHUB","icons":[{"src":"/android-chrome-192x192.png","sizes":"192x192","type":"image/png"},{"src":"/android-chrome-512x512.png","sizes":"512x512","type":"image/png"}],"theme_color":"#0d1f30","background_color":"#05070b","display":"standalone"}
```

- [ ] **Step 4: Run focused and complete web tests**

Run:

```bash
node --test www/test/characterization.test.js
npm test --prefix www
```

Expected: the focused test passes; the complete suite reports zero failures and retains the expected migration-integration skip.

- [ ] **Step 5: Commit the theme-selection contract**

Run:

```bash
git add -- \
  www/test/characterization.test.js \
  www/src/views/shared/meta.ejs \
  www/src/public/js/apps/legendwiki-app.js \
  www/src/public/site.webmanifest
git diff --cached --check
git commit -m "Add Glass Blue theme preference"
```

Expected: one commit containing only the four listed files.

### Task 2: Standalone Glass Blue build and complete component chrome

**Files:**
- Create: `www/test/glass-blue-theme.test.js`
- Create: `css/scss/bootstrap-glass-blue.scss`
- Create: `css/scss/custom/themes/_glass-blue-theme.scss`
- Create: `css/scss/custom/themes/_glass-blue-chrome.scss`
- Modify: `css/package.json`
- Modify: `www/test/smoke.test.js:84-92`
- Generate: `css/dist/css/bootstrap-glass-blue.css`
- Generate: `css/dist/css/bootstrap-glass-blue.css.map`
- Generate: `css/dist/css/bootstrap-glass-blue.min.css`
- Generate: `css/dist/css/bootstrap-glass-blue.min.css.map`
- Generate: `www/src/public/css/bootstrap-glass-blue.min.css`
- Generate: `www/src/public/css/bootstrap-glass-blue.min.css.map`

**Interfaces:**
- Consumes: Task 1's `glass-blue` slug; the existing Bootstrap import tree and shared `custom/_custom.scss`; the Glass Blue material values documented in the approved spec.
- Produces: `/css/bootstrap-glass-blue.min.css` plus source map, with a stable custom-property contract and selectors covering every shared Bootstrap interface surface.

- [ ] **Step 1: Write failing source and artifact tests**

Create `www/test/glass-blue-theme.test.js`:

```js
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const sourceRoot = path.join(root, "css/scss");
const distRoot = path.join(root, "css/dist/css");
const publicRoot = path.join(root, "www/src/public/css");

test("Glass Blue has a standalone source and minification pipeline", function() {
    const entry = fs.readFileSync(path.join(
        sourceRoot, "bootstrap-glass-blue.scss"), "utf8");
    const packageJson = JSON.parse(fs.readFileSync(path.join(
        root, "css/package.json"), "utf8"));

    assert.match(entry, /custom\/themes\/glass-blue-theme/);
    assert.match(entry, /custom\/themes\/glass-blue-chrome/);
    assert.match(packageJson.scripts["build:minify"],
        /bootstrap-glass-blue\.min\.css/);
});

test("Glass Blue source defines its material contract and component coverage", function() {
    const variables = fs.readFileSync(path.join(
        sourceRoot, "custom/themes/_glass-blue-theme.scss"), "utf8");
    const chrome = fs.readFileSync(path.join(
        sourceRoot, "custom/themes/_glass-blue-chrome.scss"), "utf8");

    assert.match(variables, /\$glass-line: #3a6a99/);
    assert.match(variables, /\$body-bg: #05070b/);
    assert.match(variables, /Palatino/);
    assert.match(chrome, /--glass-header-gradient:/);

    for (const selector of [
        ".navbar", ".breadcrumbNav", ".card", ".btn", ".form-control",
        ".table", ".dropdown-menu", ".pagination", ".alert",
        ".modal-content", ".popover", ".tooltip-inner",
        ".categoryListContainer"
    ])
        assert.ok(chrome.includes(selector), `missing Glass selector ${selector}`);
});

test("Glass Blue build artifacts are complete and copied to the web app", function() {
    const artifacts = [
        path.join(distRoot, "bootstrap-glass-blue.css"),
        path.join(distRoot, "bootstrap-glass-blue.css.map"),
        path.join(distRoot, "bootstrap-glass-blue.min.css"),
        path.join(distRoot, "bootstrap-glass-blue.min.css.map"),
        path.join(publicRoot, "bootstrap-glass-blue.min.css"),
        path.join(publicRoot, "bootstrap-glass-blue.min.css.map")
    ];

    for (const artifact of artifacts) {
        assert.ok(fs.statSync(artifact).size > 0,
            `missing or empty artifact ${path.relative(root, artifact)}`);
    }

    assert.equal(
        fs.readFileSync(path.join(distRoot, "bootstrap-glass-blue.min.css"), "utf8"),
        fs.readFileSync(path.join(publicRoot, "bootstrap-glass-blue.min.css"), "utf8")
    );
});
```

In the development static-asset smoke test, add:

```js
const glassMapResponse = await fetch(
    `${baseUrl}/css/bootstrap-glass-blue.min.css.map`);
assert.equal(glassMapResponse.status, 200);
```

- [ ] **Step 2: Run the focused tests and verify missing Glass sources fail**

Run:

```bash
node --test www/test/glass-blue-theme.test.js
node --test www/test/smoke.test.js
```

Expected: FAIL with `ENOENT` for `bootstrap-glass-blue.scss` and HTTP 404 for the Glass source map.

- [ ] **Step 3: Create the pre-Bootstrap variable partial**

Create `css/scss/custom/themes/_glass-blue-theme.scss` with the standalone palette and component variables:

```scss
$white: #fff;
$gray-100: #eaf4ff;
$gray-200: #d7e5f2;
$gray-300: #adc3d8;
$gray-400: #829db7;
$gray-500: #607d99;
$gray-600: #46627e;
$gray-700: #18314a;
$gray-800: #0a1522;
$gray-900: #05070b;
$black: #000;

$blue: #4a8fdd;
$indigo: #6c71c4;
$purple: #8d63c7;
$pink: #d35b8c;
$red: #d84545;
$orange: #d98235;
$yellow: #d6ad32;
$green: #4fa85d;
$teal: #38a99b;
$cyan: #4aa9c8;

$glass-line: #3a6a99;
$glass-backdrop: #05070b;
$glass-surface: #060b12;
$glass-well: #02050a;
$glass-ink: #eaf4ff;

$primary: $blue;
$secondary: $gray-600;
$success: $green;
$info: $cyan;
$warning: $yellow;
$danger: $red;
$light: $gray-200;
$dark: $gray-800;

$body-bg: $glass-backdrop;
$body-color: $gray-200;
$link-color: #7fc4ff;
$link-hover-color: #aad8ff;
$text-muted: $gray-400;

$border-color: $glass-line;
$border-radius: .5rem;
$border-radius-lg: .625rem;
$border-radius-sm: .375rem;
$box-shadow: 0 0 .375rem rgba(70, 140, 220, .35);

$font-family-sans-serif: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
  "Helvetica Neue", Arial, sans-serif;
$headings-font-family: "Palatino Linotype", Palatino, Georgia, serif;
$headings-font-weight: 700;
$headings-color: $glass-ink;

$component-active-color: $glass-ink;
$component-active-bg: $primary;
$input-btn-focus-color: rgba(88, 170, 255, .35);
$input-btn-focus-box-shadow: 0 0 0 .2rem $input-btn-focus-color;

$table-color: $body-color;
$table-bg: transparent;
$table-accent-bg: rgba($blue, .08);
$table-hover-bg: rgba($blue, .14);
$table-border-color: rgba($glass-line, .7);
$table-dark-bg: $glass-well;
$table-dark-border-color: $glass-line;
$table-dark-color: $body-color;

$input-bg: $glass-well;
$input-disabled-bg: $gray-700;
$input-color: $glass-ink;
$input-border-color: $glass-line;
$input-focus-bg: #040b14;
$input-focus-color: $white;
$input-focus-border-color: #58aaff;
$input-placeholder-color: $gray-500;
$input-group-addon-bg: $gray-700;
$input-group-addon-color: $glass-ink;

$dropdown-bg: rgba(4, 9, 15, .98);
$dropdown-border-color: $glass-line;
$dropdown-link-color: $body-color;
$dropdown-link-hover-color: $white;
$dropdown-link-hover-bg: rgba($blue, .2);
$dropdown-divider-bg: rgba($glass-line, .65);

$pagination-bg: $gray-800;
$pagination-border-color: $glass-line;
$pagination-color: $glass-ink;
$pagination-hover-bg: $gray-700;
$pagination-hover-border-color: #58aaff;
$pagination-disabled-bg: $glass-well;
$pagination-disabled-color: $gray-500;
$pagination-disabled-border-color: $gray-600;

$jumbotron-bg: $glass-surface;
$card-border-color: $glass-line;
$card-bg: $glass-surface;
$card-cap-bg: $gray-700;
$list-group-bg: $glass-surface;
$list-group-border-color: rgba($glass-line, .7);
$list-group-hover-bg: $gray-800;
$list-group-action-color: $body-color;

$modal-content-bg: $glass-surface;
$modal-content-border-color: $glass-line;
$modal-header-border-color: $glass-line;
$modal-footer-border-color: $glass-line;
$popover-bg: $glass-surface;
$popover-border-color: $glass-line;
$popover-header-bg: $gray-700;
$tooltip-bg: $gray-200;
$tooltip-color: $glass-well;
$close-color: $glass-ink;
$close-text-shadow: 0 1px 0 $black;
$progress-bg: $glass-well;
$breadcrumb-bg: $gray-800;
```

- [ ] **Step 4: Create the post-Bootstrap chrome partial**

Create `css/scss/custom/themes/_glass-blue-chrome.scss` with the shared material selectors:

```scss
:root {
  --glass-line: #{$glass-line};
  --glass-glow: rgba(70, 140, 220, .35);
  --glass-wash: rgba(88, 170, 255, .14);
  --glass-well: #{$glass-well};
  --glass-header-gradient: linear-gradient(
    to bottom,
    #8fb8dd 0%,
    #4a7dab 8%,
    #2b5580 45%,
    #12293f 50%,
    #0d1f30 100%
  );
  --glass-button-gradient: linear-gradient(
    to bottom,
    rgba(150, 190, 230, .35) 0%,
    rgba(70, 110, 160, .25) 45%,
    rgba(8, 20, 38, .55) 50%,
    rgba(3, 10, 22, .65) 100%
  );
}

body {
  background-color: $glass-backdrop;
}

h1,
h2,
h3,
h4,
h5,
h6,
.navbar-brand,
.card-header,
.modal-title,
.popover-header {
  font-family: $headings-font-family;
  font-weight: 700;
  letter-spacing: .025em;
}

.navbar,
.card-header,
.modal-header,
.popover-header,
.categoryListContainer h2,
.table thead th {
  color: $glass-ink;
  text-shadow: 0 1px 2px rgba($black, .7);
  background-color: #0d1f30;
  background-image: var(--glass-header-gradient);
  border-color: $glass-line;
  box-shadow:
    inset 0 1px 0 rgba($white, .4),
    inset 0 -1px 0 rgba($black, .6),
    0 1px 3px rgba($black, .6);
}

.navbar.bg-dark {
  background-color: #0d1f30 !important;
}

.breadcrumbNav,
.card,
.jumbotron,
.dropdown-menu,
.modal-content,
.popover,
.list-group,
.categoryListContainer {
  background-color: $glass-surface;
  border-color: $glass-line;
  box-shadow: 0 0 6px var(--glass-glow);
}

.card-body,
.modal-body,
.popover-body,
.list-group-item {
  background-color: $glass-surface;
}

.card-footer,
.modal-footer,
.dropdown-divider,
.list-group-item {
  border-color: rgba($glass-line, .7);
}

.btn {
  background-image: var(--glass-button-gradient);
  border-color: rgba(143, 184, 221, .8);
  box-shadow: inset 0 1px 0 rgba($white, .25);
  text-shadow: 0 1px 2px rgba($black, .7);
}

.btn:hover {
  filter: brightness(1.14);
  box-shadow:
    inset 0 1px 0 rgba($white, .3),
    0 0 6px rgba(70, 140, 220, .45);
}

.btn:not(:disabled):not(.disabled):active,
.btn:not(:disabled):not(.disabled).active {
  filter: brightness(.9);
  box-shadow: inset 0 2px 4px rgba($black, .65);
}

.form-control,
.custom-select,
.custom-file-label,
.input-group-text {
  color: $glass-ink;
  background-color: $glass-well;
  border-color: $glass-line;
  box-shadow:
    inset 0 1px 3px rgba($black, .8),
    0 1px 0 rgba($white, .05);
}

.form-control:focus,
.custom-select:focus,
.custom-file-input:focus ~ .custom-file-label,
.btn:focus,
.btn.focus,
.page-link:focus {
  border-color: #58aaff;
  outline: 0;
  box-shadow: 0 0 0 .2rem rgba(88, 170, 255, .35);
}

.table {
  color: $body-color;
  border-color: rgba($glass-line, .7);
}

.table th,
.table td {
  border-color: rgba($glass-line, .7);
}

.table-hover tbody tr:hover,
.dropdown-item:hover,
.dropdown-item:focus,
.list-group-item-action:hover,
.list-group-item-action:focus {
  color: $white;
  background-color: var(--glass-wash);
}

.pagination,
.alert,
.progress,
.badge {
  border-color: $glass-line;
  box-shadow: inset 0 1px 0 rgba($white, .12);
}

.progress {
  background-color: $glass-well;
  box-shadow: inset 0 1px 3px rgba($black, .8);
}

.modal-content,
.popover,
.tooltip-inner {
  border: 1px solid $glass-line;
  border-radius: $border-radius-lg;
}

.tooltip-inner {
  color: $glass-ink;
  background-color: $glass-well;
  box-shadow: 0 0 6px var(--glass-glow);
}

.cookie-consent-banner {
  background-color: rgba(2, 5, 10, .98);
  border-top: 1px solid $glass-line;
  box-shadow: 0 -2px 8px var(--glass-glow);
}

@media (max-width: 767px) {
  .categoryListContainer {
    background-color: $glass-surface;
    border-right-color: $glass-line;
  }

  .categoryListClose {
    color: $glass-ink;
    text-shadow: 0 0 6px rgba(70, 140, 220, .7);
  }
}
```

Keep semantic Bootstrap background colors underneath the translucent button
gradient; do not replace success, warning, danger, or info with blue.

- [ ] **Step 5: Add the standalone entrypoint and minifier command**

Create `css/scss/bootstrap-glass-blue.scss` with the same explicit Bootstrap
module list as the existing entrypoints, wrapped by these theme imports:

```scss
@import "custom/themes/glass-blue-theme";

@import "bootstrap/functions";
@import "bootstrap/variables";
@import "bootstrap/mixins";
@import "bootstrap/root";
@import "bootstrap/reboot";
@import "bootstrap/type";
@import "bootstrap/images";
@import "bootstrap/code";
@import "bootstrap/grid";
@import "bootstrap/tables";
@import "bootstrap/forms";
@import "bootstrap/buttons";
@import "bootstrap/transitions";
@import "bootstrap/dropdown";
@import "bootstrap/button-group";
@import "bootstrap/input-group";
@import "bootstrap/custom-forms";
@import "bootstrap/nav";
@import "bootstrap/navbar";
@import "bootstrap/card";
@import "bootstrap/breadcrumb";
@import "bootstrap/pagination";
@import "bootstrap/badge";
@import "bootstrap/jumbotron";
@import "bootstrap/alert";
@import "bootstrap/progress";
@import "bootstrap/media";
@import "bootstrap/list-group";
@import "bootstrap/close";
@import "bootstrap/toasts";
@import "bootstrap/modal";
@import "bootstrap/tooltip";
@import "bootstrap/popover";
@import "bootstrap/carousel";
@import "bootstrap/spinners";
@import "bootstrap/utilities";
@import "bootstrap/print";

@import "custom/custom";
@import "custom/themes/glass-blue-chrome";
```

Append this exact command to `css/package.json`'s `build:minify` chain:

```text
&& lightningcss --minify --sourcemap --output-file dist/css/bootstrap-glass-blue.min.css dist/css/bootstrap-glass-blue.css
```

- [ ] **Step 6: Build all themes and inspect unintended regeneration**

Run:

```bash
npm run build --prefix css
git status --short -- \
  css/dist/css \
  www/src/public/css
```

Expected: the build exits 0 and creates the six Glass Blue artifacts. If an
existing Light, Dark, or Solarized Dark artifact changes, inspect the diff and
retain it only when it is a deterministic toolchain regeneration caused by
this build; do not manually retheme an existing stylesheet.

- [ ] **Step 7: Run focused CSS, artifact, and HTTP tests**

Run:

```bash
npm test --prefix css
node --test www/test/glass-blue-theme.test.js
node --test www/test/smoke.test.js
```

Expected: CSS lint passes, all Glass source/artifact tests pass, and the HTTP
smoke suite serves the Glass source map in development while continuing to
block source maps in production.

- [ ] **Step 8: Commit the standalone theme**

Run:

```bash
git add -- \
  css/package.json \
  css/scss/bootstrap-glass-blue.scss \
  css/scss/custom/themes/_glass-blue-theme.scss \
  css/scss/custom/themes/_glass-blue-chrome.scss \
  css/dist/css/bootstrap-glass-blue.css \
  css/dist/css/bootstrap-glass-blue.css.map \
  css/dist/css/bootstrap-glass-blue.min.css \
  css/dist/css/bootstrap-glass-blue.min.css.map \
  www/src/public/css/bootstrap-glass-blue.min.css \
  www/src/public/css/bootstrap-glass-blue.min.css.map \
  www/test/glass-blue-theme.test.js \
  www/test/smoke.test.js
git diff --cached --check
git commit -m "Add Glass Blue interface theme"
```

Expected: one commit containing the theme source, its generated artifacts, the
build enumeration, and its regression tests only.

### Task 3: Public release record and end-to-end visual verification

**Files:**
- Modify: `www/test/changelog.test.js`
- Modify: `CHANGELOG.md`
- Verify: every file committed in Tasks 1 and 2

**Interfaces:**
- Consumes: Task 1's default/menu behavior and Task 2's served stylesheet.
- Produces: a public `2.6.1-beta` release note and final evidence that the complete feature is usable on desktop and mobile without altering existing themes.

- [ ] **Step 1: Write the failing changelog assertion**

Add this test beside the existing tracked-changelog test in
`www/test/changelog.test.js`:

```js
test("tracked changelog records the Glass Blue default theme", () => {
    const tracked = fs.readFileSync(path.join(__dirname, "../../CHANGELOG.md"), "utf8");

    assert.match(tracked, /Added the Glass Blue theme/);
    assert.match(tracked, /default for visitors without a saved preference/);
    assert.match(tracked, /Light, Dark, and Solarized Dark remain available/);
});
```

- [ ] **Step 2: Run the focused test and verify the release note is missing**

Run:

```bash
node --test www/test/changelog.test.js
```

Expected: FAIL because `CHANGELOG.md` does not yet mention Glass Blue.

- [ ] **Step 3: Add the public-facing changelog entry**

Under `## [2.6.1-beta] - 2026-08-07`, add an `### Added` section before
`### Changed` containing exactly:

```markdown
### Added

- Added the Glass Blue theme as the default for visitors without a saved preference; Light, Dark, and Solarized Dark remain available.
```

Do not change the application version or either immutable release tag.

- [ ] **Step 4: Run focused and complete automated verification**

Run:

```bash
node --test www/test/changelog.test.js
npm run build --prefix css
npm test --prefix css
npm test --prefix www
node --test scripts/test/*.test.js
git diff --check -- \
  CHANGELOG.md \
  css/package.json \
  css/scss/bootstrap-glass-blue.scss \
  css/scss/custom/themes/_glass-blue-theme.scss \
  css/scss/custom/themes/_glass-blue-chrome.scss \
  www/src/views/shared/meta.ejs \
  www/src/public/js/apps/legendwiki-app.js \
  www/src/public/site.webmanifest \
  www/test/characterization.test.js \
  www/test/glass-blue-theme.test.js \
  www/test/smoke.test.js \
  www/test/changelog.test.js
```

Expected: every command exits 0; the web suite retains only its expected skip;
the scoped whitespace check ignores the unrelated pre-existing spec edit.

- [ ] **Step 5: Start a local-only preview without deploying**

First inspect whether the development services are already running:

```bash
docker compose ps
```

If `mysql` and `www` are not already running, start only those local services:

```bash
docker compose up -d --build mysql www
docker compose ps mysql www
```

Use the local port shown by this command; it prints no secrets:

```bash
docker compose port www "$(awk -F= '$1 == "PORT" {print $2}' .env)"
```

Expected: the local HTTP endpoint returns 200. This is a workstation preview,
not a test or production deployment. Do not push images or use any remote
server.

- [ ] **Step 6: Perform desktop visual and interaction checks**

At a 1440-by-1000 viewport, compare the local site with
`/Users/toddmckimmey/Desktop/ss-look-and-feel.png` and verify:

- the navbar, card headers, modal headers, and table headings share the hard
  glossy midpoint seam;
- panels use steel-blue one-pixel edges, eight-pixel corners, dark wells, and a
  restrained glow without clipping;
- headings and chrome labels use the heavier serif face while body/form/table
  content remains sans-serif;
- buttons, inputs, dropdowns, pagination, alerts, badges, lists, and progress
  bars all read as the same material family;
- hover, active, disabled, validation, and keyboard-focus states remain
  distinguishable;
- success, warning, danger, and info remain recognizable by semantic hue.

Exercise `/`, `/builder/`, `/items/`, `/mobs/`, `/quests/`, `/wiki/`,
`/login.html`, `/feedback.html`, and `/changelog`. Open available dropdowns,
modals, table controls, and the theme menu. Capture a screenshot of the home
page and one dense data or builder page for review.

- [ ] **Step 7: Perform mobile and saved-preference checks**

At a 390-by-844 viewport, verify the navbar toggler, mobile category drawer,
cards, tables, forms, and overlays remain usable without horizontal clipping.

With cookie consent enabled, select Dark and reload; verify Dark remains Dark.
Repeat for Light and Solarized Dark. Clear only the theme preference and reload;
verify Glass Blue returns as the default. Do not clear unrelated cookies or
local data.

If Task 3 started local services that were not previously running, stop only
those two services after screenshots are complete:

```bash
docker compose stop www mysql
```

- [ ] **Step 8: Commit the public release record**

Run:

```bash
git add -- CHANGELOG.md www/test/changelog.test.js
git diff --cached --check
git commit -m "Document Glass Blue theme"
```

Expected: one final commit containing only the changelog and its regression
test. Do not push, tag, publish images, or deploy.

## Completion Gate

The feature is complete only when:

- Glass Blue is the fourth theme and the no-cookie default;
- Light, Dark, and Solarized Dark saved preferences remain unchanged;
- all Glass source and generated artifacts are present and served;
- shared desktop and mobile interface chrome matches the approved material
  direction without layout changes;
- CSS lint, complete CSS build, full web tests, script tests, and scoped
  whitespace checks pass;
- the `2.6.1-beta` changelog records the new default;
- only explicitly listed feature files are committed;
- no image is published and no test or production deployment occurs.
