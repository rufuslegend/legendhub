# Glass Theme Family Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Emerald, Ruby, Amethyst, and Amber glass themes beside the existing default Glass Blue theme and group all five in an accessible Glass submenu.

**Architecture:** Keep theme selection in the existing Angular header controller, but split standard and glass choices so both server-rendered and client-generated headers can render the same inline submenu contract. Replace the Blue-only Sass organization with palette partials feeding one shared variable layer and one shared structural chrome layer, then generate one complete Bootstrap bundle per hue.

**Tech Stack:** AngularJS, EJS, Bootstrap 4, Sass, Lightning CSS, Node.js test runner

**Spec:** `docs/superpowers/specs/2026-08-20-glass-theme-family-design.md`

## Global Constraints

- Work on `feat/glass-theme-family`, created from `master` in an isolated worktree.
- Keep `glass-blue` as the default and preserve all existing saved theme slugs.
- Copy hue values exactly from lmproxy's Blue, Emerald, Ruby, Amethyst, and Amber glass kits.
- The Glass submenu must work by click, tap, and keyboard activation; it must not depend on hover.
- Theme cookies remain consent-gated.
- Root `docker-compose-prod.yaml` is out of scope and must remain untouched.
- Do not push, publish images, deploy, or tag without separate authorization.

---

### Task 1: Theme menu behavior

**Files:**
- Modify: `www/test/theme-controller.test.js`
- Modify: `www/test/characterization.test.js`
- Create: `www/test/theme-menu.test.js`
- Modify: `www/src/public/js/apps/legendwiki-app.js`
- Modify: `www/src/views/shared/header.ejs`

**Interfaces:**
- Consumes: existing `HeaderController($scope, $http, $cookies, $compile, breadcrumb)` and `$scope.setTheme(theme)`.
- Produces: `$scope.glassThemes`, `$scope.standardThemes`, `$scope.glassThemeMenuOpen`, and `$scope.toggleGlassThemeMenu(event)` for both header render paths.

- [ ] **Step 1: Write failing controller tests**

Assert initialization yields `['Glass Blue', 'Glass Emerald', 'Glass Ruby', 'Glass Amethyst', 'Glass Amber']` and `['Light', 'Dark', 'Solarized Dark']`. Assert `setTheme('Glass Emerald')` selects `/css/bootstrap-glass-emerald.min.css`, and persists `glass-emerald` only with cookie consent. Assert the toggle prevents the dropdown click, flips its boolean state, and handles a missing event safely.

- [ ] **Step 2: Write failing markup tests**

Render `shared/header.ejs` and inspect the client-generated header string. Require a Glass button with `ng-click="toggleGlassThemeMenu($event)"`, `ng-attr-aria-expanded`, a right/down caret class tied to the state, a nested `ng-repeat="theme in glassThemes"`, and top-level `ng-repeat="theme in standardThemes"` in both paths.

- [ ] **Step 3: Run focused tests and record RED**

Run: `node --test test/theme-controller.test.js test/characterization.test.js test/theme-menu.test.js` from `www/`.

Expected: failures because the controller still has a single `themes` array and neither header contains the Glass submenu.

- [ ] **Step 4: Implement the minimal controller and markup changes**

Initialize the two theme arrays and closed submenu state. Add a toggle that calls `preventDefault()` and `stopPropagation()` when present, then flips the state. Render an inline Glass control followed by nested hue choices and the standard choices in both header paths.

- [ ] **Step 5: Run focused tests and record GREEN**

Run: `node --test test/theme-controller.test.js test/characterization.test.js test/theme-menu.test.js` from `www/`.

Expected: all focused menu tests pass.

- [ ] **Step 6: Commit the menu behavior**

Run: `git add www/test/theme-controller.test.js www/test/characterization.test.js www/test/theme-menu.test.js www/src/public/js/apps/legendwiki-app.js www/src/views/shared/header.ejs && git commit -m "feat: group glass theme choices"`.

### Task 2: Shared glass palettes and generated bundles

**Files:**
- Modify: `www/test/glass-blue-theme.test.js`
- Create: `www/test/glass-theme-family.test.js`
- Modify: `www/test/columns-modal.test.js`
- Modify: `www/test/filters-modal.test.js`
- Create: `css/scss/custom/themes/_glass-blue-palette.scss`
- Create: `css/scss/custom/themes/_glass-emerald-palette.scss`
- Create: `css/scss/custom/themes/_glass-ruby-palette.scss`
- Create: `css/scss/custom/themes/_glass-amethyst-palette.scss`
- Create: `css/scss/custom/themes/_glass-amber-palette.scss`
- Create: `css/scss/custom/themes/_glass-theme.scss`
- Create: `css/scss/custom/themes/_glass-chrome.scss`
- Create: `css/scss/bootstrap-glass-emerald.scss`
- Create: `css/scss/bootstrap-glass-ruby.scss`
- Create: `css/scss/bootstrap-glass-amethyst.scss`
- Create: `css/scss/bootstrap-glass-amber.scss`
- Modify: `css/scss/bootstrap-glass-blue.scss`
- Delete: `css/scss/custom/themes/_glass-blue-theme.scss`
- Delete: `css/scss/custom/themes/_glass-blue-chrome.scss`
- Modify: `css/package.json`
- Modify/generated: `css/dist/css/bootstrap-glass-*`
- Modify/generated: `www/src/public/css/bootstrap-glass-*.min.css*`

**Interfaces:**
- Consumes: hue-specific variables assigned before the shared theme imports, existing Bootstrap Sass imports, existing LegendHUB `_custom.scss` picker rules.
- Produces: five independently selectable `bootstrap-glass-<hue>.min.css` bundles with one shared component contract.

- [ ] **Step 1: Write failing palette and asset tests**

Define a literal test table for each hue's lmproxy values: line, glow RGB, wash RGB, ink, backdrop, surface, well, header gradient, button gradients, accent, and focus color. Assert every entrypoint imports its palette plus shared theme/chrome; shared chrome contains component selectors while palette files do not. Assert complete dist and public asset sets exist and match.

- [ ] **Step 2: Expand picker coverage to all glass hues**

Extend Columns and Filters theme matrices to `glass-emerald`, `glass-ruby`, `glass-amethyst`, and `glass-amber`, with each hue's modal and category surface values. Require every glass choice to retain dark normal, hover, focus, and active picker states.

- [ ] **Step 3: Run focused tests and record RED**

Run: `node --test test/glass-blue-theme.test.js test/glass-theme-family.test.js test/columns-modal.test.js test/filters-modal.test.js` from `www/`.

Expected: failures for missing palette sources, entrypoints, and compiled/public assets.

- [ ] **Step 4: Implement palette-fed shared Sass**

Move hue-neutral Bootstrap variables into `_glass-theme.scss` and structural component rules into `_glass-chrome.scss`. Put only lmproxy-derived color values in each palette partial. Update Blue and add four entrypoints using the common import sequence.

- [ ] **Step 5: Extend the build pipeline and build assets**

Add four minification commands in `css/package.json`, keeping source maps and the wildcard copy step. Run `npm run build` from `css/` to compile, prefix, minify, and copy all bundles.

- [ ] **Step 6: Run focused tests and record GREEN**

Run: `node --test test/glass-blue-theme.test.js test/glass-theme-family.test.js test/columns-modal.test.js test/filters-modal.test.js` from `www/`, then `npm test` from `css/`.

Expected: palette, asset, picker, and Sass lint tests pass.

- [ ] **Step 7: Commit the theme family**

Run: `git add css/package.json css/scss css/dist/css www/src/public/css www/test && git commit -m "feat: add glass color themes"`.

### Task 3: Changelog and complete verification

**Files:**
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: completed menu and five generated glass bundles.
- Produces: player-facing release note and merge-ready verification evidence.

- [ ] **Step 1: Add the player-facing changelog entry**

Under the current `2.9.0-beta` section, note that the theme chooser now groups Glass colors and adds Emerald, Ruby, Amethyst, and Amber while Blue remains the default.

- [ ] **Step 2: Run complete verification**

Run `npm test` from `www/`; run `npm test` and `npm run build` from `css/`; run `PATH="/opt/homebrew/bin:$PATH" node --test scripts/test/*.test.js`; run the repository release/version check; run `git diff --check`; verify `git status --short` contains only planned files and `docker-compose-prod.yaml` is untouched.

- [ ] **Step 3: Request independent code review**

Review the complete `master...HEAD` diff for accessibility, cookie compatibility, exact lmproxy palette fidelity, Sass duplication/drift, build completeness, generated asset consistency, and unintended files. Resolve confirmed findings with focused RED/GREEN tests.

- [ ] **Step 4: Re-run affected and complete verification**

Repeat all checks from Step 2 after any review fixes and confirm a clean result.

- [ ] **Step 5: Commit documentation or review fixes**

Run: `git add CHANGELOG.md docs/superpowers/specs/2026-08-20-glass-theme-family-design.md docs/superpowers/plans/2026-08-20-glass-theme-family.md <review-fix-files> && git commit -m "docs: explain glass theme family"`.

- [ ] **Step 6: Hand off the local branch**

Report commit IDs and verification totals. Do not push, publish, deploy, merge, or tag until the maintainer separately authorizes those actions.
