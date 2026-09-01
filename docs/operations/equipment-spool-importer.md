# Equipment Spool Importer

The equipment importer reads complete JSON observations written by LegendMUD
on the shared Dunwichmass filesystem. LegendMUD writes only to `incoming/` and
never reads the spool. LegendHUB claims ready files and exclusively owns
`processing/`, `processed/`, and `rejected/`.

The live host root is `/home/rufus/legendhub-spool`; the container sees that
same root as `/var/spool/legendhub`. The importer has no published ports and
does not enable or depend on the optional production-content sync.

## Filesystem contract

The host layout is:

```text
/home/rufus/legendhub-spool/
├── incoming/
├── processing/
├── processed/
└── rejected/
```

Use a shared `legendhub` group and mode `2770` on the root and all four
directories. The setgid bit keeps moved and newly created files in that group.
The MUD must write a temporary dotfile on this same filesystem, make it group
readable with mode `0660`, and atomically rename it to a visible `*.json` name
in `incoming/`. Never write a ready filename incrementally.

The importer moves a claimed file to `processing/`. On successful database
commit it moves the file to `processed/`; on a permanent validation or
database failure it moves the file to `rejected/` and writes a safe
`*.error.json` sidecar. Startup returns every visible processing file to
`incoming/`. Normal polling does the same for claims older than 15 minutes, so
a crash after database commit is handled as an idempotent replay.

Plain processed JSON is gzipped after one day and removed after 30 days.
Rejected observations and sidecars are removed after 90 days. MySQL is the
durable record; the spool history is only a bounded debugging window.

## Configure and enable on Dunwichmass

Publishing and deploying an image are separate, explicitly authorized
operations. Once an authorized importer commit is deployed, use `vi` to add or
confirm these ignored `.env` values in `/home/rufus/legendhub`:

```dotenv
EQUIPMENT_SPOOL_HOST_PATH=/home/rufus/legendhub-spool
COMPOSE_PROFILES=equipment-importer
```

If another profile is intentionally enabled, use a comma-separated value such
as `content-sync,equipment-importer`. Do not add `content-sync` merely to run
the importer.

In each new Dunwichmass shell, build the current immutable Compose command:

```bash
set -euo pipefail
cd /home/rufus/legendhub
release_sha="$(git rev-parse --short=12 HEAD)"
[[ "$release_sha" =~ ^[abcdef0123456789]{12}$ ]]
export LEGENDHUB_IMAGE_TAG="$release_sha"
compose=(
  docker compose
  -f docker-compose.yaml
  -f docker-compose.test.yaml
  -f docker-compose.content-sync.yaml
  -f docker-compose.equipment-importer.yaml
  -f docker-compose.registry.yaml
)
"${compose[@]}" config --quiet
"${compose[@]}" up -d --no-build equipment-importer
```

The importer runs database migrations before it touches the spool. Do not copy
a live sample into `incoming/` until the container is running and the migration
has succeeded.

## Inspect safely

These commands show status, counts, filenames, and stable error codes without
printing submitted JSON, canonical payloads, or account IDs:

```bash
"${compose[@]}" ps equipment-importer
"${compose[@]}" logs --tail=100 equipment-importer
find /home/rufus/legendhub-spool/incoming -maxdepth 1 -type f -name '*.json' -printf '%f\n' | sort
find /home/rufus/legendhub-spool/processing -maxdepth 1 -type f -name '*.json' -printf '%f\n' | sort
find /home/rufus/legendhub-spool/rejected -maxdepth 1 -type f -name '*.error.json' -printf '%f\n' | sort
"${compose[@]}" exec -T mysql sh -c \
  'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql -u"$MYSQL_USER" "$MYSQL_DATABASE" -e "SELECT COUNT(*) AS official_items FROM Items WHERE Official = 1; SELECT COUNT(*) AS variants FROM OfficialItemVariants; SELECT COUNT(*) AS submissions FROM EquipmentSubmissions;"'
```

Do not run `cat`, `head`, or broad SQL selects against submission payloads or
attribution fields during routine inspection.

## Retry a rejected observation

Never move a rejected file back unchanged: its submission identity is already
meaningful, and reusing that identity for changed content is a permanent
collision. Prefer having LegendMUD emit a corrected observation with a new
submission ID.

If a manual retry is explicitly required, inspect and correct it privately,
assign a new unique submission ID, write a hidden temporary file in
`incoming/`, set mode `0660`, and rename it atomically. For example:

```bash
set -euo pipefail
source_file=/home/rufus/legendhub-spool/rejected/REPLACE.json
new_id=REPLACE-WITH-NEW-UNIQUE-ID
temporary=/home/rufus/legendhub-spool/incoming/.retry-"$new_id".json
ready=/home/rufus/legendhub-spool/incoming/retry-"$new_id".json
jq --arg id "$new_id" '.submission.id = $id' "$source_file" > "$temporary"
chmod 0660 "$temporary"
mv -- "$temporary" "$ready"
```

Keep the rejected original and sidecar until normal retention removes them.

## Disable or roll back

Use `vi` to remove `equipment-importer` from `COMPOSE_PROFILES`, then explicitly
stop and remove only that service:

```bash
"${compose[@]}" --profile equipment-importer stop equipment-importer
"${compose[@]}" --profile equipment-importer rm -f equipment-importer
```

This leaves the spool and database records intact. An authorized deployment of
an older commit through `scripts/deploy-test.sh` also detects and removes a
stale importer container when that commit predates the importer overlay. Never
use `down --volumes` for this procedure.
