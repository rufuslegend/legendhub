# Production-to-Test Public Content Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mirror LegendHUB's allowlisted production content and audit history to Dunwichmass once per hour or on manual request without changing Dunwichmass-local identity, authorization, notification, migration, or operational data.

**Architecture:** Extend the existing MySQL backup image with a small Python content-sync package. Production creates deterministic, digest-addressed snapshots behind a forced SSH command; a profiled Dunwichmass service pulls, stages, verifies, and transactionally applies those snapshots. A local operator wrapper invokes the same guarded workflow immediately, with an explicit dry-run mode.

**Tech Stack:** Python 3 standard library, PyMySQL, MySQL 5.7, `mysqldump`, gzip, OpenSSH, Bash, Docker Compose, Node's built-in test runner, Python `unittest`.

## Global Constraints

- The primary branch is `master`; implement on the existing `feat/production-content-sync` branch.
- Keep the release version at `2.8.0-beta` unless the maintainer explicitly authorizes promotion.
- Do not push, publish images, tag, deploy, provision SSH access, or mutate either server database without authorization for that exact action.
- Any publication must publish all three private `linux/amd64` repositories: `tmckimmey/legendhub-www`, `tmckimmey/legendhub-python`, and `tmckimmey/legendhub-mysql-backup`.
- Never move, delete, or reuse an existing release tag.
- Never read into logs, print, commit, or copy `.env` contents, database passwords, SSH private keys, Docker credentials, GitHub tokens, raw snapshots, or editor IP addresses.
- Root `docker-compose-prod.yaml` is user-owned and out of scope.
- Production is read-only to this feature; only Dunwichmass receives content mutations.
- Production remains authoritative. Dunwichmass public-content edits are disposable and must be repaired even when the production digest has not changed.
- Automatic synchronization runs once per hour. `scripts/sync-test-content.sh` performs an immediate run; `--dry-run` performs no target mutation.
- Synchronization fails closed on any allowlisted schema mismatch.
- The exact 17-table allowlist from the approved design is the only content boundary; all other tables are denied by default.
- Production uses Docker Compose v1; Dunwichmass uses Docker Compose v2.
- Production server editing uses `vi` where a server-side file must be changed manually.

---

## File Structure

### Shared content-sync package

- Create `mysql/content_sync/__init__.py`: package marker only.
- Create `mysql/content_sync/contract.py`: centralized table allowlist, manifest model, strict parsing, canonical dump arguments, hashing helpers, and required-environment validation.
- Create `mysql/content_sync/source.py`: production snapshot creation, deterministic compression, retention, and `manifest`/`snapshot` serving.
- Create `mysql/content_sync/target.py`: staging schema preparation, staged validation, transactional replacement, and canonical target verification.
- Create `mysql/content_sync/sync.py`: SSH retrieval, local cache/state, drift detection, locking, dry-run, one-shot, and hourly-loop orchestration.
- Create `mysql/content_sync/health.py`: health status based only on the private state file and the two-hour threshold.

### Container entry points

- Create `mysql/export-public-content`: executable wrapper for `python3 -m content_sync.source`.
- Create `mysql/sync-public-content`: executable wrapper for `python3 -m content_sync.sync`.
- Create `mysql/content-sync-health`: executable wrapper for `python3 -m content_sync.health`.
- Modify `mysql/Dockerfile`: install Python, PyMySQL, OpenSSH client, and copy the package and wrappers.

### SSH, Compose, and operator surfaces

- Create `scripts/serve-production-content.sh`: production forced-command gateway; discovers exactly one production backup container by Docker labels and accepts only `manifest` or `snapshot <sha256>`.
- Create `docker-compose.content-sync.yaml`: test-only profiled `content-sync` service using the existing backup image and private mounts.
- Create `scripts/sync-test-content.sh`: one-command manual or dry-run synchronization through Dunwichmass.
- Create `scripts/run-test-content-sync.sh`: fixed remote-side Compose invocation used by the local operator wrapper.
- Create `scripts/provision-test-content-sync.sh`: guarded one-time staging database provisioning and read-only preflight checks; it does not generate or install SSH keys.
- Modify `scripts/deploy-test.sh`: include the tracked content-sync overlay, pull its image, and respect the server's `COMPOSE_PROFILES` gate.
- Modify `.env_example`: document non-secret content-sync variable names and safe defaults.

### Tests and documentation

- Create `mysql/test/test_content_sync_contract.py`.
- Create `mysql/test/test_content_sync_source.py`.
- Create `mysql/test/test_content_sync_target.py`.
- Create `mysql/test/test_content_sync_orchestrator.py`.
- Create `mysql/test/test_content_sync_health.py`.
- Create `scripts/test/content-sync-source-gateway.test.js`.
- Create `scripts/test/content-sync-operator.test.js`.
- Create `scripts/test/content-sync-compose.test.js`.
- Create `scripts/test/content-sync-integration.test.js`.
- Modify `scripts/test/deploy-test.test.js` and `scripts/test/mysql-backup-cron.test.js`.
- Create `docs/operations/production-to-test-content-sync.md`.
- Modify `DEVELOPMENT.md` and `CHANGELOG.md`.

---

### Task 1: Define the Shared Snapshot Contract

**Files:**
- Create: `mysql/content_sync/__init__.py`
- Create: `mysql/content_sync/contract.py`
- Create: `mysql/test/test_content_sync_contract.py`

**Interfaces:**
- Produces: `PUBLIC_TABLES`, an immutable ordered tuple of table-name strings.
- Produces: `Manifest.parse(text: str) -> Manifest`
- Produces: `Manifest.serialize() -> str`
- Produces: `Manifest.validate() -> None`
- Produces: `SyncValidationError`, the secret-free validation failure type shared by source and target code.
- Produces: `canonical_dump_args(config: MySqlConfig, database: str) -> list[str]`
- Produces: `sha256_file(path: pathlib.Path) -> str`
- Produces: `required_environment(names: Sequence[str], environment: Mapping[str, str]) -> dict[str, str]`

- [ ] **Step 1: Write failing manifest and allowlist tests**

```python
# mysql/test/test_content_sync_contract.py
import json
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).parents[1]))

from content_sync.contract import Manifest, PUBLIC_TABLES


EXPECTED_TABLES = (
    "Areas", "Categories", "ChangelogVersions",
    "ChangelogVersions_AuditTrail", "Eras", "ItemMobMap",
    "ItemStatCategories", "ItemStatInfo", "Items", "Items_AuditTrail",
    "Mobs", "Mobs_AuditTrail", "Quests", "Quests_AuditTrail",
    "SubCategories", "WikiPages", "WikiPages_AuditTrail",
)


class ContractTests(unittest.TestCase):
    def test_allowlist_is_exact_and_ordered(self):
        self.assertEqual(PUBLIC_TABLES, EXPECTED_TABLES)

    def test_manifest_round_trip_is_canonical(self):
        manifest = Manifest(
            version=1,
            content_sha256="a" * 64,
            artifact_sha256="b" * 64,
            artifact_bytes=123,
            schema_sha256="c" * 64,
            created_at="2026-08-17T14:00:00Z",
            row_counts={table: index for index, table in enumerate(PUBLIC_TABLES)},
        )
        serialized = manifest.serialize()
        self.assertEqual(Manifest.parse(serialized), manifest)
        self.assertEqual(serialized, json.dumps(
            json.loads(serialized), sort_keys=True, separators=(",", ":")) + "\n")

    def test_manifest_rejects_missing_extra_or_malformed_tables(self):
        base = {
            "version": 1,
            "content_sha256": "a" * 64,
            "artifact_sha256": "b" * 64,
            "artifact_bytes": 123,
            "schema_sha256": "c" * 64,
            "created_at": "2026-08-17T14:00:00Z",
            "row_counts": {table: 0 for table in PUBLIC_TABLES},
        }
        for mutation in ("missing", "extra", "bad_digest", "negative_count",
                         "bad_timestamp", "zero_bytes", "extra_field"):
            candidate = json.loads(json.dumps(base))
            if mutation == "missing":
                candidate["row_counts"].pop("Areas")
            elif mutation == "extra":
                candidate["row_counts"]["Members"] = 1
            elif mutation == "bad_digest":
                candidate["content_sha256"] = "not-a-digest"
            elif mutation == "negative_count":
                candidate["row_counts"]["Areas"] = -1
            elif mutation == "bad_timestamp":
                candidate["created_at"] = "today"
            elif mutation == "zero_bytes":
                candidate["artifact_bytes"] = 0
            else:
                candidate["secret_table"] = "Members"
            with self.subTest(mutation=mutation):
                with self.assertRaises(ValueError):
                    Manifest.parse(json.dumps(candidate))
```

- [ ] **Step 2: Run the contract tests and confirm the import failure**

Run: `python3 -m unittest mysql.test.test_content_sync_contract -v`

Expected: FAIL with `ModuleNotFoundError: No module named 'content_sync'`.

- [ ] **Step 3: Implement the contract and strict manifest parser**

```python
# mysql/content_sync/contract.py
from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import re

PUBLIC_TABLES = (
    "Areas", "Categories", "ChangelogVersions",
    "ChangelogVersions_AuditTrail", "Eras", "ItemMobMap",
    "ItemStatCategories", "ItemStatInfo", "Items", "Items_AuditTrail",
    "Mobs", "Mobs_AuditTrail", "Quests", "Quests_AuditTrail",
    "SubCategories", "WikiPages", "WikiPages_AuditTrail",
)
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
UTC_TIMESTAMP_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")


class SyncValidationError(RuntimeError):
    pass


@dataclass(frozen=True)
class Manifest:
    version: int
    content_sha256: str
    artifact_sha256: str
    artifact_bytes: int
    schema_sha256: str
    created_at: str
    row_counts: dict[str, int]

    def validate(self):
        if type(self.version) is not int or self.version != 1:
            raise ValueError("unsupported manifest version")
        for value in (self.content_sha256, self.artifact_sha256,
                      self.schema_sha256):
            if not SHA256_RE.fullmatch(value):
                raise ValueError("invalid manifest digest")
        if type(self.artifact_bytes) is not int or self.artifact_bytes <= 0:
            raise ValueError("invalid artifact size")
        if type(self.created_at) is not str \
                or not UTC_TIMESTAMP_RE.fullmatch(self.created_at):
            raise ValueError("invalid creation timestamp")
        if type(self.row_counts) is not dict:
            raise ValueError("invalid row counts")
        if tuple(self.row_counts) != PUBLIC_TABLES:
            raise ValueError("manifest table set or order is invalid")
        if any(type(value) is not int or value < 0
               for value in self.row_counts.values()):
            raise ValueError("invalid manifest row count")

    def serialize(self):
        self.validate()
        return json.dumps(self.__dict__, sort_keys=True,
                          separators=(",", ":")) + "\n"

    @classmethod
    def parse(cls, text):
        data = json.loads(text)
        expected = {"version", "content_sha256", "artifact_sha256",
                    "artifact_bytes", "schema_sha256", "created_at",
                    "row_counts"}
        if type(data) is not dict or set(data) != expected:
            raise ValueError("invalid manifest fields")
        if type(data["row_counts"]) is not dict:
            raise ValueError("invalid row counts")
        if set(data["row_counts"]) == set(PUBLIC_TABLES):
            data["row_counts"] = {
                table: data["row_counts"][table] for table in PUBLIC_TABLES
            }
        manifest = cls(**data)
        manifest.validate()
        return manifest
```

Implement the remaining Task 1 interfaces with these definitions:

```python
@dataclass(frozen=True)
class MySqlConfig:
    host: str
    port: int
    user: str
    password: str


CANONICAL_DUMP_FLAGS = (
    "--single-transaction", "--quick", "--skip-lock-tables",
    "--no-tablespaces", "--no-create-info", "--skip-triggers",
    "--skip-comments", "--skip-add-locks", "--skip-disable-keys",
    "--order-by-primary", "--complete-insert", "--hex-blob",
)


def canonical_dump_args(config, database):
    return [
        "mysqldump", f"--host={config.host}", f"--port={config.port}",
        f"--user={config.user}", *CANONICAL_DUMP_FLAGS,
        database, *PUBLIC_TABLES,
    ]


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def required_environment(names, environment):
    missing = [name for name in names if not environment.get(name)]
    if missing:
        raise ValueError("missing required environment: " + ", ".join(missing))
    return {name: environment[name] for name in names}
```

Passwords go only into a child-process environment as `MYSQL_PWD`, never into
the returned argument list.

- [ ] **Step 4: Run the contract tests**

Run: `python3 -m unittest mysql.test.test_content_sync_contract -v`

Expected: all contract tests PASS.

- [ ] **Step 5: Commit the contract**

```bash
git add mysql/content_sync mysql/test/test_content_sync_contract.py
git commit -m "feat: define content sync snapshot contract"
```

---

### Task 2: Build the Deterministic Production Exporter

**Files:**
- Create: `mysql/content_sync/source.py`
- Create: `mysql/export-public-content`
- Create: `mysql/test/test_content_sync_source.py`

**Interfaces:**
- Consumes: `Manifest`, `MySqlConfig`, `PUBLIC_TABLES`, `canonical_dump_args`, and `sha256_file` from Task 1.
- Produces: `SourceConfig.from_environment(environment) -> SourceConfig`
- Produces: `create_snapshot(config: SourceConfig, created_at: str) -> Manifest`
- Produces CLI: `export-public-content manifest`
- Produces CLI: `export-public-content snapshot <64-character-content-sha256>`

- [ ] **Step 1: Write failing exporter tests**

```python
# mysql/test/test_content_sync_source.py
import gzip
import pathlib
import tempfile
import unittest
from unittest import mock

import sys

sys.path.insert(0, str(pathlib.Path(__file__).parents[1]))

from content_sync.contract import Manifest, PUBLIC_TABLES
from content_sync.source import SourceConfig, create_snapshot, serve


class SourceTests(unittest.TestCase):
    def test_same_content_produces_same_content_and_artifact_digests(self):
        with tempfile.TemporaryDirectory() as directory:
            config = SourceConfig.for_test(pathlib.Path(directory))
            dump = b"INSERT INTO `Areas` VALUES (1,'one');\n"
            def write_dump(_mysql, _database, path):
                path.write_bytes(dump)

            with mock.patch("content_sync.source.dump_to_path",
                            side_effect=write_dump), mock.patch(
                    "content_sync.source.schema_digest",
                    return_value="c" * 64), mock.patch(
                    "content_sync.source.row_counts",
                    return_value={table: 0 for table in PUBLIC_TABLES}):
                first = create_snapshot(config, "2026-08-17T14:00:00Z")
                second = create_snapshot(config, "2026-08-17T15:00:00Z")
            self.assertEqual(first.content_sha256, second.content_sha256)
            self.assertEqual(first.artifact_sha256, second.artifact_sha256)
            artifact = config.snapshot_path(first.content_sha256)
            with gzip.open(artifact, "rb") as source:
                self.assertEqual(source.read(), dump)

    def test_failed_export_preserves_promoted_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            config = SourceConfig.for_test(pathlib.Path(directory))
            old_digest = "d" * 64
            old_artifact = config.snapshot_path(old_digest)
            old_artifact.parent.mkdir(parents=True)
            old_artifact.write_bytes(b"old-artifact")
            old_manifest = Manifest(
                version=1,
                content_sha256=old_digest,
                artifact_sha256="e" * 64,
                artifact_bytes=len(b"old-artifact"),
                schema_sha256="f" * 64,
                created_at="2026-08-17T13:00:00Z",
                row_counts={table: 0 for table in PUBLIC_TABLES},
            ).serialize().encode()
            manifest_path = config.snapshot_dir / "current.manifest"
            manifest_path.write_bytes(old_manifest)
            with mock.patch("content_sync.source.dump_to_path",
                            side_effect=RuntimeError("dump failed")):
                with self.assertRaisesRegex(RuntimeError, "dump failed"):
                    create_snapshot(config, "2026-08-17T14:00:00Z")
            self.assertEqual(manifest_path.read_bytes(), old_manifest)
            self.assertEqual(old_artifact.read_bytes(), b"old-artifact")

    def test_snapshot_command_rejects_non_digest_arguments(self):
        for args in (["snapshot"], ["snapshot", "../secret"],
                     ["snapshot", "a" * 63], ["shell"]):
            with self.subTest(args=args):
                self.assertEqual(serve(args), 64)
```

The same file must define `test_promoted_files_are_private`,
`test_row_counts_follow_public_table_order`, `test_recent_artifact_is_retained`,
`test_old_unreferenced_artifact_is_pruned`, `test_lock_contention_fails`, and
`test_failure_message_omits_password`. Define
`test_non_transactional_allowlisted_table_fails_before_dump` with an engine
map containing `Items: "MyISAM"`; require `SyncValidationError`, zero dump
calls, and an error naming only `Items`. Each filesystem test uses
`SourceConfig.for_test`, fixed file modification times, and
`mock.patch.dict(os.environ,
{"MYSQL_PASSWORD": "never-log-this"})`; assert promoted files have mode
`stat.S_IMODE(path.stat().st_mode) == 0o600`, the count keys equal
`PUBLIC_TABLES`, the 7199-second-old artifact exists, the 7201-second-old
artifact does not, contention raises `BlockingIOError`, and captured stderr
does not contain `never-log-this`.

- [ ] **Step 2: Run the exporter tests and confirm the missing-module failure**

Run: `python3 -m unittest mysql.test.test_content_sync_source -v`

Expected: FAIL because `content_sync.source` does not exist.

- [ ] **Step 3: Implement atomic deterministic snapshot creation**

```python
# mysql/content_sync/source.py
@dataclass(frozen=True)
class SourceConfig:
    mysql: MySqlConfig
    database: str
    snapshot_dir: Path
    retention_seconds: int = 7200

    def snapshot_path(self, digest):
        if not SHA256_RE.fullmatch(digest):
            raise ValueError("invalid snapshot digest")
        return self.snapshot_dir / f"{digest}.sql.gz"


def create_snapshot(config, created_at):
    config.snapshot_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    with exclusive_lock(config.snapshot_dir / "export.lock", blocking=False):
        raw_path = private_temporary(config.snapshot_dir, ".sql")
        gzip_path = private_temporary(config.snapshot_dir, ".sql.gz")
        try:
            dump_to_path(config.mysql, config.database, raw_path)
            content_digest = sha256_file(raw_path)
            run_checked(["gzip", "-n", "-c", str(raw_path)], stdout=gzip_path)
            artifact_digest = sha256_file(gzip_path)
            manifest = Manifest(
                version=1,
                content_sha256=content_digest,
                artifact_sha256=artifact_digest,
                artifact_bytes=gzip_path.stat().st_size,
                schema_sha256=schema_digest(config.mysql, config.database),
                created_at=created_at,
                row_counts=row_counts(config.mysql, config.database),
            )
            promote_digest_named(gzip_path,
                                 config.snapshot_path(content_digest))
            atomic_write(config.snapshot_dir / "current.manifest",
                         manifest.serialize().encode(), mode=0o600)
            prune_expired_snapshots(config, keep={content_digest})
            return manifest
        finally:
            raw_path.unlink(missing_ok=True)
            gzip_path.unlink(missing_ok=True)
```

`dump_to_path`, `schema_digest`, and `row_counts` must use exact allowlisted
tables and `MYSQL_PWD`. Exact row counts come from `SELECT COUNT(*)`, not
`INFORMATION_SCHEMA.TABLES.TABLE_ROWS`. `serve(["manifest"])` refreshes the
snapshot, writes only canonical manifest JSON to stdout, and logs status to
stderr. `serve(["snapshot", digest])` does not regenerate; it streams only the
matching digest-named artifact to stdout after verifying its digest and size.
`schema_digest` queries `INFORMATION_SCHEMA.COLUMNS` ordered by
`TABLE_NAME, ORDINAL_POSITION` and hashes canonical JSON rows containing
exactly `TABLE_NAME`, `ORDINAL_POSITION`, `COLUMN_NAME`, `COLUMN_TYPE`,
`IS_NULLABLE`, and `COLUMN_DEFAULT`.
Before dumping, query `INFORMATION_SCHEMA.TABLES` for exactly `PUBLIC_TABLES`
and require every `ENGINE` to equal `InnoDB`; a missing, extra, duplicate, or
non-InnoDB row raises `SyncValidationError` before `mysqldump` starts.
`SourceConfig.from_environment` requires `MYSQL_PORT`, `MYSQL_USER`,
`MYSQL_PASSWORD`, and `MYSQL_DATABASE`; it defaults `MYSQL_HOST` to `mysql`
and `CONTENT_SYNC_SNAPSHOT_DIR` to `/backups/content-sync`, which is already
inside the existing private backup volume.

- [ ] **Step 4: Add the executable source wrapper**

```bash
#!/usr/bin/env bash
set -euo pipefail
export PYTHONPATH=/usr/local/lib
exec python3 -m content_sync.source "$@"
```

- [ ] **Step 5: Run source tests and shell syntax validation**

Run:

```bash
python3 -m unittest mysql.test.test_content_sync_source -v
bash -n mysql/export-public-content
```

Expected: all tests PASS and `bash -n` exits 0.

- [ ] **Step 6: Commit the source exporter**

```bash
git add mysql/content_sync/source.py mysql/export-public-content \
  mysql/test/test_content_sync_source.py
git commit -m "feat: export deterministic public content snapshots"
```

---

### Task 3: Restrict Production Snapshot Access Through SSH

**Files:**
- Create: `scripts/serve-production-content.sh`
- Create: `scripts/test/content-sync-source-gateway.test.js`

**Interfaces:**
- Consumes: `/usr/local/bin/export-public-content manifest` and `snapshot <digest>` from Task 2.
- Consumes: `SSH_ORIGINAL_COMMAND` supplied by OpenSSH.
- Produces: a forced command that discovers exactly one container labeled `com.docker.compose.project=legendhub260` and `com.docker.compose.service=mysql-backup`.

- [ ] **Step 1: Write failing forced-command tests with a fake Docker executable**

```javascript
// scripts/test/content-sync-source-gateway.test.js
test("serves only the exact manifest command", () => {
    const result = runGateway("manifest", ["backup-container-id"]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readDockerLog(), [
        "ps --quiet --filter label=com.docker.compose.project=legendhub260 " +
            "--filter label=com.docker.compose.service=mysql-backup",
        "exec backup-container-id /usr/local/bin/export-public-content manifest",
        "",
    ].join("\n"));
});

test("passes a validated digest as one Docker argument", () => {
    const digest = "a".repeat(64);
    const result = runGateway(`snapshot ${digest}`, ["backup-container-id"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(readDockerLog(), new RegExp(`snapshot ${digest}$`, "m"));
});

for (const command of ["", "bash", "manifest extra", "snapshot ../x",
                       "snapshot " + "a".repeat(63), "snapshot " + "A".repeat(64)]) {
    test(`rejects ${JSON.stringify(command)}`, () => {
        const result = runGateway(command, ["backup-container-id"]);
        assert.equal(result.status, 64);
        assert.equal(readDockerLog(), "");
    });
}
```

Define the container-cardinality cases in the same test file:

```javascript
for (const ids of [[], ["one", "two"]]) {
    test(`rejects ${ids.length} matching backup containers`, () => {
        const result = runGateway("manifest", ids);
        assert.equal(result.status, 1);
        assert.doesNotMatch(readDockerLog(), /exec/);
        assert.doesNotMatch(result.stderr, /MYSQL_|INSERT INTO|snapshot bytes/);
    });
}
```

- [ ] **Step 2: Run the gateway tests and confirm failure**

Run: `node --test scripts/test/content-sync-source-gateway.test.js`

Expected: FAIL because `scripts/serve-production-content.sh` is absent.

- [ ] **Step 3: Implement the forced-command gateway**

```bash
#!/usr/bin/env bash
set -euo pipefail

case "${SSH_ORIGINAL_COMMAND:-}" in
  manifest)
    export_args=(manifest)
    ;;
  snapshot\ [0-9a-f][0-9a-f]*)
    digest="${SSH_ORIGINAL_COMMAND#snapshot }"
    [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || exit 64
    export_args=(snapshot "$digest")
    ;;
  *)
    printf 'content-export: command rejected\n' >&2
    exit 64
    ;;
esac

mapfile -t containers < <(docker ps --quiet \
  --filter label=com.docker.compose.project=legendhub260 \
  --filter label=com.docker.compose.service=mysql-backup)
[[ "${#containers[@]}" -eq 1 ]] || {
  printf 'content-export: expected one backup container\n' >&2
  exit 1
}

exec docker exec "${containers[0]}" \
  /usr/local/bin/export-public-content "${export_args[@]}"
```

The production `authorized_keys` line documented later must use OpenSSH's
`restrict` option plus this script as its forced command. Do not add a key to
the repository or server during this task.

- [ ] **Step 4: Run gateway and shell tests**

Run:

```bash
node --test scripts/test/content-sync-source-gateway.test.js
bash -n scripts/serve-production-content.sh
```

Expected: all tests PASS.

- [ ] **Step 5: Commit the gateway**

```bash
git add scripts/serve-production-content.sh \
  scripts/test/content-sync-source-gateway.test.js
git commit -m "feat: restrict production content snapshot access"
```

---

### Task 4: Stage, Validate, and Transactionally Apply Content

**Files:**
- Create: `mysql/content_sync/target.py`
- Create: `mysql/test/test_content_sync_target.py`
- Create: `scripts/test/content-sync-integration.test.js`

**Interfaces:**
- Consumes: `Manifest`, `MySqlConfig`, `PUBLIC_TABLES`, and canonical dump helpers from Task 1.
- Produces: `TargetConfig.from_environment(environment) -> TargetConfig`
- Produces: `prepare_staging(config: TargetConfig, sql_path: Path, manifest: Manifest) -> None`
- Produces: `staging_digest(config: TargetConfig) -> str`
- Produces: `apply_staging(config: TargetConfig, manifest: Manifest) -> None`
- Produces: `target_digest(config: TargetConfig) -> str`

- [ ] **Step 1: Write failing target transaction unit tests**

```python
# mysql/test/test_content_sync_target.py
class TargetTests(unittest.TestCase):
    def test_apply_replaces_only_allowlisted_tables_and_suppresses_triggers(self):
        database = RecordingDatabase(
            columns={table: ("Id", "Name") for table in PUBLIC_TABLES},
            counts={table: 2 for table in PUBLIC_TABLES},
        )
        manifest = manifest_with_counts(2)
        apply_staging(test_config(), manifest, database=database)
        self.assertEqual(database.events[0], "BEGIN")
        self.assertIn(("EXECUTE", "SET @DISABLE_NOTIFICATIONS=1"),
                      database.events)
        self.assertEqual(database.events[-1], "COMMIT")
        rendered = "\n".join(sql for event, sql in database.events
                             if event == "EXECUTE")
        for table in PUBLIC_TABLES:
            self.assertIn(f"DELETE FROM `legendhub`.`{table}`", rendered)
            self.assertIn(
                f"INSERT INTO `legendhub`.`{table}` (`Id`,`Name`) "
                f"SELECT `Id`,`Name` FROM `legendhub_content_sync`.`{table}`",
                rendered,
            )
        for private_table in ("Members", "AuthTokens", "Notifications",
                              "Migrations"):
            self.assertNotIn(private_table, rendered)

    def test_count_mismatch_rolls_back(self):
        database = RecordingDatabase(counts={**manifest_counts(), "Items": 1})
        with self.assertRaises(SyncValidationError):
            apply_staging(test_config(), manifest_with_counts(2),
                          database=database)
        self.assertEqual(database.events[-1], "ROLLBACK")
```

Define these additional unit cases in the same file:

```python
def test_schema_mismatch_fails_before_target_transaction(self):
    database = RecordingDatabase(schema_sha256="f" * 64)
    with self.assertRaisesRegex(SyncValidationError, "schema digest mismatch"):
        prepare_staging(test_config(), dump_path(), manifest(schema="e" * 64),
                        database=database)
    self.assertNotIn("BEGIN", database.events)

def test_identifier_quoting_rejects_non_allowlisted_names(self):
    self.assertEqual(quote_identifier("ModifiedOn"), "`ModifiedOn`")
    with self.assertRaises(ValueError):
        quote_identifier("Items`; DROP TABLE Members; --")

def test_staging_import_or_digest_failure_never_opens_target_transaction(self):
    for failure in (ImportError("mysql exited 1"),
                    SyncValidationError("content digest mismatch")):
        database = RecordingDatabase(import_failure=failure)
        with self.subTest(failure=str(failure)), self.assertRaises(type(failure)):
            prepare_staging(test_config(), dump_path(), manifest(),
                            database=database)
        self.assertNotIn("BEGIN", database.events)

def test_notification_suppression_and_copy_share_one_connection(self):
    database = RecordingDatabase(counts=manifest_counts())
    apply_staging(test_config(), manifest(), database=database)
    self.assertEqual(database.connection_ids_for(
        "SET @DISABLE_NOTIFICATIONS=1", "INSERT INTO"), {database.connection_id})
```

- [ ] **Step 2: Run target tests and confirm failure**

Run: `python3 -m unittest mysql.test.test_content_sync_target -v`

Expected: FAIL because `content_sync.target` is missing.

- [ ] **Step 3: Implement staging and transactional replacement**

```python
# mysql/content_sync/target.py
def apply_staging(config, manifest, database=None):
    database = database or PyMySqlDatabase.connect(config.mysql)
    try:
        database.begin()
        database.execute("SET @DISABLE_NOTIFICATIONS=1")
        for table in PUBLIC_TABLES:
            columns = database.columns(config.target_database, table)
            quoted = ",".join(quote_identifier(column) for column in columns)
            target = qualified(config.target_database, table)
            staging = qualified(config.staging_database, table)
            database.execute(f"DELETE FROM {target}")
            database.execute(
                f"INSERT INTO {target} ({quoted}) "
                f"SELECT {quoted} FROM {staging}")
            actual = database.scalar(f"SELECT COUNT(*) FROM {target}")
            if actual != manifest.row_counts[table]:
                raise SyncValidationError(
                    f"row count mismatch for {table}: "
                    f"expected {manifest.row_counts[table]}, got {actual}")
        database.commit()
    except Exception:
        database.rollback()
        raise
    finally:
        database.close()
```

`prepare_staging` must drop and recreate only allowlisted tables in the
dedicated staging database using `CREATE TABLE staging.table LIKE
target.table`, load the verified SQL artifact through the MySQL client, verify
exact row counts, and compare the canonical staged-data digest with
`manifest.content_sha256`. It must never issue DDL against the target database.
For schema comparison, query `INFORMATION_SCHEMA.COLUMNS` ordered by
`TABLE_NAME, ORDINAL_POSITION` and hash canonical JSON rows containing exactly
`TABLE_NAME`, `ORDINAL_POSITION`, `COLUMN_NAME`, `COLUMN_TYPE`, `IS_NULLABLE`,
and `COLUMN_DEFAULT`. Require production-manifest, target, and staging schema
digests to match before opening the target transaction.

- [ ] **Step 4: Add a disposable two-database integration harness**

`scripts/test/content-sync-integration.test.js` must start one temporary
`mysql:5.7.44` container with source, target, and staging databases. Build its
own schema in JavaScript so it never depends on the ignored generated
`mysql/init/dev-seed.sql`:

```javascript
const publicTables = [
    "Areas", "Categories", "ChangelogVersions",
    "ChangelogVersions_AuditTrail", "Eras", "ItemMobMap",
    "ItemStatCategories", "ItemStatInfo", "Items", "Items_AuditTrail",
    "Mobs", "Mobs_AuditTrail", "Quests", "Quests_AuditTrail",
    "SubCategories", "WikiPages", "WikiPages_AuditTrail",
];
for (const database of ["source", "target"]) {
    for (const table of publicTables)
        await sql(`CREATE TABLE \`${database}\`.\`${table}\` (` +
            "Id INT NOT NULL PRIMARY KEY, Payload VARCHAR(255) NULL) ENGINE=InnoDB");
}
const privateTables = [
    "AuthTokens", "BannedIPs", "Members", "MemberRoleMap",
    "MigrationRuns", "Migrations", "NotificationChanges",
    "NotificationQueue", "NotificationSettings", "Notifications",
    "Permissions", "PersistentLogins", "RolePermissionMap", "Roles",
];
for (const table of privateTables)
    await sql(`CREATE TABLE target.\`${table}\` (` +
        "Id INT NOT NULL PRIMARY KEY, Payload VARCHAR(255) NOT NULL) ENGINE=InnoDB");
await sql("CREATE TRIGGER target.Items_AfterInsert AFTER INSERT ON target.Items " +
    "FOR EACH ROW INSERT INTO target.NotificationQueue (Id, Payload) " +
    "SELECT NEW.Id, NEW.Payload FROM DUAL WHERE @DISABLE_NOTIFICATIONS IS NULL");
await sql("INSERT INTO source.Items VALUES " +
    "(2263, 'Ruslan''s lion shield (ARM)')");
await sql("INSERT INTO source.Items_AuditTrail VALUES " +
    "(2263, 'Ruslan''s lion shield changed from -14 to -8 AC')");
await sql("INSERT INTO source.ItemMobMap VALUES (1, 'relationship sentinel')");
for (const [index, table] of privateTables.entries())
    await sql(`INSERT INTO target.\`${table}\` VALUES (` +
        `${9001 + index}, '${table} sentinel')`);
```

Run the target module against that fixture and assert:

```javascript
assert.deepEqual(await rows("target.Items"), await rows("source.Items"));
assert.deepEqual(await rows("target.Items_AuditTrail"),
                 await rows("source.Items_AuditTrail"));
assert.deepEqual(await rows("target.ItemMobMap"),
                 await rows("source.ItemMobMap"));
for (const table of privateTables)
    assert.deepEqual(await rows(`target.${table}`), privateRows.get(table));
assert.equal(await scalar(
    "SELECT COUNT(*) FROM target.NotificationQueue " +
    "WHERE Payload='Ruslan\\'s lion shield (ARM)'"), 0);
```

The integration file must define named tests for update, deletion, audit
history, relationships, idempotent reapply, direct-target drift repair with an
unchanged source digest, schema mismatch, corrupt staging data, and forced SQL
failure. Before every run capture all `privateTables` rows in `privateRows` and
compare every table with `assert.deepEqual` afterward. For rollback, inject a
target trigger containing `SIGNAL SQLSTATE '45000'` on the second allowlisted
table and assert the first target table still has its pre-run rows. Add a
MyISAM target-table case and require it to fail before `BEGIN` so the multi-table
replacement cannot claim atomicity on a nontransactional engine.

- [ ] **Step 5: Run unit and integration tests**

Run:

```bash
python3 -m unittest mysql.test.test_content_sync_target -v
node --test scripts/test/content-sync-integration.test.js
```

Expected: both suites PASS and the temporary MySQL container is removed by the
test cleanup hook even on failure.

- [ ] **Step 6: Commit target application logic**

```bash
git add mysql/content_sync/target.py mysql/test/test_content_sync_target.py \
  scripts/test/content-sync-integration.test.js
git commit -m "feat: apply verified content snapshots atomically"
```

---

### Task 5: Orchestrate Pulls, Cache, Drift Repair, and Scheduling

**Files:**
- Create: `mysql/content_sync/sync.py`
- Create: `mysql/sync-public-content`
- Create: `mysql/test/test_content_sync_orchestrator.py`

**Interfaces:**
- Consumes: `Manifest` from Task 1 and target operations from Task 4.
- Produces: `SyncConfig.from_environment(environment) -> SyncConfig`
- Produces: `run_once(config: SyncConfig, dry_run: bool = False) -> SyncResult`
- Produces: `run_loop(config: SyncConfig) -> NoReturn`
- Produces: `SyncResult(action: str, content_sha256: str | None)` where
  `action` is one of `noop`, `dry-run`, `applied-source-change`,
  `repaired-target-drift`, or `skipped-overlap`.
- Produces CLI: `sync-public-content --once [--dry-run]`
- Produces CLI: `sync-public-content --loop`
- Writes private atomic state: `/var/lib/legendhub-content-sync/state.json`
- Caches one verified digest-named artifact in the same state volume.

- [ ] **Step 1: Write failing orchestration tests**

```python
# mysql/test/test_content_sync_orchestrator.py
class OrchestratorTests(unittest.TestCase):
    def test_noop_requires_source_applied_and_target_digests_to_match(self):
        dependencies = FakeDependencies(
            source_digest="a" * 64,
            applied_digest="a" * 64,
            target_digest="a" * 64,
        )
        result = run_once(test_config(), dependencies=dependencies)
        self.assertEqual(result.action, "noop")
        self.assertEqual(dependencies.downloads, 0)
        self.assertEqual(dependencies.applies, 0)

    def test_target_drift_reapplies_cached_snapshot(self):
        dependencies = FakeDependencies(
            source_digest="a" * 64,
            applied_digest="a" * 64,
            target_digest="b" * 64,
            cached_digest="a" * 64,
        )
        result = run_once(test_config(), dependencies=dependencies)
        self.assertEqual(result.action, "repaired-target-drift")
        self.assertEqual(dependencies.downloads, 0)
        self.assertEqual(dependencies.applies, 1)

    def test_dry_run_never_applies_or_advances_state(self):
        dependencies = FakeDependencies(source_digest="b" * 64,
                                        applied_digest="a" * 64,
                                        target_digest="a" * 64)
        result = run_once(test_config(), dry_run=True,
                          dependencies=dependencies)
        self.assertEqual(result.action, "dry-run")
        self.assertEqual(dependencies.applies, 0)
        self.assertEqual(dependencies.state_writes, 0)
```

Define the remaining orchestration cases with the existing fake dependency:

```python
def test_source_change_downloads_and_applies(self):
    deps = FakeDependencies(source_digest="b" * 64,
                            applied_digest="a" * 64,
                            target_digest="a" * 64)
    result = run_once(test_config(), dependencies=deps)
    self.assertEqual((result.action, deps.downloads, deps.applies),
                     ("applied-source-change", 1, 1))

def test_untrusted_source_inputs_never_apply(self):
    for failure in ("invalid-manifest", "truncated-artifact",
                    "artifact-sha-mismatch", "content-sha-mismatch"):
        deps = FakeDependencies(failure=failure)
        with self.subTest(failure=failure), self.assertRaises(SyncValidationError):
            run_once(test_config(), dependencies=deps)
        self.assertEqual((deps.applies, deps.state_writes), (0, 0))

def test_missing_cache_redownloads_current_digest(self):
    deps = FakeDependencies(source_digest="a" * 64,
                            applied_digest="a" * 64,
                            target_digest="b" * 64,
                            cached_digest=None)
    run_once(test_config(), dependencies=deps)
    self.assertEqual((deps.downloads, deps.applies), (1, 1))

def test_post_commit_mismatch_does_not_advance_state(self):
    deps = FakeDependencies(source_digest="b" * 64,
                            target_after_apply="c" * 64)
    with self.assertRaisesRegex(SyncValidationError, "post-commit"):
        run_once(test_config(), dependencies=deps)
    self.assertEqual(deps.state_writes, 0)

def test_lock_contention_skips_successfully_without_work(self):
    deps = FakeDependencies(lock_available=False)
    result = run_once(test_config(), dependencies=deps)
    self.assertEqual(result.action, "skipped-overlap")
    self.assertEqual((deps.downloads, deps.applies), (0, 0))

def test_loop_uses_hourly_monotonic_deadlines(self):
    clock = FakeClock(monotonic_values=[0, 15, 3600, 3610])
    run_loop(test_config(interval_seconds=3600),
             dependencies=loop_deps(clock, iterations=2))
    self.assertEqual(clock.sleep_calls, [3585, 3590])

def test_logged_failure_omits_credentials_and_sql(self):
    deps = FakeDependencies(failure=RuntimeError(
        "MYSQL_PASSWORD=secret INSERT INTO Areas VALUES (1)"))
    run_one_loop_iteration(test_config(), dependencies=deps)
    self.assertNotIn("secret", deps.stderr)
    self.assertNotIn("INSERT INTO", deps.stderr)
```

- [ ] **Step 2: Run orchestrator tests and confirm failure**

Run: `python3 -m unittest mysql.test.test_content_sync_orchestrator -v`

Expected: FAIL because `content_sync.sync` does not exist.

- [ ] **Step 3: Implement strict SSH retrieval and run-once control flow**

```python
# mysql/content_sync/sync.py
def ssh_command(config, *remote_arguments):
    return [
        "ssh", "-T", "-i", str(config.ssh_key),
        "-o", "BatchMode=yes",
        "-o", "IdentitiesOnly=yes",
        "-o", f"UserKnownHostsFile={config.known_hosts}",
        "-o", "StrictHostKeyChecking=yes",
        config.source,
        " ".join(remote_arguments),
    ]


def run_once(config, dry_run=False, dependencies=None):
    deps = dependencies or Dependencies.real(config)
    lock = deps.try_exclusive_lock()
    if lock is None:
        return SyncResult("skipped-overlap", None)
    with lock:
        manifest = Manifest.parse(deps.fetch_manifest())
        target_content = deps.target_digest()
        state = deps.read_state()
        applied_digest = state.content_sha256 if state is not None else None
        if (applied_digest == manifest.content_sha256
                and target_content == manifest.content_sha256):
            deps.record_verified(manifest.content_sha256)
            return SyncResult("noop", manifest.content_sha256)
        artifact = deps.verified_cache(manifest)
        if artifact is None:
            artifact = deps.download_and_verify(manifest)
        deps.prepare_and_validate_staging(artifact, manifest)
        if dry_run:
            return SyncResult("dry-run", manifest.content_sha256)
        deps.apply_staging(manifest)
        if deps.target_digest() != manifest.content_sha256:
            raise SyncValidationError("post-commit target digest mismatch")
        deps.record_verified(manifest.content_sha256)
        action = ("repaired-target-drift"
                  if applied_digest == manifest.content_sha256
                  else "applied-source-change")
        return SyncResult(action, manifest.content_sha256)
```

The SSH child receives no agent socket and no database environment. The source
argument comes from a required environment value and is passed as one
subprocess argument. Validate file ownership/mode expectations and refuse a key
or known-hosts path that is missing, not a regular file, or group/world
writable.
On success, emit one line containing UTC timestamp, action, content digest,
artifact bytes, 17-table total, and duration. On failure, emit UTC timestamp,
the fixed stage name, exception class, and sanitized message; never emit raw
SQL, database content, environment values, key bytes, or editor IP fields.

- [ ] **Step 4: Implement hourly loop and atomic private state**

`run_loop` must run immediately, then calculate the next monotonic deadline at
3600-second intervals. A failed run logs one sanitized line and waits for the
next deadline; it does not tight-loop. `state.json` contains only:

```json
{"content_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","verified_at_epoch":1786975200}
```

Write it through a mode-`0600` temporary file and atomic rename. Never record a
new digest before post-commit target verification. A `finally` block removes
download and decompression temporary files on every path; after success retain
only the verified cache matching the current manifest and the atomic state
file.

- [ ] **Step 5: Add executable wrapper and run tests**

```bash
#!/usr/bin/env bash
set -euo pipefail
export PYTHONPATH=/usr/local/lib
exec python3 -m content_sync.sync "$@"
```

Run:

```bash
python3 -m unittest mysql.test.test_content_sync_orchestrator -v
bash -n mysql/sync-public-content
```

Expected: all tests PASS.

- [ ] **Step 6: Commit orchestration**

```bash
git add mysql/content_sync/sync.py mysql/sync-public-content \
  mysql/test/test_content_sync_orchestrator.py
git commit -m "feat: orchestrate hourly and manual content sync"
```

---

### Task 6: Package and Healthcheck the Test-Only Sync Service

**Files:**
- Create: `mysql/content_sync/health.py`
- Create: `mysql/content-sync-health`
- Create: `mysql/test/test_content_sync_health.py`
- Create: `docker-compose.content-sync.yaml`
- Create: `scripts/test/content-sync-compose.test.js`
- Modify: `mysql/Dockerfile:3-15`
- Modify: `scripts/test/mysql-backup-cron.test.js:30-50`
- Modify: `.env_example:1-13`

**Interfaces:**
- Consumes: package and wrappers from Tasks 1-5.
- Produces CLI: `content-sync-health`
- Produces Compose profile: `content-sync`
- Produces named volume: `content-sync-state`
- Requires non-secret variables: `CONTENT_SYNC_SOURCE`, `CONTENT_SYNC_STAGING_DATABASE`, `CONTENT_SYNC_INTERVAL_SECONDS`, `CONTENT_SYNC_MAX_AGE_SECONDS`, `CONTENT_SYNC_SSH_KEY_FILE`, `CONTENT_SYNC_KNOWN_HOSTS_FILE`.

- [ ] **Step 1: Write failing health tests**

```python
# mysql/test/test_content_sync_health.py
class HealthTests(unittest.TestCase):
    def test_starting_without_state(self):
        self.assertEqual(health_status(missing_state(), now=7200),
                         (1, "starting"))

    def test_healthy_at_exact_two_hour_boundary(self):
        self.assertEqual(health_status(state(verified_at_epoch=100), now=7300),
                         (0, "healthy"))

    def test_unhealthy_after_two_hours(self):
        self.assertEqual(health_status(state(verified_at_epoch=100), now=7301),
                         (1, "unhealthy"))
```

- [ ] **Step 2: Write failing Compose/image assertions**

```javascript
// scripts/test/content-sync-compose.test.js
test("content sync is opt-in, hourly, private, and reuses the backup image", () => {
    const config = composeConfig({COMPOSE_PROFILES: "content-sync"});
    const service = config.services["content-sync"];
    assert.equal(service.image,
        "tmckimmey/legendhub-mysql-backup:abcdef123456");
    assert.deepEqual(service.profiles, ["content-sync"]);
    assert.deepEqual(service.command,
        ["/usr/local/bin/sync-public-content", "--loop"]);
    assert.equal(service.environment.CONTENT_SYNC_INTERVAL_SECONDS, "3600");
    assert.equal(service.environment.CONTENT_SYNC_MAX_AGE_SECONDS, "7200");
    assert.equal(service.healthcheck.start_period, "2h");
    assert.equal(service.volumes.find(v =>
        v.target === "/run/secrets/content_sync_key").read_only, true);
    assert.equal(service.volumes.find(v =>
        v.target === "/run/secrets/content_sync_known_hosts").read_only, true);
});
```

Add these exact assertions to the Compose test:

```javascript
assert.equal(service.ports, undefined);
assert.equal(service.volumes.some(v => v.source === "/var/run/docker.sock"), false);
assert.equal("MYSQL_ROOT_PASSWORD" in service.environment, false);
assert.equal(service.volumes.some(v => v.source.includes("snapshot")), false);
assert.deepEqual(Object.keys(config.volumes), ["content-sync-state"]);
assert.deepEqual(Object.keys(baseComposeConfig().services).sort(),
                 ["mysql", "mysql-backup", "python", "www"]);
```

- [ ] **Step 3: Run focused tests and confirm failures**

Run:

```bash
python3 -m unittest mysql.test.test_content_sync_health -v
node --test scripts/test/content-sync-compose.test.js
```

Expected: FAIL because the health module and Compose overlay are absent.

- [ ] **Step 4: Implement healthcheck and image packaging**

```python
# mysql/content_sync/health.py
def health_status(state, now, max_age_seconds=7200):
    if state is None:
        return 1, "starting"
    age = now - state.verified_at_epoch
    return (0, "healthy") if 0 <= age <= max_age_seconds \
        else (1, "unhealthy")
```

Update `mysql/Dockerfile` to install `openssh-client`, `python3`, and
`python3-pymysql` with `--no-install-recommends`; copy `content_sync/` to
`/usr/local/lib/content_sync/`; copy all three wrappers to `/usr/local/bin/`;
and mark them executable. Preserve the existing backup entrypoint and cron
command exactly.

- [ ] **Step 5: Add the profiled Compose overlay**

```yaml
# docker-compose.content-sync.yaml
volumes:
    content-sync-state:

services:
    content-sync:
        image: tmckimmey/legendhub-mysql-backup:${LEGENDHUB_IMAGE_TAG:?set LEGENDHUB_IMAGE_TAG}
        profiles: [content-sync]
        depends_on:
            mysql:
                condition: service_healthy
        command: ["/usr/local/bin/sync-public-content", "--loop"]
        environment:
            MYSQL_HOST: mysql
            MYSQL_PORT: ${MYSQL_PORT}
            MYSQL_USER: ${MYSQL_USER}
            MYSQL_PASSWORD: ${MYSQL_PASSWORD}
            MYSQL_DATABASE: ${MYSQL_DATABASE}
            CONTENT_SYNC_SOURCE: ${CONTENT_SYNC_SOURCE:?set CONTENT_SYNC_SOURCE}
            CONTENT_SYNC_STAGING_DATABASE: ${CONTENT_SYNC_STAGING_DATABASE:-legendhub_content_sync}
            CONTENT_SYNC_INTERVAL_SECONDS: ${CONTENT_SYNC_INTERVAL_SECONDS:-3600}
            CONTENT_SYNC_MAX_AGE_SECONDS: ${CONTENT_SYNC_MAX_AGE_SECONDS:-7200}
            CONTENT_SYNC_STATE_DIR: /var/lib/legendhub-content-sync
            CONTENT_SYNC_SSH_KEY: /run/secrets/content_sync_key
            CONTENT_SYNC_KNOWN_HOSTS: /run/secrets/content_sync_known_hosts
        volumes:
            - content-sync-state:/var/lib/legendhub-content-sync
            - type: bind
              source: ${CONTENT_SYNC_SSH_KEY_FILE:?set CONTENT_SYNC_SSH_KEY_FILE}
              target: /run/secrets/content_sync_key
              read_only: true
            - type: bind
              source: ${CONTENT_SYNC_KNOWN_HOSTS_FILE:?set CONTENT_SYNC_KNOWN_HOSTS_FILE}
              target: /run/secrets/content_sync_known_hosts
              read_only: true
        networks: [legendhub]
        healthcheck:
            test: ["CMD", "/usr/local/bin/content-sync-health"]
            interval: 5m
            timeout: 10s
            retries: 1
            start_period: 2h
        restart: unless-stopped
```

Add the six content-sync variable names to `.env_example` with non-secret
defaults where shown above and example file paths/source host only. Do not
put a real hostname, username, fingerprint, or key path from either server in
the committed file.

- [ ] **Step 6: Run image, health, and Compose tests**

Run:

```bash
python3 -m unittest mysql.test.test_content_sync_health -v
node --test scripts/test/content-sync-compose.test.js \
  scripts/test/mysql-backup-cron.test.js
```

Expected: all tests PASS; the backup image still starts foreground cron by
default and contains all three new entry points.

- [ ] **Step 7: Commit service packaging**

```bash
git add mysql/Dockerfile mysql/content_sync/health.py \
  mysql/content-sync-health mysql/test/test_content_sync_health.py \
  docker-compose.content-sync.yaml scripts/test/content-sync-compose.test.js \
  scripts/test/mysql-backup-cron.test.js .env_example
git commit -m "feat: package test content sync service"
```

---

### Task 7: Add Operator, Provisioning, and Test-Deployment Commands

**Files:**
- Create: `scripts/sync-test-content.sh`
- Create: `scripts/run-test-content-sync.sh`
- Create: `scripts/provision-test-content-sync.sh`
- Create: `scripts/test/content-sync-operator.test.js`
- Modify: `scripts/deploy-test.sh:22-61`
- Modify: `scripts/test/deploy-test.test.js:140-174`

**Interfaces:**
- Consumes: `content-sync` Compose service from Task 6.
- Produces local CLI: `scripts/sync-test-content.sh [--dry-run]`
- Produces remote CLI: `scripts/run-test-content-sync.sh [--dry-run]`
- Produces local CLI: `scripts/provision-test-content-sync.sh`
- Adds tracked overlay to every Dunwichmass Compose validation/deployment.
- Keeps automatic service startup gated by `COMPOSE_PROFILES=content-sync` in the ignored server `.env`.

- [ ] **Step 1: Write failing operator-wrapper tests**

```javascript
// scripts/test/content-sync-operator.test.js
test("manual sync sends the fixed remote command", () => {
    const result = runSync([]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readSshLog(),
        "dunwichmass /home/rufus/legendhub/scripts/run-test-content-sync.sh\n");
});

test("dry run remains explicit and reaches the container as one flag", () => {
    const result = runSync(["--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readSshLog(),
        "dunwichmass /home/rufus/legendhub/scripts/run-test-content-sync.sh --dry-run\n");
});

test("preserves the remote exit status", () => {
    const result = runSync([], {sshExitStatus: 37});
    assert.equal(result.status, 37);
});

for (const argument of ["--apply", "dry-run", "--remote", "anything"])
    test(`rejects ${argument}`, () => {
        const result = runSync([argument]);
        assert.equal(result.status, 64);
        assert.equal(readSshLog(), "");
    });
```

Define `test_provision_uses_fixed_staging_database_and_minimum_grant` with a
fake `ssh` and Docker executable. Assert the captured SQL equals the two
statements in Step 5, the Docker call uses the discovered MySQL container, and
captured stdout/stderr contain neither fake root password nor fake target
password.

- [ ] **Step 2: Update deploy tests first**

Change the expected Compose calls in `scripts/test/deploy-test.test.js` to:

```javascript
assert.equal(readIfPresent(dockerLog), [
    "compose -f docker-compose.yaml -f docker-compose.test.yaml " +
        "-f docker-compose.registry.yaml -f docker-compose.content-sync.yaml " +
        "config --quiet",
    "compose -f docker-compose.yaml -f docker-compose.test.yaml " +
        "-f docker-compose.registry.yaml -f docker-compose.content-sync.yaml " +
        "pull www python mysql-backup content-sync",
    "compose -f docker-compose.yaml -f docker-compose.test.yaml " +
        "-f docker-compose.registry.yaml -f docker-compose.content-sync.yaml " +
        "up -d --no-build",
    "",
].join("\n"));
```

Define `test_deploy_stops_before_compose_when_content_sync_overlay_is_missing`;
delete only that overlay from the disposable deploy fixture, require nonzero
status with `Missing required file: docker-compose.content-sync.yaml`, and
assert the fake Docker log is empty.

- [ ] **Step 3: Run focused tests and confirm failure**

Run:

```bash
node --test scripts/test/content-sync-operator.test.js \
  scripts/test/deploy-test.test.js
```

Expected: FAIL because the wrappers and deploy integration do not exist.

- [ ] **Step 4: Implement the manual sync wrapper**

```bash
#!/usr/bin/env bash
set -euo pipefail

case "$#:${1:-}" in
  0:) remote_args=() ;;
  1:--dry-run) remote_args=(--dry-run) ;;
  *) printf 'Usage: %s [--dry-run]\n' "${0##*/}" >&2; exit 64 ;;
esac

exec ssh dunwichmass \
  /home/rufus/legendhub/scripts/run-test-content-sync.sh "${remote_args[@]}"
```

Create the remote-side wrapper separately so no hidden operator argument is
needed:

```bash
#!/usr/bin/env bash
set -euo pipefail

case "$#:${1:-}" in
  0:) sync_args=(--once) ;;
  1:--dry-run) sync_args=(--once --dry-run) ;;
  *) printf 'Usage: %s [--dry-run]\n' "${0##*/}" >&2; exit 64 ;;
esac

cd /home/rufus/legendhub
exec docker compose \
  -f docker-compose.yaml \
  -f docker-compose.test.yaml \
  -f docker-compose.registry.yaml \
  -f docker-compose.content-sync.yaml \
  run --rm --no-deps content-sync \
  /usr/local/bin/sync-public-content "${sync_args[@]}"
```

Neither wrapper uses agent forwarding; Dunwichmass owns the dedicated
production key.

- [ ] **Step 5: Implement minimum-grant staging provisioning**

The provisioning script must validate the remote path and required ignored
files, locate exactly one MySQL service through Compose, and run inside that
container:

```sql
CREATE DATABASE IF NOT EXISTS `legendhub_content_sync`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON `legendhub_content_sync`.*
  TO 'legendhub'@'%';
```

Read the target user from the container's `MYSQL_USER` and fail unless it is
exactly `legendhub`, matching the fixed quoted grant above. Invoke the MySQL
client inside the container with `MYSQL_PWD="$MYSQL_ROOT_PASSWORD"`; neither
password may appear in its argument list or output. Reject any staging name
other than the fixed `legendhub_content_sync`, and issue no grant for any other
database.

- [ ] **Step 6: Modify test deployment to include but not force-enable sync**

Add `docker-compose.content-sync.yaml` to `require_file` and the Compose array,
and add `content-sync` to `pull`. Leave automatic startup controlled by the
profile: without `COMPOSE_PROFILES=content-sync`, normal `up -d` must not start
the service; after the initial authorized sync, the ignored Dunwichmass `.env`
can enable it for future deployments.

- [ ] **Step 7: Run operator, deployment, and syntax tests**

Run:

```bash
node --test scripts/test/content-sync-operator.test.js \
  scripts/test/deploy-test.test.js
bash -n scripts/sync-test-content.sh \
  scripts/run-test-content-sync.sh scripts/provision-test-content-sync.sh \
  scripts/deploy-test.sh
```

Expected: all tests PASS.

- [ ] **Step 8: Commit operator and deployment integration**

```bash
git add scripts/sync-test-content.sh scripts/run-test-content-sync.sh \
  scripts/provision-test-content-sync.sh scripts/deploy-test.sh \
  scripts/test/content-sync-operator.test.js \
  scripts/test/deploy-test.test.js
git commit -m "feat: operate and deploy test content sync"
```

---

### Task 8: Document Operations and Run the Complete Verification Matrix

**Files:**
- Create: `docs/operations/production-to-test-content-sync.md`
- Modify: `DEVELOPMENT.md:73-177`
- Modify: `CHANGELOG.md:6-15`

**Interfaces:**
- Documents exact provisioning, dry-run, manual sync, hourly enablement, health, failure, revocation, and rollback commands.
- Records the public-facing operational improvement under `2.8.0-beta`.

- [ ] **Step 1: Write the operations guide**

The guide must include these sections and exact safe commands:

```markdown
# Production-to-Test Content Sync

## Security boundary
## One-time key and host-key provisioning
## Production forced-command installation
## Dunwichmass staging provisioning
## Comparison-only run
## Initial mutating run
## Enable or disable the hourly profile
## Immediate manual run
## Health and secret-free logs
## Revoke production access
## Restore the pre-sync Dunwichmass backup
```

Use `vi` for the documented production `authorized_keys` and ignored Compose
or `.env` edits. The authorized-key entry format must be:

```text
restrict,command="/home/rufus/legendhub/serve-production-content.sh" ssh-ed25519 <public-key-material> legendhub-content-sync
```

State explicitly that `<public-key-material>` is copied from the newly created
public `.pub` file and that neither the private key nor its contents may be
printed into logs or committed. Require out-of-band verification of the Legend
host-key fingerprint before writing the pinned known-hosts file; do not
recommend `StrictHostKeyChecking=no`.

Document manual use as:

```bash
./scripts/sync-test-content.sh --dry-run
./scripts/sync-test-content.sh
```

Document hourly enablement as adding `COMPOSE_PROFILES=content-sync` to the
ignored Dunwichmass `.env` with `vi`, then recreating only `content-sync` with
the four-file Compose command. Disabling removes that profile value and stops
only the sync service; it does not remove volumes or database content.

- [ ] **Step 2: Update development documentation and changelog**

Add the fifth opt-in service to `DEVELOPMENT.md`, the focused Python and Node
test commands, and links to the operations guide. Under `2.8.0-beta` →
`### Added`, add:

```markdown
- Added guarded hourly and on-demand synchronization so Dunwichmass public content and history can mirror production without replacing test accounts or operational data.
```

- [ ] **Step 3: Run the focused content-sync suites**

Run:

```bash
python3 -m unittest discover -s mysql/test -p 'test_content_sync*.py' -v
node --test scripts/test/content-sync-*.test.js \
  scripts/test/deploy-test.test.js scripts/test/mysql-backup-cron.test.js
```

Expected: all focused tests PASS with zero failures.

- [ ] **Step 4: Run all repository verification**

Run:

```bash
node scripts/verify-release-version.js
(cd www && npm test)
node --test scripts/test/*.test.js
(cd css && npm test)
bash -n mysql/backup-entrypoint mysql/backup-mysql \
  mysql/export-public-content mysql/sync-public-content \
  mysql/content-sync-health scripts/serve-production-content.sh \
  scripts/sync-test-content.sh scripts/run-test-content-sync.sh \
  scripts/provision-test-content-sync.sh scripts/deploy-test.sh
docker build --tag legendhub-content-sync-plan-check mysql
```

Expected: release metadata matches `2.8.0-beta`; all web, script, CSS, Python,
shell, and image checks PASS. Remove only the disposable local verification
image after recording its image ID:

```bash
docker image rm legendhub-content-sync-plan-check
```

- [ ] **Step 5: Validate merged Compose configurations without starting services**

Create temporary empty key and known-host fixture files with mode `0600`, set
only non-secret fixture environment values, and run:

```bash
LEGENDHUB_IMAGE_TAG=abcdef123456 \
CONTENT_SYNC_SOURCE=sync@example.invalid \
CONTENT_SYNC_SSH_KEY_FILE="$fixture_key" \
CONTENT_SYNC_KNOWN_HOSTS_FILE="$fixture_hosts" \
docker compose -f docker-compose.yaml \
  -f docker-compose.registry.yaml \
  -f docker-compose.content-sync.yaml config --quiet
```

Expected: exit 0. Remove the temporary fixture directory afterward. Do not run
`docker compose up` in this verification step.

- [ ] **Step 6: Inspect the final diff and commit documentation**

Run:

```bash
git diff --check
git status --short
git diff --stat "$(git merge-base master HEAD)" HEAD
```

Expected: only scoped source, tests, Compose, scripts, changelog, and
documentation changes appear; user-owned untracked files remain untouched.

```bash
git add docs/operations/production-to-test-content-sync.md DEVELOPMENT.md \
  CHANGELOG.md
git commit -m "docs: explain production content sync operations"
```

---

### Task 9: Review, Integrate, and Perform the Authorized Rollout

**Files:**
- Review all files changed by Tasks 1-8.
- Do not modify root `docker-compose-prod.yaml`.

**Interfaces:**
- Consumes the completed feature branch and immutable three-image SHA.
- Produces a merged implementation and, only through separately authorized
  gates, a read-only production exporter plus Dunwichmass synchronization.

- [ ] **Step 1: Request code review before integration**

Use `superpowers:requesting-code-review`. Resolve findings through
`superpowers:receiving-code-review`, rerun the focused and full verification
commands from Task 8, and commit fixes individually.

- [ ] **Step 2: Integrate through the approved branch-finishing workflow**

Use `superpowers:finishing-a-development-branch`. Do not assume approval to
push, merge, or delete branches. Confirm the target is `master`, not `main`.

- [ ] **Step 3: Stop at the image-publication authorization gate**

Before running `scripts/publish-images.sh`, obtain explicit authorization for
this publication. After authorization, verify Docker Hub authentication and
private visibility for all three repositories, publish the immutable
12-character SHA, and verify all three remote manifests are `linux/amd64`.

- [ ] **Step 4: Stop at the production-provisioning authorization gate**

Before changing Legend, obtain explicit authorization covering the backup
image update, forced-command script installation, and restricted public key.
Then:

1. run and verify the existing production private backup;
2. save a recoverable copy of the current production Compose file;
3. deploy only the authorized backup-image reference;
4. copy `serve-production-content.sh` to its fixed production path;
5. use `vi` to add the exact restricted public-key line;
6. verify `manifest` and one digest-addressed `snapshot` request without
   displaying snapshot bytes; and
7. confirm production MySQL, backups, web routes, and all unrelated containers
   remain healthy.

The production exporter performs no database mutation.

- [ ] **Step 5: Stop at the Dunwichmass deployment/provisioning gate**

Obtain explicit authorization before deploying the image/Compose changes or
creating the staging database and key files. Deploy with the profile still
disabled, provision the minimum staging grant, install the private key and
pinned known-host entry as mode `0600`, and run:

```bash
./scripts/sync-test-content.sh --dry-run
```

Expected: source/staging/schema/content checks pass, the target remains
unchanged, and no new notification or audit rows appear.

- [ ] **Step 6: Stop at the initial Dunwichmass data-replacement gate**

Obtain explicit authorization for the first target content replacement. Then:

1. run and verify a fresh Dunwichmass private backup;
2. record exact pre-sync counts and digests for all 17 mirrored tables;
3. record exact counts/digests for excluded account and operational tables;
4. run `./scripts/sync-test-content.sh`;
5. require all mirrored counts and the canonical content digest to equal
   production;
6. require excluded-table counts/digests to equal their pre-sync values;
7. verify `/`, `/items/`, `/mobs/`, `/quests/`, `/wiki/`, `/builder/`, and
   history views return expected results; and
8. verify MySQL and the existing backup service remain healthy.

- [ ] **Step 7: Enable and verify the hourly loop**

With authorization to enable automation, use `vi` to set
`COMPOSE_PROFILES=content-sync` in the ignored Dunwichmass `.env`, recreate
only `content-sync`, and verify:

- the immediate startup run succeeds;
- an unchanged scheduled/manual run reports a no-op;
- a controlled production content edit reaches Dunwichmass after a manual run;
- direct Dunwichmass public-content drift is repaired while the production
  digest remains unchanged;
- the service remains healthy for a successful run and becomes unhealthy in a
  disposable test after the two-hour threshold; and
- logs contain no credentials, raw SQL, key material, or editor IP addresses.

- [ ] **Step 8: Record rollback facts without performing rollback**

Record the verified pre-sync Dunwichmass backup path, the prior backup-image
reference, the restricted key line location, the current content digest, and
the commands to stop only `content-sync`. Do not restore, revoke, delete, or
roll back unless the maintainer separately authorizes that action or a defined
automatic failure handler must restore the immediately previous state.
