# Changelog

All notable user-facing changes to LegendHUB are documented here beginning
with version 2.6.0.

## [3.1.0-beta] - 2026-08-26

### Added

- Added verified email addresses to accounts. New accounts now require an email address and receive a verification link before email-only features become available.
- Added a dismissible email-verification reminder after each login for existing accounts without a verified address; all features available before 3.1 continue to work without one.
- Added password recovery through a verified email address, with one-hour reset links that sign out every existing session after the password changes.

### Changed

- Sign-in now accepts either a username or a verified email address.
- Added secure account email changes and verification resends. A verified address stays active until its replacement is verified, and the previous address receives a security notice after the change.

### Fixed

- Kept older exact usernames usable for sign-in and recovery while preventing a new email address from shadowing another player's username.
- Hardened verification and password-reset transitions so copied action links, concurrent password changes, and older pending actions cannot retain unintended account access.
- Added an accessible 60-second countdown after successful or rate-limited verification resends, and kept verification/reset result navigation in sync with the current sign-in state.

## [3.0.0] - 2026-08-26

### Changed

- Modernized the client foundation behind LegendHUB's pages while preserving the familiar sign-in, account, search, list, editing, Builder, theme, and saved-preference workflows.
- Rebuilt the Character Builder with the current interactive interface while keeping saved characters, variants, item choices, imports, exports, calculated totals, and warnings working as before.
- Restored saved Builder equipment, rune charms, item details, keyboard-friendly dialogs, and copy controls after the interface update.
- Made item search, filters, visible columns, sorting, and paging respond without the legacy browser framework while keeping shareable search links and saved column choices.
- Made item editing safer and easier to use with a keyboard, including searchable mob and quest choices, save feedback, and a safe Markdown preview.
- Made mob, quest, and wiki editing safer and easier to use with a keyboard, with live save feedback and sanitized Markdown previews.
- Fixed restoring older mob, quest, and wiki revisions so renewed sign-ins and return links work correctly.
- Made item, mob, quest, and wiki details show their notes and guides immediately, including when JavaScript is unavailable.
- Made the shared navigation, theme chooser, notification menu, and cookie banner work without the legacy browser framework while keeping all nine themes and saved preferences intact.
- Made the Mobs, Quests, and Wiki lists easier to navigate: names and sortable headings are now ordinary links, while the separate new-tab details action remains available. Their mobile area and category menus now work with keyboard controls and return you to the menu button after closing.
- Made notification preferences and password changes easier to use with a keyboard, kept focus in the active account workflow, and improved clarity for assistive technology while preserving secure sign-in renewal.

### Fixed

- Hardened sign-in renewal so private session data is not written to server diagnostics.
- Prevented crafted page titles, search links, and saved theme values from changing page markup.
- Protected sign-in, sign-out, deletion, and revision restoration from cross-site requests while preserving their existing confirmations and destinations.
- Hardened item search so editable result data is loaded safely into the interactive page.
- Protected saved Builder characters when startup data is unavailable or an older save cannot be read, and restored confirmation before locking or unlocking every equipped item.
- Hardened list searches, failed sign-ins, and notifications so entered or stored names remain plain text and passwords are never echoed back into the page.
- Kept renewed sign-ins working after account changes even when optional cookie consent is not enabled.
- Made notification and item-search actions keyboard-accessible, prevented duplicate mark-read requests, and added an Items recovery prompt when the interactive page cannot render.
- Restored the Builder's compact equipment table, hover and keyboard-focus explanations for red warning cells, and scrolling inside long item-selection windows.
- Restored centered Builder equipment headers and totals at both ends of the table.
- Kept long Columns and Filters windows scrollable on small screens without moving the page behind them.
- Restored centered, compact Builder equipment rows, including lock controls, kept slot and total values on one line, and returned item names to their familiar emphasis.
- Restored the Builder's compact Character and Variant action icons and the stat-quest bonuses with their original help text.
- Restored Markdown line breaks in guides and notes, and returned editor preview cards to their familiar “Preview” heading.
- Restored emoji shortcodes in guides, notes, histories, and editor previews.
- Kept the footer at the bottom of short account, search, Builder, and editing pages after the interface update.
- Returned item-search column headings to their familiar plain appearance while retaining keyboard sorting.
- Restored the Builder item picker's wide comparison layout, familiar result-table cues, visible sorting indicators, and clearer locked-item guidance.
- Fixed the notification menu's middle action so its text remains readable in every theme.
- Restored the Builder's categorized, theme-aware column chooser with clear shown/hidden icons, compact grouping, and per-character choices.
- Restored the Builder's repeated equipment totals, keyboard-accessible stat cells, mobile Character actions, and per-character columns after deleting a character.
- Protected saved Builder lists when item details are temporarily unavailable, with a visible Retry action that restores normal items, faux objects, rune charms, and missing-item markers without discarding the original list.
- Restored complete Builder list-name validation, in-picker item unlocking, accessible warning associations, and compact Character/Stats spacing in every Glass theme.

## [2.9.0] - 2026-08-22

### Added

- **Era Abilities:** Builder characters can now record ranks for the eight era abilities that affect calculated stats. Their armor class, resource, combat, regeneration, spell, and attribute-cap bonuses are applied automatically instead of requiring faux objects.
- Added Emerald, Ruby, Amethyst, and Amber Glass themes alongside the default Glass Blue theme.
- Added a High Contrast theme with black surfaces, bright text, clear borders, and gold keyboard-focus rings.

### Changed

- Compacted the Builder by making KSM swaps, quest modifiers, and era abilities collapsible with directional indicators, aligning era abilities in three responsive columns, and allowing the Character card to size to its contents.
- Restyled item-search filters to match the compact, responsive column picker with clearer themed category surfaces.
- Kept column and filter choices comfortably dark in the Dark and Solarized Dark themes.
- Grouped the five Glass colors into an expandable theme submenu that works with mouse, touch, and keyboard controls.

### Fixed

- Updated the browser library behind interactive pages to close known HTML-handling vulnerabilities while preserving existing behavior.
- Gave the add and details icon links descriptive names for screen-reader users across Items, Mobs, Quests, and Wiki.
- Named the Builder character and variant selectors for screen-reader users.
- Underlined High Contrast content links so they remain identifiable without relying on color alone, while keeping navigation and button styling uncluttered.
- Made the login and registration panels keyboard-operable and connected login, registration, and feedback labels to their form fields for assistive technology.
- Corrected the High Contrast Builder's equipment slots and Total rows so their text stays readable on bright backgrounds.

## [2.8.3] - 2026-08-18

### Fixed

- **Armor Class:** Corrected the Builder's natural armor calculation to match LegendMUD's dexterity-based in-game rule. Skill, era-ability, and buff adjustments remain available through faux objects.

### Changed

- Enlarged the shared column picker's visibility icons for easier scanning.

## [2.7.0] - 2026-08-12

### Added

- Added the compact Glass Blue theme as the default for visitors without a saved preference; Light, Dark, and Solarized Dark remain available.

### Changed

- Allowed approved LegendMUD proxy and development sites to embed LegendHUB while continuing to block other framing origins.
- Reorganized the shared column picker into four compact, responsive columns with related stat stacks, clearer headings, raised category surfaces, and a compact reset action.
- Reduced the shared column picker to half the viewport width on tablet and desktop screens while retaining its nearly full-width mobile layout.

### Fixed

- Corrected the public changelog release text after the 2.6.0 promotion.

## [2.6.0] - 2026-08-07

### Added

- Added builder fields for character-specific quest hit points, mana, and movement.
- Added automated application and migration checks to make updates safer.
- Added repeatable database backups and a verified test-release process.

### Changed

- Updated the application platform and major server dependencies.
- Improved startup so the site waits for database updates before accepting traffic.
- Improved the reliability of builder stat calculations without intentionally changing their results.
- Updated project and issue links to the maintained LegendHUB repository.
- Temporarily hid the Discord widget and removed obsolete voting links.

### Fixed

- Added the builder's melee damage-cap total using Legend's configured base, capped-strength contribution, item modifiers, and two-handed wield bonus.
- Corrected level-50 builder movement to use Legend's current capped-dexterity-only formula while retaining entered Quest Mv and faux-item bonuses.
- Corrected builder hit point, mana, and move regeneration to match Legend's current stat bonuses and stat-adjusted equipment caps while leaving Familiar and Other-slot bonuses uncapped.
- Corrected level-50 builder hit points to mirror Legend's current base and constitution formulas while using entered Quest HP instead of assuming India quest boosts.
- Corrected level-50 builder mana to use Legend's 296 quest-less reroll base before adding entered Quest Mana.
- Corrected builder damroll to use capped current strength alone for its natural bonus and equipment cap while retaining raw over-cap warnings.
- Corrected builder hitroll to use capped current dexterity alone for its natural bonus and equipment cap while retaining raw over-cap warnings.
- Fixed several form pages after the server framework upgrade.
- Fixed error responses so visitors receive the intended status and safe message.
- Fixed startup and database-update failures that could leave the site partially available.
- Fixed anonymous feedback delivery so submissions create public, triaged GitHub Issues in the maintained repository.
