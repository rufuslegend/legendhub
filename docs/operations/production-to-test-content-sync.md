# Production-to-Test Content Sync

This runbook is for the separately authorized rollout and operation of the
production-content synchronization feature. The runtime data path is:

```text
LegendMUD production -> restricted SSH snapshot -> Dunwichmass content-sync
container -> Dunwichmass MySQL
```

The local Mac is only a development, verification, and operator-control
machine. It may invoke the repository wrapper, but it never receives the
snapshot, the production database credentials, or the synchronization private
key. Publishing images, changing production, deploying to Dunwichmass,
creating the staging database, replacing test content, enabling the hourly
profile, revoking access, and restoring a backup each require authorization
for that exact action.

## Security boundary

Production exposes only the fixed `manifest` and `snapshot <sha256>` commands
through a dedicated forced SSH key. The wrapper reads the production database
through the existing backup container and does not mutate it. A successful
export does write private digest-addressed snapshot artifacts in the existing
production backup volume. The wrapper rejects shells, unexpected arguments,
forwarding, and ambiguous container matches. Production database credentials
never leave the production container.

On Dunwichmass, the `content-sync` container imports into the dedicated
`legendhub_content_sync` staging database, validates the snapshot, and then
transactionally replaces only the 17 allowlisted public and audit tables in
`legendhub`. Accounts, authentication, authorization, notifications,
migrations, and other operational tables are excluded. Snapshots and audit
history are confidential even when the current content is publicly visible.

The service is opt-in under the `content-sync` Compose profile. It has no
published ports, Docker socket, production credentials, root database
password, or host backup-directory mount. Its only writable persistent mount
is the private `content-sync-state` volume. The private key and pinned
known-hosts file are same-owner regular files bind-mounted read-only. Do not
add a Compose `user` override: the image's default root process must be able to
read the mode-`0600`, `rufus`-owned bind files, while the application still
requires both files to have the same owner.

All Dunwichmass service commands use the deployed, detached Git `HEAD` as the
immutable image tag. In every new interactive Dunwichmass shell, establish the
tag and the complete Compose overlay set before running Compose directly:

```bash
set -euo pipefail
cd /home/rufus/legendhub
project_definitions="$(awk '
  /^[[:space:]]*(export[[:space:]]+)?COMPOSE_PROJECT_NAME[[:space:]]*=/ {
    count += 1
  }
  END { print count + 0 }
' .env)"
project_literal_lines="$(awk '
  $0 == "COMPOSE_PROJECT_NAME=legendhub-test" { count += 1 }
  END { print count + 0 }
' .env)"
test "$project_definitions" -eq 1
test "$project_literal_lines" -eq 1
unset COMPOSE_PROJECT_NAME
release_sha="$(git rev-parse --short=12 HEAD)"
[[ "$release_sha" =~ ^[abcdef0123456789]{12}$ ]]
export LEGENDHUB_IMAGE_TAG="$release_sha"
compose=(
  docker compose
  -f docker-compose.yaml
  -f docker-compose.test.yaml
  -f docker-compose.registry.yaml
  -f docker-compose.content-sync.yaml
)
"${compose[@]}" config --quiet
```

Do not persist `LEGENDHUB_IMAGE_TAG` in `.env`: the deployment and operator
scripts derive it from the current detached checkout, and a shell export from
an earlier deployment is not available in a later session. Never run Compose
with a movable `test` or `latest` image tag.

After publication and deployment are separately authorized, deploy or roll
back Dunwichmass only through the checked wrapper:

```bash
set -euo pipefail
release_sha='REPLACE-WITH-12-CHARACTER-IMMUTABLE-SHA'
[[ "$release_sha" =~ ^[abcdef0123456789]{12}$ ]]
./scripts/deploy-test.sh "$release_sha"
```

For a current tree, the wrapper requires all four overlays, pulls the three
application services plus `content-sync`, and lets the ignored
`COMPOSE_PROFILES` value decide whether sync starts. For a rollback target
whose Git tree genuinely predates `docker-compose.content-sync.yaml`, it uses
the three legacy overlays and removes only the exactly labeled stale
`content-sync` container before starting the legacy services. It does not
remove the sync state volume or database data. A current tree with a missing
tracked overlay fails closed. Do not work around either result by omitting an
overlay or by running `down --volumes`.

## One-time key and host-key provisioning

Do this only after Dunwichmass provisioning is authorized. Create the
dedicated key on Dunwichmass so the private key never passes through the local
Mac. Open a shell with agent forwarding disabled:

```bash
ssh -a dunwichmass
```

Inside that Dunwichmass shell, create a new key and an exclusively created,
empty known-hosts file. Any pre-existing target path stops the procedure:

```bash
set -euo pipefail
umask 077
key_dir=/home/rufus/.ssh/legendhub-content-sync
private_key="$key_dir/id_ed25519"
known_hosts_file="$key_dir/known_hosts"
mkdir -p -m 700 "$key_dir"
test ! -e "$private_key"
test ! -e "${private_key}.pub"
test ! -e "$known_hosts_file"
ssh-keygen -q -t ed25519 -N '' -C legendhub-content-sync -f "$private_key"
set -o noclobber
: > "$known_hosts_file"
set +o noclobber
chmod 600 "$private_key" "$known_hosts_file"
chmod 644 "${private_key}.pub"
test "$(stat -c '%u' "$private_key")" = \
  "$(stat -c '%u' "$known_hosts_file")"
sync_key_fingerprint="$(ssh-keygen -lf "${private_key}.pub" | awk '{print $2}')"
[[ "$sync_key_fingerprint" =~ ^SHA256:[A-Za-z0-9+/]{43}$ ]]
printf 'Record the approved sync-key fingerprint: %s\n' \
  "$sync_key_fingerprint"
stat -c '%n mode=%a owner=%U' \
  "$private_key" "${private_key}.pub" "$known_hosts_file"
```

Record that public-key fingerprint in the private rollout record; no key bytes
are printed. Obtain the Legend production SSH host-key fingerprint through an
approved out-of-band channel. Independently verify the expected host token,
key type, and fingerprint before trusting any host-key line. Set the two
non-secret verification variables, then use `vi` to add exactly one verified
record to the still-empty known-hosts file:

```bash
production_host='legendmud.org'
production_port='7822'
approved_host_fingerprint='SHA256:REPLACE-WITH-OOB-VERIFIED-FINGERPRINT'
[[ "$production_host" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]]
[[ "$production_port" =~ ^[0-9]+$ ]]
test "$production_port" -ge 1
test "$production_port" -le 65535
[[ "$approved_host_fingerprint" =~ ^SHA256:[A-Za-z0-9+/]{43}$ ]]
known_hosts_token="[$production_host]:$production_port"
vi "$known_hosts_file"
chmod 600 "$known_hosts_file"
host_record_count="$(awk '
  NF && $1 !~ /^#/ { count += 1 }
  END { print count + 0 }
' "$known_hosts_file")"
test "$host_record_count" -eq 1
test "$(awk 'NF && $1 !~ /^#/ { print $1 }' "$known_hosts_file")" = \
  "$known_hosts_token"
known_host_details="$(ssh-keygen -lf "$known_hosts_file")"
test "${known_host_details#*$'\n'}" = "$known_host_details"
actual_host_fingerprint="$(printf '%s\n' "$known_host_details" | \
  awk '{print $2}')"
test "$actual_host_fingerprint" = "$approved_host_fingerprint"
```

All checks must exit zero. Because production SSH listens on a non-default
port, the single known-hosts record must use the bracketed token
`[legendmud.org]:7822`, while `CONTENT_SYNC_SOURCE` uses the unbracketed host
name and `CONTENT_SYNC_SSH_PORT` carries the port separately. Never use
`StrictHostKeyChecking=no`, and do not treat an unverified network scan as
proof of the host key.

Edit the ignored Dunwichmass environment with `vi` and replace every bracketed
placeholder with the approved value. Do not add `COMPOSE_PROFILES` yet:

```bash
cd /home/rufus/legendhub
vi .env
```

```dotenv
CONTENT_SYNC_SOURCE=rufus@legendmud.org
CONTENT_SYNC_SSH_PORT=7822
CONTENT_SYNC_STAGING_DATABASE=legendhub_content_sync
CONTENT_SYNC_INTERVAL_SECONDS=3600
CONTENT_SYNC_MAX_AGE_SECONDS=7200
CONTENT_SYNC_SSH_KEY_FILE=/home/rufus/.ssh/legendhub-content-sync/id_ed25519
CONTENT_SYNC_KNOWN_HOSTS_FILE=/home/rufus/.ssh/legendhub-content-sync/known_hosts
```

The one-hour interval and independent two-hour maximum age are the production
defaults. Port `7822` is required for LegendMUD SSH. Do not substitute a
different SSH account: the restricted key is installed for production user
`rufus`. Do not display or commit `.env`, the private key, or the private
key's contents. Do not copy the private key to production or to the local Mac.

Open the newly created public `${private_key}.pub` file with `vi` and transfer
only that public line through the approved administrative channel:

```bash
vi "${private_key}.pub"
```

The `<public-key-material>` used in the next section is copied from this newly
created public `.pub` file. It is never copied from the private key. The
production check must match the approved `sync_key_fingerprint` recorded
above.

## Production forced-command installation

This step requires separate production authorization, a current verified
production private backup, and deployment of the matching immutable
`linux/amd64` backup image. The image must contain the exporter before the key
is enabled. Do not modify the user-owned root `docker-compose-prod.yaml`.

From the clean, reviewed local release checkout, record the wrapper's digest
and transfer it to a temporary production path:

```bash
set -euo pipefail
wrapper_sha="$(shasum -a 256 scripts/serve-production-content.sh | \
  awk '{print $1}')"
[[ "$wrapper_sha" =~ ^[abcdef0123456789]{64}$ ]]
printf 'Record the wrapper SHA-256: %s\n' "$wrapper_sha"
scp -o ForwardAgent=no \
  scripts/serve-production-content.sh \
  legend:/home/rufus/legendhub/serve-production-content.sh.candidate
```

Record the printed digest in the private rollout record. On the production
host, compare that digest before installing the candidate at the fixed
forced-command path. First open the production shell:

```bash
ssh -a legend
```

Then run this fail-fast block inside that production shell:

```bash
set -euo pipefail
cd /home/rufus/legendhub
expected_wrapper_sha='REPLACE-WITH-RECORDED-SHA256'
[[ "$expected_wrapper_sha" =~ ^[abcdef0123456789]{64}$ ]]
test "$(sha256sum serve-production-content.sh.candidate | awk '{print $1}')" = \
  "$expected_wrapper_sha"
bash -n serve-production-content.sh.candidate
install -m 0755 serve-production-content.sh.candidate \
  /home/rufus/legendhub/serve-production-content.sh
bash -n /home/rufus/legendhub/serve-production-content.sh
unlink serve-production-content.sh.candidate
```

Replace `REPLACE-WITH-RECORDED-SHA256` with the locally recorded 64-character
digest. Stop without installing on any mismatch.

Deploying the production backup image remains a separate, explicitly
authorized operation under the existing production procedure; this runbook
does not modify `docker-compose-prod.yaml` or grant that authorization. After
the authorized deployment, but before enabling the restricted key, run this
fail-closed gate in the same production shell. It proves that exactly one
running `legendhub260` backup container uses the expected immutable
`linux/amd64` image and exercises both manifest and snapshot export without
printing either artifact:

```bash
set -euo pipefail
expected_release_sha='REPLACE-WITH-12-CHARACTER-IMMUTABLE-SHA'
[[ "$expected_release_sha" =~ ^[abcdef0123456789]{12}$ ]]
expected_backup_image="tmckimmey/legendhub-mysql-backup:${expected_release_sha}"
backup_containers="$(docker ps --quiet --no-trunc \
  --filter label=com.docker.compose.project=legendhub260 \
  --filter label=com.docker.compose.service=mysql-backup)"
test -n "$backup_containers"
test "${backup_containers#*$'\n'}" = "$backup_containers"
[[ "$backup_containers" =~ ^[abcdef0123456789]{64}$ ]]
backup_container="$backup_containers"
test "$(docker inspect --format \
  '{{index .Config.Labels "com.docker.compose.project"}}' \
  "$backup_container")" = legendhub260
test "$(docker inspect --format \
  '{{index .Config.Labels "com.docker.compose.service"}}' \
  "$backup_container")" = mysql-backup
test "$(docker inspect --format '{{.State.Status}}' \
  "$backup_container")" = running
test "$(docker inspect --format '{{.Config.Image}}' \
  "$backup_container")" = "$expected_backup_image"
expected_image_id="$(docker image inspect --format '{{.Id}}' \
  "$expected_backup_image")"
test "$(docker inspect --format '{{.Image}}' "$backup_container")" = \
  "$expected_image_id"
test "$(docker image inspect --format '{{.Os}}/{{.Architecture}}' \
  "$expected_backup_image")" = linux/amd64
docker exec "$backup_container" bash -eu -c '
  command -v mysqldump >/dev/null
  command -v gzip >/dev/null
  test -x /usr/local/bin/export-public-content
  export PYTHONPATH=/usr/local/lib
  python3 -c "import content_sync, pymysql"
  umask 077
  manifest_path="$(mktemp /tmp/content-sync-manifest.XXXXXX)"
  snapshot_path=
  cleanup_export_check() {
    local original_exit="$?"
    local cleanup_failed=0
    trap - EXIT
    if [[ -n "$manifest_path" && -e "$manifest_path" ]]; then
      if ! unlink "$manifest_path"; then
        cleanup_failed=1
      fi
    fi
    if [[ -n "$snapshot_path" && -e "$snapshot_path" ]]; then
      if ! unlink "$snapshot_path"; then
        cleanup_failed=1
      fi
    fi
    if [[ "$original_exit" -ne 0 ]]; then
      exit "$original_exit"
    fi
    if [[ "$cleanup_failed" -ne 0 ]]; then
      printf "production content export cleanup failed\n" >&2
      exit 1
    fi
  }
  trap cleanup_export_check EXIT
  snapshot_path="$(mktemp /tmp/content-sync-snapshot.XXXXXX)"
  /usr/local/bin/export-public-content manifest > "$manifest_path"
  mapfile -t manifest_values < <(python3 - "$manifest_path" <<'"'"'PY'"'"'
import sys

from content_sync.contract import Manifest

with open(sys.argv[1], encoding="utf-8") as source:
    manifest = Manifest.parse(source.read())
print(manifest.content_sha256)
print(manifest.artifact_sha256)
print(manifest.artifact_bytes)
PY
  )
  test "${#manifest_values[@]}" -eq 3
  content_sha="${manifest_values[0]}"
  artifact_sha="${manifest_values[1]}"
  artifact_bytes="${manifest_values[2]}"
  [[ "$content_sha" =~ ^[abcdef0123456789]{64}$ ]]
  [[ "$artifact_sha" =~ ^[abcdef0123456789]{64}$ ]]
  [[ "$artifact_bytes" =~ ^[0123456789]+$ ]]
  test "$artifact_bytes" -gt 0
  /usr/local/bin/export-public-content snapshot "$content_sha" > \
    "$snapshot_path"
  test "$(stat -c %s "$snapshot_path")" = "$artifact_bytes"
  test "$(sha256sum "$snapshot_path" | awk '"'"'{print $1}'"'"')" = \
    "$artifact_sha"
  gzip -t "$snapshot_path"
  printf "production content export verification passed\n"
'
```

The manifest operation creates or refreshes private digest-addressed snapshot
artifacts in the existing production backup volume but does not mutate the
production database. Stop before key enablement on any image, platform,
container-cardinality, executable, manifest, digest, byte-size, or gzip
failure.

Use `vi` to add exactly one restricted line to the production account's
`authorized_keys` file:

```bash
set -euo pipefail
umask 077
vi /home/rufus/.ssh/authorized_keys
chmod 600 /home/rufus/.ssh/authorized_keys
```

```text
restrict,command="/home/rufus/legendhub/serve-production-content.sh" ssh-ed25519 <public-key-material> legendhub-content-sync
```

Replace `<public-key-material>` with the key material copied from the newly
created public `.pub` file. Never print the private key or its contents into a
terminal log, copy it into `authorized_keys`, or commit either key. The
`restrict` option and fixed command are required; do not add a second
unrestricted entry for this key. Mechanically validate the exact structure and
the approved public-key fingerprint without printing key bytes:

```bash
set -euo pipefail
authorized_keys=/home/rufus/.ssh/authorized_keys
expected_options='restrict,command="/home/rufus/legendhub/serve-production-content.sh"'
approved_key_fingerprint='SHA256:REPLACE-WITH-APPROVED-SYNC-KEY-FINGERPRINT'
[[ "$approved_key_fingerprint" =~ ^SHA256:[A-Za-z0-9+/]{43}$ ]]
comment_lines="$(awk '$NF == "legendhub-content-sync" { count += 1 }
  END { print count + 0 }' "$authorized_keys")"
test "$comment_lines" -eq 1
valid_lines="$(awk -v options="$expected_options" '
  $NF == "legendhub-content-sync" && NF == 4 && $1 == options &&
      $2 == "ssh-ed25519" { count += 1 }
  END { print count + 0 }
' "$authorized_keys")"
test "$valid_lines" -eq 1
key_check="$(mktemp /home/rufus/.ssh/.legendhub-content-sync-key.XXXXXX)"
cleanup_key_check() {
  [[ ! -e "$key_check" ]] || unlink "$key_check"
}
trap cleanup_key_check EXIT
awk -v options="$expected_options" '
  NF == 4 && $1 == options && $2 == "ssh-ed25519" &&
      $4 == "legendhub-content-sync" { print $2, $3, $4 }
' "$authorized_keys" > "$key_check"
chmod 600 "$key_check"
actual_key_details="$(ssh-keygen -lf "$key_check")"
test "${actual_key_details#*$'\n'}" = "$actual_key_details"
actual_key_fingerprint="$(printf '%s\n' "$actual_key_details" | \
  awk '{print $2}')"
test "$actual_key_fingerprint" = "$approved_key_fingerprint"
matching_fingerprints="$(ssh-keygen -lf "$authorized_keys" | \
  awk -v fingerprint="$approved_key_fingerprint" '
    $2 == fingerprint { count += 1 }
    END { print count + 0 }
  ')"
test "$matching_fingerprints" -eq 1
cleanup_key_check
trap - EXIT
```

All checks must exit zero before testing the forced-command connection.

The comparison-only run below is the end-to-end validation of the forced
command. It requests only a manifest and its digest-addressed snapshot; it
does not mutate production.

## Dunwichmass staging provisioning

First obtain explicit test-deployment authorization and deploy the immutable
release while `COMPOSE_PROFILES=content-sync` is absent. The ignored `.env`
must already contain the content-sync values so the tracked overlay validates.
Immediately before both the deployment wrapper and, later, the provisioning
wrapper, run this preflight from the reviewed local checkout. It requires the
fixed project, zero profile definitions, and no running regular or one-off
sync container without displaying `.env`:

```bash
set -euo pipefail
ssh -a dunwichmass /bin/bash -s <<'REMOTE'
set -euo pipefail
cd /home/rufus/legendhub
test -f .env
profile_lines="$(awk '
  /^[[:space:]]*(export[[:space:]]+)?COMPOSE_PROFILES[[:space:]]*=/ {
    count += 1
  }
  END { print count + 0 }
' .env)"
project_definitions="$(awk '
  /^[[:space:]]*(export[[:space:]]+)?COMPOSE_PROJECT_NAME[[:space:]]*=/ {
    count += 1
  }
  END { print count + 0 }
' .env)"
project_literal_lines="$(awk '
  $0 == "COMPOSE_PROJECT_NAME=legendhub-test" { count += 1 }
  END { print count + 0 }
' .env)"
test "$profile_lines" -eq 0
test "$project_definitions" -eq 1
test "$project_literal_lines" -eq 1
unset COMPOSE_PROFILES COMPOSE_PROJECT_NAME
running_sync_containers="$(docker ps --quiet --no-trunc \
  --filter label=com.docker.compose.project=legendhub-test \
  --filter label=com.docker.compose.service=content-sync)"
test -z "$running_sync_containers"
REMOTE
```

After that preflight succeeds, run the separately authorized deployment:

```bash
set -euo pipefail
release_sha='REPLACE-WITH-12-CHARACTER-IMMUTABLE-SHA'
[[ "$release_sha" =~ ^[abcdef0123456789]{12}$ ]]
./scripts/deploy-test.sh "$release_sha"
```

The deployment, provisioning, and remote manual-sync wrappers independently
repeat the project-identity check in their own SSH processes: each requires
exactly one literal `COMPOSE_PROJECT_NAME=legendhub-test` line, clears any ambient
override, and exports the fixed project before Compose. The operator preflight
above additionally proves profile and running-container state before either
authorized mutation.

The deployment leaves `/home/rufus/legendhub` at the matching detached
commit. With separate staging-provisioning authorization, run from the same
reviewed local checkout after repeating the preflight above:

```bash
set -euo pipefail
./scripts/provision-test-content-sync.sh
```

The wrapper connects with agent forwarding disabled, validates the four-file
Compose configuration and detached-HEAD image tag, finds exactly one
Dunwichmass MySQL container, creates only `legendhub_content_sync`, and grants
that database to the existing `legendhub` user. It does not print or export
the root password and does not start the hourly profile.

Confirm the deployed configuration without displaying interpolated secrets:

```bash
ssh -a dunwichmass
```

In that Dunwichmass shell, run:

```bash
set -euo pipefail
cd /home/rufus/legendhub
project_definitions="$(awk '
  /^[[:space:]]*(export[[:space:]]+)?COMPOSE_PROJECT_NAME[[:space:]]*=/ {
    count += 1
  }
  END { print count + 0 }
' .env)"
project_literal_lines="$(awk '
  $0 == "COMPOSE_PROJECT_NAME=legendhub-test" { count += 1 }
  END { print count + 0 }
' .env)"
test "$project_definitions" -eq 1
test "$project_literal_lines" -eq 1
unset COMPOSE_PROJECT_NAME
release_sha="$(git rev-parse --short=12 HEAD)"
[[ "$release_sha" =~ ^[abcdef0123456789]{12}$ ]]
export LEGENDHUB_IMAGE_TAG="$release_sha"
compose=(
  docker compose
  -f docker-compose.yaml
  -f docker-compose.test.yaml
  -f docker-compose.registry.yaml
  -f docker-compose.content-sync.yaml
)
"${compose[@]}" config --quiet
"${compose[@]}" ps mysql mysql-backup www python
```

Do not run `config` without `--quiet`, because rendered Compose output contains
environment values.

## Comparison-only run

Establish an operator maintenance freeze before starting: no other operator may
run either manual wrapper, enable the profile, or deploy until the post-run
checks finish and `www` and `python` are restarted. The final container checks
below enforce the machine state; the freeze prevents a new one-off from being
launched while terminals are switched.

Before the first comparison, create and verify a uniquely named private
Dunwichmass backup. This reads the database and writes a private host artifact;
it does not alter database content. Run on Dunwichmass after establishing the
four-file Compose command:

```bash
set -euo pipefail
umask 077
backup_root=/home/rufus/legendhub-content-sync-backups
backup_stamp="$(date -u +%Y%m%dT%H%M%SZ)"
database_backup="${backup_root}/legendhub-pre-content-sync-${backup_stamp}.sql.gz"
mkdir -p -m 700 "$backup_root"
backup_container="$("${compose[@]}" ps -q mysql-backup)"
test -n "$backup_container"
test "${backup_container#*$'\n'}" = "$backup_container"
profile_lines="$(awk '
  /^[[:space:]]*(export[[:space:]]+)?COMPOSE_PROFILES[[:space:]]*=/ {
    count += 1
  }
  END { print count + 0 }
' .env)"
test "$profile_lines" -eq 0
unset COMPOSE_PROFILES
effective_services="$("${compose[@]}" config --services)"
if [[ $'\n'"$effective_services"$'\n' == *$'\ncontent-sync\n'* ]]; then
  printf 'content-sync: hourly profile must remain disabled\n' >&2
  exit 1
fi
running_sync_containers="$(docker ps --quiet --no-trunc \
  --filter label=com.docker.compose.project=legendhub-test \
  --filter label=com.docker.compose.service=content-sync)"
test -z "$running_sync_containers"

create_private_backup() {
  local destination="$1"
  test ! -e "$destination"
  if ! docker exec "$backup_container" bash -c '
    set -euo pipefail
    source /run/legendhub-backup.env
    export MYSQL_PWD="$MYSQL_PASSWORD"
    exec mysqldump \
      -P "$MYSQL_PORT" \
      -h mysql \
      -u "$MYSQL_USER" \
      --single-transaction \
      --quick \
      --lock-tables=false \
      --no-tablespaces \
      -B "$MYSQL_DATABASE"
  ' | gzip > "$destination"; then
    printf 'content-sync: private backup creation failed\n' >&2
    return 1
  fi
  chmod 600 "$destination"
  test -s "$destination"
  gzip -t "$destination"
  test "$(stat -c '%a' "$destination")" = 600
  test "$(stat -c '%U' "$destination")" = "$(id -un)"
  sha256sum "$destination"
  stat -c '%n %s bytes mode=%a owner=%U' "$destination"
}

create_private_backup "$database_backup"
```

Record the exact backup path and SHA-256 in the private rollout record. Do not
display the dump. This comparison backup is not the authoritative rollback
point for the first mutation; that backup is created later while every target
writer is quiesced.

In the same fail-fast Dunwichmass shell, define two secret-safe metadata
captures. They write only table names, exact row counts, and stable SHA-256
digests to mode-`0600` files. Failures are generic; no row contents, SQL, SSH
details, or passwords are printed:

```bash
capture_source_reference() {
  local destination="$1"
  local temporary
  test ! -e "$destination"
  temporary="$(mktemp "${destination}.tmp.XXXXXX")"
  "${compose[@]}" run --rm --no-deps -T \
    -e PYTHONPATH=/usr/local/lib \
    content-sync python3 - > "$temporary" <<'PY'
import json
import os
import sys

from content_sync.contract import Manifest
from content_sync.sync import Dependencies, SyncConfig

try:
    config = SyncConfig.from_environment(os.environ)
    manifest = Manifest.parse(Dependencies.real(config).fetch_manifest())
    result = {
        "public": {
            "counts": manifest.row_counts,
            "sha256": manifest.content_sha256,
        },
    }
except Exception:
    print("source metadata capture failed", file=sys.stderr)
    raise SystemExit(1)

print(json.dumps(result, sort_keys=True, separators=(",", ":")))
PY
  chmod 600 "$temporary"
  mv "$temporary" "$destination"
}

capture_target_reference() {
  local destination="$1"
  local temporary
  test ! -e "$destination"
  temporary="$(mktemp "${destination}.tmp.XXXXXX")"
  docker exec -i "$backup_container" bash -eu -c \
    'export PYTHONPATH=/usr/local/lib; exec python3 -' \
    > "$temporary" <<'PY'
import hashlib
import json
import os
import subprocess
import sys

from content_sync.contract import CANONICAL_DUMP_FLAGS, PUBLIC_TABLES
from content_sync.target import PyMySqlDatabase, TargetConfig, qualified

database = None
try:
    config = TargetConfig.from_environment(os.environ)
    database = PyMySqlDatabase.connect(config)
    table_rows = database._rows(
        "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES "
        "WHERE TABLE_SCHEMA = %s AND TABLE_TYPE = 'BASE TABLE' "
        "ORDER BY TABLE_NAME",
        (config.target_database,),
    )
    excluded_tables = [
        row["TABLE_NAME"] for row in table_rows
        if row["TABLE_NAME"] not in PUBLIC_TABLES
    ]
    if not excluded_tables:
        raise RuntimeError("excluded table set is empty")

    environment = os.environ.copy()
    environment["MYSQL_PWD"] = config.mysql.password
    environment.pop("MYSQL_PASSWORD", None)
    environment.pop("MYSQL_ROOT_PASSWORD", None)
    excluded = {}
    for table in excluded_tables:
        arguments = [
            "mysqldump",
            "--host=" + config.mysql.host,
            "--port=" + str(config.mysql.port),
            "--user=" + config.mysql.user,
            *CANONICAL_DUMP_FLAGS,
            config.target_database,
            table,
        ]
        process = subprocess.Popen(
            arguments,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            env=environment,
        )
        digest = hashlib.sha256()
        for block in iter(lambda: process.stdout.read(1024 * 1024), b""):
            digest.update(block)
        process.stdout.close()
        if process.wait() != 0:
            raise RuntimeError("excluded table digest failed")
        excluded[table] = {
            "count": database.scalar(
                "SELECT COUNT(*) AS content_count FROM "
                + qualified(config.target_database, table)
            ),
            "sha256": digest.hexdigest(),
        }

    result = {
        "excluded": excluded,
        "public": {
            "counts": database.counts(config.target_database),
            "sha256": database.dump_digest(config.target_database),
        },
    }
except Exception:
    print("target metadata capture failed", file=sys.stderr)
    raise SystemExit(1)
finally:
    if database is not None:
        database.close()

print(json.dumps(result, sort_keys=True, separators=(",", ":")))
PY
  chmod 600 "$temporary"
  mv "$temporary" "$destination"
}

capture_restore_reference() {
  local destination="$1"
  local temporary
  test ! -e "$destination"
  temporary="$(mktemp "${destination}.tmp.XXXXXX")"
  if ! docker exec "$backup_container" bash -eu -c '
    source /run/legendhub-backup.env
    test "$MYSQL_DATABASE" = legendhub
    export MYSQL_PWD="$MYSQL_PASSWORD"
    unset MYSQL_PASSWORD MYSQL_ROOT_PASSWORD
    mysql_command=(
      mysql
      --protocol=tcp
      --host=mysql
      --port="$MYSQL_PORT"
      --user="$MYSQL_USER"
      --database="$MYSQL_DATABASE"
      --batch
      --raw
      --skip-column-names
    )
    table_count=0
    while IFS= read -r table; do
      [[ "$table" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]
      count="$("${mysql_command[@]}" --execute \
        "SELECT COUNT(*) FROM \`legendhub\`.\`$table\`")"
      [[ "$count" =~ ^[0123456789]+$ ]]
      checksum_row="$("${mysql_command[@]}" --execute \
        "CHECKSUM TABLE \`legendhub\`.\`$table\`")"
      IFS=$'"'"'\t'"'"' read -r qualified_table checksum_value extra <<< \
        "$checksum_row"
      test -z "${extra:-}"
      test "$qualified_table" = "legendhub.$table"
      [[ "$checksum_value" =~ ^[0123456789]+$ ]]
      printf "%s\t%s\t%s\n" "$table" "$count" "$checksum_value"
      table_count=$((table_count + 1))
    done < <("${mysql_command[@]}" --execute "
      SELECT TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_TYPE = 0x42415345205441424c45
      ORDER BY TABLE_NAME
    ")
    test "$table_count" -ge 18
  ' > "$temporary" 2>/dev/null; then
    unlink "$temporary"
    printf 'content-sync: restore reference capture failed\n' >&2
    return 1
  fi
  chmod 600 "$temporary"
  test -s "$temporary"
  mv "$temporary" "$destination"
}
```

Create a private comparison directory, clear any ambient profile override,
prove that the ignored `.env` leaves the hourly service inactive, then briefly
stop the two application writers and capture the complete pre-dry-run target
metadata:

```bash
reference_root="${backup_root}/verification-${backup_stamp}"
mkdir -m 700 "$reference_root"
pre_dry_reference="${reference_root}/target-before-dry-run.json"
post_dry_reference="${reference_root}/target-after-dry-run.json"
unset COMPOSE_PROFILES
effective_services="$("${compose[@]}" config --services)"
if [[ $'\n'"$effective_services"$'\n' == *$'\ncontent-sync\n'* ]]; then
  printf 'content-sync: hourly profile must remain disabled\n' >&2
  exit 1
fi
running_sync_containers="$(docker ps --quiet --no-trunc \
  --filter label=com.docker.compose.project=legendhub-test \
  --filter label=com.docker.compose.service=content-sync)"
test -z "$running_sync_containers"
restart_remote_writers() {
  "${compose[@]}" up -d --no-deps --no-build www python
}
recover_remote_shell_exit() {
  local original_exit="$?"
  trap - EXIT HUP INT TERM
  if [[ "${remote_writer_recovery_armed:-0}" -eq 1 ]]; then
    if ! restart_remote_writers; then
      printf 'content-sync: remote-shell writer restart failed\n' >&2
    fi
  fi
  exit "$original_exit"
}
remote_writer_recovery_armed=1
trap recover_remote_shell_exit EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
if ! "${compose[@]}" stop www python; then
  restart_remote_writers || true
  printf 'content-sync: writer stop failed; restart attempted\n' >&2
  exit 1
fi
capture_target_reference "$pre_dry_reference"
running_sync_containers="$(docker ps --quiet --no-trunc \
  --filter label=com.docker.compose.project=legendhub-test \
  --filter label=com.docker.compose.service=content-sync)"
if [[ -n "$running_sync_containers" ]]; then
  restart_remote_writers || true
  printf 'content-sync: a sync writer appeared; writer restart attempted\n' >&2
  exit 1
fi
```

Keep that Dunwichmass shell open. In a separate terminal at the reviewed local
checkout, define a fail-safe restart and arm an `EXIT` trap before running the
comparison-only workflow. Any wrapper failure, interrupt, or local-shell exit
attempts to restart only `www` and `python`, then preserves the original
nonzero exit status:

```bash
set -euo pipefail
restart_test_writers() {
  ssh -a dunwichmass /bin/bash -s <<'RESTART'
set -euo pipefail
cd /home/rufus/legendhub
profile_lines="$(awk '
  /^[[:space:]]*(export[[:space:]]+)?COMPOSE_PROFILES[[:space:]]*=/ {
    count += 1
  }
  END { print count + 0 }
' .env)"
project_definitions="$(awk '
  /^[[:space:]]*(export[[:space:]]+)?COMPOSE_PROJECT_NAME[[:space:]]*=/ {
    count += 1
  }
  END { print count + 0 }
' .env)"
project_literal_lines="$(awk '
  $0 == "COMPOSE_PROJECT_NAME=legendhub-test" { count += 1 }
  END { print count + 0 }
' .env)"
test "$profile_lines" -eq 0
test "$project_definitions" -eq 1
test "$project_literal_lines" -eq 1
unset COMPOSE_PROFILES COMPOSE_PROJECT_NAME
release_sha="$(git rev-parse --short=12 HEAD)"
[[ "$release_sha" =~ ^[abcdef0123456789]{12}$ ]]
export LEGENDHUB_IMAGE_TAG="$release_sha"
compose=(
  docker compose
  -f docker-compose.yaml
  -f docker-compose.test.yaml
  -f docker-compose.registry.yaml
  -f docker-compose.content-sync.yaml
)
"${compose[@]}" config --quiet
effective_services="$("${compose[@]}" config --services)"
if [[ $'\n'"$effective_services"$'\n' == *$'\ncontent-sync\n'* ]]; then
  printf 'content-sync: recovery requires the hourly profile disabled\n' >&2
  exit 1
fi
"${compose[@]}" up -d --no-deps --no-build www python
RESTART
}
recover_local_sync_exit() {
  local original_exit="$?"
  if [[ "${writer_recovery_armed:-0}" -eq 1 ]]; then
    if ! restart_test_writers; then
      printf 'content-sync: automatic writer restart failed\n' >&2
    fi
  fi
  exit "$original_exit"
}
writer_recovery_armed=1
trap recover_local_sync_exit EXIT
./scripts/sync-test-content.sh --dry-run
writer_recovery_armed=0
trap - EXIT
```

Require exit zero and one `action=dry-run` success line with a 64-character
content digest and `public_tables=17`. Dry-run downloads and validates the
confidential snapshot and rebuilds the dedicated staging tables, but it does
not apply changes to the `legendhub` target or advance the last-success state.
Stop on any schema, count, digest, SSH, or artifact error.

Back in the Dunwichmass shell, capture the post-run target metadata,
mechanically require every public and excluded count/digest to remain
unchanged, and restart only the two application services. Each capture and
comparison is a standalone fail-fast command. On failure, the armed remote
`EXIT` recovery restarts the writers while preserving the nonzero status:

```bash
capture_target_reference "$post_dry_reference"
python3 - "$pre_dry_reference" "$post_dry_reference" <<'PY'
import json
import sys

try:
    with open(sys.argv[1], encoding="utf-8") as source:
        before = json.load(source)
    with open(sys.argv[2], encoding="utf-8") as source:
        after = json.load(source)
except Exception:
    print("dry-run metadata comparison failed", file=sys.stderr)
    raise SystemExit(1)

if before != after:
    print("dry-run changed target metadata", file=sys.stderr)
    raise SystemExit(1)
print("dry-run target metadata unchanged")
PY
restart_remote_writers
remote_writer_recovery_armed=0
trap - EXIT HUP INT TERM
```

## Initial mutating run

This step requires explicit authorization for the first Dunwichmass content
replacement. Keep the fail-fast Dunwichmass shell from the comparison open. If
it was closed, reopen it with `ssh -a dunwichmass` and redefine
`create_private_backup`, all three capture functions,
`restart_remote_writers`, and `recover_remote_shell_exit` exactly as above.
The block below independently restores fail-fast mode, the private umask,
working directory, backup root, immutable tag, four-file `compose` array, and
`backup_container`; it refuses to create an artifact unless the directory and
all required functions are present. The authoritative backup must be created
only after every target writer is quiesced; never reuse the comparison backup.

Re-establish the same operator maintenance freeze before this section and keep
it in force from the first zero-writer check through the authoritative backup,
mutation, verification, and writer restart. No other operator may run a manual
wrapper, edit the profile, deploy, or begin recovery during that interval.

Require the exact project, zero profile definitions, an effectively inactive
profile, and zero exact-label regular or one-off sync containers. Then stop
the application writers, create and verify a new unique full backup, capture
an all-table rollback reference, and capture the detailed pre-mutation
metadata. Any failure after the stop attempts to restart the writers before
returning nonzero:

```bash
set -euo pipefail
umask 077
cd /home/rufus/legendhub
backup_root=/home/rufus/legendhub-content-sync-backups
test -d "$backup_root"
test "$(stat -c '%a' "$backup_root")" = 700
test "$(stat -c '%U' "$backup_root")" = "$(id -un)"
profile_lines="$(awk '
  /^[[:space:]]*(export[[:space:]]+)?COMPOSE_PROFILES[[:space:]]*=/ {
    count += 1
  }
  END { print count + 0 }
' .env)"
test "$profile_lines" -eq 0
project_definitions="$(awk '
  /^[[:space:]]*(export[[:space:]]+)?COMPOSE_PROJECT_NAME[[:space:]]*=/ {
    count += 1
  }
  END { print count + 0 }
' .env)"
project_literal_lines="$(awk '
  $0 == "COMPOSE_PROJECT_NAME=legendhub-test" { count += 1 }
  END { print count + 0 }
' .env)"
test "$project_definitions" -eq 1
test "$project_literal_lines" -eq 1
unset COMPOSE_PROFILES COMPOSE_PROJECT_NAME
release_sha="$(git rev-parse --short=12 HEAD)"
[[ "$release_sha" =~ ^[abcdef0123456789]{12}$ ]]
export LEGENDHUB_IMAGE_TAG="$release_sha"
compose=(
  docker compose
  -f docker-compose.yaml
  -f docker-compose.test.yaml
  -f docker-compose.registry.yaml
  -f docker-compose.content-sync.yaml
)
"${compose[@]}" config --quiet
effective_services="$("${compose[@]}" config --services)"
if [[ $'\n'"$effective_services"$'\n' == *$'\ncontent-sync\n'* ]]; then
  printf 'content-sync: hourly profile must remain disabled\n' >&2
  exit 1
fi
backup_container="$("${compose[@]}" ps -q mysql-backup)"
test -n "$backup_container"
test "${backup_container#*$'\n'}" = "$backup_container"
declare -F create_private_backup >/dev/null
declare -F capture_source_reference >/dev/null
declare -F capture_target_reference >/dev/null
declare -F capture_restore_reference >/dev/null
declare -F restart_remote_writers >/dev/null
declare -F recover_remote_shell_exit >/dev/null
running_sync_containers="$(docker ps --quiet --no-trunc \
  --filter label=com.docker.compose.project=legendhub-test \
  --filter label=com.docker.compose.service=content-sync)"
test -z "$running_sync_containers"
mutation_stamp="$(date -u +%Y%m%dT%H%M%SZ)"
mutation_root="${backup_root}/mutation-verification-${mutation_stamp}"
mkdir -m 700 "$mutation_root"
database_backup="${backup_root}/legendhub-pre-content-sync-${mutation_stamp}.sql.gz"
pre_mutation_reference="${mutation_root}/target-before.json"
source_reference="${mutation_root}/production-source.json"
post_mutation_reference="${mutation_root}/target-after.json"
restore_reference="${mutation_root}/restore-all-tables-before.tsv"
remote_writer_recovery_armed=1
trap recover_remote_shell_exit EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
if ! "${compose[@]}" stop www python; then
  restart_remote_writers || true
  printf 'content-sync: writer stop failed; restart attempted\n' >&2
  exit 1
fi
running_sync_containers="$(docker ps --quiet --no-trunc \
  --filter label=com.docker.compose.project=legendhub-test \
  --filter label=com.docker.compose.service=content-sync)"
if [[ -n "$running_sync_containers" ]]; then
  restart_remote_writers || true
  printf 'content-sync: a sync writer appeared; writer restart attempted\n' >&2
  exit 1
fi
create_private_backup "$database_backup"
capture_restore_reference "$restore_reference"
capture_target_reference "$pre_mutation_reference"
test "$(stat -c '%a' "$restore_reference")" = 600
test "$(stat -c '%U' "$restore_reference")" = "$(id -un)"
sha256sum "$restore_reference"
stat -c '%n %s bytes mode=%a owner=%U' "$restore_reference"
running_sync_containers="$(docker ps --quiet --no-trunc \
  --filter label=com.docker.compose.project=legendhub-test \
  --filter label=com.docker.compose.service=content-sync)"
if [[ -n "$running_sync_containers" ]]; then
  restart_remote_writers || true
  printf 'content-sync: a sync writer appeared; writer restart attempted\n' >&2
  exit 1
fi
```

Before switching terminals, record the newly printed backup path and SHA-256,
plus the exact `restore_reference` path and SHA-256, in the private rollout
record. The backup and both references were created while `www`, `python`, and
every sync writer were stopped.

Keep that remote shell open. In the same reviewed local terminal, re-arm the
writer-recovery trap defined under **Comparison-only run**. If that terminal
was closed, redefine `restart_test_writers` and `recover_local_sync_exit`
exactly as above before running:

```bash
set -euo pipefail
declare -F restart_test_writers >/dev/null
declare -F recover_local_sync_exit >/dev/null
writer_recovery_armed=1
trap recover_local_sync_exit EXIT
./scripts/sync-test-content.sh
writer_recovery_armed=0
trap - EXIT
```

Require exit zero and an `action=applied-source-change` (or, when repairing a
previously recorded digest, `action=repaired-target-drift`) success line.
Record its content digest. Back in the Dunwichmass shell, capture the source
manifest metadata and post-mutation target metadata, compare them mechanically,
and restart the application writers. Each capture and comparison is a
standalone fail-fast command; the armed remote `EXIT` recovery handles any
failure before the explicit restart:

```bash
capture_source_reference "$source_reference"
capture_target_reference "$post_mutation_reference"
python3 - \
    "$source_reference" \
    "$pre_mutation_reference" \
    "$post_mutation_reference" <<'PY'
import json
import sys

try:
    with open(sys.argv[1], encoding="utf-8") as source:
        production = json.load(source)
    with open(sys.argv[2], encoding="utf-8") as source:
        before = json.load(source)
    with open(sys.argv[3], encoding="utf-8") as source:
        after = json.load(source)
except Exception:
    print("mutation metadata comparison failed", file=sys.stderr)
    raise SystemExit(1)

if after.get("public") != production.get("public"):
    print("public counts or digest differ from production", file=sys.stderr)
    raise SystemExit(1)
if after.get("excluded") != before.get("excluded"):
    print("excluded counts or digests changed", file=sys.stderr)
    raise SystemExit(1)
print("public metadata matched and excluded metadata was preserved")
PY
restart_remote_writers
remote_writer_recovery_armed=0
trap - EXIT HUP INT TERM
```

The first equality covers every one of the 17 manifest row counts and the
canonical public digest. The second covers every non-allowlisted base table's
exact count and stable data digest. The private JSON files contain metadata,
not rows, and remain part of the private rollout record. Verify `/`, `/items/`,
`/mobs/`, `/quests/`, `/wiki/`, `/builder/`, and history views, plus a test
account login, MySQL health, and the existing backup service. A second
unchanged manual run should report `action=noop`.

If any committed synchronized content is wrong, leave the hourly profile
disabled, stop further manual runs, and use the separately authorized restore
procedure below.

## Enable or disable the hourly profile

Enable automation only after the initial mutation and its verification are
authorized and complete. Open a Dunwichmass shell with agent forwarding
disabled:

```bash
ssh -a dunwichmass
```

In that shell, enable fail-fast behavior and use `vi` to add exactly this one
literal line to the ignored `.env`:

```bash
set -euo pipefail
cd /home/rufus/legendhub
vi .env
```

```dotenv
COMPOSE_PROFILES=content-sync
```

Mechanically require exactly one profile definition and exactly one approved
literal value. Clear any ambient shell override, derive the immutable tag,
verify that Compose now includes the service, and only then recreate
`content-sync` with all four overlays:

```bash
profile_lines="$(awk '
  /^[[:space:]]*(export[[:space:]]+)?COMPOSE_PROFILES[[:space:]]*=/ {
    count += 1
  }
  END { print count + 0 }
' .env)"
exact_profile_lines="$(awk '
  $0 == "COMPOSE_PROFILES=content-sync" { count += 1 }
  END { print count + 0 }
' .env)"
test "$profile_lines" -eq 1
test "$exact_profile_lines" -eq 1
project_definitions="$(awk '
  /^[[:space:]]*(export[[:space:]]+)?COMPOSE_PROJECT_NAME[[:space:]]*=/ {
    count += 1
  }
  END { print count + 0 }
' .env)"
project_literal_lines="$(awk '
  $0 == "COMPOSE_PROJECT_NAME=legendhub-test" { count += 1 }
  END { print count + 0 }
' .env)"
test "$project_definitions" -eq 1
test "$project_literal_lines" -eq 1
unset COMPOSE_PROFILES COMPOSE_PROJECT_NAME
release_sha="$(git rev-parse --short=12 HEAD)"
[[ "$release_sha" =~ ^[abcdef0123456789]{12}$ ]]
export LEGENDHUB_IMAGE_TAG="$release_sha"
compose=(
  docker compose
  -f docker-compose.yaml
  -f docker-compose.test.yaml
  -f docker-compose.registry.yaml
  -f docker-compose.content-sync.yaml
)
"${compose[@]}" config --quiet
effective_services="$("${compose[@]}" config --services)"
active_sync_count="$(printf '%s\n' "$effective_services" | awk '
  $0 == "content-sync" { count += 1 }
  END { print count + 0 }
')"
test "$active_sync_count" -eq 1
running_sync_containers="$(docker ps --quiet --no-trunc \
  --filter label=com.docker.compose.project=legendhub-test \
  --filter label=com.docker.compose.service=content-sync)"
test -z "$running_sync_containers"
mysql_before="$("${compose[@]}" ps -q mysql)"
test -n "$mysql_before"
test "${mysql_before#*$'\n'}" = "$mysql_before"
"${compose[@]}" up -d --no-deps --no-build content-sync
test "$("${compose[@]}" ps -q mysql)" = "$mysql_before"
running_sync_containers="$(docker ps --quiet --no-trunc \
  --filter label=com.docker.compose.project=legendhub-test \
  --filter label=com.docker.compose.service=content-sync)"
test -n "$running_sync_containers"
test "${running_sync_containers#*$'\n'}" = "$running_sync_containers"
"${compose[@]}" ps content-sync mysql
```

The loop runs immediately at startup and then on the configured interval,
which defaults to 3600 seconds. Verify the immediate success and a later
unchanged `action=noop` before considering enablement complete.

To disable automation, open a fresh shell if needed:

```bash
ssh -a dunwichmass
```

Use `vi` to remove the entire `COMPOSE_PROFILES=content-sync` line. This
runbook requires zero `COMPOSE_PROFILES` definitions after disablement:

```bash
set -euo pipefail
cd /home/rufus/legendhub
vi .env
profile_lines="$(awk '
  /^[[:space:]]*(export[[:space:]]+)?COMPOSE_PROFILES[[:space:]]*=/ {
    count += 1
  }
  END { print count + 0 }
' .env)"
test "$profile_lines" -eq 0
project_definitions="$(awk '
  /^[[:space:]]*(export[[:space:]]+)?COMPOSE_PROJECT_NAME[[:space:]]*=/ {
    count += 1
  }
  END { print count + 0 }
' .env)"
project_literal_lines="$(awk '
  $0 == "COMPOSE_PROJECT_NAME=legendhub-test" { count += 1 }
  END { print count + 0 }
' .env)"
test "$project_definitions" -eq 1
test "$project_literal_lines" -eq 1
unset COMPOSE_PROFILES COMPOSE_PROJECT_NAME
release_sha="$(git rev-parse --short=12 HEAD)"
[[ "$release_sha" =~ ^[abcdef0123456789]{12}$ ]]
export LEGENDHUB_IMAGE_TAG="$release_sha"
compose=(
  docker compose
  -f docker-compose.yaml
  -f docker-compose.test.yaml
  -f docker-compose.registry.yaml
  -f docker-compose.content-sync.yaml
)
"${compose[@]}" config --quiet
effective_services="$("${compose[@]}" config --services)"
inactive_sync_count="$(printf '%s\n' "$effective_services" | awk '
  $0 == "content-sync" { count += 1 }
  END { print count + 0 }
')"
test "$inactive_sync_count" -eq 0
"${compose[@]}" stop content-sync
running_sync_containers="$(docker ps --quiet --no-trunc \
  --filter label=com.docker.compose.project=legendhub-test \
  --filter label=com.docker.compose.service=content-sync)"
test -z "$running_sync_containers"
"${compose[@]}" ps mysql mysql-backup www python
```

Disabling does not delete the `content-sync` container, its private state
volume, the staging database, the main database, or any backup. Do not use
`down`, `rm`, `volume rm`, or `down --volumes` for enablement or disablement.

## Immediate manual run

Manual reconciliation works whether or not the hourly profile is enabled. Run
the comparison-only command from the reviewed local repository checkout:

```bash
set -euo pipefail
./scripts/sync-test-content.sh --dry-run
```

Run the mutating command only with separate authorization:

```bash
set -euo pipefail
./scripts/sync-test-content.sh
```

The first performs comparison-only validation. The second may replace the 17
allowlisted Dunwichmass tables and therefore requires authorization for that
mutation. Both wrappers disable SSH agent forwarding, connect only to
Dunwichmass, independently require and export the fixed `legendhub-test` Compose
project, derive its current detached-HEAD image tag, and use all four Compose
overlays. The snapshot moves directly from production to the Dunwichmass
container; it does not traverse the local Mac.

## Health and secret-free logs

When the hourly service is enabled, inspect it on Dunwichmass after
establishing the immutable tag and four-file `compose` array:

```bash
set -euo pipefail
"${compose[@]}" ps content-sync mysql mysql-backup
sync_container="$("${compose[@]}" ps -q content-sync)"
test -n "$sync_container"
test "${sync_container#*$'\n'}" = "$sync_container"
docker inspect --format \
  'sync={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} restarts={{.RestartCount}}' \
  "$sync_container"
"${compose[@]}" logs --tail=100 content-sync
"${compose[@]}" logs --tail=100 mysql-backup
set +e
"${compose[@]}" exec -T content-sync \
  /usr/local/bin/content-sync-health
health_exit="$?"
set -e
printf 'content-sync-health exit=%s\n' "$health_exit"
```

The health helper prints only `healthy`, `starting`, or `unhealthy`. Before the
first success, its nonzero `starting` result is expected. After success, the
service is healthy while the state is no older than
`CONTENT_SYNC_MAX_AGE_SECONDS` (7200 seconds by default), independently of the
3600-second loop interval. A stale, malformed, future-dated, or missing state
fails closed.

Success logs contain only timestamps, action names, digests, artifact byte
sizes, the fixed public-table count, and durations. Failures contain a stage
and sanitized exception class, not the underlying secret-bearing error. Never
run `docker compose config` without `--quiet`; never print `.env`, container
environment, the private key, state file, cached snapshot, raw SQL, or audit
rows while diagnosing a failure.

## Revoke production access

Revocation requires explicit production authorization. Disable and stop the
hourly service on Dunwichmass as described above, then use `vi` on production
to remove the exact restricted line. Open the production shell first:

```bash
ssh -a legend
```

Then run inside that shell:

```bash
set -euo pipefail
authorized_keys=/home/rufus/.ssh/authorized_keys
approved_key_fingerprint='SHA256:REPLACE-WITH-APPROVED-SYNC-KEY-FINGERPRINT'
[[ "$approved_key_fingerprint" =~ ^SHA256:[A-Za-z0-9+/]{43}$ ]]
vi "$authorized_keys"
chmod 600 "$authorized_keys"
comment_lines="$(awk '$NF == "legendhub-content-sync" { count += 1 }
  END { print count + 0 }' "$authorized_keys")"
test "$comment_lines" -eq 0
active_key_lines="$(awk 'NF && $1 !~ /^#/ { count += 1 }
  END { print count + 0 }' "$authorized_keys")"
if [[ "$active_key_lines" -eq 0 ]]; then
  approved_fingerprint_lines=0
else
  approved_fingerprint_lines="$(ssh-keygen -lf "$authorized_keys" 2>/dev/null | \
    awk -v fingerprint="$approved_key_fingerprint" '
      $2 == fingerprint { count += 1 }
      END { print count + 0 }
    ')"
fi
test "$approved_fingerprint_lines" -eq 0
```

Replace the fingerprint placeholder with the value recorded during key
creation. The two zero-count checks prove that neither the expected comment
nor the approved key remains under a renamed or commentless entry, without
printing any key bytes. Removing the production authorized-key entry
immediately denies future manifest and snapshot requests without changing
either database. Leave the wrapper, Dunwichmass key files, state volume,
staging database, and backups in place until their separately authorized
retention or incident-review decision; they are not needed to revoke access.

## Restore the pre-sync Dunwichmass backup

Restore only with explicit authorization and only from the exact path and
SHA-256 recorded before the first mutation. Establish a maintenance freeze:
no operator may invoke either manual sync command until recovery is complete.
Open a Dunwichmass shell:

```bash
ssh -a dunwichmass
```

Inside that shell, enable fail-fast behavior and use `vi` to remove the entire
`COMPOSE_PROFILES=content-sync` line from the ignored `.env`:

```bash
set -euo pipefail
umask 077
cd /home/rufus/legendhub
backup_root=/home/rufus/legendhub-content-sync-backups
test -d "$backup_root"
test "$(stat -c '%a' "$backup_root")" = 700
test "$(stat -c '%U' "$backup_root")" = "$(id -un)"
vi .env
profile_lines="$(awk '
  /^[[:space:]]*(export[[:space:]]+)?COMPOSE_PROFILES[[:space:]]*=/ {
    count += 1
  }
  END { print count + 0 }
' .env)"
test "$profile_lines" -eq 0
project_definitions="$(awk '
  /^[[:space:]]*(export[[:space:]]+)?COMPOSE_PROJECT_NAME[[:space:]]*=/ {
    count += 1
  }
  END { print count + 0 }
' .env)"
test "$project_definitions" -eq 1
project_literal_lines="$(awk '
  $0 == "COMPOSE_PROJECT_NAME=legendhub-test" { count += 1 }
  END { print count + 0 }
' .env)"
test "$project_literal_lines" -eq 1
unset COMPOSE_PROFILES COMPOSE_PROJECT_NAME
release_sha="$(git rev-parse --short=12 HEAD)"
[[ "$release_sha" =~ ^[abcdef0123456789]{12}$ ]]
export LEGENDHUB_IMAGE_TAG="$release_sha"
compose=(
  docker compose
  -f docker-compose.yaml
  -f docker-compose.test.yaml
  -f docker-compose.registry.yaml
)
tracked_content_sync="$(git ls-tree --name-only HEAD -- \
  docker-compose.content-sync.yaml)"
case "$tracked_content_sync" in
  docker-compose.content-sync.yaml)
    test -f docker-compose.content-sync.yaml
    compose+=(-f docker-compose.content-sync.yaml)
    has_content_sync=1
    ;;
  '')
    has_content_sync=0
    ;;
  *)
    printf 'content-sync: unexpected Compose tree result\n' >&2
    exit 1
    ;;
esac
"${compose[@]}" config --quiet
effective_services="$("${compose[@]}" config --services)"
active_sync_count="$(printf '%s\n' "$effective_services" | awk '
  $0 == "content-sync" { count += 1 }
  END { print count + 0 }
')"
test "$active_sync_count" -eq 0
database_backup='REPLACE-WITH-EXACT-RECORDED-ABSOLUTE-PATH'
expected_backup_sha='REPLACE-WITH-RECORDED-SHA256'
restore_reference='REPLACE-WITH-EXACT-RECORDED-RESTORE-REFERENCE-PATH'
expected_restore_reference_sha='REPLACE-WITH-RECORDED-REFERENCE-SHA256'
case "$database_backup" in
  "$backup_root"/legendhub-pre-content-sync-*.sql.gz) ;;
  *)
    printf 'content-sync: backup path is outside the approved set\n' >&2
    exit 1
    ;;
esac
case "$restore_reference" in
  "$backup_root"/mutation-verification-*/restore-all-tables-before.tsv) ;;
  *)
    printf 'content-sync: restore reference path is outside the approved set\n' >&2
    exit 1
    ;;
esac
[[ "$expected_backup_sha" =~ ^[abcdef0123456789]{64}$ ]]
[[ "$expected_restore_reference_sha" =~ ^[abcdef0123456789]{64}$ ]]
test -s "$database_backup"
test "$(stat -c '%a' "$database_backup")" = 600
test "$(stat -c '%U' "$database_backup")" = "$(id -un)"
gzip -t "$database_backup"
actual_backup_sha="$(sha256sum "$database_backup" | awk '{print $1}')"
test "$actual_backup_sha" = "$expected_backup_sha"
test -s "$restore_reference"
test "$(stat -c '%a' "$restore_reference")" = 600
test "$(stat -c '%U' "$restore_reference")" = "$(id -un)"
actual_restore_reference_sha="$(sha256sum "$restore_reference" | \
  awk '{print $1}')"
test "$actual_restore_reference_sha" = "$expected_restore_reference_sha"
```

Replace all four placeholders with the exact recorded absolute paths and
digests. Both paths, modes, owners, and 64-character SHA-256 values, plus the
backup gzip stream, must pass mechanically. The Git-tree branch above uses all
four overlays for a current checkout and the original three for a genuine
legacy rollback.

Define the same secret-safe, legacy-image-compatible all-table capture used
before mutation. It uses only the preserved backup entrypoint environment and
MySQL client, emits no rows, and writes exact counts plus stable table
checksums to a private file:

```bash
capture_restore_reference() {
  local destination="$1"
  local temporary
  test ! -e "$destination"
  temporary="$(mktemp "${destination}.tmp.XXXXXX")"
  if ! docker exec "$backup_container" bash -eu -c '
    source /run/legendhub-backup.env
    test "$MYSQL_DATABASE" = legendhub
    export MYSQL_PWD="$MYSQL_PASSWORD"
    unset MYSQL_PASSWORD MYSQL_ROOT_PASSWORD
    mysql_command=(
      mysql
      --protocol=tcp
      --host=mysql
      --port="$MYSQL_PORT"
      --user="$MYSQL_USER"
      --database="$MYSQL_DATABASE"
      --batch
      --raw
      --skip-column-names
    )
    table_count=0
    while IFS= read -r table; do
      [[ "$table" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]
      count="$("${mysql_command[@]}" --execute \
        "SELECT COUNT(*) FROM \`legendhub\`.\`$table\`")"
      [[ "$count" =~ ^[0123456789]+$ ]]
      checksum_row="$("${mysql_command[@]}" --execute \
        "CHECKSUM TABLE \`legendhub\`.\`$table\`")"
      IFS=$'"'"'\t'"'"' read -r qualified_table checksum_value extra <<< \
        "$checksum_row"
      test -z "${extra:-}"
      test "$qualified_table" = "legendhub.$table"
      [[ "$checksum_value" =~ ^[0123456789]+$ ]]
      printf "%s\t%s\t%s\n" "$table" "$count" "$checksum_value"
      table_count=$((table_count + 1))
    done < <("${mysql_command[@]}" --execute "
      SELECT TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_TYPE = 0x42415345205441424c45
      ORDER BY TABLE_NAME
    ")
    test "$table_count" -ge 18
  ' > "$temporary" 2>/dev/null; then
    unlink "$temporary"
    printf 'content-sync: restore reference capture failed\n' >&2
    return 1
  fi
  chmod 600 "$temporary"
  test -s "$temporary"
  mv "$temporary" "$destination"
}
```

Stop the regular sync service when it exists and stop the application writers,
but keep MySQL running. Then discover every running container with the exact
`legendhub-test` project and `content-sync` service labels; this includes one-off
`compose run` containers. Require zero rather than stopping an unknown
in-flight transaction:

```bash
if [[ "$has_content_sync" -eq 1 ]]; then
  "${compose[@]}" stop content-sync www python mysql-backup
else
  "${compose[@]}" stop www python mysql-backup
fi
running_sync_containers="$(docker ps --quiet --no-trunc \
  --filter label=com.docker.compose.project=legendhub-test \
  --filter label=com.docker.compose.service=content-sync)"
test -z "$running_sync_containers"
mysql_container="$("${compose[@]}" ps -q mysql)"
test -n "$mysql_container"
test "${mysql_container#*$'\n'}" = "$mysql_container"
test "$(docker inspect --format '{{.State.Health.Status}}' \
  "$mysql_container")" = healthy
```

Check the exact labels again immediately before import. Restore through the
MySQL container without placing a password in an argument or displaying the
dump. Capture all detailed pipeline diagnostics in a new private file and
print only a generic failure plus that private path:

```bash
running_sync_containers="$(docker ps --quiet --no-trunc \
  --filter label=com.docker.compose.project=legendhub-test \
  --filter label=com.docker.compose.service=content-sync)"
test -z "$running_sync_containers"
restore_diagnostics="$(mktemp \
  "$backup_root/.content-sync-restore-errors.XXXXXX")"
chmod 600 "$restore_diagnostics"
if {
  gzip -dc "$database_backup" | \
    docker exec -i "$mysql_container" sh -eu -c '
      export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"
      unset MYSQL_ROOT_PASSWORD MYSQL_PASSWORD
      exec mysql --protocol=socket --user=root
    ' > /dev/null
} 2> "$restore_diagnostics"; then
  unlink "$restore_diagnostics"
else
  printf 'content-sync: restore failed; private diagnostics retained at %s\n' \
    "$restore_diagnostics" >&2
  exit 1
fi
```

Because the shell has `pipefail`, gzip failure and MySQL failure both fail the
guard. Before restarting either application writer, require healthy MySQL,
start only the read-only backup service, reproduce the all-table reference
through the same current or legacy overlay set, and compare it mechanically
with the retained pre-mutation reference:

```bash
test "$(docker inspect --format '{{.State.Health.Status}}' \
  "$mysql_container")" = healthy
"${compose[@]}" up -d --no-deps --no-build mysql-backup
backup_container="$("${compose[@]}" ps -q mysql-backup)"
test -n "$backup_container"
test "${backup_container#*$'\n'}" = "$backup_container"
docker exec "$backup_container" test -s /run/legendhub-backup.env
restore_stamp="$(date -u +%Y%m%dT%H%M%SZ)"
post_restore_reference="${backup_root}/restore-verification-${restore_stamp}.tsv"
capture_restore_reference "$post_restore_reference"
test "$(stat -c '%a' "$post_restore_reference")" = 600
test "$(stat -c '%U' "$post_restore_reference")" = "$(id -un)"
if ! cmp --silent "$restore_reference" "$post_restore_reference"; then
  printf 'content-sync: restored all-table reference mismatch; writers remain stopped\n' >&2
  exit 1
fi
sha256sum "$post_restore_reference"
running_sync_containers="$(docker ps --quiet --no-trunc \
  --filter label=com.docker.compose.project=legendhub-test \
  --filter label=com.docker.compose.service=content-sync)"
test -z "$running_sync_containers"
"${compose[@]}" up -d --no-deps --no-build python www
"${compose[@]}" ps mysql mysql-backup python www
```

The byte-for-byte reference comparison covers the exact row count and stable
checksum of every base table, including accounts and all public and operational
tables, before writers restart. Record the post-restore reference path and
SHA-256 in the private incident record. Recheck the application routes,
restored account and operational data, MySQL health, and backup health. Do not
re-enable or manually run content sync until the incident cause is corrected
and a new mutation is explicitly authorized. The restore does not require
deleting the synchronization state volume or staging database.
