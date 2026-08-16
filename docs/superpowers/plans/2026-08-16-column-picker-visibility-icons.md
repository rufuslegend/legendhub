# Shared Column Picker Visibility Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the shared Columns picker's green check and red X with the maintainer-provided green open-eye and red closed-eye SVGs at the same approximate size.

**Architecture:** Keep the state indicator in the existing shared EJS option loop so the builder and item-search pages receive the change together. Inline the supplied `currentColor` SVG geometry behind the existing `showColumn(...)` expression, and add one modal-scoped Sass rule for consistent `1em` sizing and flex behavior across all four compiled themes.

**Tech Stack:** EJS, AngularJS template directives, inline SVG, Sass, Node.js built-in test runner, Stylelint, Sass/PostCSS/Lightning CSS build pipeline.

## Global Constraints

- A visible column renders the open-eye geometry from `~/Downloads/eye.svg` with `text-success`.
- A hidden column renders the closed-eye geometry from `~/Downloads/eye-closed.svg` with `text-danger`.
- Both icons use a `0 0 24 24` view box, `currentColor`, and `1em` width and height.
- Both icons are decorative with `aria-hidden="true"` and `focusable="false"`.
- Preserve the native option buttons, `toggleColumn(...)`, `showColumn(...)`, reset behavior, category grouping, persistence, spacing, and responsive layout.
- Do not change check/X icons outside `www/src/views/shared/columnsModal.ejs`.
- Do not modify the maintainer's dirty WebStorm checkout or the downloaded source SVG files.
- Do not push, merge, publish images, deploy, or create/move a release tag without separate explicit authorization.

---

## File Structure

- `www/src/views/shared/columnsModal.ejs`: owns the picker option markup and Angular visibility-state bindings; replace only its Font Awesome state indicator.
- `css/scss/custom/_custom.scss`: owns modal-scoped shared picker layout; add the visibility icon's size and flex rule here.
- `www/test/columns-modal.test.js`: renders the real shared template and reads compiled themes; add the behavior regression and compiled sizing checks here.
- `css/dist/css/bootstrap-{light,dark,solarized-dark,glass-blue}.{css,css.map,min.css,min.css.map}`: regenerated theme artifacts from the Sass build.
- `www/src/public/css/bootstrap-{light,dark,solarized-dark,glass-blue}.min.{css,css.map}`: regenerated public copies produced by `build:copy`.

### Task 1: Replace picker state glyphs with accessible eye SVGs

**Files:**
- Modify: `www/test/columns-modal.test.js`
- Modify: `www/src/views/shared/columnsModal.ejs`
- Modify: `css/scss/custom/_custom.scss`
- Regenerate: `css/dist/css/bootstrap-{light,dark,solarized-dark,glass-blue}.{css,css.map,min.css,min.css.map}`
- Regenerate: `www/src/public/css/bootstrap-{light,dark,solarized-dark,glass-blue}.min.{css,css.map}`

**Interfaces:**
- Consumes: EJS locals `vm.itemStatCategories` and `vm.selectedColumns`; Angular expressions `showColumn(stat.short, selectedByDefault)` and `toggleColumn(stat.short)`.
- Produces: inline SVG elements selected by `ng-if`, class `columns-picker-visibility-icon`, and modal-scoped compiled CSS with `flex: 0 0 auto`, `width: 1em`, and `height: 1em`.

- [ ] **Step 1: Write the failing markup and sizing tests**

Add this test after `shared Columns modal preserves column selection bindings` in `www/test/columns-modal.test.js`:

```js
test("shared Columns modal uses colored eye icons for column visibility", function() {
    const html = renderCategories([
        category("Basic", "Str", "Strength")
    ], ["Str"]);
    const option = html.match(
        /<button\b[^>]*\bcolumns-picker-option\b[^>]*>([\s\S]*?)<\/button>/);

    assert.ok(option, "missing rendered Columns picker option");
    assert.match(option[1],
        /<svg\b[^>]*ng-if="showColumn\('Str', true\)"[^>]*class="columns-picker-visibility-icon text-success ml-2"[^>]*aria-hidden="true"[^>]*focusable="false"[^>]*>/);
    assert.match(option[1],
        /<path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0-4 0"\s*\/>/);
    assert.match(option[1],
        /<path d="M21 12q-3\.6 6-9 6t-9-6q3\.6-6 9-6t9 6"\s*\/>/);
    assert.match(option[1],
        /<svg\b[^>]*ng-if="!showColumn\('Str', true\)"[^>]*class="columns-picker-visibility-icon text-danger ml-2"[^>]*aria-hidden="true"[^>]*focusable="false"[^>]*>/);
    assert.match(option[1],
        /<path[^>]*d="M21 9q-3\.6 4-9 4T3 9m0 6l2\.5-3\.8M21 14\.976L18\.508 11\.2M9 17l\.5-4m5\.5 4l-\.5-4"\s*\/>/);
    assert.equal((option[1].match(/viewBox="0 0 24 24"/g) || []).length, 2);
    assert.equal((option[1].match(/stroke="currentColor"/g) || []).length, 2);
    assert.doesNotMatch(option[1], /\b(?:fas|fa-check|fa-times)\b/);
});
```

Inside the existing `compiled themes expose the responsive compact picker` loop, retrieve and assert the new rule:

```js
const visibilityIcon = getPickerRule(css,
    String.raw`\.columns-picker-visibility-icon`);

assert.match(visibilityIcon, /flex:\s*0 0 auto;/);
assert.match(visibilityIcon, /width:\s*1em;/);
assert.match(visibilityIcon, /height:\s*1em;/);
```

- [ ] **Step 2: Run the focused test and verify the RED state**

Run from `www/`:

```bash
node --test test/columns-modal.test.js
```

Expected: FAIL because the rendered option still contains `fas fa-check` / `fas fa-times`, no eye SVG paths, and the compiled themes have no `.columns-picker-visibility-icon` rule.

- [ ] **Step 3: Replace the shared Font Awesome indicator with the supplied SVG geometry**

In `www/src/views/shared/columnsModal.ejs`, replace the single picker-local `<i>` after the stat label with:

```ejs
<svg ng-if="showColumn('<%- stat.short _%>', <%- vm.selectedColumns.includes(stat.short) _%>)" class="columns-picker-visibility-icon text-success ml-2" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">
        <path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0-4 0" />
        <path d="M21 12q-3.6 6-9 6t-9-6q3.6-6 9-6t9 6" />
    </g>
</svg>
<svg ng-if="!showColumn('<%- stat.short _%>', <%- vm.selectedColumns.includes(stat.short) _%>)" class="columns-picker-visibility-icon text-danger ml-2" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 9q-3.6 4-9 4T3 9m0 6l2.5-3.8M21 14.976L18.508 11.2M9 17l.5-4m5.5 4l-.5-4" />
</svg>
```

Do not change any surrounding stat label, option button, category, or toolbar markup.

- [ ] **Step 4: Add the modal-scoped 1em icon rule**

In the existing `.modal[aria-labelledby="columnsModalLabel"]` block in `css/scss/custom/_custom.scss`, add this rule immediately after `.columns-picker-option`:

```scss
.columns-picker-visibility-icon {
  flex: 0 0 auto;
  width: 1em;
  height: 1em;
}
```

- [ ] **Step 5: Rebuild all theme artifacts and public copies**

Run from `css/`:

```bash
npm run build
```

Expected: Stylelint, Sass compilation, prefixing, minification, and public copy complete successfully. Only the 24 tracked generated CSS/source-map files listed under File Structure change in addition to the three hand-edited files.

- [ ] **Step 6: Run focused verification and confirm GREEN**

Run from the repository root:

```bash
(cd www && node --test test/columns-modal.test.js)
(cd css && npm test)
git diff --check
```

Expected: focused picker tests pass, Stylelint passes, and Git reports no whitespace errors.

- [ ] **Step 7: Run the complete web regression suite**

Run from `www/`:

```bash
npm test
```

Expected: 168 tests pass, zero fail, and one existing test remains skipped.

- [ ] **Step 8: Review scope and generated-copy integrity**

Run from the repository root:

```bash
git status --short
git diff --stat
git diff -- www/src/views/shared/columnsModal.ejs css/scss/custom/_custom.scss www/test/columns-modal.test.js
```

Confirm the downloaded SVG files and dirty primary checkout are unchanged, the picker is the only changed behavior, and the generated public minified files remain byte-identical to their corresponding `css/dist/css` files through the focused test.

- [ ] **Step 9: Commit the verified implementation**

```bash
git add www/src/views/shared/columnsModal.ejs \
  www/test/columns-modal.test.js \
  css/scss/custom/_custom.scss \
  css/dist/css/bootstrap-* \
  www/src/public/css/bootstrap-*
git commit -m "feat: use eye icons in column picker"
```
