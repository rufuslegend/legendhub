# React/EJS AngularJS Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace AngularJS with page-scoped React components and semantic EJS/HTML while preserving LegendHUB's Express routes, public behavior, data contracts, themes, and deployment model.

**Architecture:** Express and EJS remain the application shell. Vite builds stable, route-specific entry modules into a dedicated static directory. React owns only explicit roots for stateful workflows; EJS and native browser modules retain simple, server-rendered interactions. AngularJS remains available only to unmigrated pages until the final removal slice.

**Tech Stack:** Node.js 22.12+, Express 5, EJS 6, React 19, JavaScript/JSX, Vite 8, Bootstrap 4, Node's built-in test runner, Playwright, axe-core, Docker

**Spec:** `docs/superpowers/specs/2026-08-22-react-ejs-migration-design.md`

## Global Constraints

- Work through the milestones in order, but use a fresh feature branch from
  `master` for each numbered milestone. Do not keep the entire migration on one
  long-lived branch.
- Merge and, if authorized, deploy each milestone before beginning the next.
- Do not tag, push, publish images, or deploy without authorization for that
  specific action.
- Update root `CHANGELOG.md` in player-friendly language in every milestone that
  changes player-facing or player-relevant behavior.
- Do not modify root `docker-compose-prod.yaml`.
- Preserve all public routes, query parameters, GraphQL fields, cookie names,
  builder encodings, and game formulas unless a separately approved spec says
  otherwise.
- Do not add React Router, TypeScript, a global state library, a GraphQL client
  framework, or server-side React rendering during this migration.
- AngularJS and React must never own the same DOM subtree.
- Add a characterization test before replacing behavior. Make it fail for the
  missing new implementation, implement the smallest passing change, and then
  remove only the now-obsolete AngularJS code.
- Treat generated `www/src/public/build` files as build output. Never hand edit
  or commit them.
- Use GraphQL variables for all migrated user-entered values. Never interpolate
  tokens, passwords, search text, or editor text into GraphQL source.
- Never log credentials, cookie values, `.env` contents, or GraphQL bodies that
  may contain secrets.

## Milestone and branch map

| Milestone | Suggested branch | Independently releasable outcome |
|---|---|---|
| 1 | `feat/react-foundation-account` | React build pipeline and Account Settings pilot |
| 2 | `refactor/native-shared-shell` | Angular-free header, footer, notifications, and passive pages |
| 3 | `refactor/ejs-list-detail-pages` | Angular-free mob, quest, wiki, item detail/list rendering where no React is needed |
| 4 | `feat/react-content-editors` | React item, mob, quest, and wiki editor workflows |
| 5 | `feat/react-item-search` | React item search, columns, and filters |
| 6 | `feat/react-builder` | React builder with preserved calculations and encodings |
| 7 | `chore/remove-angularjs` | AngularJS packages and active source removed; audit clean |

Do not start a later milestone merely because its branch can be created. Each
checkpoint is an opportunity to validate the architectural boundary in the
running test environment.

---

## Milestone 1: React foundation and Account Settings pilot

### Task 1: Freeze the AngularJS surface and account behavior

**Files:**

- Create: `www/test/angularjs-surface.test.js`
- Create: `www/test/account-characterization.test.js`
- Modify: `www/test/characterization.test.js` only if shared helpers need to be
  extracted

- [ ] Write a source-inventory test that walks `www/src/views` and
  `www/src/public/js`, records files containing active AngularJS syntax, and
  compares them to an explicit allowlist.

The matcher must cover at least:

```js
const angularPatterns = [
    /\bng-[a-z-]+=/,
    /\bangular\.(?:module|copy)\b/,
    /\$scope\b/,
    /\$http\b/,
    /\$cookies\b/
];
```

Do not assert a raw directive count; the allowlist is the migration ratchet.
Every later slice removes migrated files from it, and the final state is empty.

- [ ] Add account characterization tests for the route-provided notification
  settings and for the existing update operations:

```js
test("account route renders all notification settings", async function() {});
test("notification mutation preserves every boolean field", async function() {});
test("password mutation distinguishes invalid and successful passwords", async function() {});
```

- [ ] Run the focused tests.

```bash
cd www
npm test -- --test-name-pattern="AngularJS surface|account"
```

Expected: PASS against the existing AngularJS implementation.

- [ ] Commit the characterization boundary.

```bash
git add www/test/angularjs-surface.test.js www/test/account-characterization.test.js
git commit -m "test: characterize AngularJS account surface"
```

### Task 2: Add the Vite build and production packaging

**Files:**

- Modify: `www/package.json`
- Modify: `www/package-lock.json`
- Modify: `www/.gitignore` or root `.gitignore`
- Create: `www/vite.config.mjs`
- Create: `www/client/package.json`
- Create: `www/client/entries/foundation.js`
- Create: `www/test/client-build.test.js`
- Modify: `www/Dockerfile`
- Modify: `DEVELOPMENT.md`

- [ ] Write `client-build.test.js` first. It must fail unless a clean client
  build produces `src/public/build/foundation.js`, produces no files outside the
  dedicated build directory, and leaves the existing public CSS and legacy JS
  intact.

- [ ] Install the pinned migration baseline.

```bash
cd www
npm install --save-dev react@19.2.8 react-dom@19.2.8 vite@8.2.2 @vitejs/plugin-react@6.1.0
```

- [ ] Raise `engines.node` from `>=22` to `>=22.12`, add
  `build:client` and `dev:client` scripts, and make both `npm test` and
  `npm run test:a11y` build client assets before they execute.

Use these script contracts:

```json
{
  "build:client": "vite build",
  "dev:client": "vite build --watch",
  "pretest": "npm run build:client",
  "pretest:a11y": "npm run build:client"
}
```

- [ ] Add `www/client/package.json` containing only `{ "type": "module" }` so
  browser library modules can be imported by focused Node tests without
  converting the Express package from CommonJS.

- [ ] Configure Vite with `publicDir: false`, one explicit `foundation` input,
  `src/public/build` as `outDir`, and stable entry names. Shared chunks retain a
  content hash.

```js
build: {
    emptyOutDir: true,
    outDir: resolve(import.meta.dirname, "src/public/build"),
    rolldownOptions: {
        output: {
            chunkFileNames: "chunks/[name]-[hash].js",
            entryFileNames: "[name].js"
        }
    }
}
```

Keep the input list explicit; a migration reviewer must be able to tell which
pages ship a React bundle.

- [ ] Add `foundation.js` as a complete, side-effect-free build probe containing
  `export {};`. Do not include it from a production EJS view. Task 4 replaces
  this input with the first real page entry.

- [ ] Ignore `www/src/public/build/` in Git.

- [ ] Convert `www/Dockerfile` to two stages based on the same explicit Node 22
  image family. The build stage runs `npm ci` and `npm run build:client`; the
  runtime stage runs `npm ci --omit=dev` and copies the built `src` tree and
  `CHANGELOG.md`. Preserve the existing entry point, port, and changelog path.

- [ ] Document the two-terminal local workflow:

```bash
cd www
npm run dev:client

# second terminal
cd www
npm start
```

- [ ] Verify both the local build and production image contents.

```bash
cd www
npm run build:client
npm test -- --test-name-pattern="client build"
cd ..
docker build --platform linux/amd64 -f www/Dockerfile -t legendhub-www:react-foundation .
docker run --rm --entrypoint sh legendhub-www:react-foundation -c 'test -s /app/src/public/build/foundation.js'
```

Expected: all commands pass; the runtime image contains the bundle but does not
contain Vite or React source directories.

- [ ] Commit the build foundation.

```bash
git add www/package.json www/package-lock.json www/vite.config.mjs www/client www/test/client-build.test.js www/Dockerfile DEVELOPMENT.md .gitignore
git commit -m "build: add page-scoped React pipeline"
```

### Task 3: Add safe server-to-React and browser-service contracts

**Files:**

- Create: `www/src/view-helpers.js`
- Modify: `www/src/create-app.js`
- Create: `www/client/lib/mount-react-root.js`
- Create: `www/client/lib/graphql-request.js`
- Create: `www/client/lib/cookies.js`
- Create: `www/client/components/PageErrorBoundary.jsx`
- Create: `www/test/view-helpers.test.js`
- Create: `www/test/client/graphql-request.test.js`
- Create: `www/test/client/cookies.test.js`

- [ ] Write failing serializer tests for quotes, ampersands, `<script>`, Unicode
  separators, `null`, arrays, and nested objects.

The public contract is:

```js
serializeJsonForHtml(value) -> string
```

The result must round-trip through `JSON.parse` and must not contain literal
`<`, `>`, `&`, U+2028, or U+2029 characters.

- [ ] Implement the serializer and expose it as
  `res.locals.serializeJsonForHtml` from `create-app.js`.

- [ ] Write failing client-library tests for:

```js
readRootProps({ name, document })
graphqlRequest({ query, variables, signal })
parseCookieHeader(header)
formatCookie(name, value, options)
```

Required behavior includes duplicate/missing root errors, inert JSON parsing,
same-origin JSON POSTs, GraphQL error normalization, abort propagation, 401/403
redirection to `/error/401.html`, encoded cookie values, and the existing
`Path=/; SameSite=Lax; Secure` defaults. Test `mountReactRoot` itself in the
browser in Task 4; do not add a second DOM implementation solely for Node tests.

- [ ] Implement the smallest passing modules. Do not add a framework around
  `fetch`; keep feature operations as ordinary modules.

- [ ] Add a page error boundary that renders an accessible recovery message and
  reload button. Do not display stack traces or response bodies.

- [ ] Run the focused tests.

```bash
cd www
npm test -- --test-name-pattern="serialize|GraphQL request|cookie|React root"
```

- [ ] Commit the integration contracts.

```bash
git add www/src/view-helpers.js www/src/create-app.js www/client/lib www/client/components/PageErrorBoundary.jsx www/test
git commit -m "feat: add safe React integration contracts"
```

### Task 4: Migrate Account Settings to React

**Files:**

- Modify: `www/src/views/account/index.ejs`
- Delete: `www/client/entries/foundation.js`
- Create: `www/client/entries/account.jsx`
- Create: `www/client/features/account/AccountSettings.jsx`
- Create: `www/client/features/account/account-api.js`
- Create: `www/client/features/account/account-reducer.js`
- Create: `www/test/client/account-reducer.test.js`
- Create: `www/accessibility/react-account.spec.js`
- Modify: `www/accessibility/support/public-page-data.js`
- Delete: `www/src/public/js/controllers/account/main.js`
- Modify: `www/test/angularjs-surface.test.js`
- Modify: `CHANGELOG.md`

- [ ] Write reducer tests before the component. Cover loading initial settings,
  entering and canceling edit mode, dirty notification values, pending saves,
  password mismatch, invalid-current-password errors, successful saves, and
  network errors.

Use explicit states rather than independent booleans:

```js
{
    notificationEditor: { status: "viewing", saved: {}, draft: {} },
    passwordEditor: { status: "viewing", oldPassword: "", newPassword: "", confirmPassword: "", error: null }
}
```

- [ ] Implement named GraphQL operations with variables in `account-api.js`.
  Preserve every existing notification field, including `changelogAdded`, and
  preserve token-renewal cookie behavior.

- [ ] Add a failing Playwright test that mounts the production account bundle
  against representative props and intercepted `/api` responses. Verify:

  - initial values and labels;
  - Edit, Save, and Cancel using keyboard controls;
  - a visible pending state and disabled double-submit;
  - password mismatch before submission;
  - invalid-current-password and network error announcements;
  - successful save and returned token persistence;
  - no axe A/AA violations in High Contrast.

- [ ] Replace the AngularJS account body with one React root plus escaped initial
  props. Keep EJS head, header, footer, canonical URL, authentication redirect,
  and route-owned initial query. Keep the page-level `ng-app` temporarily because
  the shared header and footer still need it until Milestone 2; remove only the
  account controller and all directives inside the React-owned root.

```ejs
<div data-react-root="account-settings"></div>
<script type="application/json" data-react-props="account-settings"><%-
    serializeJsonForHtml({ notificationSettings: vm.notificationSettings })
%></script>
<script type="module" src="/build/account.js?v=<%-locals.version%>"></script>
```

- [ ] Remove the account controller script and all account-workflow `ng-*`
  attributes, delete the legacy controller file, remove the temporary
  `foundation` Vite input, add the real `account` input, and shrink the
  AngularJS surface allowlist. The account EJS file remains allowlisted only for
  its shared-shell `ng-app` until Task 5.

- [ ] Add a player-friendly changelog entry describing equivalent, accessible
  account editing—not the implementation technology alone.

- [ ] Run the milestone gate.

```bash
cd www
npm test
npm run test:a11y
npm audit --audit-level=critical
cd ../css
npm test
cd ..
node scripts/verify-release-version.js
```

Expected: all tests pass; no critical advisory exists. Record the full audit
output separately and confirm the remaining high-severity result is the known
AngularJS advisory scheduled for Milestone 7.

- [ ] Commit the pilot.

```bash
git add CHANGELOG.md www
git commit -m "feat: migrate account settings to React"
```

- [ ] Stop for review, merge, and an explicitly authorized test deployment
  before beginning Milestone 2.

---

## Milestone 2: Shared shell and passive pages

### Task 5: Replace shared AngularJS shell behavior

**Files:**

- Modify: `www/src/views/shared/header.ejs`
- Modify: `www/src/views/shared/notification.ejs`
- Modify: `www/src/views/shared/notificationWindow.ejs`
- Modify: `www/src/views/shared/footer.ejs`
- Create: `www/client/entries/shell.js`
- Create: `www/client/lib/theme-menu.js`
- Create: `www/client/lib/notifications.js`
- Create: `www/client/lib/cookie-consent.js`
- Modify: `www/vite.config.mjs`
- Create: `www/test/client/theme-menu.test.js`
- Create: `www/test/client/notifications.test.js`
- Create: `www/test/client/cookie-consent.test.js`
- Modify: `www/accessibility/high-contrast.spec.js`
- Modify: `www/test/theme-controller.test.js`
- Modify: `www/test/theme-menu.test.js`
- Modify: `www/test/angularjs-surface.test.js`
- Modify: `CHANGELOG.md`

- [ ] Extend the existing theme and accessibility tests before changing markup.
  Preserve all nine themes, the expandable Glass group, focus order, stylesheet
  replacement, consent-gated persistence, and the `tzoffset` cookie.

- [ ] Replace `ng-click`, `ng-if`, `ng-repeat`, and `ng-class` in the theme menu
  with EJS-rendered choices and a small module that updates `aria-expanded`,
  `hidden`, the caret class, and `link#theme`.

- [ ] Replace the notification `ng-click` and `$compile` path with EJS-rendered
  content and a module that initializes the existing Bootstrap popover, sends
  the mark-read mutation through `graphqlRequest`, and reloads only after
  success. Announce failures without closing the popover.

- [ ] Replace `lh-cookie-consent` with a native button listener that writes the
  same cookie and removes only its nearest banner.

- [ ] Add `shell` to the explicit Vite inputs and include `shell.js` from
  `shared/scripts.ejs` after jQuery/Bootstrap but before any page bundle.

- [ ] Remove the header controller and the shell-only directives from
  `legendwiki-app.js`. Keep Angular factories still consumed by legacy pages.

- [ ] Remove `ng-app` from pages that have no remaining page-specific AngularJS
  behavior: home, feedback, cookies, notifications, changelog, and 401/404/500
  pages. Verify the fatal and generic error templates separately because they
  currently include scripts without bootstrapping AngularJS.

- [ ] Shrink the AngularJS allowlist and update the changelog.

- [ ] Run all web and accessibility tests, then commit.

```bash
cd www
npm test
npm run test:a11y
cd ..
git add CHANGELOG.md www
git commit -m "refactor: remove AngularJS from the shared shell"
```

- [ ] Stop for review and merge before Milestone 3.

---

## Milestone 3: EJS list and detail pages

### Task 6: Replace list-page directives with semantic navigation

**Files:**

- Modify: `www/src/views/mobs/index.ejs`
- Modify: `www/src/views/quests/index.ejs`
- Modify: `www/src/views/wiki/index.ejs`
- Create: `www/client/lib/responsive-category-list.js`
- Modify: `www/client/entries/shell.js`
- Create: `www/accessibility/ejs-list-pages.spec.js`
- Modify: `www/test/angularjs-surface.test.js`
- Modify: `CHANGELOG.md`

- [ ] Write browser tests for mobile category open/close, sortable headings,
  row navigation, external-detail links, keyboard operation, and current query
  preservation.

- [ ] Make sortable headings actual anchors with the existing EJS-generated
  URLs. Make the primary entity name an ordinary details anchor. Remove the
  controller-only whole-row click behavior unless it can be added as progressive
  enhancement without creating a nested interactive control.

- [ ] Replace the category backdrop directives with a small shared module using
  `aria-expanded`, `aria-controls`, and a CSS class. Preserve Escape and focus
  restoration, adding them where the AngularJS behavior lacked them.

- [ ] Delete all three inline controllers and remove `ng-app`, `ng-controller`,
  and related directives from these pages.

- [ ] Run tests and commit.

```bash
cd www
npm test
npm run test:a11y
cd ..
git add CHANGELOG.md www
git commit -m "refactor: use semantic EJS list navigation"
```

### Task 7: Server-render read-only Markdown and remove display-page AngularJS

**Files:**

- Create: `www/src/markdown.js`
- Create: `www/test/markdown.test.js`
- Modify: `www/src/routes/items.js`
- Modify: `www/src/routes/mobs.js`
- Modify: `www/src/routes/quests.js`
- Modify: `www/src/routes/wiki.js`
- Modify: `www/src/views/items/display.ejs`
- Modify: `www/src/views/mobs/display.ejs`
- Modify: `www/src/views/quests/display.ejs`
- Modify: `www/src/views/wiki/display.ejs`
- Delete after confirming no consumers: `www/src/views/shared/displayChangelog.ejs`
- Delete after confirming no consumers: `www/src/views/shared/displayChangelogEdit.ejs`
- Modify: `www/test/angularjs-surface.test.js`
- Modify: `CHANGELOG.md`

- [ ] Add tests proving expected Markdown formatting renders and unsafe links,
  raw script tags, inline event handlers, and dangerous HTML do not.

- [ ] Configure one server Markdown renderer with an explicit safe policy. Pass
  rendered HTML from routes rather than executing Markdown directives in the
  browser.

- [ ] Replace `markdown-to-html` attributes with escaped-by-policy rendered
  output, remove `shared/markdown.ejs` from read-only pages, and remove their
  `ng-app` roots.

- [ ] Confirm the two legacy `displayChangelog` partials have no EJS or browser
  consumers, then delete them rather than carrying unreachable AngularJS syntax
  into later milestones.

- [ ] Confirm page source contains meaningful content with JavaScript disabled
  and run the smoke/accessibility suites.

- [ ] Commit the server-rendered detail slice.

```bash
git add CHANGELOG.md www
git commit -m "refactor: render read-only Markdown on the server"
```

- [ ] Stop for review and merge before Milestone 4.

---

## Milestone 4: React content editors

### Task 8: Build shared editor primitives and migrate mob, quest, and wiki

**Files:**

- Add dependency: `dompurify@3.4.14`
- Create: `www/client/components/MarkdownPreview.jsx`
- Create: `www/client/components/EntityChangelogFields.jsx`
- Create: `www/client/components/CategorySelect.jsx`
- Create: `www/client/features/editors/editor-reducer.js`
- Create: `www/client/features/editors/editor-api.js`
- Create: `www/client/features/editors/MobEditor.jsx`
- Create: `www/client/features/editors/QuestEditor.jsx`
- Create: `www/client/features/editors/WikiEditor.jsx`
- Create: `www/client/entries/mob-editor.jsx`
- Create: `www/client/entries/quest-editor.jsx`
- Create: `www/client/entries/wiki-editor.jsx`
- Modify: `www/vite.config.mjs`
- Modify: `www/src/views/mobs/modify.ejs`
- Modify: `www/src/views/quests/modify.ejs`
- Modify: `www/src/views/wiki/modify.ejs`
- Create: `www/test/client/editor-reducer.test.js`
- Create: `www/accessibility/react-editors.spec.js`
- Modify: `www/test/angularjs-surface.test.js`
- Modify: `CHANGELOG.md`

- [ ] Characterize add, edit, and revert initialization; permission gating;
  required fields; category/subcategory filtering; changelog fields; mutation
  payloads; redirects; and errors for each entity.

- [ ] Install DOMPurify as a browser build dependency and add malicious-Markdown
  fixtures before implementing `MarkdownPreview`.

```bash
cd www
npm install --save-dev dompurify@3.4.14
```

- [ ] Implement a shared editor reducer whose entity-specific payload mapping
  remains in `editor-api.js`. Do not create one generic form schema that hides
  the existing domain field names.

- [ ] Replace raw `ng-init="...JSON.stringify(...)"` with escaped inert JSON
  props and mount one page root per editor.

- [ ] Verify add/edit/revert and Markdown preview paths in Playwright, including
  keyboard and axe checks, then delete the inline AngularJS controllers and
  shrink the allowlist.

- [ ] Update the changelog, run the milestone gate, and commit.

```bash
cd www
npm test
npm run test:a11y
cd ..
git add CHANGELOG.md www
git commit -m "feat: migrate content editors to React"
```

### Task 9: Migrate the item editor and entity lookups

**Files:**

- Create: `www/client/features/editors/ItemEditor.jsx`
- Create: `www/client/components/EntityLookup.jsx`
- Create: `www/client/entries/item-editor.jsx`
- Modify: `www/client/features/editors/editor-api.js`
- Modify: `www/vite.config.mjs`
- Modify: `www/src/views/items/modify.ejs`
- Create: `www/test/client/item-editor.test.js`
- Extend: `www/accessibility/react-editors.spec.js`
- Modify: `www/test/angularjs-surface.test.js`
- Modify: `CHANGELOG.md`

- [ ] Characterize item stat-category loading, stat initialization, mob and
  quest lookups, selection, add/edit/revert payloads, and rejection paths.

- [ ] Implement lookup cancellation with `AbortController` so a slower obsolete
  result cannot overwrite the latest search.

- [ ] Preserve every item field and relationship. Use GraphQL variables for
  lookup text and mutation input.

- [ ] Replace the item editor EJS body with a React root and safe props, delete
  its inline AngularJS controller, and remove its file from the allowlist.

- [ ] Run the milestone gate, commit, review, and merge.

```bash
git add CHANGELOG.md www
git commit -m "feat: migrate the item editor to React"
```

---

## Milestone 5: React item search

### Task 10: Migrate item search, columns, and filters as one ownership boundary

**Files:**

- Create: `www/client/features/items/ItemSearch.jsx`
- Create: `www/client/features/items/item-search-reducer.js`
- Create: `www/client/features/items/item-search-api.js`
- Create: `www/client/components/ColumnsDialog.jsx`
- Create: `www/client/components/FiltersDialog.jsx`
- Create: `www/client/components/Pagination.jsx`
- Create: `www/client/entries/items.jsx`
- Modify: `www/vite.config.mjs`
- Modify: `www/src/views/items/index.ejs`
- Remove after parity: `www/src/views/shared/columnsModal.ejs`
- Remove after parity: `www/src/views/shared/filtersModal.ejs`
- Delete: `www/src/public/js/controllers/items/main.js`
- Create: `www/test/client/item-search-reducer.test.js`
- Modify: `www/test/columns-modal.test.js`
- Modify: `www/test/filters-modal.test.js`
- Modify: `www/accessibility/high-contrast.spec.js`
- Modify: `www/test/angularjs-surface.test.js`
- Modify: `CHANGELOG.md`

- [ ] Add reducer characterization for initial metadata, search criteria,
  category filtering, sorting, pagination, visible-column defaults, reset,
  cookie persistence, pending searches, stale responses, and errors.

- [ ] Preserve query-string URLs as the canonical navigation representation.
  React may update results asynchronously, but loading or sharing the resulting
  URL must produce the same server-rendered result.

- [ ] Port Columns and Filters dialogs as controlled React components. Preserve
  their labels, ordering, theme classes, responsive layout, Escape behavior,
  focus trap, and focus restoration.

- [ ] Replace the page controller and templates only after existing modal tests
  pass against the React page. Remove the item controller and shrink the
  AngularJS allowlist.

- [ ] Run the milestone gate, commit, review, and merge.

```bash
cd www
npm test
npm run test:a11y
cd ..
git add CHANGELOG.md www
git commit -m "feat: migrate item search to React"
```

---

## Milestone 6: React builder

### Task 11: Extract builder state and services under characterization tests

**Files:**

- Refactor: `www/src/public/js/controllers/builder/main.js`
- Refactor: `www/src/public/js/services/game-stats.js`
- Create: `www/client/features/builder/builder-reducer.js`
- Create: `www/client/features/builder/builder-encoding.js`
- Create: `www/client/features/builder/builder-persistence.js`
- Create: `www/client/features/builder/item-constants.js`
- Extend: `www/test/builder-game-stats.test.js`
- Create: `www/test/client/builder-reducer.test.js`
- Create: `www/test/client/builder-encoding.test.js`
- Create: `www/test/client/builder-persistence.test.js`

- [ ] Inventory every `$scope` property, watcher, derived calculation, cookie,
  local transition, dialog, import/export path, and HTTP request. Map each to a
  reducer state field, pure selector, effect, or API operation before moving UI.

- [ ] Add fixtures for every supported encoded list version and representative
  character variants. For every fixture assert decode, derived totals, encode,
  and round-trip stability.

- [ ] Move constants, base-62 encoding, persistence decisions, and pure state
  transitions into ESM modules one concern at a time. Keep a temporary AngularJS
  adapter so the current builder uses each extracted module while tests remain
  green.

- [ ] Do not copy formulas into the reducer. Import the existing game-stat
  service functions through a framework-neutral export.

- [ ] Commit extraction separately from UI migration.

```bash
git add www/client/features/builder www/src/public/js www/test
git commit -m "refactor: extract builder state contracts"
```

### Task 12: Replace the builder page with React

**Files:**

- Create: `www/client/features/builder/Builder.jsx`
- Create: `www/client/features/builder/CharacterPanel.jsx`
- Create: `www/client/features/builder/EquipmentPanel.jsx`
- Create: `www/client/features/builder/StatsPanel.jsx`
- Create: `www/client/features/builder/QuestModifiersPanel.jsx`
- Create: `www/client/features/builder/EraAbilitiesPanel.jsx`
- Create: `www/client/features/builder/ImportExportDialog.jsx`
- Create: `www/client/features/builder/BuilderListsDialog.jsx`
- Create: `www/client/entries/builder.jsx`
- Modify: `www/vite.config.mjs`
- Modify: `www/src/views/builder/index.ejs`
- Delete after parity: `www/src/public/js/controllers/builder/main.js`
- Modify after parity: `www/src/public/js/services/game-stats.js`
- Create: `www/accessibility/react-builder.spec.js`
- Modify: `www/accessibility/high-contrast.spec.js`
- Modify: `www/test/angularjs-surface.test.js`
- Modify: `CHANGELOG.md`

- [ ] Write browser parity tests before replacing the page. Cover character and
  variant switching, equipment, faux objects, KSM/quest modifiers, era
  abilities, collapsed panels, all calculated totals, warnings, list import,
  list export, cookie persistence, and error recovery.

- [ ] Implement one page-level `Builder` root backed by `useReducer`. Break
  rendering into cohesive panels, but keep a single state owner so totals and
  variants cannot diverge across islands.

- [ ] Preserve existing element labels and strengthen semantics where current
  controls depend on clickable non-controls. Verify keyboard use at mobile and
  desktop widths in every theme.

- [ ] Switch the EJS page to the React root only after all characterization and
  parity tests pass. Delete the AngularJS controller, remove the final adapter
  from `game-stats.js`, and shrink the AngularJS allowlist.

- [ ] Run the full milestone gate, commit, review, and perform an explicitly
  authorized test deployment before removing AngularJS packages.

```bash
cd www
npm test
npm run test:a11y
cd ../css
npm test
cd ..
node scripts/verify-release-version.js
git add CHANGELOG.md www
git commit -m "feat: migrate the builder to React"
```

---

## Milestone 7: Remove AngularJS

### Task 13: Delete the runtime, adapters, and legacy source

**Files:**

- Modify: `www/src/views/shared/scripts.ejs`
- Delete: `www/src/views/shared/markdown.ejs`
- Delete: `www/src/public/js/apps/legendwiki-app.js`
- Delete: `www/src/public/js/ng-showdown.js`
- Delete: `www/src/public/js/showdown.min.js`
- Delete any remaining migrated controller files under:
  `www/src/public/js/controllers/`
- Modify: `www/accessibility/support/local-browser-scripts.js`
- Modify: `www/package.json`
- Modify: `www/package-lock.json`
- Modify: `www/test/angularjs-surface.test.js`
- Modify: `README.md`
- Modify: `docs/architecture.html`
- Modify: `CHANGELOG.md`

- [ ] Change the AngularJS surface test from an allowlist to a zero-tolerance
  assertion over active views, browser source, package metadata, and browser
  test substitutions.

The final scan must return no active matches:

```bash
rg -n 'ng-[a-z-]+=|angular(?:\.min)?\.js|angular-cookies|angular-sanitize|ng-showdown|\$scope|\$http|\$cookies|\$compile|\$sanitize|\$sce' \
  www/src/views www/src/public/js www/client www/package.json www/accessibility
```

Expected: exit 1 with no output. Exclude historical design and plan documents
from this gate.

- [ ] Remove AngularJS CDN tags and the application script from
  `shared/scripts.ejs`. Keep jQuery, Popper, and Bootstrap until their own
  approved migration.

- [ ] Remove `angular` and `angular-cookies` from npm. Remove local browser-script
  substitutions that exist only for them.

```bash
cd www
npm uninstall angular angular-cookies
```

- [ ] Delete the legacy application, controllers, Angular Markdown adapter, and
  vendored Showdown files only after the zero-consumer scan proves they are
  unused.

- [ ] Update README development guidance and `docs/architecture.html` to show
  Express/EJS plus page-scoped React/Vite, with AngularJS absent.

- [ ] Add a player-friendly changelog entry describing the maintained client
  foundation and preserved workflows.

- [ ] Run a clean-install and audit gate.

```bash
cd www
npm ci
npm run build:client
npm test
npm run test:a11y
npm audit
cd ../css
npm ci
npm test
cd ..
PATH=/opt/homebrew/bin:$PATH node --test scripts/test/*.test.js
node scripts/verify-release-version.js
LEGENDHUB_IMAGE_TAG=000000000000 docker compose -f docker-compose.yaml -f docker-compose.registry.yaml config --quiet
```

Expected: all tests pass, CSS lint passes, Compose validates, release metadata
matches, and the web audit contains no AngularJS advisory.

- [ ] Build and inspect the production web image without publishing it.

```bash
docker build --platform linux/amd64 -f www/Dockerfile -t legendhub-www:react-final .
docker image inspect legendhub-www:react-final --format '{{.Architecture}}/{{.Os}}'
docker run --rm --entrypoint sh legendhub-www:react-final -c 'test -s /app/src/public/build/builder.js && ! find /app -iname "*angular*" -print -quit | grep .'
```

Expected: `amd64/linux`, all required bundles exist, and no AngularJS artifact is
present in the image.

- [ ] Commit the removal.

```bash
git add CHANGELOG.md README.md docs/architecture.html www
git commit -m "chore: remove AngularJS runtime"
```

### Task 14: Final migration review and 3.0 release readiness

**Files:**

- Review: all files changed across Milestones 1-7
- Modify only if needed: `CHANGELOG.md`, `README.md`, `DEVELOPMENT.md`,
  `docs/architecture.html`

- [ ] Compare the finished tree line by line with every goal, non-goal, data
  contract, risk control, and completion criterion in the linked spec.

- [ ] Verify no placeholders were introduced.

```bash
rg -n "TODO|FIXME|placeholder|not implemented|coming soon" www/client www/src/views www/src/public/js
```

Every match must be pre-existing and intentionally retained or removed before
release.

- [ ] Verify the final diff does not alter public routes, Compose ownership,
  secrets, release tags, or production deployment files outside the approved
  scope.

- [ ] Run the complete clean-install, browser, CSS, script, Compose, audit, and
  image checks from Task 13 again from the exact proposed release commit.

- [ ] Prepare the first React release as `3.0.0` only after the maintainer
  explicitly authorizes release preparation. Release tagging, pushing, image
  publishing, and deployment each remain separate authorized actions.

- [ ] Stop and present the exact commit, verification evidence, known
  limitations, and rollback commit before any release action.
