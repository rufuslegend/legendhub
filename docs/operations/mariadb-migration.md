# MariaDB migration — 4.0.0-beta

The branch uses MariaDB 12.3.3, pinned to
`mariadb:12.3.3@sha256:dd9b303aed4f4890ed09f766d8ca9ddfd176c0c6f6267feff53b3192ec65a979`
on `linux/amd64`. Application connections still use the service name `mysql`
and existing `MYSQL_*` settings. The Node mysql driver and Python clients are
unchanged. Migrations 9 and 11 now recognize MariaDB's JSON/default metadata
while preserving their schema checks. The backup worker uses `mariadb-dump`.

This is a logical export/import, **never an in-place data-directory upgrade**.
MariaDB gets `mariadb-database`; MySQL keeps `database`. Both mount their own
storage at `/var/lib/mysql`. On Docker Desktop those volumes live inside its
Linux VM. Preserve the actual Docker volume names, which include the Compose
project prefix. Do not run `down -v` or prune retained volumes.

`v3.2.0` (`ae509ac9739f958ac601e535f2aadd2acd313c85`) is the code checkpoint.
A Git tag contains neither database data nor Docker images. Preserve the
running source stack's image IDs, configuration, and full database backup too;
the deployed source version may precede this tag. Publishing, pushing, tagging,
and deploying remain separately authorized actions. This guide does not change
the maintainer's untracked `docker-compose-prod.yaml`.

## Accepted fallback and scope

Keep the old MySQL stack stopped or without writers after the final snapshot.
The fallback is to restart it at that frozen point. Writes made only on
MariaDB after cutover can be lost; this is an accepted last-resort fallback.
Do not attempt to mount MariaDB files in MySQL or replay MariaDB dumps into
MySQL as the rollback procedure.

Content sync is currently disabled and stays disabled on both systems. Do not
start its Compose profile or manually run synchronization during this work.
Its cross-engine schema comparison and export/import behavior are deferred,
even after both servers have moved. Existing MySQL content-sync tests do not
certify it for MariaDB. The old release-specific production preflight scripts
also do not constitute MariaDB acceptance.

## Prepare an isolated target

For each server, identify its actual source checkout, complete Compose overlay
list, environment file, project name, image IDs, database volume, proxy/ports,
and every writer (web, Python, importer, content-sync jobs, external jobs).
Do not print environment files or full `docker inspect`/`compose config`
output, which can include secrets. Safe inventory examples:

```bash
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
docker inspect --format '{{range .Mounts}}{{println .Type .Name .Destination}}{{end}}' SOURCE_DB_CONTAINER
docker inspect --format '{{.Config.Image}} {{.Image}}' SOURCE_WWW_CONTAINER
```

Use a **different Compose project** for the new stack. That permits separate
MySQL and MariaDB containers and volumes to coexist. Preserve the old checkout
and containers so fallback does not depend on rebuilding them. Set up a 4.0
checkout and private environment file with the intended database credentials.
Retain the established `legendhub` application user/database settings.

The following Bash commands are a template to adapt to the inspected server.
Replace uppercase placeholders and add that server's required overlays to the
arrays before running them. The old array must identify the existing stack,
not create another MySQL project. The target shown builds locally; a registry
deployment must instead use previously published immutable SHA images and its
reviewed overlay set. Do not point both apps at the same external port while
both web containers are running.

```bash
set -euo pipefail
umask 077
old_checkout=/ABSOLUTE/PATH/TO/RETAINED_SOURCE
new_checkout=/ABSOLUTE/PATH/TO/MARIADB_CHECKOUT
old_env=/ABSOLUTE/PATH/TO/SOURCE_ENV
new_env=/ABSOLUTE/PATH/TO/TARGET_ENV
old_project=EXISTING_SOURCE_PROJECT
new_project=UNIQUE_MARIADB_PROJECT
migration_dir=/ABSOLUTE/PRIVATE/PATH/TO/CHECKPOINT
mkdir -p "$migration_dir/empty-init"
chmod 700 "$migration_dir" "$migration_dir/empty-init"

old_compose=(docker compose --project-directory "$old_checkout"
  --project-name "$old_project" --env-file "$old_env"
  -f "$old_checkout/docker-compose.yaml")

# Suppress every automatic seed/restore from the target checkout. Restore
# the final checkpoint explicitly after a fresh MariaDB volume is healthy.
cat > "$migration_dir/no-init.yaml" <<EOF
services:
  mysql:
    volumes:
      - type: bind
        source: $migration_dir/empty-init
        target: /docker-entrypoint-initdb.d
        read_only: true
EOF
new_compose=(docker compose --project-directory "$new_checkout"
  --project-name "$new_project" --env-file "$new_env"
  -f "$new_checkout/docker-compose.yaml"
  -f "$migration_dir/no-init.yaml")

# Refuse an existing target project before any target container starts.
test "$new_project" != "$old_project"
if [[ -n "$(docker volume ls -q --filter "label=com.docker.compose.project=$new_project")" ||
      -n "$(docker ps -aq --filter "label=com.docker.compose.project=$new_project")" ]]; then
  printf 'Target project already has containers or volumes; choose a fresh project.\n' >&2
  exit 1
fi

# Build/pull the intended images before the downtime window. Building these
# three images locally does not publish them.
"${new_compose[@]}" build www python mysql-backup
"${new_compose[@]}" up -d --wait --wait-timeout 180 mysql
"${new_compose[@]}" exec -T mysql healthcheck.sh --connect --innodb_initialized
```

The startup command waits up to three minutes for database health. Inspect the
target database mount and confirm it is the distinct project-scoped volume.
The template rejects projects with existing containers or volumes before
startup; choose another project if it rejects a previous rehearsal. Explicit
external volume overrides require a separate freshness check and must never
refer to the source MySQL volume. Do not import over an existing target
database. Check user accounts and trigger/routine definers: an
application-database dump does not recreate unrelated server users or grants.

For local development, `scripts/local-stack.sh` always selects
`legendhub-local`, even from another worktree. Changing
`LEGENDHUB_LOCAL_STATE_DIR` does **not** isolate that project. Use explicit
Compose commands with another project name and different published ports for
a parallel rehearsal. The local overlay imports its saved snapshot only on
first initialization. Visual parity keeps its historical MySQL 5.7.44
reference and tests the candidate on MariaDB with isolated init fixtures.

## Freeze, export, and restore

Stop every source writer before the final snapshot. The base services below
are not an exhaustive list if importer or other optional services are enabled.
Verify external import/sync timers are stopped as well. Keep MySQL itself
running to export it. Leave source writers stopped until cutover or fallback.

```bash
"${old_compose[@]}" stop www python mysql-backup
"${old_compose[@]}" exec -T mysql sh -c '
  export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"
  exec mysqldump --user=root --single-transaction --quick --no-tablespaces \
    --routines --events --triggers --hex-blob --set-gtid-purged=OFF \
    --databases "$MYSQL_DATABASE"
' | gzip > "$migration_dir/mysql-checkpoint.sql.gz"
gzip -t "$migration_dir/mysql-checkpoint.sql.gz"
shasum -a 256 "$migration_dir/mysql-checkpoint.sql.gz" > "$migration_dir/mysql-checkpoint.sha256"

gzip -dc "$migration_dir/mysql-checkpoint.sql.gz" |
  "${new_compose[@]}" exec -T mysql sh -c '
    export MYSQL_PWD="$MARIADB_ROOT_PASSWORD"
    exec mariadb --user=root
  '
"${new_compose[@]}" exec -T mysql healthcheck.sh --connect --innodb_initialized
```

Do not use `--force` to continue after SQL import errors. Keep the gzip backup
and checksum in protected storage outside the container and copy them to
separate protected storage. The deployed schema uses InnoDB; if inspection
finds other engines, ensure the stopped-writer snapshot covers them too.

## Verify and cut over

Before enabling background jobs, compare source and target table inventories,
exact row counts, content hashes in a consistent order, trigger definitions,
and migration history. Do not log private rows. Start the new web app, verify
startup migrations complete, and restart it once to check repeat startup:

```bash
"${new_compose[@]}" up -d www
"${new_compose[@]}" logs --tail=80 www
"${new_compose[@]}" restart www
```

Check the intended host/proxy, then exercise Builder loading, item search,
equipment selection, calculations, browser save/reload with storage consent,
and a verified test account's save/reload. Check accounts and preferences,
item details, manual, and API. Rehearse the backup worker on the new database:

```bash
"${new_compose[@]}" run --rm --no-deps mysql-backup /usr/local/bin/backup-mysql
```

Inspect its success status and restore its private gzip backup into another
fresh MariaDB volume. Confirm table hashes and trigger definitions match the
backup source. Confirm public exports contain no private-table rows and omit
the private submission tables. Restore MariaDB dumps with the `mariadb`
client: modern dumps can contain a sandbox directive that MySQL clients
reject. See [MariaDB's compatibility notice](https://mariadb.org/mariadb-dump-file-compatibility-change/).

After acceptance, point the intended proxy at the new web service as needed,
then start the intended background services. Keep content sync off:

```bash
"${new_compose[@]}" up -d python mysql-backup
```

Retain the old containers, volumes, images, environment, and checkpoint until
the maintainer chooses to retire the fallback. Do not prune them during the
beta. Review this server's optional importer separately before resuming it.

## Last-resort fallback

Stop all new writers and restore the old proxy/port routing. Preserve a
private MariaDB backup for later investigation if practical, but do not
import it into the frozen MySQL database.

```bash
"${new_compose[@]}" stop www python mysql-backup
# Also stop any optional target writers identified during preparation.
"${old_compose[@]}" start mysql
"${old_compose[@]}" start www python mysql-backup
```

This restarts the retained source containers with their original images and
MySQL volume. Recheck Builder and the public routes. Using the tagged v3.2.0
application instead is a separate deployment choice requiring its matching
images; it is not implied by restarting an older deployed source stack.

## Local verification record — 2026-09-07

An isolated rehearsal restored a full copy of the existing local MySQL
database into MariaDB 12.3.3: **37 tables, 159,698 rows, 10 triggers**. Every
table's row count and content hash matched. The updated backup worker's full
MariaDB export restored into a second fresh MariaDB database with identical
table hashes and trigger definitions. Its public export excluded all 16
private/operational table datasets and omitted both submission table schemas.
Restored migrations 9 and 11 verified successfully; the existing Python
SQLAlchemy/PyMySQL client connected successfully.

The live web rehearsal passed the home, manual, Builder, Items, Mobs, Quests,
Wiki, changelog, and API routes. Browser automation exercised item search and
equipment selection against restored data, checked calculated totals, and
preserved the character and equipment after reload with storage consent.
The standard browser suite passed all 152 tests; the Python suite passed 67.
The web suite passed 878 tests with four opt-in skips; the final script suite
passed 235 tests. Client build, CSS lint, shell syntax, and release metadata
checks passed.

The durable `scripts/test/mariadb-integration.test.js` runs real migration 9
and 11 DDL, partial-state retries, named-lock contention/release, Builder
profile/preferences/import-receipt roundtrips, and trigger behavior using
`mysql@2.18.1`. Run it with Docker available and `www` dependencies installed:

```bash
node --test scripts/test/mariadb-integration.test.js
```

These are local results, not evidence that either server has been migrated.
