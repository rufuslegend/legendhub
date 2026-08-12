# Changelog

All notable user-facing changes to LegendHUB are documented here beginning
with version 2.6.0.

## [2.6.1-beta] - 2026-08-07

### Added

- Added the compact Glass Blue theme as the default for visitors without a saved preference; Light, Dark, and Solarized Dark remain available.

### Changed

- Allowed approved LegendMUD proxy and development sites to embed LegendHUB while continuing to block other framing origins.
- Reorganized the shared column picker into compact, responsive columns with related stat stacks, clearer headings, raised category surfaces, and a compact reset action.

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
