# Glass Blue Density and Columns Contrast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce oversized builder panel titles and panel gaps while fixing unreadable Columns-modal labels in Glass Blue only.

**Architecture:** Add three narrowly scoped post-Bootstrap rules to the existing Glass Blue chrome partial. Protect the behavior with source and compiled-artifact contract tests, then regenerate the existing Glass Blue distribution/public assets without touching shared templates or other themes.

**Tech Stack:** SCSS, Bootstrap 4, Node.js built-in test runner, Stylelint, Sass, Lightning CSS.

## Global Constraints

- Change Glass Blue only; Light, Dark, and Solarized Dark must remain byte-for-byte unchanged.
- Do not edit builder or Columns modal templates or alter application behavior.
- Keep card-header titles at `1.25rem` and builder top-panel spacing at approximately 12–15 pixels.
- Preserve contextual list-group hover, focus, and active colors by inheriting only the nested heading text color.
- Do not touch the user-owned root `docker-compose-prod.yaml` or unrelated working-tree files.
- Do not push, deploy, tag, publish images, or change the application version.

---

### Task 1: Compact builder panels and repair Columns-modal contrast

**Files:**
- Modify: `www/test/glass-blue-theme.test.js`
- Modify: `css/scss/custom/themes/_glass-blue-chrome.scss`
- Generate: `css/dist/css/bootstrap-glass-blue.css`
- Generate: `css/dist/css/bootstrap-glass-blue.css.map`
- Generate: `css/dist/css/bootstrap-glass-blue.min.css`
- Generate: `css/dist/css/bootstrap-glass-blue.min.css.map`
- Generate: `www/src/public/css/bootstrap-glass-blue.min.css`
- Generate: `www/src/public/css/bootstrap-glass-blue.min.css.map`

**Interfaces:**
- Consumes: Bootstrap's `.card-header`, `.h4`, `.row`, `.col-lg-6`, `.mb-4`, and `.list-group-item-action` contracts plus the builder body's `ng-controller="builder"` attribute.
- Produces: Glass-only `1.25rem` card-header `h4` titles, 0.5rem builder top-panel gutters, 0.75rem bottom spacing, and inherited contextual-list heading color.

- [ ] **Step 1: Add a failing density and contrast regression test**

Append this test before the artifact-completeness test in `www/test/glass-blue-theme.test.js`:

```js
test("Glass Blue compacts builder panels and preserves Columns label contrast", function() {
    const expanded = fs.readFileSync(path.join(
        distRoot, "bootstrap-glass-blue.css"), "utf8");

    assert.match(expanded,
        /\.card-header h4,\s*\.card-header \.h4\s*\{\s*font-size:\s*1\.25rem;/);
    assert.match(expanded,
        /body\[ng-controller="builder"\][\s\S]*padding-right:\s*\.5rem;[\s\S]*padding-left:\s*\.5rem;[\s\S]*margin-bottom:\s*\.75rem !important;/);
    assert.match(expanded,
        /\.list-group-item-action h5\s*\{\s*color:\s*inherit;/);
});
```

These assertions target the expanded stylesheet served by the build rather
than grepping SCSS implementation text. Removing or changing any of the three
consumer-visible rules makes the test fail.

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
node --test www/test/glass-blue-theme.test.js
```

Expected: the new test fails because the compact title, spacing, and inherited list-heading rules do not exist.

- [ ] **Step 3: Add the minimal Glass-only SCSS rules**

Add these rules to `css/scss/custom/themes/_glass-blue-chrome.scss` after the shared serif-heading block and before the material surface block:

```scss
.card-header h4,
.card-header .h4 {
  font-size: 1.25rem;
}

body[ng-controller="builder"] > .container-fluid > .row:first-child {
  margin-right: -.5rem;
  margin-left: -.5rem;
}

body[ng-controller="builder"] > .container-fluid > .row:first-child > .col-lg-6 {
  padding-right: .5rem;
  padding-left: .5rem;
  margin-bottom: .75rem !important;
}

.list-group-item-action h5 {
  color: inherit;
}
```

The adjusted row margins preserve the existing 15-pixel outer container inset while the two 0.5rem column paddings reduce the inter-card gap to 1rem. The inherited `h5` color follows each contextual button's normal, hover, focus, and active color.

- [ ] **Step 4: Rebuild Glass Blue artifacts**

Run:

```bash
npm run build --prefix css
```

Expected: Sass, prefixing, minification, copying, and Stylelint exit zero. Existing Bootstrap 4 Sass deprecation warnings may remain. Confirm no existing theme artifact changed:

```bash
git status --short -- css/dist/css www/src/public/css
```

Expected: only the six Glass Blue artifacts are modified.

- [ ] **Step 5: Run focused and complete verification**

Run:

```bash
node --test www/test/glass-blue-theme.test.js
npm test --prefix css
npm test --prefix www
cmp css/dist/css/bootstrap-glass-blue.min.css www/src/public/css/bootstrap-glass-blue.min.css
cmp css/dist/css/bootstrap-glass-blue.min.css.map www/src/public/css/bootstrap-glass-blue.min.css.map
git diff --check -- \
  css/scss/custom/themes/_glass-blue-chrome.scss \
  css/dist/css/bootstrap-glass-blue.css \
  css/dist/css/bootstrap-glass-blue.css.map \
  css/dist/css/bootstrap-glass-blue.min.css \
  css/dist/css/bootstrap-glass-blue.min.css.map \
  www/src/public/css/bootstrap-glass-blue.min.css \
  www/src/public/css/bootstrap-glass-blue.min.css.map \
  www/test/glass-blue-theme.test.js
```

Expected: all commands exit zero; the web suite retains only its expected skip; dist/public CSS and maps are byte-identical.

- [ ] **Step 6: Commit only the refinement files**

Run:

```bash
git add -- \
  css/scss/custom/themes/_glass-blue-chrome.scss \
  css/dist/css/bootstrap-glass-blue.css \
  css/dist/css/bootstrap-glass-blue.css.map \
  css/dist/css/bootstrap-glass-blue.min.css \
  css/dist/css/bootstrap-glass-blue.min.css.map \
  www/src/public/css/bootstrap-glass-blue.min.css \
  www/src/public/css/bootstrap-glass-blue.min.css.map \
  www/test/glass-blue-theme.test.js
git diff --cached --check
git commit -m "Refine Glass Blue density and contrast"
```

Expected: one commit containing only the Glass Blue SCSS, generated artifacts, and regression test. Leave the existing changelog/test changes and unrelated worktree files unstaged.

### Task 2: Darken the Columns modal choices

**Files:**
- Modify: `www/test/glass-blue-theme.test.js`
- Modify: `css/scss/custom/themes/_glass-blue-chrome.scss`
- Generate: the same six Glass Blue CSS and source-map artifacts listed in Task 1

**Interfaces:**
- Consumes: `#columnsModal`, `.list-group-item-light`, and the existing Glass material variables.
- Produces: dark normal, blue hover/focus, and distinct active states scoped only to the Columns modal.

- [ ] **Step 1: Add and run a failing compiled-CSS regression**

Assert that `#columnsModal .list-group-item-light` compiles with light text on
`$glass-well`, and that its action hover/focus and active states compile after
Bootstrap's contextual light rules. Run `node --test www/test/glass-blue-theme.test.js`
and confirm the new test fails against the current white background.

- [ ] **Step 2: Add the scoped post-Bootstrap overrides**

Add normal, hover/focus, and active selectors beneath the existing
`.list-group-item-action h5` rule. Do not change the shared modal template or
contextual list groups elsewhere.

- [ ] **Step 3: Rebuild and verify**

Run the CSS build, focused Glass tests, CSS lint, full web and script suites,
artifact byte comparisons, and scoped whitespace checks. Commit only the
Glass source, generated artifacts, regression test, and this approved design
record before resuming publication.
