# Shared Column Picker Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the shared visible-columns modal into a compact responsive grid of category columns on both the builder and item-search pages.

**Architecture:** Keep the server-provided category order and all existing AngularJS selection bindings in the shared EJS template. Add Columns-modal-scoped CSS Grid and density rules to the shared SCSS, then regenerate every theme artifact through the existing CSS build. Add source-level regressions for the template and SCSS and retain the Glass Blue artifact tests for theme integration.

**Tech Stack:** EJS, AngularJS template bindings, Bootstrap 4 modal/list-group classes, SCSS and CSS Grid, Node.js `node:test`, Stylelint, Sass, PostCSS, Lightning CSS.

## Global Constraints

- Apply the new picker everywhere `www/src/views/shared/columnsModal.ejs` is included: the builder and item-search pages.
- Use the existing `modal-xl` dialog size.
- Use responsive equal-width `minmax(12rem, 1fr)` grid tracks that wrap whole category cards as space requires.
- Use `1rem` category headings and `0.875rem` choice labels with `0.5rem 0.75rem` choice padding.
- Preserve category and choice order, AngularJS selection/reset behavior, cookies, icons, keyboard behavior, and all theme states.
- Do not change the Filters modal, controller logic, default columns, release version, or dependencies.
- Record the public-facing change under the existing `2.6.1-beta` changelog section.
- Do not publish, deploy, tag, push, or modify root `docker-compose-prod.yaml`.
- Preserve all pre-existing unrelated working-tree changes and untracked files.

## File Structure

- `www/test/columns-modal.test.js`: source-level regression contract for shared-picker markup, bindings, responsive grid SCSS, and Filters-modal isolation.
- `www/src/views/shared/columnsModal.ejs`: shared semantic markup for the extra-wide modal, category grid, compact headings, choices, and existing AngularJS bindings.
- `css/scss/custom/_custom.scss`: theme-independent, Columns-modal-scoped responsive grid and density rules.
- `css/dist/css/bootstrap-{light,dark,solarized-dark,glass-blue}.{css,css.map,min.css,min.css.map}`: generated theme artifacts produced by the CSS build.
- `www/src/public/css/bootstrap-{light,dark,solarized-dark,glass-blue}.min.{css,css.map}`: generated deployable theme artifacts copied by the CSS build.
- `www/test/changelog.test.js`: regression that the tracked changelog includes this user-facing improvement.
- `CHANGELOG.md`: user-facing description under `2.6.1-beta`.

---

### Task 1: Build the responsive shared picker

**Files:**
- Create: `www/test/columns-modal.test.js`
- Modify: `www/src/views/shared/columnsModal.ejs:1-42`
- Modify: `css/scss/custom/_custom.scss:30-68`
- Generate: `css/dist/css/bootstrap-light.css`
- Generate: `css/dist/css/bootstrap-light.css.map`
- Generate: `css/dist/css/bootstrap-light.min.css`
- Generate: `css/dist/css/bootstrap-light.min.css.map`
- Generate: `css/dist/css/bootstrap-dark.css`
- Generate: `css/dist/css/bootstrap-dark.css.map`
- Generate: `css/dist/css/bootstrap-dark.min.css`
- Generate: `css/dist/css/bootstrap-dark.min.css.map`
- Generate: `css/dist/css/bootstrap-solarized-dark.css`
- Generate: `css/dist/css/bootstrap-solarized-dark.css.map`
- Generate: `css/dist/css/bootstrap-solarized-dark.min.css`
- Generate: `css/dist/css/bootstrap-solarized-dark.min.css.map`
- Generate: `css/dist/css/bootstrap-glass-blue.css`
- Generate: `css/dist/css/bootstrap-glass-blue.css.map`
- Generate: `css/dist/css/bootstrap-glass-blue.min.css`
- Generate: `css/dist/css/bootstrap-glass-blue.min.css.map`
- Generate: `www/src/public/css/bootstrap-light.min.css`
- Generate: `www/src/public/css/bootstrap-light.min.css.map`
- Generate: `www/src/public/css/bootstrap-dark.min.css`
- Generate: `www/src/public/css/bootstrap-dark.min.css.map`
- Generate: `www/src/public/css/bootstrap-solarized-dark.min.css`
- Generate: `www/src/public/css/bootstrap-solarized-dark.min.css.map`
- Generate: `www/src/public/css/bootstrap-glass-blue.min.css`
- Generate: `www/src/public/css/bootstrap-glass-blue.min.css.map`

**Interfaces:**
- Consumes: EJS `vm.itemStatCategories: Array<{name: string, getItemStatInfo: Array<{display: string, short: string}>}>`; AngularJS `toggleColumn(short: string): void`; AngularJS `showColumn(short: string, selectedByDefault: boolean): boolean`; Bootstrap `modal-xl`, `list-group-item`, `list-group-item-action`, and `list-group-item-light` classes.
- Produces: `.columns-picker-grid`, `.columns-picker-category`, `.columns-picker-category-title`, and `.columns-picker-option` markup/style contracts; unchanged toggle and visibility bindings for callers.

- [ ] **Step 1: Write the failing shared-picker regression test**

Create `www/test/columns-modal.test.js`:

```js
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "../..");
const columnsTemplate = fs.readFileSync(path.join(
    root, "www/src/views/shared/columnsModal.ejs"), "utf8");
const filtersTemplate = fs.readFileSync(path.join(
    root, "www/src/views/shared/filtersModal.ejs"), "utf8");
const customScss = fs.readFileSync(path.join(
    root, "css/scss/custom/_custom.scss"), "utf8");

test("shared Columns modal renders compact categories in a wide grid", function() {
    assert.match(columnsTemplate, /class="modal-dialog modal-xl"/);
    assert.match(columnsTemplate, /class="columns-picker-grid"/);
    assert.match(columnsTemplate,
        /class="columns-picker-category list-group-item/);
    assert.match(columnsTemplate,
        /<h6 class="columns-picker-category-title">/);
    assert.match(columnsTemplate,
        /class="columns-picker-option list-group-item list-group-item-action list-group-item-light"/);
});

test("shared Columns modal preserves column selection bindings", function() {
    assert.match(columnsTemplate,
        /ng-click="toggleColumn\('<%- stat\.short _%>'\)"/);
    assert.match(columnsTemplate,
        /showColumn\('<%- stat\.short _%>', <%- vm\.selectedColumns\.includes\(stat\.short\) _%>\)/);
    assert.match(columnsTemplate, /ng-click="resetColumns\(\)"/);
});

test("Columns modal grid wraps category cards and uses compact type", function() {
    assert.match(customScss,
        /\.modal\[aria-labelledby="columnsModalLabel"\]\s*\{/);
    assert.match(customScss, /\.columns-picker-grid\s*\{[\s\S]*display:\s*grid;/);
    assert.match(customScss,
        /grid-template-columns:\s*repeat\(auto-fit, minmax\(12rem, 1fr\)\);/);
    assert.match(customScss, /\.columns-picker-category-title\s*\{[\s\S]*font-size:\s*1rem;/);
    assert.match(customScss,
        /\.columns-picker-option\s*\{[\s\S]*padding:\s*\.5rem \.75rem;[\s\S]*font-size:\s*\.875rem;/);
});

test("compact picker classes remain isolated from the Filters modal", function() {
    assert.doesNotMatch(filtersTemplate, /columns-picker-/);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd www
node --test test/columns-modal.test.js
```

Expected: FAIL because the shared template lacks `modal-xl` and the `columns-picker-*` contracts, and the SCSS lacks the grid and density rules. The existing binding assertions pass.

- [ ] **Step 3: Replace the vertical picker markup with the approved semantic grid**

In `www/src/views/shared/columnsModal.ejs`:

- Add `modal-xl` to the `modal-dialog` class.
- Replace the outer `<div class="list-group">` with `<div class="columns-picker-grid">`.
- Render each category as `<section class="columns-picker-category list-group-item">`.
- Replace the category `h4` with `<h6 class="columns-picker-category-title">`.
- Add `columns-picker-option` to each choice button.
- Replace the nested heading wrapper with a compact flex span while retaining the exact AngularJS bindings and icon classes.

The category and option block should be:

```ejs
<div class="columns-picker-grid">
<% for (let i = 0; i < vm.itemStatCategories.length; ++i) { %>
    <section class="columns-picker-category list-group-item">
        <h6 class="columns-picker-category-title"><%= vm.itemStatCategories[i].name _%></h6>
        <div class="list-group list-group-flush">
        <%
        for (let j = 0; j < vm.itemStatCategories[i].getItemStatInfo.length; ++j) {
            let stat = vm.itemStatCategories[i].getItemStatInfo[j];
        %>
            <button ng-click="toggleColumn('<%- stat.short _%>')" type="button" class="columns-picker-option list-group-item list-group-item-action list-group-item-light">
                <span class="d-flex align-items-center justify-content-between">
                    <span><%= stat.display _%></span>
                    <i ng-class="{'text-success fa-check': showColumn('<%- stat.short _%>', <%- vm.selectedColumns.includes(stat.short) _%>), 'text-danger fa-times': !showColumn('<%- stat.short _%>', <%- vm.selectedColumns.includes(stat.short) _%>)}" class="fas ml-2"></i>
                </span>
            </button>
        <% } %>
        </div>
    </section>
<% } %>
</div>
```

Do not edit `filtersModal.ejs`, either controller, or the reset button.

- [ ] **Step 4: Add Columns-modal-scoped grid and density rules**

Insert this block in `css/scss/custom/_custom.scss` after `.breadcrumbNav` and before the unrelated category-list navigation rules:

```scss
.modal[aria-labelledby="columnsModalLabel"] {
  .columns-picker-grid {
    display: grid;
    align-items: start;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
    gap: 1rem;
  }

  .columns-picker-category {
    padding: .75rem;
  }

  .columns-picker-category-title {
    margin-bottom: .5rem;
    font-size: 1rem;
  }

  .columns-picker-option {
    padding: .5rem .75rem;
    font-size: .875rem;
  }
}
```

Keep the selector anchored to the Columns modal. Do not change the existing Glass Blue selectors; the choice buttons retain the classes they target.

- [ ] **Step 5: Run the focused test and CSS lint**

Run:

```bash
cd www
node --test test/columns-modal.test.js
cd ../css
npm run build:lint
```

Expected: 4 focused tests PASS and Stylelint exits 0.

- [ ] **Step 6: Rebuild every theme and copied public asset**

Run:

```bash
cd css
npm run build
```

Expected: Sass compiles all four themes, Stylelint passes, PostCSS prefixes the expanded output, Lightning CSS recreates minified files and source maps, and the minified artifacts are copied into `www/src/public/css`.

- [ ] **Step 7: Verify the generated CSS and existing Glass Blue integration**

Run:

```bash
cd www
node --test test/columns-modal.test.js test/glass-blue-theme.test.js
```

Expected: all tests PASS, including the existing Glass Blue Columns-modal normal, hover/focus, and active material rules and artifact-copy equality checks.

- [ ] **Step 8: Review the change and commit the picker unit**

Run:

```bash
git diff --check HEAD -- \
  www/test/columns-modal.test.js \
  www/src/views/shared/columnsModal.ejs \
  css/scss/custom/_custom.scss \
  css/dist/css \
  www/src/public/css
git diff --stat -- \
  www/test/columns-modal.test.js \
  www/src/views/shared/columnsModal.ejs \
  css/scss/custom/_custom.scss \
  css/dist/css \
  www/src/public/css
git add \
  www/test/columns-modal.test.js \
  www/src/views/shared/columnsModal.ejs \
  css/scss/custom/_custom.scss \
  css/dist/css \
  www/src/public/css
git commit -m "feat: compact shared column picker"
```

Expected: the path-scoped whitespace check is clean, only the approved picker sources/tests/generated artifacts are staged, and the commit succeeds without staging unrelated working-tree files.

### Task 2: Document and fully verify the shared UI change

**Files:**
- Modify: `www/test/changelog.test.js:65-72`
- Modify: `CHANGELOG.md:8-14`

**Interfaces:**
- Consumes: the Task 1 shared picker behavior and the existing `2.6.1-beta` changelog section.
- Produces: public release-note text covered by the existing Node changelog test suite; no runtime API.

- [ ] **Step 1: Add a failing changelog regression**

Add this test after `tracked changelog records the builder regeneration fix` in `www/test/changelog.test.js`:

```js
test("tracked changelog records the compact shared column picker", () => {
    const tracked = fs.readFileSync(path.join(__dirname, "../../CHANGELOG.md"), "utf8");

    assert.match(tracked,
        /Reorganized the shared column picker into compact, responsive category columns/);
});
```

- [ ] **Step 2: Run the changelog test and verify RED**

Run:

```bash
cd www
node --test test/changelog.test.js
```

Expected: FAIL only for the new release-note assertion because `CHANGELOG.md` does not yet contain the sentence.

- [ ] **Step 3: Add the public-facing changelog entry**

Under `## [2.6.1-beta] - 2026-08-07` → `### Changed` in root `CHANGELOG.md`, add:

```markdown
- Reorganized the shared column picker into compact, responsive category columns for easier scanning.
```

Do not change the heading version/date or package versions.

- [ ] **Step 4: Run the focused changelog test and complete web suite**

Run:

```bash
cd www
node --test test/changelog.test.js
npm test
```

Expected: the focused changelog tests PASS, then the complete web suite passes with only any already-documented expected skip.

- [ ] **Step 5: Run final CSS and diff verification**

Run:

```bash
cd css
npm run build:lint
cd ..
git diff --check HEAD -- \
  CHANGELOG.md \
  www/test/changelog.test.js \
  www/test/columns-modal.test.js \
  www/src/views/shared/columnsModal.ejs \
  css/scss/custom/_custom.scss \
  css/dist/css \
  www/src/public/css
git status --short
```

Expected: Stylelint exits 0; the path-scoped whitespace check reports nothing; status contains only this task's two uncommitted files plus the known unrelated pre-existing changes and untracked files.

If the app can be started against a local database without changing configuration, also open both `/builder/` and `/items/`, open Columns, and confirm at a wide viewport that categories share a row and at a narrow viewport that whole cards wrap without horizontal page scrolling. If no configured local database is available, record that visual verification was unavailable and rely on the grid/source/artifact regressions; do not inspect or print `.env`.

- [ ] **Step 6: Commit the changelog unit**

Run:

```bash
git add CHANGELOG.md www/test/changelog.test.js
git commit -m "docs: record compact column picker"
```

Expected: only the changelog and its regression are committed. No deployment, publication, tag, push, or release-version change follows.
