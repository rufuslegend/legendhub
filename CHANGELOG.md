# Changelog

All notable user-facing changes to LegendHUB are documented here beginning
with version 2.6.0-beta.

## [2.6.0-beta] - 2026-08-05

### Added

- Added automated application and migration checks to make updates safer.
- Added repeatable database backups and a verified test-release process.

### Changed

- Updated the application platform and major server dependencies.
- Improved startup so the site waits for database updates before accepting traffic.
- Improved the reliability of builder stat calculations without intentionally changing their results.

### Fixed

- Fixed several form pages after the server framework upgrade.
- Fixed error responses so visitors receive the intended status and safe message.
- Fixed startup and database-update failures that could leave the site partially available.
