# LegendHUB 3.1 Account Storage Design

**Date:** 2026-08-26

**Status:** Implemented

**Target:** LegendHUB 3.1.0

## Summary

LegendHUB 3.1 adds verified email addresses, password recovery, and
account-backed Builder storage. Players may continue to use the Builder
anonymously with browser-local storage. Players with a verified account may
copy their anonymous data into their account and automatically synchronize
characters and preferences across browsers.

Account and anonymous data remain separate. LegendHUB never silently uploads
anonymous data, never silently overwrites a character during migration or
synchronization, and does not expose account-backed data after logout.

## Goals

- Require a unique email address for newly registered accounts.
- Verify email ownership before enabling account-backed storage.
- Let grandfathered accounts retain all existing functionality without an
  email address while prompting them after every login to add and verify one.
- Allow login with either username or verified email.
- Provide secure password recovery through verified email.
- Synchronize Builder characters, variants, and useful preferences between
  work, home, and other browsers.
- Preserve complete anonymous Builder use through localStorage.
- Provide an explicit, non-destructive migration from anonymous storage to
  account storage.
- Prevent stale browsers from silently overwriting or recreating newer data.
- Keep the existing compact Builder representation and import/export format.

## Non-goals

The 3.1 release does not add:

- Public profiles or public access to account-backed Builder data.
- Character sharing between accounts.
- Collaborative or real-time multi-user editing.
- Offline editing of account-backed profiles.
- A fully relational schema for individual stats, equipment slots, or charms.
- Synchronization of device-specific consent, authentication, or timezone
  state.

## Current Behavior

Accounts currently contain a username and password. Login sessions use
database-backed authentication tokens stored in a secure browser cookie.
There is no email delivery, verification, or recovery flow.

The Builder stores its versioned compact character payload in localStorage
under `cln` and its current character/variant selection under `scl`. It can
read legacy `cl`, `cl1`, and `cl2` values. Builder columns and paging are
stored in cookies. Theme and item-search column preferences are also stored
in cookies. Anonymous persistence requires the existing cookie-consent state.

## Storage Modes

### Anonymous mode

Anonymous and unverified players use the current browser-local persistence
path. They can create, edit, import, export, and delete Builder characters
without an account or network-backed storage.

### Account mode

A logged-in player with a verified email uses account-backed profiles and
preferences as the active Builder state. Account data is fetched from the
server and retained in application memory, not copied into the anonymous
localStorage namespace.

### Logout

Logging out removes account-backed profiles from the active interface and
restores any anonymous data that existed in that browser. Account data must
not remain accessible through anonymous Builder state after logout.

## Email and Account Rules

### Email identity

- New accounts require an email address at registration.
- Email uniqueness is case-insensitive.
- The stored display address preserves the player's casing while a normalized
  address is used for uniqueness and lookup.
- Normalization trims surrounding whitespace and lowercases the complete
  address. It does not apply provider-specific rules such as removing dots or
  plus-address suffixes.
- Only verified email addresses may be used to log in or recover a password.
- Usernames remain valid login identifiers.
- Recovery and resend endpoints return generic public responses so they do not
  reveal whether an account or email exists.

### New accounts

Registration collects username, email, password, password confirmation, and
the existing CAPTCHA. The account is created in an unverified state and the
application attempts to deliver the verification message. A delivery failure
leaves the account pending and exposes the rate-limited resend path.

An unverified new account may sign in far enough to change its pending email
or resend verification. It continues to use anonymous Builder storage and
cannot use account-backed storage until verification succeeds.

### Grandfathered accounts

Existing members retain all capabilities they had before 3.1. They are not
locked out for lacking a verified email. After every login, LegendHUB shows a
prominent prompt to add or verify an email. The prompt may be dismissed for
that login session, but returns after the next login until verification is
complete.

Account-backed Builder storage requires a verified email for both new and
grandfathered accounts.

### Verification

- Verification links are single-use and expire after 24 hours.
- Resending is rate-limited and invalidates older verification tokens for the
  same action.
- Verification atomically marks the active or pending email as verified.
- Successful verification enables email login and account-backed storage.

### Email changes

- Adding or changing an email requires the current password.
- A verified existing address remains active until the replacement is
  verified.
- A pending replacement cannot be used to log in or recover the password.
- Verification promotes the replacement atomically.
- The old verified address receives a security notification after promotion.

### Password recovery

- Recovery requests are rate-limited by source IP and normalized email.
- A matching verified account receives a single-use reset link that expires
  after one hour.
- A successful reset changes the password, consumes the reset token, and
  invalidates every login session in one transaction.
- The reset browser is not automatically signed in.
- A password-changed notification is sent after the transaction succeeds.

## Database Design

All database changes are additive so the 3.0 application remains compatible
with the migrated database during an application rollback.

### Members

Add nullable fields for:

- Display email address.
- Normalized email address.
- Email verification timestamp.
- Pending display and normalized email address when changing email.

The normalized active email has a unique index. Multiple legacy rows may keep
null email values. The account service also reserves pending normalized
addresses transactionally so an address cannot be active or pending for more
than one account at a time. Abandoning, replacing, consuming, or expiring a
pending change releases its reservation.

### Account action tokens

An account-action token table records:

- Member ID.
- Purpose: verification, email change, or password recovery.
- Selector.
- Hashed validator.
- Pending email data when required by the action.
- Creation and expiration timestamps.
- Consumption or invalidation state.

Only the selector and hashed validator are stored. The raw validator appears
only in the delivered link. Token verification uses constant-time comparison.

### Builder profiles

Each Builder character is stored separately with:

- Stable profile ID.
- Owning member ID.
- Character name.
- Versioned compact Base62 text payload containing every variant for that
  character.
- Payload-format version.
- Monotonic revision.
- Creation and update timestamps.
- Deletion marker and deletion timestamp.

Character names remain case-sensitive and unique per active account, using
the same naming rules as the current Builder. A deletion marker prevents a
stale browser from recreating a profile under the old identity. Retention and
cleanup of old deletion markers may be added operationally without changing
client behavior.

Deleting a profile clears its payload while retaining the minimum identity,
revision, and deletion metadata required to reject stale updates. Deleted
payloads do not count toward the account quota.

The payload uses a text column rather than a binary database BLOB. The compact
representation remains the exchange format, but it is decoded and validated
before storage.

### Account preferences

One row per member stores a versioned preference document and a monotonic
revision. It also stores an account-storage generation used to invalidate
stale clients after a delete-all operation. The preference document includes:

- Theme.
- Items per page.
- Item-search columns.
- Builder columns keyed by stable profile ID.
- Last selected profile and variant.

Cookie consent, login tokens, and timezone remain device-specific and are not
synchronized.

### Quota

Account-backed Builder data has a 10 MB total limit, matching the storage
expectation already shown by the Builder. One encoded profile may consume up
to that remaining quota, and one import request may carry at most 10 MB of
encoded profile data plus its small request envelope. Limits are calculated
from encoded bytes on the server rather than client-reported usage.

## Shared Builder Codec

Move the Builder encoder and decoder into an environment-neutral shared
module used by both the React client and the Node API. It must preserve all
currently supported legacy formats and the current import/export contract.

Before creating or updating a profile, the server:

1. Enforces request and payload size limits.
2. Rejects unsupported format versions.
3. Decodes the complete payload.
4. Confirms it represents exactly one character.
5. Confirms every encoded variant uses the row's character name.
6. Applies current character, variant, stat, item, and charm validation.
7. Re-encodes or otherwise confirms a canonical supported representation.

The API never treats the payload as trusted merely because it originated from
the LegendHUB client.

## API Design

Extend the existing GraphQL API with protected operations for:

- Reading all active profiles and account preferences.
- Creating a profile.
- Updating a profile with its expected revision.
- Deleting a profile with its expected revision.
- Updating preferences with their expected revision.
- Importing a batch of anonymous profiles with idempotency keys.
- Exporting and deleting all account-backed Builder data.
- Reading account email and verification status.
- Adding or changing an email after password confirmation.
- Resending verification.

Extend the public authentication API with operations for:

- Registering with an email address.
- Verifying an email action token.
- Requesting password recovery by username or email.
- Completing password recovery with a reset token.
- Logging in by username or verified email.

Every protected resolver derives the member ID from the login token. No
profile or preference resolver accepts a caller-supplied account ID as proof
of ownership.

Profile mutations include the client's last observed account-storage
generation. They return the stable profile ID, accepted revision, update
timestamp, current generation, and current quota usage. A revision or
generation conflict returns structured conflict information rather than a
generic database error.

## Anonymous-to-Account Migration

LegendHUB never uploads anonymous data without a player's explicit action.
After verified login, the Builder fetches account state and checks for local
anonymous profiles. If local data exists, it offers an import screen listing
the profiles to be copied.

The primary action is **Copy all to my account**. Migration copies data; it
does not delete the anonymous source.

For each local profile:

- An identical account profile is deduplicated.
- A distinct name is imported normally.
- A same-name profile with different content is imported as `Name Local`,
  with a numeric suffix if necessary. The generated name stays within the
  current codec's letters, digits, and spaces rule.
- A malformed or unsupported profile is skipped and reported without blocking
  valid profiles.

Each item has an idempotency key so retrying an interrupted migration cannot
create duplicate profiles. The completion report lists copied, renamed,
deduplicated, and rejected profiles.

Local preferences are offered as part of the same explicit migration. When
the account has no stored preferences, importing them is selected by default.
When account preferences already exist, keeping the account preferences is
selected by default and the player may explicitly choose this browser's
preferences instead. Device-specific state is never included.

After import or dismissal, the browser records a locally calculated SHA-256
fingerprint of the anonymous dataset against a server-provided opaque storage
namespace. The same unchanged local data is not offered again on every login.
A later anonymous-data change causes the import offer to return. This
acknowledgement contains no account Builder payload and does not make account
data available after logout.

## Synchronization

Verified account changes autosave 750 milliseconds after the last edit,
preserving the
Builder's current automatic-persistence behavior. The interface exposes an
accessible state of `Saving…`, `Saved to account`, or `Sync problem`.

### Profile updates

Each update supplies the last observed revision.

- If it matches, the server validates the payload, writes it, and increments
  the revision.
- If it is stale, the newer server profile remains under the original name.
  The attempted client state is preserved as a newly named `Name Conflict`
  copy, with a numeric suffix if necessary, and the interface reports the
  conflict.
- If the profile was deleted, its deletion marker prevents an old client from
  silently restoring it. The old client's attempted edit is preserved as a
  conflict copy instead.
- If the account-storage generation changed because the player used **Delete
  all synced Builder data**, the stale client is rejected and may export its
  in-memory state, but it cannot recreate deleted data automatically.

Changing one character never creates a revision conflict for an unrelated
character.

### Preference updates

Preferences synchronize independently from profiles. Preference conflicts are
low-risk: the server accepts the complete valid preference document and the
last committed update wins. A preference failure must not block or misreport
profile persistence.

### Network failures

When saving fails, the current edit remains in memory, the UI reports a sync
problem, and the client retries after 1, 2, 4, 8, 16, and at most 30 seconds.
Authentication, validation, quota, deletion-generation, and revision errors
do not retry automatically. The client must never show `Saved` before the
server confirms the write. Export remains available as a recovery path.

Offline account editing is not supported: a profile loaded before connection
loss remains visible, but the UI clearly reports that subsequent changes are
not yet stored.

## Player Interface

### Login and registration

- Registration includes required email and clear verification messaging.
- Login is labeled **Username or email**.
- Login provides a **Forgot password?** action.
- Verification, resend, and recovery use the existing LegendHUB shell.

### Verification prompt

The post-login prompt explains why email is requested and that existing
features remain available. It links directly to adding or verifying the
address and can be dismissed for the current login session.

### Account settings

Add an Email section showing:

- Current verified address, if any.
- Pending address, if any.
- Verification state.
- Resend action and cooldown state.
- Password-protected add/change flow.

Account settings also shows Builder storage usage and provides:

- **Export all Builder data**.
- A separately confirmed **Delete all synced Builder data** action.

Delete-all marks every active profile deleted and increments the
account-storage generation in one transaction. Tabs holding the prior
generation cannot repopulate the account through autosave.

### Builder

The Builder identifies the active storage mode:

- **Saved in this browser** for anonymous or unverified use.
- **Saving…**, **Saved to account**, or **Sync problem** for account use.

It provides the local-data import prompt, migration result report, and visible
identification of imported or synchronization conflict copies. Existing
per-character import and export continue working.

All new prompts, forms, dialogs, pending states, errors, and status changes
follow the current React focus-management patterns and use appropriate live
regions for assistive technology.

## Email Delivery

Use a small SMTP-backed mail module configured exclusively through environment
variables. Application code exposes purpose-specific operations such as
sending verification, email-change, and password-reset messages. Tests inject
a fake transport and never contact a real mail server.

Mail failures leave the requested action pending and provide a safely
rate-limited resend path. Deployment preflight verifies required mail
configuration without printing credentials.

## Security and Privacy

- Passwords continue to use the existing password-hashing boundary.
- Raw action tokens, passwords, SMTP credentials, email addresses, and Builder
  payload contents never appear in application logs or error responses.
- Sensitive form submissions and authenticated mutations retain the existing
  cross-site request protections.
- Verification and reset tokens are random, hashed at rest, purpose-bound,
  expiring, single-use, and invalidated when replaced.
- Account ownership is checked for every profile and preference operation.
- Recovery responses do not disclose account existence.
- Registration, login, resend, recovery, verification, import, and save paths
  receive appropriate rate and size limits.
- Account-backed data is never made public and never copied into anonymous
  storage automatically.

Operational logs may record action type, outcome category, and opaque member
or request identifiers. They must not record personally identifying or secret
values.

## Failure Behavior

- A mail-delivery failure leaves the account or email change pending and
  permits a rate-limited resend.
- A malformed local profile is skipped and reported without mutating it.
- A partially interrupted import is safe to retry because imported items are
  idempotent.
- A database or network error never clears in-memory or anonymous Builder
  data.
- A quota error names the limit, preserves the unsaved edit, and offers export
  as a recovery action.
- A stale update preserves both the server state and attempted client state.
- Logout and expired authentication immediately remove account-backed state
  from the active Builder view.

## Testing Strategy

### Unit tests

- Current and legacy codec round trips.
- Server-side payload validation and canonicalization.
- Email normalization and case-insensitive uniqueness.
- Token hashing, expiry, invalidation, purpose binding, and replay rejection.
- Migration classification, deduplication, collision naming, and idempotency.
- Revision conflict and deletion-marker behavior.
- Preference filtering so device-specific values cannot synchronize.

### API and database integration tests

- Additive migrations against representative existing members.
- Registration, verification, resend, email change, email login, and recovery.
- Password reset and complete session invalidation in one transaction.
- Authorization isolation between two accounts.
- Profile CRUD, revisions, quota enforcement, deletion markers, and imports.
- Preference reads, writes, and latest-write-wins conflict behavior.
- Generic recovery responses and rate limits.
- Fake SMTP success and failure behavior.

### Browser and accessibility tests

- Complete anonymous Builder operation without an account.
- Unverified new and grandfathered account behavior.
- Verification and recovery journeys.
- Explicit local-data migration and its completion report.
- Deduplication, same-name imports, malformed data, and safe retry.
- Autosave and conflicting edits in two browser contexts representing work and
  home.
- Logout restoring prior anonymous data.
- Storage-mode and sync-status announcements.
- Keyboard operation, focus restoration, labels, errors, and live regions for
  every new account and Builder interaction.

### Operational verification

- Application rollback to 3.0 against the additive schema.
- Mail configuration preflight without credential output.
- Database backup and restore containing account-backed profiles.
- Dunwich smoke checks for registration, verification using a test transport,
  migration, synchronization, logout, and recovery.

## Acceptance Criteria

The 3.1 feature is complete when:

1. Anonymous players retain all current local Builder capabilities.
2. New accounts require a unique email and cannot sync until it is verified.
3. Existing accounts remain usable and receive the login-time prompt until
   verified.
4. Verified players can log in with username or email and recover a forgotten
   password securely.
5. A player can explicitly copy local profiles and preferences into an
   account without losing or overwriting either source.
6. Profile changes made in one browser appear after loading the account in
   another browser.
7. Concurrent stale edits preserve both versions rather than overwriting one.
8. Logout hides account data and restores the browser's anonymous data.
9. Email, account-storage, migration, conflict, security, and accessibility
   test suites pass.
10. The changelog describes the player-facing account and cross-device
    storage behavior before the 3.1 release is tagged.
