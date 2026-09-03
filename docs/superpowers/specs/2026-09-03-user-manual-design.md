# LegendHUB User Manual Design

**Date:** 2026-09-03

**Status:** Approved in chat; awaiting review of this written specification

## Purpose

Create a durable LegendHUB user manual that explains the current application to ordinary LegendMUD players, account holders, and community content contributors. The manual will have one canonical Markdown source in the repository and will also be rendered as a player-facing page inside LegendHUB.

The first edition will prioritize common tasks, use the labels players see in the interface, and provide an advanced reference for item-search expressions and important Builder calculations. It will not cover deployment, database maintenance, role assignment, or other administrator procedures.

## Audience

The manual serves three overlapping groups:

1. Visitors browsing items, mobs, quests, and wiki pages without an account.
2. Players using an account, preferences, notifications, and synchronized Builder storage.
3. Signed-in community contributors adding or updating ordinary items, mobs, quests, and wiki pages.

Administrator-only procedures and internal service operation remain in the repository's developer and operations documentation.

## Goals

- Give a new visitor a quick path to the application's useful areas.
- Explain the public catalogs and their search, filtering, sorting, pagination, column, and preview controls.
- Provide a complete task-oriented guide to the Character Builder.
- Explain accounts, email verification, account-backed Builder storage, preferences, and notifications.
- Explain how signed-in contributors add, edit, and restore community content.
- Clearly distinguish protected official LegendMUD imports from community-maintained items.
- Provide exact advanced search syntax and the important Builder caps and formulas in reference appendices.
- Keep the source easy to review and update alongside application changes.

## Non-goals

- Administrator, deployment, Docker, database, backup, importer-operation, role-management, or permission-management instructions.
- A general LegendMUD gameplay guide.
- Documentation of controls that do not exist in the player-facing application.
- A screenshot-heavy tutorial.
- Independent database or wiki copies of the manual.
- Client-side manual search or a separate documentation application in the first edition.
- Treating suspected bugs, stale developer documentation, or uncertain implementation behavior as intentional player-facing rules.

## Chosen Approach

The canonical source will be `docs/user-manual.md`. LegendHUB will package this file in the web image, render it on the server through the existing Markdown pipeline, and expose it at `/manual/`.

This follows the existing Changelog architecture: source-controlled Markdown is loaded by the Node application and rendered into the standard EJS page shell. It avoids a second content store, works without client-side JavaScript, and preserves normal LegendHUB themes, responsive behavior, and accessibility landmarks.

### Alternatives considered

1. **Wiki-backed manual:** Rejected because the database copy could diverge from the repository source and normal content-editing workflows could modify the canonical manual.
2. **Dedicated client-side documentation application:** Rejected because client-side rendering, navigation, and state would add complexity without improving the first edition's core reading experience.

## Information Architecture

The manual will be a single article with a generated table of contents and stable heading anchors.

### 1. Welcome and Quick Start

- What LegendHUB is and how it relates to LegendMUD.
- What visitors can do without an account.
- A short map of Builder, Items, Mobs, Quests, and Wiki.
- Where to register, sign in, send feedback, and review recent changes.

### 2. Finding Game Information

- Shared catalog behavior: recent changes, search, sorting, pagination, and record links.
- Item search by name and stat expression.
- Item filter selection and visible-column selection.
- Item details, hover or keyboard previews, revision history, related mobs and quests, and official-item labels.
- Mob browsing by era and area, searching, sorting, and details.
- Quest browsing by era and area, Stat filtering, searching, and details.
- Wiki browsing by category and subcategory, searching, pinned and locked indicators, and details.
- Mobile category navigation and opening records in another tab.

### 3. Using the Character Builder

- Opening the Builder and understanding browser-local versus verified-account storage.
- Creating, selecting, renaming, and deleting character profiles.
- Creating, cloning, selecting, renaming, deleting, and promoting build variants.
- Entering the six base stats and using KSM swaps, quest modifiers, and era abilities.
- Understanding equipment rows, multiple wear slots, and the shared three-hand pool for Shield, Wield, and Hold.
- Choosing, replacing, and removing equipment.
- Searching and sorting inside Choose Item.
- Using item details and optional stat previews.
- Locking rows, locking or unlocking all rows, and clearing unlocked equipment.
- Customizing runecraft equipment where the interface offers it.
- Reading totals, parenthetical equipment contributions, restrictions, and warnings.
- Understanding autosave status, account synchronization, conflict copies, storage limits, and retry guidance.
- Importing, exporting, backing up, and sharing encoded builds.
- Choosing visible columns and applying equipment display preferences.

### 4. Accounts and Preferences

- Registering, verifying an email address, signing in, staying signed in, and signing out.
- Changing an email address and resending verification.
- Changing or recovering a password.
- Understanding which Builder data is browser-local and which data is synchronized to a verified account.
- Reviewing, exporting, and deleting synchronized Builder data.
- Selecting a theme.
- Turning item pop-up stat windows and zero-value hiding on or off.
- Choosing notification categories.
- Finding privacy and cookie information.

### 5. Contributing Information

- What a signed-in community contributor can add or edit.
- Adding and editing ordinary items, including multiple wear slots, stats, related mobs and quests, and notes.
- Adding and editing mobs, quests, and wiki pages.
- Using Markdown and the live preview for supported content fields.
- Reading revision history and restoring an earlier revision.
- Explaining that deletion requires additional permission.
- Explaining that official imported items are protected from editing, deletion, and revision restoration for now.
- Explaining the visible `Submitted by <name> via LegendMUD Import` credit on imported equipment when attribution is present.

### 6. Troubleshooting

- A build is not visible after changing browser, account, or storage mode.
- Browser-local data is unavailable because storage consent is absent or browser data was cleared.
- Builder changes remain in memory after a synchronization conflict, revision problem, or quota error.
- Imported build data is invalid, duplicated, overwritten, or skipped.
- Saved equipment now displays as deleted or fails to load.
- An item search expression is invalid.
- An expected preview does not appear on touch devices or when the preference is disabled.
- An account email or recovery action cannot be completed.
- Where and how to send feedback.

### 7. Reference

#### Item-search expression syntax

- Plain text performs a case-insensitive name search.
- Comparisons support `=`, `>`, `<`, `>=`, and `<=`, including signed values and decimals.
- Stat labels and aliases are case-insensitive.
- `and` and commas combine required conditions; `or` combines alternatives; `and` binds before `or`; parentheses override precedence.
- A name plus stat expressions uses a comma, such as `sword, strength > 15`.
- Examples will use labels available in the current interface and will not promise unsupported operators or quoted-string behavior.

#### Builder calculations

The appendix will document important player-facing rules rather than reproduce every implementation detail. It will cover:

- Valid base-stat totals and the six primary attributes.
- KSM swap validation and quest-stat choices.
- Three-hand usage and two-handed item cost.
- Unique-item, wield-weight, and limited-item warnings.
- Primary-stat caps and cap bonuses.
- Equipment and overall caps for hit, damage, spell damage, spell critical chance, regeneration, mana reduction, armor class, and mitigation where the current application defines them.
- The level-50 natural contributions used for HP, mana, movement, hit, damage, armor class, melee damage cap, spell statistics, and regeneration.
- Alignment compatibility and the meaning of an `ERROR` total.
- The meaning of parenthetical capped-equipment contributions in totals.

The current calculation implementation and its tests are authoritative when the appendix is written. Formulas will be expressed in player-readable notation and checked against `www/src/public/js/services/game-stats.js`, `www/test/game-stats.test.js`, and `www/test/builder-game-stats.test.js`.

#### Terms and abbreviations

The reference will define application-specific and commonly displayed terms such as AC, KSM, HPR, MAR, MVR, stat caps, variants, official items, and synchronized Builder data. It will not attempt to replace a general LegendMUD glossary.

## Page and Navigation Design

- Public route: `/manual/`, with `/manual` handled consistently by Express routing.
- Page title and primary heading: `LegendHUB User Manual`.
- Global navigation label: `Manual`, placed after `Wiki`.
- The page will use the existing shared header, footer, theme, responsive container, and script includes.
- The article begins with a generated table of contents.
- Table-of-contents links target stable, deterministic heading IDs.
- Duplicate heading text receives a deterministic suffix so every target remains unique.
- Instructions link directly to relevant LegendHUB routes when doing so helps the reader act immediately.
- A canonical URL identifies the public manual location.
- No screenshots or image assets are included in the first edition.

## Rendering Architecture

The implementation will add a focused manual-document loader and route while reusing `www/src/markdown.js` for safe Markdown rendering.

The Markdown document support will expose the rendered HTML plus a table-of-contents model derived from the document's headings. Heading identifiers will be generated before rendering rather than added through unsafe post-rendered string replacement. Existing HTML safety behavior remains intact: unsupported inline HTML and structural HTML blocks are escaped rather than executed.

The web Docker image will explicitly copy `docs/user-manual.md` and set or use a deterministic in-container path. The image publishing input check will include the manual source so an uncommitted manual cannot be omitted from a supposedly immutable image.

The application will load and validate the manual during startup, following the Changelog's fail-fast behavior. A missing, unreadable, or empty source will produce a clear startup error rather than a blank page.

## Editorial Rules

- Write in plain, player-friendly English using exact interface labels.
- Lead each section with the task a user is trying to complete.
- Put advanced syntax and calculations in the reference section rather than interrupting basic workflows.
- Distinguish anonymous, signed-in, and verified-account behavior whenever the difference changes an outcome.
- Describe official item protection with an explicit `for now` caveat because trusted editing may be introduced later.
- Treat deployed item metadata, such as available filters and stat columns, as configurable and avoid claiming that a development-only list is exhaustive.
- Describe current observable behavior. Do not enshrine implementation anomalies or unconfirmed semantics as product rules.
- Use concise notes or warnings only when they prevent data loss, explain an unavailable action, or resolve a likely misunderstanding.
- Keep the manual text-only in the first edition.

## Maintenance Contract

- Add developer-facing guidance that changes to player workflows, interface labels, account behavior, contributor behavior, search syntax, or Builder calculations should update `docs/user-manual.md` in the same release.
- Continue recording the user-visible change itself in root `CHANGELOG.md` under the active release.
- Structural tests will guard required top-level sections and important internal links, but reviewers remain responsible for semantic accuracy.
- Manual changes require a normal application deployment because the Markdown source is packaged in the web image and loaded at startup.

## Error Handling

- Missing, unreadable, or empty manual source: fail application startup with a path-specific error.
- Duplicate headings: assign stable numeric suffixes rather than emit duplicate IDs.
- Unsupported raw HTML: preserve the existing renderer's escaping behavior.
- Broken application links or missing required headings: fail targeted automated tests.
- Content whose deployed options may vary: explain the workflow generically and refer readers to the choices currently displayed in their interface.

## Testing and Verification

Targeted automated coverage will verify:

- The manual loader reads the canonical source and rejects missing or empty input.
- Markdown is rendered through the existing safe pipeline.
- Heading IDs are deterministic, unique, and safe for links.
- The generated table of contents matches the intended heading levels and targets.
- `/manual/` renders the standard page shell, article landmark, title, and table of contents.
- Global navigation exposes the Manual link.
- The canonical Markdown file contains every required top-level section.
- Important internal application links point at known routes.
- The Docker image includes the canonical manual source.
- The release changelog describes the new player-facing manual.

Before completion, run the focused manual tests, relevant route and Markdown tests, the full web test suite, and the production client build. Perform a browser smoke check at desktop and narrow viewport sizes to confirm table-of-contents navigation, heading order, readable line length, keyboard access, themes, and responsive layout.

## Release Impact

This is a player-facing addition. It requires an entry in root `CHANGELOG.md` and ships as part of the normal web image. It does not require database migrations, new services, changes to existing content records, or administrator configuration.
