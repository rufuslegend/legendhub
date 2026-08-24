# LegendHUB 2.9-to-React Visual Parity Harness Design

## Purpose

Create a repeatable local comparison harness that renders the frozen Angular
2.9 release and the current React candidate from identical data and browser
state, then reports visual and structural disparities.

`https://legendhub.org` remains the ultimate visible and behavioral source of
truth. The immutable 2.9.0 release is the automated reference because it is the
released Angular implementation. If a manual production observation conflicts
with the local 2.9 rendering, the production observation wins and the harness
fixture or scenario must be corrected.

The parity phase does not introduce new accessibility-driven visual changes.
Existing security fixes and nonvisual semantic improvements remain in place.
Accessibility refinement resumes after visual and behavioral parity is
established.

## Reference and Candidate

The reference must resolve to the exact commit behind the annotated `v2.9.0`
tag:

```text
0cab3ac95826a53de19b3146d277e7056495210f
```

The runner must fail before starting containers if the tag resolves to a
different commit or if the cached reference checkout is modified. It may
create or reuse a detached worktree in ignored operator state, but must treat
that checkout as read-only.

The candidate is the current checked-out commit. Every report records the full
reference and candidate SHAs so comparisons remain reproducible.

## Stack Architecture

Each run starts two isolated, disposable Compose projects:

- Angular 2.9 reference
- Current React candidate

Each project has its own network, MySQL volume, web image, and Nginx container.
Both import the same read-only snapshot from
`data/local-stack/backups/dunwich-latest.sql.gz`. There are no database
migration differences between 2.9.0 and the current React branch, so both
applications can initialize from that snapshot independently.

Only `mysql`, `www`, and `nginx` run. Python maintenance, backup, and content
sync services are outside UI comparison scope.

A tracked parity Compose overlay supplies:

- unique localhost HTTPS ports for reference and candidate;
- the existing trusted local certificate through read-only absolute paths;
- the shared snapshot through a read-only absolute path;
- production-shaped web builds without source bind mounts;
- Google's published reCAPTCHA v2 test credentials;
- a deterministic local-only fixture imported after the snapshot.

The base Compose file comes from each checkout, ensuring each web image builds
that checkout's application. The parity overlay and operator state never
modify the tagged checkout or source snapshot.

The normal `legendhub-local` project is not reused. The runner must reject
project names, volumes, ports, and paths that overlap the existing persistent
local stack.

Docker build caching may be reused, but containers and database volumes are
removed after every run unless the operator explicitly passes `--keep`.

## Deterministic Data and Browser State

The post-snapshot fixture creates identical, local-only records needed by the
scenario matrix, including an authenticated test account with ordinary editor
permissions and stable notification data. The fixture must not mutate the
stored source snapshot or contain production credentials.

Reference and candidate use separate Playwright browser contexts. Before each
scenario, the runner sets identical:

- theme cookie;
- cookie-consent state;
- authenticated session, where required;
- Builder local storage and cookies;
- viewport and device scale factor;
- query parameters and navigation history;
- seeded form, entity, warning, and notification state.

The runner waits for the scenario's explicit readiness selector, local fonts,
application requests, and any opening transition before capture. It disables
animation during the final capture window so timing cannot create false
differences.

External widgets and changing third-party content are not comparison inputs.
Pinned local browser assets should satisfy shared runtime dependencies where
possible. CAPTCHA iframe internals and similarly uncontrollable content are
masked narrowly.

## Scenario Manifest

Scenarios live in one validated manifest. Each entry declares:

- stable name and route;
- anonymous or authenticated state;
- browser-state fixture;
- setup actions;
- reference and candidate readiness selectors;
- full-page or component capture region;
- narrow masks for genuinely volatile content;
- structural targets for text, icons, ordering, visibility, and geometry.

Reference and candidate selectors may differ because Angular and React own
different DOM structures. They must resolve to the same user-visible concept.
A missing target is a finding, not a skipped comparison.

The initial matrix covers:

- shared shell, responsive navigation, login, registration, notifications,
  account, and changelog;
- Builder with a populated character, stats, equipment, Columns, item picker,
  collapsed sections, warnings, and error states;
- Items results, sorting, Columns, Filters, and editor;
- Mob, Quest, and Wiki lists, details, history, and editors;
- Markdown preview and the Smithing guide;
- desktop and mobile layouts.

Two execution modes keep iteration practical:

- `smoke`: Glass Blue at desktop and mobile for every major surface;
- `full`: all nine supported themes at desktop and mobile.

## Capture and Comparison

Every scenario produces:

- reference PNG;
- candidate PNG;
- highlighted pixel-difference PNG;
- structural reference and candidate JSON;
- consolidated finding records.

Pixel comparison allows only a small anti-aliasing tolerance. Material pixel
changes are reported by count and percentage. Geometry, missing elements,
visible text, icon identity, control order, display state, and wrapping are
compared strictly unless a scenario declares a narrow numerical tolerance.

The existing computed-style parity comparison remains useful diagnostic data
and should be incorporated rather than duplicated. Screenshot findings answer
where the rendering differs; structural and computed-style findings explain
why.

Artifacts are written beneath an ignored `data/parity-report/` run directory.
A self-contained HTML report links each reference, candidate, and diff image,
groups repeated root differences, and includes the exact SHAs, environment,
mode, theme, viewport, and scenario.

## Triage Policy

Runs are report-only while known disparities exist. There is no general
allowlist for React redesigns.

Every finding receives one disposition:

1. Fix React to match the 2.9 reference.
2. Retain a nonvisual security or semantic implementation difference whose
   visible behavior already matches.
3. Stabilize nondeterministic fixture or capture setup.
4. Correct the automated reference when manual legendhub.org evidence proves
   the frozen local rendering is not the production behavior.

Once the accepted report is clean, `--fail-on-diff` makes any new finding a
nonzero release gate.

## Operator Interface

One repository command orchestrates checkout validation, stack startup,
readiness, capture, report creation, and cleanup. It accepts at least:

- `--mode smoke|full`;
- `--keep` to retain disposable stacks after a run;
- `--fail-on-diff` once the baseline is clean.

Failures identify the phase, project, service, and scenario without printing
credentials, database contents, or environment files. Cleanup runs after both
success and failure unless `--keep` was explicit. Cleanup targets only exact,
validated parity project names and volumes.

## Testing Strategy

Implementation follows strict red-green TDD.

Unit tests cover:

- reference SHA and manifest validation;
- snapshot-key and finding consolidation behavior;
- pixel thresholds and dimension mismatches using literal PNG fixtures;
- structural missing, text, icon, order, visibility, wrapping, and geometry
  differences;
- report generation and nonzero exit behavior.

Compose and orchestration tests prove:

- distinct projects, networks, ports, and volumes;
- the same read-only source snapshot feeds both empty databases;
- only MySQL, web, and Nginx are started;
- local certificate and fixture mounts are read-only;
- the persistent `legendhub-local` project cannot be targeted;
- success, startup failure, capture failure, and interruption clean up only
  disposable resources;
- `--keep` preserves only the two parity projects.

An integration test renders deliberately different controlled pages and must
produce a reference image, candidate image, visible diff, structural finding,
and report entry. Restoring parity must make that focused test green.

The normal Node, Playwright, stylesheet, release, and Compose gates remain
required before the harness is considered complete.

## Completion Criteria

The harness is complete when:

- one command can create both clean stacks from the same snapshot;
- the exact 2.9.0 and candidate SHAs are recorded and verified;
- smoke and full matrices produce reproducible artifacts;
- deliberate pixel and structural mutations are detected;
- an operator can identify each disparity from the HTML report;
- cleanup cannot affect the existing local stack;
- all focused and repository-wide verification gates pass;
- no images are published and no remote environment is changed.
