# Changelog

All notable user-facing changes to LegendHUB are documented here beginning
with version 2.6.0.

## [2.9.0] - 2026-08-22

### Added

- **Era Abilities:** Builder characters can now record ranks for the eight era abilities that affect calculated stats. Their armor class, resource, combat, regeneration, spell, and attribute-cap bonuses are applied automatically instead of requiring faux objects.
- Added Emerald, Ruby, Amethyst, and Amber Glass themes alongside the default Glass Blue theme.
- Added a High Contrast theme with black surfaces, bright text, clear borders, and gold keyboard-focus rings.

### Changed

- Made item search, filters, visible columns, sorting, and paging respond without the legacy browser framework while keeping shareable search links and saved column choices.
- Made item editing safer and easier to use with a keyboard, including searchable mob and quest choices, save feedback, and a safe Markdown preview.
- Made mob, quest, and wiki editing safer and easier to use with a keyboard, with live save feedback and sanitized Markdown previews.
- Fixed restoring older mob, quest, and wiki revisions so renewed sign-ins and return links work correctly.
- Made item, mob, quest, and wiki details show their notes and guides immediately, including when JavaScript is unavailable.
- Made the shared navigation, theme chooser, notification menu, and cookie banner work without the legacy browser framework while keeping all nine themes and saved preferences intact.
- Made the Mobs, Quests, and Wiki lists easier to navigate: names and sortable headings are now ordinary links, while the separate new-tab details action remains available. Their mobile area and category menus now work with keyboard controls and return you to the menu button after closing.
- Made notification preferences and password changes easier to use with a keyboard, kept focus in the active account workflow, and improved clarity for assistive technology while preserving secure sign-in renewal.
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
