# Changelog

All notable user-facing changes to LegendHUB are documented here beginning
with version 2.6.0-beta.

## [2.6.0-beta] - 2026-08-05

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

- Corrected level-50 builder mana to use the entered quest bonus instead of assuming completed mana quests.
- Corrected builder damroll calculations to use strength alone and raise the equipment cap when strength exceeds 90.
- Corrected builder hitroll calculations to use dexterity alone and raise the equipment cap when dexterity exceeds 90.
- Fixed several form pages after the server framework upgrade.
- Fixed error responses so visitors receive the intended status and safe message.
- Fixed startup and database-update failures that could leave the site partially available.
- Fixed anonymous feedback delivery so submissions create public, triaged GitHub Issues in the maintained repository.
