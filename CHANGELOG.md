# Changelog

All notable user-facing changes to LegendHUB are documented here beginning
with version 2.6.0.

## [4.0.0-beta]

### Changed

- Prepared the site for a newer database engine, including account and Builder storage checks and private backups. This beta is in development; server upgrades are still pending.

## [3.2.0] - 2026-09-07

### Added

- Added a browser-readable User Manual covering game-data browsing, the Character Builder, accounts and preferences, community contributions, troubleshooting, search syntax, and important Builder calculations.
- Added Builder-style stat expressions to the main Items search, including comparisons, combined name searches, `and`/`or`, and parentheses.
- Added Account preferences to turn item stat pop-ups on or off and optionally hide zero-valued stats in equipment tables while keeping Rent visible.
- Added two-second item previews when hovering or focusing gear names in Item Search and Builder, while preserving the existing item links and new-tab actions.
- Added verified email addresses to accounts. New accounts now require an email address and receive a verification link before email-only features become available.
- Added a themed, dismissible email-verification modal after each login for existing accounts without a verified address; previously available features continue to work without one.
- Added a plain-language Privacy Policy covering account information, Builder storage, cookies, service providers, retention, and deletion requests.
- Added password recovery through a verified email address, with one-hour reset links that sign out every existing session after the password changes.
- Added account-backed Builder storage for players with a verified email address. Characters autosave separately, follow the player between work, home, and other browsers, and share a 10 MB account limit.
- Added cross-device Builder and site preferences for account storage, including themes, paging, visible columns, and the last selected character and variant.
- Added account controls to download a fresh export of every synced Builder character or permanently delete all synced Builder data after a separate confirmation.
- Added official Legend-submitted equipment to Item Search and Builder filters. Distinct observed versions of the same item remain available as separate variants.
- Official item pages now credit the character who submitted the equipment through the LegendMUD import.

### Changed

- Choose Item now centers stat headings and values while keeping item names left-aligned.
- Item names now remain visible in equipment tables and cannot be hidden from the shared column chooser.
- Item hover previews now use one predictable equipment-stat order: Slot, Rent, AC, the six primary stats, their caps, the remaining visible-column groups, and Alignment last; Mob and Quest details are omitted.
- Glass table bands now have a horizontal divider every three rows, and Builder Lock columns use only the space their controls need in every theme.
- Slot columns now stay compact in Builder and Item Search across every theme, leaving more room for item names and stats.
- Glass themes now use vertical-only separators and alternating three-row bands in Builder equipment, Item Search, and Choose Item results while keeping the existing row highlight.
- Item hover previews now use a narrower single-column layout with the item name across the top, evenly aligned labels and values, and only non-zero stats in the body.
- Builder's Choose Item search now combines item names with stat comparisons using `and`, `or`, commas, and parentheses, including `=`, `>`, `<`, `>=`, and `<=`.
- Official Legend-submitted items are protected from player editing, deletion, and history reverts for now.

- Items can now list every place they may be worn, so Item Search and Builder find the same item in each valid slot without requiring duplicate entries.
- Builder now models Legend characters' three hands with one Shield row, one Wield row, and three Hold rows, including the two-hand cost of two-handed equipment.
- Made Dark the default theme for visitors and players without a saved theme; every Glass theme remains available in the theme menu.
- Sign-in now accepts either a username or a verified email address.
- Added secure account email changes and verification resends. A verified address stays active until its replacement is verified, and the previous address receives a security notice after the change.
- Anonymous and unverified players can keep using browser-local Builder storage as before. Signing out of account storage restores only the anonymous characters already saved on that device.
- Copying Builder characters saved in a browser to an account now requires an explicit player action, keeps the browser copy intact, and safely reports copied, renamed, duplicate, or invalid characters.
- Account Builder saves now retry temporary network problems with visible status while validation, quota, conflict, and deleted-storage errors keep unsaved edits available for export instead of retrying indefinitely.

### Fixed

- Restored layered sorting in Builder's Choose Item results, keeping earlier column sorts as tie-breakers when another column is selected.
- Prevented item stat previews from appearing or staying open after following an item details link or closing the Builder item chooser.
- Prevented successful Builder account saves from being replayed as duplicate conflict characters when a temporary network problem hid the original response.
- Rendered legacy bold, italic, underline, and line-break markup in wiki content while continuing to block unsafe or structural HTML.
- Restored the Builder's default Strength, Mind, Dexterity, Constitution, Perception, Spirit, Armor Class, Alignment, and Rent columns for fresh account storage.
- Made the local Builder data copy notice readable in every theme, summarized large profile sets in scrollable dialogs, transitioned supported Builder preferences automatically, let players dismiss the notice without refreshing, and stopped preference changes from prompting players to copy the same profiles again.
- Kept the email reminder from blocking the email-verification page.
- Aligned Account Settings actions and aligned and widened the labels and entry fields across the sign-in and registration forms.
- Kept the account-storage database upgrade starting correctly on the MySQL version used by LegendHUB servers.
- Kept account verification, recovery, and synced Builder records out of the public game-content copy while retaining them in private database backups.
- Kept older exact usernames usable for sign-in and recovery while preventing a new email address from shadowing another player's username.
- Hardened verification and password-reset transitions so copied action links, concurrent password changes, and older pending actions cannot retain unintended account access.
- Added an accessible 60-second countdown after successful or rate-limited verification resends, and kept verification/reset result navigation in sync with the current sign-in state.
- Preserved both versions of a Builder character when devices edit the same profile, saving the attempted edit as a clearly named conflict copy instead of overwriting either version.
- Restored Builder and item-picker name cells as full-size click targets while keeping item names and separate details links keyboard accessible.
- Made each unlocked row in the Builder's Choose Item results clickable across every displayed stat.
- Included Increased Potential ranks in the Builder's visible Strength, Mind, Dexterity, Constitution, Perception, and Spirit cap totals.

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
