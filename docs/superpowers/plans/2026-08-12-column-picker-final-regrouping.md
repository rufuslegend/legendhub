# Column Picker Final Regrouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rearrange the shared column picker's known stat sets into the approved four columns while preserving all existing picker styling, behavior, responsive wrapping, and future-category fallback.

**Architecture:** Keep the existing shared EJS stack renderer and change only its declarative `knownStackNames` configuration, so Builder and Items remain synchronized. Exercise the real shared template through the existing Node test helper, asserting exact DOM stack order, missing-category compaction, and unknown-category placement before updating the release record.

**Tech Stack:** EJS, AngularJS template bindings, Bootstrap 4 markup, Node.js built-in test runner, npm/stylelint

## Global Constraints

- Known column 1 is exactly `Basic`.
- Known column 2 is exactly `Main`, `Limits`, `Ranged`, in that vertical order.
- Known column 3 is exactly `Regen`, `Tank`, `Melee`, in that vertical order.
- Known column 4 is exactly `Mage`, `Weapon`, in that vertical order.
- Retain the source capitalization `Regen`.
- Omit unavailable known sets without rendering an empty stack.
- Append each unknown future set as an independent column after all remaining configured stacks, in source order; with all known sets present, unknown sets begin at column 5.
- Preserve the smaller option font, `1.2rem` headings, theme surfaces, toolbar copy, compact reset action, selection/reset bindings, native button semantics, `modal-xl`, and responsive grid.
- Do not modify SCSS, generated CSS, theme assets, or root `docker-compose-prod.yaml`.
- Keep the application version at `2.6.1-beta`; do not create or move a release tag.
- Do not merge, push, publish images, or deploy without separate authorization for this pass.

---

## File Map

- `www/test/columns-modal.test.js`: renders the real shared picker partial and asserts the exact known stacks, missing-known-set behavior, and future-set fallback.
- `www/src/views/shared/columnsModal.ejs`: owns the declarative known-set grouping consumed by both Builder and Items.
- `CHANGELOG.md`: refines the current `2.6.1-beta` picker entry to describe the final four-column grouping.

### Task 1: Implement and Document the Final Four-Column Grouping

**Files:**
- Modify: `www/test/columns-modal.test.js:99-142`
- Modify: `www/src/views/shared/columnsModal.ejs:19-25`
- Modify: `CHANGELOG.md:15`

**Interfaces:**
- Consumes: `renderCategories(categories, selectedColumns)` and `renderedStackNames(html)` from `www/test/columns-modal.test.js`, plus the existing `vm.itemStatCategories` EJS view model.
- Produces: `categoryStacks: Array<Array<Category>>` in the exact approved known-set order, followed by one-element stacks for unknown categories; no public function or binding changes.

- [ ] **Step 1: Change the exact known-stack regression expectation**

Replace the expected stacks in `shared Columns modal renders the approved category stacks` with:

```js
assert.deepEqual(renderedStackNames(html), [
    ["Basic"],
    ["Main", "Limits", "Ranged"],
    ["Regen", "Tank", "Melee"],
    ["Mage", "Weapon"]
]);
```

Keep the deliberately non-grouped source input order so the test proves that
the shared configuration, rather than input order, controls the rendered DOM.

- [ ] **Step 2: Strengthen the unknown-set fallback regression**

Replace `shared Columns modal appends unknown categories in independent stacks`
with this complete-known-set case:

```js
test("shared Columns modal appends unknown categories after configured stacks", function() {
    const html = renderCategories([
        category("Future Two"),
        category("Weapon"),
        category("Tank"),
        category("Basic"),
        category("Ranged"),
        category("Main"),
        category("Future One"),
        category("Melee"),
        category("Limits"),
        category("Mage"),
        category("Regen")
    ]);

    assert.deepEqual(renderedStackNames(html), [
        ["Basic"],
        ["Main", "Limits", "Ranged"],
        ["Regen", "Tank", "Melee"],
        ["Mage", "Weapon"],
        ["Future Two"],
        ["Future One"]
    ]);
});
```

Leave `shared Columns modal omits missing known categories and empty stacks`
unchanged; its `Basic`, `Limits`, `Weapon` fixture continues to prove that
missing members and empty configured stacks collapse cleanly.

- [ ] **Step 3: Run the focused test and verify RED**

Run from `www/`:

```bash
node --test test/columns-modal.test.js
```

Expected: the two changed stack tests fail because the template still renders
the previous five-stack order; the toolbar, bindings, button semantics, theme,
and copied-asset tests remain green.

- [ ] **Step 4: Apply the minimal declarative regrouping**

Replace only `knownStackNames` in
`www/src/views/shared/columnsModal.ejs` with:

```ejs
const knownStackNames = [
    ["Basic"],
    ["Main", "Limits", "Ranged"],
    ["Regen", "Tank", "Melee"],
    ["Mage", "Weapon"]
];
```

Do not alter `knownNames`, `categoriesByName`, `categoryStacks`, either loop,
or any surrounding HTML. Those existing paths already implement omission and
unknown-category fallback correctly.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run from `www/`:

```bash
node --test test/columns-modal.test.js
```

Expected: all shared Columns modal tests pass, including exact four-stack
order, omission, unknown fallback, toolbar, bindings, compiled theme contract,
and copied assets.

- [ ] **Step 6: Refine the current changelog entry**

Under `## [2.6.1-beta]` → `### Changed`, replace the existing picker bullet
with:

```markdown
- Reorganized the shared column picker into four compact, responsive columns with related stat stacks, clearer headings, raised category surfaces, and a compact reset action.
```

- [ ] **Step 7: Run the complete verification set**

Run from the repository root:

```bash
npm test --prefix www
npm test --prefix css
git diff --check
git status --short
git diff -- \
  CHANGELOG.md \
  www/src/views/shared/columnsModal.ejs \
  www/test/columns-modal.test.js
```

Expected: the web suite passes with only the documented expected skip, CSS
lint passes, whitespace validation is silent, and the diff contains only the
approved stack configuration, matching tests, and changelog refinement. No CSS
or theme artifact appears in `git status`.

- [ ] **Step 8: Commit the working regrouping**

```bash
git add \
  CHANGELOG.md \
  www/src/views/shared/columnsModal.ejs \
  www/test/columns-modal.test.js
git commit -m "style: finalize column picker grouping"
```

- [ ] **Step 9: Perform final branch verification**

```bash
npm test --prefix www
npm test --prefix css
git diff --check master...HEAD
git status --short --branch
```

Expected: tests and CSS lint pass, the feature worktree is clean, and the
branch remains unpublished and undeployed pending an explicit integration
choice.
