# Glass Blue Whole-Interface Density Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Glass Blue at normal desktop browser zoom feel approximately as compact as the current theme at 80% Chrome zoom while preserving readable text and current mobile sizing.

**Architecture:** Add Glass-only density constants to the pre-Bootstrap theme partial and a single desktop media block to the post-Bootstrap chrome partial. A 75% root rem scale compacts Bootstrap's rem-based layout while inherited 1rem body/control rules resolve to 12px; explicit 11.25px grid and shared pixel values complete the spatial scale without CSS zoom or transforms.

**Tech Stack:** Bootstrap 4 SCSS, Dart Sass, PostCSS/Autoprefixer, Lightning CSS, Stylelint, Node.js built-in test runner.

## Global Constraints

- Start execution on a new feature branch created from current `master`; suggested name: `feat/glass-blue-whole-interface-density`.
- Change Glass Blue only. Light, Dark, and Solarized Dark source and generated artifacts must remain unchanged.
- At viewport widths of 768px and above, use a `0.75` type-scale target and a `0.75` space-scale target.
- Below 768px, retain current font sizes, spacing, control dimensions, responsive stacking, and touch targets.
- Keep one-pixel structural borders, existing Glass gradients and shadows, and the current visible focus-ring thickness.
- Do not use CSS `zoom`, whole-page `transform: scale(...)`, viewport metadata changes, JavaScript sizing logic, new breakpoints, or page-specific markup changes.
- Preserve the existing Columns-modal contrast behavior and all interaction, validation, disabled, hover, active, and semantic states.
- Keep the application version at its current beta value. Tighten the existing Glass Blue changelog bullet instead of adding a duplicate entry.
- Use `apply_patch` for source and test edits. The CSS build may update generated artifacts mechanically.
- Use explicit pathspecs for staging. Do not stage the pre-existing edit to `docs/superpowers/specs/2026-08-07-builder-capped-roll-stats-design.md`.
- Leave `.codex/`, `.idea/`, `package-lock.json`, root `docker-compose-prod.yaml`, and unrelated production plans/specs untouched and unstaged.
- Do not push, tag, publish images, deploy, or modify release tags.

---

## File Structure

- Modify `css/scss/custom/themes/_glass-blue-theme.scss`: define the shared density breakpoint, type scale, space scale, derived copy size, and fixed grid gutter.
- Modify `css/scss/custom/themes/_glass-blue-chrome.scss`: apply responsive Glass-only typography, rem scaling, grid gutters, fixed shared spacing, and focus-ring preservation.
- Modify `www/test/glass-blue-theme.test.js`: protect compiled desktop behavior, unchanged mobile defaults, and the prohibition on global zoom/scale hacks.
- Generate `css/dist/css/bootstrap-glass-blue.css` and its source map: expanded review artifact.
- Generate `css/dist/css/bootstrap-glass-blue.min.css` and its source map: minified distribution artifact.
- Generate `www/src/public/css/bootstrap-glass-blue.min.css` and its source map: web-served copies.
- Modify `www/test/changelog.test.js`: remove the obsolete exact-prose assertion for the Glass Blue announcement.
- Modify root `CHANGELOG.md`: tighten the existing Glass Blue release bullet.

### Task 1: Responsive whole-interface Glass density

**Files:**
- Modify: `www/test/glass-blue-theme.test.js:39-188`
- Modify: `css/scss/custom/themes/_glass-blue-theme.scss:24-29`
- Modify: `css/scss/custom/themes/_glass-blue-chrome.scss:1-276`
- Generate: `css/dist/css/bootstrap-glass-blue.css`
- Generate: `css/dist/css/bootstrap-glass-blue.css.map`
- Generate: `css/dist/css/bootstrap-glass-blue.min.css`
- Generate: `css/dist/css/bootstrap-glass-blue.min.css.map`
- Generate: `www/src/public/css/bootstrap-glass-blue.min.css`
- Generate: `www/src/public/css/bootstrap-glass-blue.min.css.map`

**Interfaces:**
- Consumes: the existing standalone Glass Blue entrypoint, Bootstrap's rem-based component sizing, the shared 30px grid gutter, and the existing mobile `max-width: 767px` category-drawer rules.
- Produces: centralized Glass density values and a compiled `@media (min-width: 768px)` density contract.
- Preserves: the builder's intentionally narrower top-row spacing, Columns-modal colors, mobile rules, one-pixel borders, and the full Glass interaction vocabulary.

- [ ] **Step 1: Add failing compiled-density regression coverage**

Insert this test before the current builder-density test in
`www/test/glass-blue-theme.test.js`:

```js
test("Glass Blue applies balanced density only above mobile", function() {
    const expanded = fs.readFileSync(path.join(
        distRoot, "bootstrap-glass-blue.css"), "utf8");

    assert.doesNotMatch(expanded, /(^|[;{]\s*)zoom\s*:/m);
    assert.doesNotMatch(expanded,
        /(?:^|})\s*(?:html|body)(?:\s*,\s*(?:html|body))*\s*\{[^}]*transform:\s*scale\(/m);

    const densityStart = expanded.lastIndexOf("@media (min-width: 768px)");
    const mobileStart = expanded.indexOf("@media (max-width: 767px)", densityStart);
    assert.ok(densityStart >= 0, "missing desktop Glass density breakpoint");
    assert.ok(mobileStart > densityStart,
        "desktop density must precede and remain separate from mobile rules");
    const density = expanded.slice(densityStart, mobileStart);

    assert.match(density, /html\s*\{\s*font-size:\s*75%;/);
    assert.doesNotMatch(density, /body,[\s\S]*font-size:/);
    assert.match(density,
        /\.container,[\s\S]*\.container-fluid\s*\{[\s\S]*padding-right:\s*11\.25px;[\s\S]*padding-left:\s*11\.25px;/);
    assert.match(density,
        /\.row:not\(\.no-gutters\)\s*\{[\s\S]*margin-right:\s*-11\.25px;[\s\S]*margin-left:\s*-11\.25px;/);
    assert.match(density,
        /\.breadcrumbList\s*\{[\s\S]*padding:\s*3\.75px 11\.25px;/);
    assert.match(density,
        /\.categoryListContainer\s*\{[\s\S]*padding:\s*0 22\.5px 0 11\.25px;/);
    assert.match(density,
        /\.cookie-consent-banner\s*\{[\s\S]*padding:\s*7\.5px 0;/);
    assert.match(density,
        /\.page-link:focus\s*\{[\s\S]*box-shadow:\s*0 0 0 0?\.266667rem rgba\(88, 170, 255, 0?\.35\);/);

    const rootSizeRules = [...expanded.matchAll(
        /html\s*\{\s*font-size:\s*75%;/g)];
    assert.equal(rootSizeRules.length, 1,
        "desktop density must not leak into the mobile base style");
});
```

Maintainer-approved correction: the no-scale guard applies to whole-page
`html`/`body` rules only, allowing existing Bootstrap component animations
such as `.spinner-grow` while still forbidding a page-level transform hack.
This test reads the actual expanded consumer artifact. The media-slice
assertions ensure the 75% root scale appears only in the desktop block, while
the base/mobile stylesheet remains unchanged. It deliberately avoids locking
tests to private SCSS variable names.

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
node --test www/test/glass-blue-theme.test.js
```

Expected: the new test fails because the compiled stylesheet does not contain
the desktop Glass density breakpoint. Existing Glass tests continue to pass.

- [ ] **Step 3: Define the density values in the Glass variable partial**

Add this block immediately after the existing `$glass-ink` declaration in
`css/scss/custom/themes/_glass-blue-theme.scss`:

```scss
$glass-density-breakpoint: 768px;
$glass-density-type-scale: .75;
$glass-density-space-scale: .75;
$glass-density-gutter: 11.25px;
```

The 75% root resolves inherited `1rem` body and control text to 12px. The
11.25px gutter is 75% of Bootstrap's current 15px column half-gutter.

- [ ] **Step 4: Add the desktop density block without changing mobile rules**

Add this block in `css/scss/custom/themes/_glass-blue-chrome.scss` immediately
before the existing `@media (max-width: 767px)` block:

```scss
@media (min-width: $glass-density-breakpoint) {
  html {
    font-size: percentage($glass-density-space-scale);
  }

  .container,
  .container-fluid {
    padding-right: $glass-density-gutter;
    padding-left: $glass-density-gutter;
  }

  .row:not(.no-gutters) {
    margin-right: -$glass-density-gutter;
    margin-left: -$glass-density-gutter;
  }

  .row:not(.no-gutters) > .col,
  .row:not(.no-gutters) > [class*="col-"] {
    padding-right: $glass-density-gutter;
    padding-left: $glass-density-gutter;
  }

  .breadcrumbList {
    padding: 3.75px 11.25px;
  }

  .categoryListContainer {
    padding: 0 22.5px 0 11.25px;
  }

  .cookie-consent-banner {
    padding: 7.5px 0;
  }

  .navbar-dark .navbar-toggler:focus,
  .form-control:focus,
  .custom-select:focus,
  .custom-file-input:focus ~ .custom-file-label,
  .btn:focus,
  .btn.focus,
  .page-link:focus {
    box-shadow: 0 0 0 .266667rem rgba(88, 170, 255, .35);
  }
}
```

Do not move or alter the existing mobile media block. Do not remove the
builder-specific `.5rem` top-row gutters: those were part of the previously
approved compact view and continue to scale through the new desktop root size.
Do not change the existing `.card-header h4` rule or Columns-modal rules.

- [ ] **Step 5: Rebuild every CSS artifact**

Run:

```bash
npm run build --prefix css
```

Expected: Sass compilation, prefixing, minification, copying, and Stylelint all
exit zero. Existing Bootstrap 4 Sass deprecation warnings may remain.

- [ ] **Step 6: Run focused verification and prove other themes did not change**

Run:

```bash
node --test www/test/glass-blue-theme.test.js
npm test --prefix css
cmp css/dist/css/bootstrap-glass-blue.min.css www/src/public/css/bootstrap-glass-blue.min.css
cmp css/dist/css/bootstrap-glass-blue.min.css.map www/src/public/css/bootstrap-glass-blue.min.css.map
git diff --exit-code -- \
  css/dist/css/bootstrap-dark.css \
  css/dist/css/bootstrap-dark.css.map \
  css/dist/css/bootstrap-dark.min.css \
  css/dist/css/bootstrap-dark.min.css.map \
  css/dist/css/bootstrap-light.css \
  css/dist/css/bootstrap-light.css.map \
  css/dist/css/bootstrap-light.min.css \
  css/dist/css/bootstrap-light.min.css.map \
  css/dist/css/bootstrap-solarized-dark.css \
  css/dist/css/bootstrap-solarized-dark.css.map \
  css/dist/css/bootstrap-solarized-dark.min.css \
  css/dist/css/bootstrap-solarized-dark.min.css.map \
  www/src/public/css/bootstrap-dark.min.css \
  www/src/public/css/bootstrap-dark.min.css.map \
  www/src/public/css/bootstrap-light.min.css \
  www/src/public/css/bootstrap-light.min.css.map \
  www/src/public/css/bootstrap-solarized-dark.min.css \
  www/src/public/css/bootstrap-solarized-dark.min.css.map
```

Expected: all commands exit zero. The focused suite includes the current
builder-density and Columns-modal contrast assertions, proving those behaviors
remain present.

- [ ] **Step 7: Perform the desktop and mobile visual gate**

With the local application running, review Glass Blue at 100% Chrome zoom at a
1440x900 desktop viewport:

```text
/
/builder/
/items/
/items/details.html?id=1
/account/
/feedback.html
/changelog
```

Open the theme menu, one dropdown, the builder Columns modal, a tooltip, and a
focusable form/button sequence. Confirm:

- the desktop interface has the compact impression of the previously approved
  compact view;
- ordinary copy remains readable and heading hierarchy remains clear;
- cards, grids, tables, controls, dropdowns, and overlays do not clip or
  overlap;
- focus rings retain their prior visible thickness;
- Columns choices retain dark normal, blue hover/focus, and distinct active
  states; and
- the layout does not cross a Bootstrap breakpoint earlier than it did before.

Then use a 390x844 mobile viewport at 100% zoom and review `/`, `/builder/`,
the mobile category drawer, and the Columns modal. Confirm font sizes, touch
targets, padding, stacking, and drawer behavior match the pre-change mobile
presentation. If Chrome control is unavailable, pause at this gate and request
the maintainer's visual confirmation from the running local build; do not
describe the visual gate as passing without that evidence.

- [ ] **Step 8: Commit the tested density implementation**

Run:

```bash
git add -- \
  css/scss/custom/themes/_glass-blue-theme.scss \
  css/scss/custom/themes/_glass-blue-chrome.scss \
  css/dist/css/bootstrap-glass-blue.css \
  css/dist/css/bootstrap-glass-blue.css.map \
  css/dist/css/bootstrap-glass-blue.min.css \
  css/dist/css/bootstrap-glass-blue.min.css.map \
  www/src/public/css/bootstrap-glass-blue.min.css \
  www/src/public/css/bootstrap-glass-blue.min.css.map \
  www/test/glass-blue-theme.test.js
git diff --cached --check
git commit -m "Compact the Glass Blue interface"
```

Expected: one commit containing only the two Glass source partials, six Glass
artifacts, and the focused regression test.

---

### Task 2: Public wording and complete verification

**Files:**
- Modify: `www/test/changelog.test.js:73-79`
- Modify: `CHANGELOG.md:8-12`

**Interfaces:**
- Consumes: Task 1's approved compact desktop presentation and the existing `2.6.1-beta` Glass Blue announcement.
- Produces: one non-duplicated public changelog bullet describing Glass Blue as compact while preserving the current version and theme availability wording.

- [ ] **Step 1: Tighten the existing bullet without adding another entry**

In root `CHANGELOG.md`, replace the existing Glass Blue bullet with exactly:

```markdown
- Added the compact Glass Blue theme as the default for visitors without a saved preference; Light, Dark, and Solarized Dark remain available.
```

Do not change the version heading or add a second Glass Blue bullet.

- [ ] **Step 2: Remove the obsolete exact-prose test**

Delete the complete `tracked changelog records the Glass Blue default theme`
test from `www/test/changelog.test.js`. Human-facing release prose is reviewed
in the final diff; automated coverage remains focused on loading, sanitizing,
and serving the changelog document.

- [ ] **Step 3: Verify the changelog behavior still passes**

Run:

```bash
node --test www/test/changelog.test.js
```

Expected: all remaining changelog document and route tests pass.

- [ ] **Step 4: Run complete verification**

Run:

```bash
node --test www/test/changelog.test.js www/test/glass-blue-theme.test.js
npm test --prefix www
npm test --prefix css
node --test scripts/test/*.test.js
cmp css/dist/css/bootstrap-glass-blue.min.css www/src/public/css/bootstrap-glass-blue.min.css
cmp css/dist/css/bootstrap-glass-blue.min.css.map www/src/public/css/bootstrap-glass-blue.min.css.map
git diff --check -- \
  CHANGELOG.md \
  css/scss/custom/themes/_glass-blue-theme.scss \
  css/scss/custom/themes/_glass-blue-chrome.scss \
  css/dist/css/bootstrap-glass-blue.css \
  css/dist/css/bootstrap-glass-blue.css.map \
  css/dist/css/bootstrap-glass-blue.min.css \
  css/dist/css/bootstrap-glass-blue.min.css.map \
  www/src/public/css/bootstrap-glass-blue.min.css \
  www/src/public/css/bootstrap-glass-blue.min.css.map \
  www/test/changelog.test.js \
  www/test/glass-blue-theme.test.js
```

Expected: focused and complete tests report zero failures; the web suite keeps
only its documented opt-in MySQL migration skip; Stylelint and script tests
exit zero; dist/public Glass assets compare byte-for-byte; and scoped whitespace
checks pass.

- [ ] **Step 5: Review the final diff and repository boundaries**

Run:

```bash
git diff --stat master
git diff --name-only master
git status --short --branch
```

Expected: the feature diff contains the two Glass SCSS partials, six Glass
generated artifacts, two tests, and `CHANGELOG.md`. The approved spec and plan
are already present on the `master` base from which the feature branch was
created. The pre-existing builder-design edit and user-owned untracked files
remain unstaged and unchanged. No other theme artifact appears in the feature
diff.

- [ ] **Step 6: Commit the public wording**

Run:

```bash
git add -- CHANGELOG.md www/test/changelog.test.js
git diff --cached --check
git commit -m "Document compact Glass Blue sizing"
```

Expected: one commit containing only the changelog and its regression test.

---

## Completion Gate

The feature is complete only when:

- Glass Blue uses the 0.75 spatial and 0.75 ordinary-type targets at widths of
  768px and above;
- Glass Blue below 768px retains its previous sizing and touch behavior;
- no global CSS zoom, scale transform, viewport, JavaScript, template, route,
  or application-behavior change was introduced;
- the builder and Columns modal retain their approved density and contrast;
- one-pixel borders and full-strength focus rings remain visible;
- Light, Dark, and Solarized Dark artifacts are unchanged;
- all six Glass distribution/public artifacts are current and synchronized;
- desktop and mobile visual gates have current evidence;
- focused, full web, CSS, and script verification pass; and
- no push, tag, image publication, or deployment occurred.
