# Shared Column Picker Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the shared visible-columns modal into a compact responsive grid of category columns on both the builder and item-search pages.

**Architecture:** Keep the server-provided category order and all existing AngularJS selection bindings in the shared EJS template. Add Columns-modal-scoped CSS Grid and density rules to the shared SCSS, then regenerate every theme artifact through the existing CSS build. Render the template with representative data and verify the compiled, deployable CSS rather than asserting against raw source text.

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

- `www/test/columns-modal.test.js`: rendered-template and generated-artifact regression contract for shared-picker markup, bindings, responsive grid behavior, density, and copied public CSS.
- `www/src/views/shared/columnsModal.ejs`: shared semantic markup for the extra-wide modal, category grid, compact headings, choices, and existing AngularJS bindings.
- `css/scss/custom/_custom.scss`: theme-independent, Columns-modal-scoped responsive grid and density rules.
- `css/dist/css/bootstrap-{light,dark,solarized-dark,glass-blue}.{css,css.map,min.css,min.css.map}`: generated theme artifacts produced by the CSS build.
- `www/src/public/css/bootstrap-{light,dark,solarized-dark,glass-blue}.min.{css,css.map}`: generated deployable theme artifacts copied by the CSS build.
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
const ejs = require("ejs");

const root = path.join(__dirname, "../..");
const templatePath = path.join(root, "www/src/views/shared/columnsModal.ejs");
const themes = ["light", "dark", "solarized-dark", "glass-blue"];
const rendered = ejs.render(
    fs.readFileSync(templatePath, "utf8"),
    {
        vm: {
            itemStatCategories: [
                {
                    name: "Basic",
                    getItemStatInfo: [{display: "Strength", short: "Str"}]
                },
                {
                    name: "Tank",
                    getItemStatInfo: [{display: "Hit Points", short: "HP"}]
                }
            ],
            selectedColumns: ["Str"]
        }
    },
    {filename: templatePath}
);

function getPickerRule(css, selector) {
    const modal = String.raw`\.modal\[aria-labelledby=(?:"columnsModalLabel"|columnsModalLabel)\]`;
    const match = css.match(new RegExp(`${modal} ${selector}\\s*\\{([^}]*)\\}`));
    assert.ok(match, `missing generated rule for ${selector}`);
    return match[1];
}

test("shared Columns modal renders in an extra-wide dialog", function() {
    assert.match(rendered, /class="modal-dialog modal-xl"/);
    assert.match(rendered, /class="columns-picker-grid"/);
});

test("shared Columns modal renders ordered compact category cards", function() {
    assert.equal((rendered.match(
        /class="columns-picker-category list-group-item"/g) || []).length, 2);
    assert.ok(rendered.indexOf("Basic") < rendered.indexOf("Tank"));
    assert.match(rendered, /<h6 class="columns-picker-category-title">Basic<\/h6>/);
    assert.match(rendered,
        /class="columns-picker-option list-group-item list-group-item-action list-group-item-light"/);
    assert.match(rendered, />Strength<\/span>/);
    assert.match(rendered, />Hit Points<\/span>/);
});

test("shared Columns modal preserves column selection bindings", function() {
    assert.match(rendered, /ng-click="toggleColumn\('Str'\)"/);
    assert.match(rendered, /showColumn\('Str', true\)/);
    assert.match(rendered, /ng-click="resetColumns\(\)"/);
});

test("compiled themes expose the responsive compact picker", function() {
    for (const theme of themes) {
        const css = fs.readFileSync(path.join(
            root, `css/dist/css/bootstrap-${theme}.css`), "utf8");
        const grid = getPickerRule(css, String.raw`\.columns-picker-grid`);
        const title = getPickerRule(css,
            String.raw`\.columns-picker-category-title`);
        const option = getPickerRule(css, String.raw`\.columns-picker-option`);

        assert.match(grid, /display:\s*grid;/);
        assert.match(grid, /align-items:\s*start;/);
        assert.match(grid,
            /grid-template-columns:\s*repeat\(auto-fit, minmax\(12rem, 1fr\)\);/);
        assert.match(title, /font-size:\s*1rem;/);
        assert.match(option, /padding:\s*0\.5rem 0\.75rem;/);
        assert.match(option, /font-size:\s*0\.875rem;/);
    }
});

test("every minified theme is copied into the web app", function() {
    for (const theme of themes) {
        assert.equal(
            fs.readFileSync(path.join(
                root, `css/dist/css/bootstrap-${theme}.min.css`), "utf8"),
            fs.readFileSync(path.join(
                root, `www/src/public/css/bootstrap-${theme}.min.css`), "utf8")
        );
    }
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd www
node --test test/columns-modal.test.js
```

Expected: FAIL because the rendered shared template lacks `modal-xl` and the `columns-picker-*` contracts, and the generated theme CSS lacks the responsive grid and density rules. The existing binding assertion passes.

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

- [ ] **Step 5: Run CSS lint before regenerating assets**

Run:

```bash
cd css
npm run build:lint
```

Expected: Stylelint exits 0.

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

Expected: all tests PASS, including five new rendered-output/generated-artifact tests and the existing Glass Blue Columns-modal normal, hover/focus, and active material rules.

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
- Modify: `CHANGELOG.md:8-14`

**Interfaces:**
- Consumes: the Task 1 shared picker behavior and the existing `2.6.1-beta` changelog section.
- Produces: public release-note text for human readers; no runtime API.

- [ ] **Step 1: Add the public-facing changelog entry**

Under `## [2.6.1-beta] - 2026-08-07` → `### Changed` in root `CHANGELOG.md`, add:

```markdown
- Reorganized the shared column picker into compact, responsive category columns for easier scanning.
```

Do not change the heading version/date or package versions.

- [ ] **Step 2: Run the complete web suite**

Run:

```bash
cd www
npm test
```

Expected: the complete web suite passes with only any already-documented expected skip.

- [ ] **Step 3: Run final CSS and diff verification**

Run:

```bash
cd css
npm run build:lint
cd ..
git diff --check HEAD -- \
  CHANGELOG.md \
  www/test/columns-modal.test.js \
  www/src/views/shared/columnsModal.ejs \
  css/scss/custom/_custom.scss \
  css/dist/css \
  www/src/public/css
git status --short
```

Expected: Stylelint exits 0; the path-scoped whitespace check reports nothing; status contains only this task's uncommitted changelog plus any known unrelated pre-existing changes and untracked files.

If the app can be started against a local database without changing configuration, also open both `/builder/` and `/items/`, open Columns, and confirm at a wide viewport that categories share a row and at a narrow viewport that whole cards wrap without horizontal page scrolling. If no configured local database is available, record that visual verification was unavailable and rely on the rendered-output/generated-artifact regressions; do not inspect or print `.env`.

- [ ] **Step 4: Commit the changelog unit**

Run:

```bash
git add CHANGELOG.md
git commit -m "docs: record compact column picker"
```

Expected: only the changelog is committed. No deployment, publication, tag, push, or release-version change follows.
