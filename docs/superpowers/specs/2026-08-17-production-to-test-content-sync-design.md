# Production-to-Test Public Content Sync Design

**Date:** 2026-08-17

## Goal

Keep Dunwichmass's public LegendHUB content synchronized with production once
per hour and whenever an operator manually requests it, while preserving all
Dunwichmass-local accounts, credentials, authorization, notifications,
migration state, and operational data.

Production is authoritative. Public-content edits made directly on Dunwichmass
are disposable and will be replaced by the next successful synchronization.

## Current Evidence

Production and Dunwichmass currently expose identical schemas for the proposed
public-content boundary: 17 tables and 259 columns with the same schema digest.
The production content occupies about 16 MiB uncompressed, including audit
history, so a consistent full snapshot is small enough to create frequently.

Dunwichmass is materially behind production. At the time of inspection,
production contained 331 quests and 829 wiki pages while Dunwichmass contained
none of either. A complete snapshot is therefore preferable to a change-only
repair because it handles existing drift, additions, updates, and deletions in
one mechanism.

Production still uses legacy Docker Compose v1 while Dunwichmass uses the
Compose plugin. The synchronization interface must not depend on the same
Compose command being available on both hosts.

## Authoritative Content Boundary

The synchronization uses a deny-by-default allowlist. These tables and only
these tables are mirrored:

- `Areas`
- `Categories`
- `ChangelogVersions`
- `ChangelogVersions_AuditTrail`
- `Eras`
- `ItemMobMap`
- `ItemStatCategories`
- `ItemStatInfo`
- `Items`
- `Items_AuditTrail`
- `Mobs`
- `Mobs_AuditTrail`
- `Quests`
- `Quests_AuditTrail`
- `SubCategories`
- `WikiPages`
- `WikiPages_AuditTrail`

Audit tables are included so history and revert views on Dunwichmass match
production. Audit rows contain fields such as editor names and IP addresses,
so snapshots are confidential operational artifacts even though the current
content is publicly readable through LegendHUB.

Everything not explicitly listed is excluded. This includes accounts, login
tokens, banned IPs, roles, permissions, role mappings, notifications,
notification settings, migration records, and any future table until it is
deliberately reviewed and added to the allowlist.

## Selected Architecture

The existing `mysql-backup` image will gain reusable export and import tools.
Dunwichmass will run a second, test-only `content-sync` service from that same
image, avoiding a fourth Docker repository and keeping the database tooling in
one image.

Once per hour, the Dunwichmass service will poll production through a
dedicated SSH key. The corresponding production `authorized_keys` entry will
use a forced command with forwarding and interactive access disabled. That key
can request only a content manifest or the immutable snapshot named by the
manifest. It cannot obtain a shell, forward ports, choose arbitrary commands,
or access production database credentials.

The production-side forced-command wrapper will account for the legacy Compose
installation and invoke the exporter inside the running backup container. The
exporter will connect to MySQL using its existing container environment. No
production database password will be copied to Dunwichmass or placed in an SSH
command, artifact, or log.

The test-only sync service will use Dunwichmass's existing database environment
and a read-only mount of the dedicated SSH key and pinned production host key.
It will not mount the Docker socket. Persistent sync state will live in a small
dedicated volume rather than in the LegendHUB application schema.

A repository-owned operator wrapper, `scripts/sync-test-content.sh`, will make
an immediate manual run a single local command. It will connect to
Dunwichmass and execute `sync-public-content --once` inside the running sync
service. The wrapper will not receive production credentials or key material;
the service continues to own the restricted production connection.

## Snapshot Protocol

The production exporter will:

1. acquire a nonblocking advisory lock so exports cannot overlap;
2. validate the exact table allowlist and require all mirrored tables to use a
   transactionally consistent storage engine;
3. calculate the public schema digest and require the expected table set;
4. create a consistent, deterministic data snapshot with a single transaction,
   primary-key ordering, explicit columns, suppressed dump comments and lock
   statements, no triggers, and no schema or secret tables;
5. calculate a content SHA-256 digest over those canonical uncompressed bytes;
6. compress the snapshot deterministically without a gzip timestamp into a
   mode-`0600` temporary artifact;
7. calculate a separate artifact SHA-256 digest and record both digests, the
   compressed byte size, schema digest, exact per-table row counts, and creation
   timestamp in a manifest; and
8. atomically promote the artifact under its content digest and update the
   current manifest only after both validate.

The forced-command interface will expose two fixed read-only operations:

- return the current manifest, generating or refreshing the snapshot first;
- return the immutable snapshot matching an exact 64-character content digest
  from that manifest.

Dunwichmass will remember the last applied content digest and retain a verified
copy of that immutable snapshot. Every poll will also calculate Dunwichmass's
current canonical content digest. The poll is a no-op only when the production
digest, last-applied digest, and current Dunwichmass digest all match. If
Dunwichmass has drifted, the service reapplies the cached snapshot even when
production is unchanged. The larger artifact is transferred only when its
content digest changes or the cached copy is missing or invalid. Production
retains the current artifact and recent digest-named artifacts for at least the
two-hour unhealthy threshold so a manifest/snapshot race cannot invalidate
an in-progress poll.

## Test-Side Application Flow

The Dunwichmass service will:

1. acquire a nonblocking advisory lock and skip if another sync is active;
2. retrieve and strictly parse the production manifest;
3. calculate Dunwichmass's canonical content digest and stop successfully only
   when it, the source digest, and the last-applied digest all match;
4. reuse the verified cached snapshot or download the named snapshot into a
   mode-`0600` temporary file;
5. verify its artifact digest, content digest, size, table set, schema digest,
   and row-count manifest;
6. load it into a dedicated staging database;
7. verify the staged row counts and a deterministic staged-data digest;
8. begin a target transaction and set `@DISABLE_NOTIFICATIONS=1` so the
   existing content triggers create neither duplicate audit rows nor test
   notification events;
9. replace all allowlisted target rows from staging using explicit column
   lists, leaving excluded tables untouched;
10. verify exact target row counts within the transaction and commit;
11. recalculate the committed target's canonical content digest and require it
    to match the production content digest;
12. atomically record the applied digest and successful timestamp, retain one
    verified cached artifact, and remove other temporary data; and
13. emit one secret-free success record.

Readers will see either the previous committed snapshot or the new committed
snapshot. They will not see a partially replaced set. Any validation or SQL
failure before commit rolls back the target transaction and retains the
previous successful sync state.

The applied digest is recorded only after post-commit canonical verification.
If that verification fails, the service remains unhealthy and the next run
reapplies the same source snapshot instead of treating it as a no-op. The
transaction still guarantees that readers never observe a partially replaced
table set.

The staging database will be created once on Dunwichmass with the minimum
grants required by the sync service. It is scratch space, contains no excluded
tables, and is cleared before each import.

## Schema Compatibility

Synchronization fails closed when any mirrored production and Dunwichmass
table differs in name, column order, column type, nullability, or default. It
does not guess how to translate between schemas.

This is intentional: Dunwichmass may temporarily run a schema-changing beta
ahead of production, and silently filling new columns or dropping source
columns could create believable but invalid test data. A public-table schema
change must include an explicit synchronization compatibility update or accept
a temporarily unhealthy sync until production reaches the compatible schema.
Schema changes outside the allowlist do not affect synchronization.

## Scheduling, Health, and Observability

The sync loop runs immediately at service startup and then once per hour. An
operator can request the same guarded workflow at any time through `--once`;
the advisory lock prevents a manual request from overlapping a scheduled run.
Network failures, an unavailable source, schema mismatch, corrupt artifacts,
invalid manifests, and SQL failures are nonzero failures followed by a retry
on the next interval or the next manual request.

`sync-test-content.sh` performs a mutating synchronization by default because
that is its stated operator purpose. An explicit `--dry-run` option performs
all source, artifact, schema, staging, digest, and preservation checks without
opening the target replacement transaction. Both modes print a concise
secret-free summary and preserve the underlying exit status.

The service healthcheck reports:

- `starting` until the first successful application or verified no-op;
- `healthy` while the last successful verification is no more than two hours
  old; and
- `unhealthy` after two hours without success.

Logs include timestamps, snapshot digests, byte sizes, table counts, durations,
and failure stages. They never include database contents, credentials, SSH key
material, editor IP addresses, or raw SQL dumps. The `--once` mode supports
immediate synchronization and emergency reconciliation without starting the
loop; combining it with `--dry-run` supports manual validation without target
mutation.

## Security

- Production database credentials remain only in production containers.
- Dunwichmass receives a dedicated key whose production-side forced command
  denies shells, PTYs, forwarding, agent forwarding, and arbitrary arguments.
- The production host key is pinned; host-key checking is never disabled.
- Snapshot and staging data are treated as confidential because audit rows can
  contain personal data.
- Temporary and persistent sync artifacts use restrictive permissions and are
  removed or atomically replaced.
- The table allowlist is centralized and shared by export, import, manifest,
  and tests so a future private table cannot enter the snapshot implicitly.
- Neither host exposes MySQL over the network for this feature.

## Failure Handling and Recovery

The source snapshot is read-only with respect to production. Export failure
leaves the previous promoted source snapshot intact and returns a failure; it
never produces a success manifest for a partial dump.

On Dunwichmass, the artifact, schema, staging contents, and row counts are
validated before target mutation. Transactional apply failures roll back. A
post-commit canonical-digest failure does not advance the applied digest, so
the same verified snapshot is reapplied on the next run. The service retains
the last successful digest and keeps retrying. An unhealthy state makes
prolonged drift visible through ordinary Compose and Docker status checks.

Before the first mutating synchronization, create and verify a current private
Dunwichmass database backup. Rollback consists of stopping the `content-sync`
service and restoring that verified backup if the committed synchronized
content itself proves incorrect. Removing or disabling the production forced
key immediately revokes source access without changing either database.

## Testing

Repository-level tests will cover:

- the exact allowlist and deny-by-default behavior;
- deterministic manifest creation and unchanged-digest no-ops;
- deterministic timestamp-free compression and separate content/artifact
  digests;
- forced-command argument validation and rejection of shells or arbitrary
  commands;
- schema-digest and row-count validation;
- snapshot digest, size, truncation, and corruption failures;
- restrictive file permissions and cleanup;
- lock behavior and overlapping-run prevention;
- operator-wrapper argument handling, exit-status preservation, and explicit
  dry-run behavior;
- health transitions at startup, normal operation, and two-hour staleness;
- secret-free output, including failure paths; and
- compatibility with production Compose v1 and Dunwichmass Compose v2 command
  wrappers.

An integration suite using isolated source, staging, and target MySQL databases
will prove that:

- inserts, updates, deletions, relationships, and audit histories mirror
  production;
- target authentication, authorization, notification, migration, and
  operational rows remain byte-for-byte unchanged;
- target triggers do not create extra histories or notifications;
- repeated identical runs are idempotent;
- direct target drift is detected and repaired even when production is
  unchanged;
- schema mismatch, corrupt data, and mid-apply SQL failure preserve the last
  committed target snapshot; and
- a post-apply deterministic target digest matches the source digest.

Existing web, script, Compose, CSS, shell-syntax, and image-platform checks
remain required.

## Rollout

Publishing images, production provisioning, production deployment, test
deployment, and the first content mutation each require explicit authorization
applicable to that step.

The rollout sequence is:

1. implement and test the exporter, importer, forced-command wrapper, sync
   service, healthcheck, and Compose integration on a feature branch;
2. exercise source and target integration tests entirely against disposable
   local databases;
3. publish the three required `linux/amd64` images under an immutable Git SHA
   only after separate publication authorization;
4. with production authorization, install the forced-command wrapper and key,
   deploy the matching backup image, and verify manifest and snapshot export
   without changing production data;
5. with test-deployment authorization, provision the staging database, key,
   pinned host key, and sync service on Dunwichmass;
6. create and verify a current Dunwichmass private backup;
7. run `sync-test-content.sh --dry-run` in comparison-only mode and review
   schema, counts, digests, and the excluded-table preservation report;
8. with explicit authorization for the initial data replacement, run one
   mutating synchronization and verify all mirrored and preserved tables;
9. enable the hourly loop, verify the unchanged no-op path and a controlled
   production-to-test content update, then verify an additional manual
   `sync-test-content.sh` request; and
10. confirm application routes, Builder lookups, history views, MySQL health,
    sync health, and backup health.

## Alternatives Rejected

### Application-Level Change Feed

An authenticated change feed could transfer smaller deltas nearly
immediately, but every content mutation, deletion, relationship, audit entry,
and manual SQL correction would need a correct event representation. Missing
one path would silently create drift. The snapshot model periodically repairs
all drift by construction.

### Filtered MySQL Replication

Filtered replication would reduce latency but requires production binlogs,
replication credentials, filter maintenance, and tight operational coupling to
a disposable test environment. A filter or schema mistake has a larger blast
radius, and test writes complicate replication semantics.

### Import the Existing Public Backup

The current public backup includes schema for tables whose data is omitted.
Importing it wholesale could drop or recreate Dunwichmass-local account and
operational tables. It also runs only daily and is not an explicit,
deny-by-default content contract. The new snapshot tooling may share low-level
dump helpers with the backup image, but it must remain a separate artifact and
workflow.
