# Shared Column Picker Desktop Width Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Center the shared Columns picker at 50 percent of the viewport on screens 768px and wider while preserving its current mobile width and responsive four-stack layout.

**Architecture:** Add one media-query override scoped to the Columns modal's existing `aria-labelledby` contract, leaving the repository-wide `.modal-xl` sizing untouched. Prove the compiled contract in the existing shared-modal test, rebuild all four theme bundles through the established CSS pipeline, and verify both shared-picker callers visually.

**Tech Stack:** SCSS, Bootstrap 4 modal/grid CSS, Node.js test runner, EJS fixture rendering, Stylelint, Sass, PostCSS, Lightning CSS.

## Global Constraints

- The change applies only to the shared Columns picker identified by `columnsModalLabel`, including Builder and Items.
- At viewport widths of 768px and above, the picker is centered at exactly 50 percent of the viewport width with no fixed pixel cap.
- Below 768px, retain Bootstrap's current nearly full-width mobile dialog behavior.
- Preserve the four configured stacks, auto-fitting grid fallback, toolbar, category surfaces, typography, selection/reset behavior, and unknown-category behavior.
- Other `modal-xl` dialogs retain `width: 90%` and `max-width: 1800px` at the repository's desktop override.
- Keep the public version at `2.6.1-beta`; do not create or move a release tag.
- Do not publish images, push, or deploy without fresh authorization for those actions.

---

## File structure

- `www/test/columns-modal.test.js`: verifies the shared picker's compiled desktop width and guards the unrelated global extra-wide modal rule.
- `css/scss/custom/_custom.scss`: owns the source media query for both the global extra-wide modal and the Columns-picker-specific override.
- `css/dist/css/bootstrap-{light,dark,solarized-dark,glass-blue}{.css,.css.map,.min.css,.min.css.map}`: generated theme artifacts; rebuild, never edit by hand.
- `www/src/public/css/bootstrap-{light,dark,solarized-dark,glass-blue}{.min.css,.min.css.map}`: generated web assets copied by the CSS build; rebuild, never edit by hand.
- `CHANGELOG.md`: records the user-visible narrower desktop picker.

---

### Task 1: Narrow the shared picker on tablet and desktop

**Files:**
- Modify: `www/test/columns-modal.test.js`
- Modify: `css/scss/custom/_custom.scss`
- Generate: `css/dist/css/bootstrap-{light,dark,solarized-dark,glass-blue}{.css,.css.map,.min.css,.min.css.map}`
- Generate: `www/src/public/css/bootstrap-{light,dark,solarized-dark,glass-blue}{.min.css,.min.css.map}`

**Interfaces:**
- Consumes: `.modal[aria-labelledby="columnsModalLabel"]`, `.modal-dialog`, the existing `@media (min-width: 768px)` block, and the existing `npm run build` CSS pipeline.
- Produces: compiled desktop CSS in every theme where the shared picker dialog has `width: 50%` and `max-width: none`, without changing the general `.modal-xl` values.

- [ ] **Step 1: Write the failing compiled-CSS test**

In `www/test/columns-modal.test.js`, add this helper after `getPickerRule`:

```js
function getDesktopPickerDialogRules(css) {
    const modal = String.raw`\.modal\[aria-labelledby=(?:"columnsModalLabel"|columnsModalLabel)\]`;
    const match = css.match(new RegExp(
        String.raw`@media \(min-width: 768px\) \{\s*` +
        String.raw`\.modal-xl\s*\{([^}]*)\}\s*` +
        `${modal} \\.modal-dialog\\s*\\{([^}]*)\\}\\s*\\}`
    ));
    assert.ok(match, "missing desktop Columns picker dialog rule");
    return {general: match[1], picker: match[2]};
}
```

In `test("compiled themes expose the responsive compact picker", ...)`, immediately after reading each theme's CSS, add:

```js
        const desktopDialog = getDesktopPickerDialogRules(css);
        assert.match(desktopDialog.general, /width:\s*90%;/);
        assert.match(desktopDialog.general, /max-width:\s*1800px;/);
        assert.match(desktopDialog.picker, /width:\s*50%;/);
        assert.match(desktopDialog.picker, /max-width:\s*none;/);
```

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run:

```bash
cd www
node --test test/columns-modal.test.js
```

Expected: FAIL in `compiled themes expose the responsive compact picker` with `missing desktop Columns picker dialog rule`, because no scoped dialog-width rule exists yet.

- [ ] **Step 3: Add the minimal scoped SCSS override**

In the existing `@media (min-width: 768px)` block in `css/scss/custom/_custom.scss`, keep the `.modal-xl` rule unchanged and append:

```scss
  .modal[aria-labelledby="columnsModalLabel"] .modal-dialog {
    width: 50%;
    max-width: none;
  }
```

Do not add a mobile rule; omitting it preserves the existing Bootstrap behavior below 768px.

- [ ] **Step 4: Rebuild every theme and copied web asset**

Run:

```bash
cd css
npm run build
```

Expected: Stylelint, compilation, prefixing, minification, and copying all exit successfully. The generated CSS contains the scoped rule in each theme and the copied minified assets match their CSS build counterparts.

- [ ] **Step 5: Run the focused test and verify green**

Run:

```bash
cd www
node --test test/columns-modal.test.js
```

Expected: all Columns modal tests pass with zero failures; the unchanged tests still prove the picker stacks and selection bindings.

- [ ] **Step 6: Review and commit the independently testable CSS change**

Run:

```bash
git diff --check
git diff -- css/scss/custom/_custom.scss www/test/columns-modal.test.js
git status --short
git add css/scss/custom/_custom.scss css/dist/css www/src/public/css www/test/columns-modal.test.js
git commit -m "style: narrow desktop column picker"
```

Expected: the source diff contains only the scoped desktop override and its regression assertions; generated theme artifacts are committed with it.

---

### Task 2: Record and verify the user-visible change

**Files:**
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: the compiled shared-picker CSS contract from Task 1.
- Produces: a public changelog entry and fresh full-suite plus visual evidence that Builder and Items use the approved desktop/mobile sizing.

- [ ] **Step 1: Update the current prerelease changelog**

Under `## [2.6.1-beta] - 2026-08-07` → `### Changed`, append:

```markdown
- Reduced the shared column picker to half the viewport width on tablet and desktop screens while retaining its nearly full-width mobile layout.
```

- [ ] **Step 2: Run the complete automated verification**

Run:

```bash
cd css
npm run build
npm test
cd ../www
npm test
cd ..
node --test scripts/test/*.test.js
git diff --check
```

Expected: the CSS build and lint pass; all 169 web tests pass apart from the one documented expected skip; all 101 script tests pass; `git diff --check` prints nothing.

- [ ] **Step 3: Visually verify both shared-picker callers**

Start the existing local application stack without changing tracked Compose files. In the in-app browser, open the Columns picker on `/builder/` and `/items/` at both 1440×900 and 390×844.

At 1440×900, verify the centered dialog is approximately 720px wide, the four configured stacks remain visible when their 12rem minimum tracks fit, and no horizontal overflow appears. At 390×844, verify the dialog uses the existing nearly full-width mobile presentation and the grid reduces its tracks naturally. Confirm the toolbar, reset action, headings, category surfaces, and option controls remain legible and usable in both themes/sizes.

- [ ] **Step 4: Commit the changelog**

Run:

```bash
git add CHANGELOG.md
git commit -m "docs: record narrower column picker"
git status --short --branch
```

Expected: the feature branch is clean and contains the design commit, plan commit, scoped CSS/test commit, and changelog commit above `master`.

Deployment is not part of this plan. Ask for fresh authorization before pushing, publishing the three `linux/amd64` images, or deploying to Dunwich.
