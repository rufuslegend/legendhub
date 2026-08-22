# React/EJS Migration Design

**Date:** 2026-08-22

**Status:** Approved direction; ready for implementation review

## Summary

LegendHUB will replace AngularJS with React without turning the site into a
single-page application. Express will continue to own routing, authentication,
data loading, and error handling. EJS will continue to render page structure,
navigation, metadata, read-only content, and any interaction that is better
expressed as a link or native form control. React will own bounded, stateful
parts of a page and, where warranted, an entire interactive page body.

The migration will be incremental. AngularJS and React may coexist at the page
level while work is in progress, but they must never manage the same DOM
subtree. Each migration slice must be independently testable, releasable, and
reversible before the next slice begins.

This follows React's documented gradual-adoption model for existing server
applications and uses Vite as the JavaScript module and JSX build tool:

- [Add React to an Existing Project](https://react.dev/learn/add-react-to-an-existing-project)
- [Rendering a page partially built with React](https://react.dev/reference/react-dom/client/createRoot#rendering-a-page-partially-built-with-react)
- [Vite backend integration](https://vite.dev/guide/backend-integration.html)

## Decision

Use React for stateful client interfaces while preserving the Express/EJS
application boundary.

The initial frontend stack will be:

- React 19.2.8 and React DOM 19.2.8;
- Vite 8.2.2 with `@vitejs/plugin-react` 6.1.0;
- JavaScript and JSX, not TypeScript;
- the existing Node test runner for framework-neutral logic;
- the existing Playwright and axe suites for rendered behavior and
  accessibility;
- Bootstrap 4 and jQuery for the duration of this migration.

Those versions are the registry releases observed when this design was written.
The package lock, not this paragraph, will be the authoritative dependency
record after implementation begins.

This is deliberately not a React SPA. The migration will not introduce React
Router, a client-side data cache, Redux, another global state library, or a new
server-rendering framework.

## Why this shape

LegendHUB already has valuable server-rendered behavior:

- stable, linkable Express routes;
- EJS output that is useful before client JavaScript runs;
- server-owned authentication and authorization;
- metadata, canonical URLs, and error pages;
- server-rendered lists and detail pages;
- established Docker packaging and accessibility tests.

Replacing those capabilities with a SPA would increase migration risk without
addressing the actual problem, which is the unsupported AngularJS browser
runtime. React islands let the project replace the stateful AngularJS portions
while leaving the rest of the application intact.

The code should also avoid using React where HTML is clearer. A sortable table
heading can be an anchor. A row can contain a normal details link. A GET search
can remain a form. A dismissible cookie banner can be a small framework-neutral
module. Choosing React does not require converting every click handler into a
component.

## Goals

1. Remove AngularJS, `angular-cookies`, `angular-sanitize`, and `ng-showdown`
   from active source, test fixtures, browser delivery, and the dependency
   lockfile.
2. Eliminate the AngularJS high-severity `npm audit` finding without purchasing
   an extended-support runtime.
3. Preserve Express routes, EJS rendering, public URLs, GraphQL operations,
   cookie names, builder encodings, themes, responsive behavior, and user-visible
   workflows.
4. Establish a small React architecture that can be maintained alongside the
   maintainer's other React work.
5. Improve client request safety by using GraphQL variables rather than
   interpolating user values into query strings in migrated code.
6. Preserve or improve keyboard and screen-reader behavior during every slice.
7. Keep every slice deployable through the existing container workflow.

## Non-goals

- Converting the application into a SPA.
- Changing public routes, route response shapes, or the GraphQL schema.
- Replacing EJS, Express, Bootstrap, jQuery, Popper, or the CSS theme system.
- Introducing TypeScript during the AngularJS removal.
- Redesigning the interface or changing game calculations.
- Replacing the authentication model or renaming existing cookies.
- Adding server-side React rendering or hydration.
- Moving publishing or deployment into GitHub Actions.

These can be considered separately after AngularJS has been removed and the new
boundary has settled.

## Current migration surface

The active application currently has:

- 22 EJS page bodies that bootstrap `legendwiki-app`;
- 12 template-level AngularJS controllers;
- 3,307 lines across the account, builder, items, and login controller files;
- a 668-line shared AngularJS application containing theme, notification,
  cookie, category, encoding, and error-handling behavior;
- inline controllers in the mobs, quests, and wiki list and editor views;
- AngularJS Markdown rendering on item, mob, quest, wiki, and changelog content;
- 84 `ng-click`, 71 `ng-model`, 45 `ng-if`, 37 `ng-show`, and 37 `ng-repeat`
  bindings in EJS templates.

The builder is the dominant risk at 2,711 controller lines and will migrate
last, after shared framework-neutral modules and migration patterns are proven.

## Target architecture

### Request and rendering flow

```text
Browser request
      |
      v
Express route -----> authentication / database / GraphQL helpers
      |
      v
EJS page ----------> semantic HTML, metadata, initial values, React root(s)
      |                                      |
      |                                      v
      |                         inert JSON props (when needed)
      v                                      |
static CSS + legacy Bootstrap JS             v
                                      page-scoped Vite bundle
                                               |
                                               v
                                      React owns only its root
```

Express and EJS remain the page shell. A page opts into a named module bundle
only when it has migrated client behavior. The browser does not receive one
site-wide application bundle containing every page.

### Source and build layout

New browser-module source will live outside `src/public` so source and generated
artifacts cannot be confused:

```text
www/
  client/
    entries/             # one entry per migrated page or shared shell
    components/          # reusable presentational and stateful components
    features/            # account, items, editors, builder
    lib/                 # mounting, cookies, GraphQL, Markdown, utilities
  src/
    public/
      build/             # generated Vite output; never hand edited
    views/
      shared/
        client-entry.ejs # emits a page bundle tag
  vite.config.js
```

Vite will build into the dedicated `www/src/public/build` directory. It may
empty that directory, but it must never empty `www/src/public`. Entry filenames
will be stable, such as `build/account.js`; shared and lazy chunks may be hashed.
The existing application version query parameter remains the cache-busting
boundary for entry scripts.

The production Dockerfile will use a build stage that installs all dependencies
and runs the client build, followed by a runtime stage that installs only server
production dependencies and copies the built `src` tree. Browser-only packages
are build dependencies and are bundled into the emitted assets.

### React root contract

Each root has a unique name:

```html
<div data-react-root="account-settings"></div>
<script type="application/json" data-react-props="account-settings">
  {"notificationSettings":{}}
</script>
```

The actual JSON must be emitted by a server helper that escapes characters
which can terminate a script element or alter HTML parsing. Templates must not
place raw `JSON.stringify(...)` output into directives, inline executable
scripts, or HTML attributes.

Each page entry imports only the components it can mount. A shared
`mountReactRoot` helper will:

1. find exactly one root and zero or one matching props element;
2. parse inert JSON props;
3. create the React root with `createRoot`;
4. report a clear error for a missing root, duplicate root, or invalid props;
5. pass an `identifierPrefix` derived from the root name so multiple roots do
   not collide.

No AngularJS directive, controller, or jQuery mutation may operate inside a
React-owned root. Bootstrap's jQuery plugins may be initialized around a React
root only when React does not render or replace the plugin-owned subtree.

### Rendering policy

Use the smallest owner that fits the behavior:

- EJS for initial page structure, read-only data, canonical navigation, and
  content already known by the route;
- semantic HTML for navigation, sorting, GET searches, and ordinary forms;
- small framework-neutral browser modules for one-action progressive
  enhancement such as cookie consent and focus;
- React for local state, validation, asynchronous mutations, dynamic filtering,
  dialogs, editors, and the builder.

React components should own complete behavioral regions. Do not spread one
workflow across AngularJS and React, and do not use React solely to attach an
`onclick` to otherwise complete EJS markup.

### Client data contract

Migrated pages receive initial server-known data through escaped inert JSON.
They use a shared `graphqlRequest` helper for subsequent requests:

```js
graphqlRequest({ query, variables, signal }) -> Promise<data>
```

The helper will:

- POST `{ query, variables }` to `/api`;
- use `Content-Type: application/json` and same-origin credentials;
- parse GraphQL errors into a typed application error object;
- redirect HTTP 401 and 403 responses to `/error/401.html`, matching the
  AngularJS interceptor;
- support `AbortSignal` so obsolete searches can be canceled;
- never log tokens, passwords, or response bodies containing secrets.

GraphQL variables are required for user-entered strings and mutations. Existing
operation names and response fields remain unchanged.

### Cookies and authentication

The browser cookie module will preserve the existing names and semantics:

- `cookie-consent` gates optional persistence;
- `theme` stores the selected stylesheet name;
- `tzoffset` stores the browser timezone offset;
- `loginToken` stores the authentication token when consent exists;
- builder and item preferences keep their current names and formats.

Cookies continue to use `Path=/`, `SameSite=Lax`, and `Secure` where the current
application does. Authentication and authorization remain server-owned. A React
component may renew or store a token only where the AngularJS behavior already
does so.

### Markdown

Read-only Markdown should be rendered on the server with the existing
`markdown-it` dependency when the route already has the content. Editor previews
may render in the browser, but the generated HTML must be sanitized before it is
passed to `dangerouslySetInnerHTML`. The migration must not reproduce the
current `sanitize: false` and `$sce.trustAsHtml` behavior.

`DOMPurify` is the proposed browser sanitizer. Its exact allowlist must be
covered by tests for ordinary Markdown, links, formatting, and rejected script
or event-handler content.

### State ownership

No global state library will be introduced.

- simple components use `useState`;
- workflows with multiple coordinated transitions use `useReducer`;
- server calls live in feature-specific API modules built on
  `graphqlRequest`;
- persistent preferences are explicit effects through the cookie module;
- game formulas and encoders remain pure framework-neutral modules.

The builder reducer will own UI and character state, while extracted pure
services continue to own calculations and import/export formats. React
components must not duplicate game formulas.

### Error handling

Every asynchronous React workflow must expose a visible, accessible error state
and restore controls after failure. Error messages use `role="alert"` or an
equivalent live region when the message changes after an action. Unexpected
errors are caught at the page root so one failed component does not silently
leave an unusable blank region.

The migration will preserve the existing `/error/401.html` response behavior.
It will not add a telemetry vendor.

## Migration sequence

### 1. Foundation and account pilot

Add the Vite/React build, secure props serialization, mounting and request
helpers, Docker build stage, and tests. Migrate Account Settings as the first
substantial React page because it exercises initial props, local form state,
validation, authenticated queries and mutations, cookie renewal, success and
failure paths, and accessible state changes without the builder's size.

### 2. Shared shell and native-only pages

Remove AngularJS from the header, notifications, theme chooser, cookie banner,
autofocus behavior, and pages that otherwise have no AngularJS behavior. Keep
the header and footer primarily EJS-rendered. Use semantic markup and small
modules unless a region genuinely benefits from React.

### 3. Server-rendered lists and detail pages

Replace inline AngularJS click handlers on mobs, quests, and wiki lists with
links and minimal progressive enhancement. Move read-only Markdown rendering to
the server. Remove AngularJS from display pages and changelog fragments.

### 4. Content editors

Migrate the mob, quest, wiki, and item add/edit/revert workflows to React.
Create shared form, validation, category selection, entity lookup, changelog,
and sanitized Markdown preview components without changing payload semantics.

### 5. Item search

Migrate the item search controller and the shared columns and filters dialogs.
Preserve query-string navigation, visible-column cookies, filtering, sorting,
pagination, modal focus behavior, and the high-contrast accessibility contract.

### 6. Builder

Extract Angular-independent constants, encoding, state transitions, persistence,
and calculations behind characterization tests. Then migrate the builder by
cohesive panels into a page-level React root. The AngularJS builder remains the
rollback path until the React implementation passes parity tests for all list
formats, statistics, equipment, abilities, import/export, and persistence.

### 7. AngularJS removal

Remove the AngularJS application, controllers, directives, Markdown adapter,
CDN tags, local Playwright substitutions, and npm packages. Update README and
architecture documentation. Verify source scans, production image contents,
the complete test matrix, and `npm audit` before declaring the migration done.

## Testing strategy

Every slice follows red-green-refactor and adds tests before deleting the
corresponding AngularJS behavior.

### Framework-neutral tests

Use `node:test` for:

- safe JSON serialization;
- GraphQL request/error normalization with a stubbed `fetch`;
- cookie parsing and write options;
- URL and query-string builders;
- Markdown sanitization contracts where a DOM is not required;
- reducers, encoders, parsers, state transitions, and game formulas.

### Browser tests

Use Playwright for:

- root mounting and initial props;
- keyboard operation and focus restoration;
- validation and error announcements;
- successful and failed queries and mutations;
- cookies and route navigation;
- responsive sidebar and modal behavior;
- no detectable WCAG A/AA violations in every supported theme, with the
  existing high-contrast suite retained as a release gate.

External browser dependencies must be fulfilled locally in tests. React bundles
are served by Express from the build output rather than intercepted as CDN
requests.

### Characterization before replacement

Before migrating a workflow, record its current observable behavior. The test
must pass against AngularJS, then pass unchanged or with only selector ownership
updates against React. For the builder, fixtures must include every supported
encoded list version and representative boundary values for derived stats.

## Release and rollback

Each migration slice:

1. starts from `master` on its own feature branch;
2. changes one coherent ownership boundary;
3. updates root `CHANGELOG.md` in player-friendly language;
4. passes repository, web, accessibility, CSS, shell, Compose, and release
   metadata checks appropriate to the touched files;
5. is merged before the next slice starts;
6. is deployed only with explicit authorization for that deployment.

There is no runtime feature flag. Rollback is the previous immutable application
commit and its images. AngularJS files are not deleted until their final
consumer is migrated, so intermediate commits retain an in-repository rollback
implementation for the remaining legacy pages.

## Completion criteria

The migration is complete only when all of the following are true:

- no active EJS template contains `ng-*`, Angular interpolation, or inline
  AngularJS controller registration;
- no active browser source references `angular`, `$scope`, `$http`, `$q`,
  `$cookies`, `$timeout`, `$compile`, `$sanitize`, or `$sce`;
- AngularJS, `angular-cookies`, `angular-sanitize`, `ng-showdown`, and Showdown
  browser assets are not served or present in `www/package-lock.json`;
- React bundles are produced in a clean install and in the production Docker
  build for `linux/amd64`;
- all route URLs and server-rendered metadata remain stable;
- the complete repository and browser test suites pass;
- `npm audit` has no AngularJS advisory;
- README, architecture documentation, and the player changelog describe the
  resulting implementation accurately.

## Risks and controls

### Two frameworks in one page

Risk: AngularJS or jQuery mutates a React-owned subtree.

Control: roots are explicit, page bundles are opt-in, and a slice removes all
AngularJS directives inside a root before mounting React there.

### Builder regression

Risk: implicit `$scope` watchers and shared mutation hide state dependencies.

Control: builder migrates last; pure functions and reducer transitions are
characterized first; encoded outputs and game-stat fixtures are treated as
compatibility contracts.

### Script injection through initial props or Markdown

Risk: raw JSON or generated HTML escapes its intended container.

Control: one tested JSON serializer, inert script elements, GraphQL variables,
and sanitized Markdown. No template-specific serialization shortcuts.

### Build/deployment mismatch

Risk: local assets exist but production installs only runtime dependencies.

Control: multi-stage Docker build runs `npm ci` and `npm run build:client` before
the runtime stage; clean-install and container smoke tests are release gates.

### Migration scope expansion

Risk: combining React migration with routing, CSS, API, or TypeScript rewrites
makes parity difficult to assess.

Control: the non-goals are enforced per slice. Follow-up modernization happens
after AngularJS removal.

## Open decisions intentionally deferred

- TypeScript adoption after the JavaScript migration is stable.
- Bootstrap and Popper modernization.
- Whether remaining jQuery behavior should become native JavaScript or React.
- A broader GraphQL client or generated operation types.
- Server-side React rendering.

None of these decisions blocks the AngularJS replacement described here.
