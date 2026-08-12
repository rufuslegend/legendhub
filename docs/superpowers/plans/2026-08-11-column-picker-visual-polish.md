# Shared Column Picker Visual Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the shared column picker's reset control compact and right-aligned beside clearer help copy, enlarge category headings by 20 percent, and raise category-card surfaces above the modal body in all four themes.

**Architecture:** Keep the toolbar and copy in the shared EJS template so builder and item search change together. Add picker-specific Sass surface variables with Light defaults and theme-file overrides, then consume them only inside the Columns modal selector; verify behavior by rendering the real template and inspecting the real compiled CSS artifacts.

**Tech Stack:** EJS, AngularJS template bindings, SCSS, Bootstrap 4, Node.js built-in test runner, npm CSS build pipeline

## Global Constraints

- The toolbar copy is exactly `Select columns to show and hide from the following:`.
- The compact `Reset to defaults` button remains on the right in the same flex row and calls `resetColumns()`.
- The reset button is `type="button"`, uses `btn-sm`, and does not use `col-12` or `btn-block`.
- Category headings are exactly `1.2rem`; stat-option labels remain `0.875rem` with `0.5rem 0.75rem` padding.
- Picker surfaces are scoped to the Columns modal and do not alter the Filters modal.
- Light uses modal body `#f8f9fa` and category cards `#fff`.
- Dark uses modal body `#212529` and category cards `#343a40`.
- Solarized Dark uses modal body `#002b36` and category cards `#073642`.
- Glass Blue uses modal body `#060b12` and category cards `#0a1522`.
- Preserve the approved five category stacks, selection/reset behavior, option states, responsive wrapping, and `modal-xl`.
- Keep the application version at `2.6.1-beta`; do not create or move a release tag.
- Do not modify root `docker-compose-prod.yaml`.
- Do not merge, push, publish images, or deploy without separate authorization.

---

## File Map

- `www/src/views/shared/columnsModal.ejs`: renders the exact help copy and compact reset control in one toolbar row.
- `www/test/columns-modal.test.js`: renders the real template and checks toolbar behavior plus literal compiled theme outcomes.
- `css/scss/custom/_custom.scss`: defines Light defaults and Columns-modal-scoped toolbar, heading, modal-body, and category-card rules.
- `css/scss/custom/themes/_dark-theme.scss`: overrides picker surfaces for Dark.
- `css/scss/custom/themes/_solarized-dark-theme.scss`: overrides picker surfaces for Solarized Dark.
- `css/scss/custom/themes/_glass-blue-theme.scss`: overrides picker surfaces for Glass Blue.
- `css/dist/css/bootstrap-{light,dark,solarized-dark,glass-blue}.{css,css.map,min.css,min.css.map}`: generated theme artifacts.
- `www/src/public/css/bootstrap-{light,dark,solarized-dark,glass-blue}.{min.css,min.css.map}`: generated assets served by the application.
- `CHANGELOG.md`: refines the current `2.6.1-beta` picker note.

### Task 1: Compact Right-Aligned Toolbar

**Files:**
- Modify: `www/test/columns-modal.test.js`
- Modify: `www/src/views/shared/columnsModal.ejs`

**Interfaces:**
- Consumes: the existing `resetColumns()` AngularJS action.
- Produces: `.columns-picker-toolbar` containing `.columns-picker-toolbar-copy` and `.columns-picker-reset`, with the existing reset action unchanged.

- [ ] **Step 1: Write the failing rendered-toolbar test**

Add this test after the dialog-width test in `www/test/columns-modal.test.js`:

```js
test("shared Columns modal renders a compact right-aligned reset toolbar", function() {
    const toolbar = rendered.match(
        /<div class="columns-picker-toolbar">([\s\S]*?)<\/div>/);

    assert.ok(toolbar, "missing Columns picker toolbar");
    assert.match(toolbar[1],
        /<p class="columns-picker-toolbar-copy text-info">\s*Select columns to show and hide from the following:\s*<\/p>/);

    const reset = toolbar[1].match(/<button\b[^>]*>Reset to defaults<\/button>/);
    assert.ok(reset, "missing compact reset button");
    assert.match(reset[0], /\btype="button"/);
    assert.match(reset[0], /\bclass="[^"]*\bcolumns-picker-reset\b[^"]*\bbtn-sm\b[^"]*"/);
    assert.match(reset[0], /\bng-click="resetColumns\(\)"/);
    assert.doesNotMatch(reset[0], /\bcol-12\b/);
    assert.doesNotMatch(reset[0], /\bbtn-block\b/);
});
```

This catches the deployed regression where the reset action expands to the full
modal width, as well as wrong copy, lost bindings, or accidental submit
behavior.

- [ ] **Step 2: Run the focused test and verify RED**

Run from `www/`:

```bash
node --test test/columns-modal.test.js
```

Expected: the new test fails with `missing Columns picker toolbar`; all existing
stack, option, and binding tests remain green.

- [ ] **Step 3: Implement the minimal shared toolbar markup**

Replace the two introductory rows and `<br />` in
`www/src/views/shared/columnsModal.ejs` with:

```ejs
<div class="columns-picker-toolbar">
    <p class="columns-picker-toolbar-copy text-info">
        Select columns to show and hide from the following:
    </p>
    <button type="button" class="columns-picker-reset btn btn-primary btn-sm" ng-click="resetColumns()">Reset to defaults</button>
</div>
```

Do not alter the category stack loop or stat-option buttons.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run from `www/`:

```bash
node --test test/columns-modal.test.js
```

Expected: every focused template test passes.

- [ ] **Step 5: Commit the toolbar behavior**

```bash
git add www/src/views/shared/columnsModal.ejs www/test/columns-modal.test.js
git commit -m "fix: compact column picker reset control"
```

### Task 2: Larger Headings and Theme-Native Raised Surfaces

**Files:**
- Modify: `www/test/columns-modal.test.js`
- Modify: `css/scss/custom/_custom.scss`
- Modify: `css/scss/custom/themes/_dark-theme.scss`
- Modify: `css/scss/custom/themes/_solarized-dark-theme.scss`
- Modify: `css/scss/custom/themes/_glass-blue-theme.scss`
- Generate: `css/dist/css/bootstrap-{light,dark,solarized-dark,glass-blue}.{css,css.map,min.css,min.css.map}`
- Generate: `www/src/public/css/bootstrap-{light,dark,solarized-dark,glass-blue}.{min.css,min.css.map}`

**Interfaces:**
- Consumes: `.columns-picker-toolbar`, `.columns-picker-toolbar-copy`, `.columns-picker-reset`, `.modal-body`, `.columns-picker-category`, and `.columns-picker-category-title` markup from the shared template.
- Produces: `$columns-picker-modal-bg` and `$columns-picker-category-bg` compile-time tokens plus literal theme CSS surfaces and a `1.2rem` heading.

- [ ] **Step 1: Add a literal per-theme surface contract**

Near the existing `themes` constant in `www/test/columns-modal.test.js`, add:

```js
const pickerSurfaces = {
    light: {modal: "#f8f9fa", category: "#fff"},
    dark: {modal: "#212529", category: "#343a40"},
    "solarized-dark": {modal: "#002b36", category: "#073642"},
    "glass-blue": {modal: "#060b12", category: "#0a1522"}
};
```

Extend `compiled themes expose the responsive compact picker` to retrieve and
assert the real compiled rules:

```js
const toolbar = getPickerRule(css, String.raw`\.columns-picker-toolbar`);
const toolbarCopy = getPickerRule(css,
    String.raw`\.columns-picker-toolbar-copy`);
const reset = getPickerRule(css, String.raw`\.columns-picker-reset`);
const modalBody = getPickerRule(css, String.raw`\.modal-body`);
const category = getPickerRule(css, String.raw`\.columns-picker-category`);

assert.match(toolbar, /display:\s*flex;/);
assert.match(toolbar, /align-items:\s*center;/);
assert.match(toolbar, /gap:\s*1rem;/);
assert.match(toolbar, /margin-bottom:\s*1rem;/);
assert.match(toolbarCopy, /flex:\s*1 1 auto;/);
assert.match(toolbarCopy, /min-width:\s*0;/);
assert.match(toolbarCopy, /margin-bottom:\s*0;/);
assert.match(reset, /flex:\s*0 0 auto;/);
assert.match(modalBody, new RegExp(
    `background-color:\\s*${pickerSurfaces[theme].modal};`));
assert.match(category, new RegExp(
    `background-color:\\s*${pickerSurfaces[theme].category};`));
assert.match(title, /font-size:\s*1\.2rem;/);
```

Replace the old `font-size: 1rem` title assertion. Keep all grid, stack,
option-size, padding, and copied-asset assertions.

- [ ] **Step 2: Run the focused test and verify RED**

Run from `www/`:

```bash
node --test test/columns-modal.test.js
```

Expected: the compiled-theme test fails first because the generated CSS has no
`.columns-picker-toolbar` rule. The existing generated assets still match their
public copies.

- [ ] **Step 3: Add picker defaults and scoped styles**

At the top of `css/scss/custom/_custom.scss`, add Light-theme defaults:

```scss
$columns-picker-modal-bg: $gray-100 !default;
$columns-picker-category-bg: $white !default;
```

Inside `.modal[aria-labelledby="columnsModalLabel"]`, add:

```scss
.modal-body {
  background-color: $columns-picker-modal-bg;
}

.columns-picker-toolbar {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1rem;
}

.columns-picker-toolbar-copy {
  flex: 1 1 auto;
  min-width: 0;
  margin-bottom: 0;
}

.columns-picker-reset {
  flex: 0 0 auto;
}
```

Extend the existing category and title rules:

```scss
.columns-picker-category {
  padding: .75rem;
  background-color: $columns-picker-category-bg;
}

.columns-picker-category-title {
  margin-bottom: .5rem;
  font-size: 1.2rem;
}
```

- [ ] **Step 4: Add theme-specific surface overrides**

Add these definitions after the referenced palette variables exist in each
theme file and before Bootstrap imports the shared custom partial.

In `css/scss/custom/themes/_dark-theme.scss`:

```scss
$columns-picker-modal-bg: $body-bg;
$columns-picker-category-bg: $gray-800;
```

In `css/scss/custom/themes/_solarized-dark-theme.scss`:

```scss
$columns-picker-modal-bg: $gray-800;
$columns-picker-category-bg: $gray-700;
```

In `css/scss/custom/themes/_glass-blue-theme.scss`, after `$glass-surface` is
defined:

```scss
$columns-picker-modal-bg: $glass-surface;
$columns-picker-category-bg: $gray-800;
```

- [ ] **Step 5: Lint and rebuild all four themes**

Run from the repository root:

```bash
npm run build --prefix css
```

Expected: CSS lint, Sass compilation, prefixing, minification, and public-copy
steps exit zero. Existing upstream Bootstrap Sass deprecation warnings may be
printed but must not become build errors.

- [ ] **Step 6: Run focused picker and Glass Blue tests**

Run from `www/`:

```bash
node --test test/columns-modal.test.js test/glass-blue-theme.test.js
```

Expected: all focused tests pass, including literal surfaces for every theme,
the `1.2rem` heading, preserved option density, and byte-identical public CSS.

- [ ] **Step 7: Commit source, tests, and generated assets**

```bash
git add \
  css/scss/custom/_custom.scss \
  css/scss/custom/themes/_dark-theme.scss \
  css/scss/custom/themes/_solarized-dark-theme.scss \
  css/scss/custom/themes/_glass-blue-theme.scss \
  css/dist/css \
  www/src/public/css \
  www/test/columns-modal.test.js
git commit -m "style: polish shared column picker surfaces"
```

### Task 3: Changelog and Complete Verification

**Files:**
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: the completed toolbar and theme artifacts from Tasks 1 and 2.
- Produces: an accurate `2.6.1-beta` release note and a verified feature branch ready for review.

- [ ] **Step 1: Refine the existing picker changelog entry**

Under `## [2.6.1-beta]` → `### Changed`, replace the picker bullet with:

```markdown
- Reorganized the shared column picker into compact, responsive columns with related stat stacks, clearer headings, raised category surfaces, and a compact reset action.
```

- [ ] **Step 2: Run the complete web suite**

Run from the repository root:

```bash
npm test --prefix www
```

Expected: all web tests pass with only the documented expected skip.

- [ ] **Step 3: Run CSS lint and focused artifact checks**

Run from the repository root:

```bash
npm test --prefix css
cd www && node --test test/columns-modal.test.js test/glass-blue-theme.test.js
```

Expected: CSS lint and all focused tests pass.

- [ ] **Step 4: Inspect scoped changes and whitespace**

```bash
git diff --check
git status --short
git diff -- \
  CHANGELOG.md \
  www/src/views/shared/columnsModal.ejs \
  www/test/columns-modal.test.js \
  css/scss/custom/_custom.scss \
  css/scss/custom/themes/_dark-theme.scss \
  css/scss/custom/themes/_solarized-dark-theme.scss \
  css/scss/custom/themes/_glass-blue-theme.scss
```

Expected: `git diff --check` is silent and the source diff contains only the
approved picker polish. Unrelated user-owned paths remain untouched.

- [ ] **Step 5: Commit the changelog**

```bash
git add CHANGELOG.md
git commit -m "docs: record column picker polish"
```

- [ ] **Step 6: Perform final branch verification**

```bash
npm test --prefix www
npm test --prefix css
git diff --check master...HEAD
git status --short --branch
```

Expected: tests and lint pass, the worktree is clean, and the feature remains
unpublished and undeployed pending an explicit integration choice.
