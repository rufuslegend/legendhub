# MariaDB for LegendHUB 4.0.0-beta

## Accepted scope

The maintainer approved moving the application to MariaDB after freezing the
MySQL application at `v3.2.0` (`ae509ac9739f`). Builder is the primary acceptance
criterion. A frozen MySQL database is an acceptable last-resort fallback, with
post-cutover writes potentially lost. Content sync is disabled and its engine
compatibility work is explicitly deferred. This task implements and rehearses
locally; it does not publish images, push, tag, or deploy servers.

## Approach

Use MariaDB 12.3.3 on linux/amd64, pinned by digest. Preserve the `mysql` service
name and existing application environment/clients. Use a new `mariadb-database`
volume, never the existing `database` MySQL volume. Import a full logical backup
into the fresh volume. Preserve current SQL modes, latin1 server defaults, and
the legacy utf8mb4_general_ci default for new utf8mb4 tables. Keep MySQL's old
configuration available for the v3.2.0 fallback. Base and local Compose should
use MariaDB; visual parity must still support its historical MySQL reference.

Schema verifiers for migrations 9 and 11 must understand MariaDB metadata.
Normalize nullable SQL NULL defaults without confusing them with literal text.
Accept a MariaDB JSON alias only with utf8mb4_bin LONGTEXT and an actual
JSON_VALID constraint for the exact column; reject plain LONGTEXT, permissive
constraints, missing columns, and wrong indexes or foreign keys. Preserve
MySQL verification behavior. Restore current data and also test older schema
migration paths so completed migration history cannot hide incompatibilities.

Backup tooling uses explicit MariaDB client commands where needed. Keep private
account/Builder records private. Prove full dump/restore, trigger preservation,
and Builder persistence with the actual Node driver. Do not refactor content
sync or upgrade unrelated application dependencies.

## Rehearsal and fallback

Run an isolated MariaDB container/stack using a local full backup. Never mutate
the existing local stack or its database. Record only schema/count/hash results,
not private rows or credentials. Test Builder query and save/load behavior,
database migrations and repeat startup, backup/restore, and Python connectivity.
Run existing automated suites plus focused new integration coverage.

The operations guide must identify the source volume, stop all writers for the
final snapshot, create fresh MariaDB storage, restore and validate before
switching clients, and retain the MySQL volume. Git tags and container images
do not contain database data. A rollback uses v3.2.0 software and the frozen
MySQL volume; no synchronization or lossless post-cutover rollback is promised.

## Documentation

Update the 4.0.0-beta changelog in player-friendly language and README/operator
instructions. Player workflows and Builder calculations remain unchanged, so
the user manual needs no invented workflow changes. Existing historical release
and preflight documents remain historical unless explicitly adapted.
