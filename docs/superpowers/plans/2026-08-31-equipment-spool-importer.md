# Legend Equipment Spool Importer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consume Legend equipment observation files from the shared spool and create or reuse player-searchable official item variants with durable provenance.

**Architecture:** A dedicated Node process in the existing `legendhub-www` image polls a bind-mounted spool, claims one JSON file at a time by atomic rename, validates and canonicalizes the versioned contract, and delegates one database transaction to an importer repository. An additive migration stores the official marker, source variants, and submissions; a Dunwich-only Compose overlay opts the consumer in without coupling it to the web process.

**Tech Stack:** Node.js 22, CommonJS, `node:test`, existing `mysql` 2.18 pool, MySQL 5.7-compatible SQL, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-08-31-legend-equipment-spool-json-design.md`

## Global Constraints

- Accept only `schema_version: 1` and `event_type: "equipment.observed"` with the spec's closed object shapes and exact bounds.
- Enforce the 256 KiB file limit before parsing and require valid UTF-8.
- Treat `(source.server, submission.id)` as submission identity and `(source.server, item.vnum, item fingerprint)` as official variant identity.
- Normalize text with trim plus NFC, lowercase enums, normalize negative zero, canonicalize weight to two decimals, and sort/deduplicate `slots` and `casts` before fingerprinting.
- Keep `raw_text` and submission metadata out of the item fingerprint.
- Never convert or overwrite a community item; new official variants receive distinct `Items` rows.
- Import exactly one file at a time; multiple concurrent consumers remain out of scope.
- Polling is authoritative. Requeue all startup leftovers and running leftovers older than 15 minutes from `processing/` to `incoming/`.
- Accepted files move to `processed/`; rejected files move to `rejected/` with a non-sensitive `.error.json` sidecar.
- Gzip processed JSON after one day, delete processed artifacts after 30 days, and delete rejected artifacts after 90 days.
- The live Dunwich host root is `/home/rufus/legendhub-spool`; the container path is `/var/spool/legendhub`.
- The existing three private Docker repositories remain the publication set; the importer reuses the `legendhub-www` image.
- Do not publish, deploy, push, tag, or change Dunwich `.env` without separate authorization for that action.

---

### Task 1: Version-1 Contract Validation and Canonicalization

**Files:**
- Create: `www/src/equipment-importer/errors.js`
- Create: `www/src/equipment-importer/contract.js`
- Create: `www/test/equipment-import-contract.test.js`
- Create: `www/test-fixtures/equipment-spool/valid.json`

**Interfaces:**
- Produces: `ImportValidationError(code, message, paths = [])` with safe `code`, `message`, and JSON field `paths`.
- Produces: `parseObservation(buffer: Buffer): ParsedObservation`.
- `ParsedObservation` contains `{document, canonicalPayload, payloadHash, normalizedItem, itemFingerprint, sourceTimestamp}` where hashes are 32-byte `Buffer` values.

- [ ] **Step 1: Add a sanitized fixture matching the live sample**

Use the exact v1 object shape, including `slots: ["arm"]`, `source.server: "testmud"`, and all required zero-valued fields, but replace submitter identity with synthetic fixture values.

- [ ] **Step 2: Write failing happy-path and determinism tests**

```js
test("parses and fingerprints a complete v1 observation", () => {
    const parsed = parseObservation(fixtureBuffer());
    assert.equal(parsed.document.item.name, "Cuchullain's shield");
    assert.equal(parsed.payloadHash.length, 32);
    assert.equal(parsed.itemFingerprint.length, 32);
});

test("item fingerprint ignores key order, slot order, cast order, enum case, raw text, and negative zero", () => {
    const left = fixtureDocument();
    const right = reorderedEquivalentFixture();
    assert.deepEqual(
        parseObservation(Buffer.from(JSON.stringify(left))).itemFingerprint,
        parseObservation(Buffer.from(JSON.stringify(right))).itemFingerprint
    );
});
```

- [ ] **Step 3: Run the contract tests and confirm they fail because the module is absent**

Run: `node --test test/equipment-import-contract.test.js`

Expected: FAIL with `Cannot find module '../src/equipment-importer/contract'`.

- [ ] **Step 4: Implement strict validation, normalization, stable JSON, and SHA-256 hashing**

Implement closed-object validation with explicit key sets. Reject non-Buffer input, buffers over `256 * 1024`, UTF-8 replacement characters, malformed JSON, arrays/objects in the wrong positions, unknown fields, missing fields, values outside the documented bounds, non-UTC timestamps, invalid enums, duplicate-after-normalization empty strings, and `other` combined with another slot.

```js
function parseObservation(buffer) {
    const text = decodeUtf8(buffer);
    const document = JSON.parse(text);
    validateDocument(document);
    const canonicalPayload = stableStringify(document);
    const normalizedItem = normalizeItem(document.item);
    return {
        document,
        canonicalPayload,
        payloadHash: sha256(canonicalPayload),
        normalizedItem,
        itemFingerprint: sha256(stableStringify(normalizedItem)),
        sourceTimestamp: new Date(document.submission.submitted_at)
    };
}
```

- [ ] **Step 5: Add rejection coverage for every contract boundary**

Use table-driven tests for malformed JSON, invalid UTF-8, oversized input, unknown/missing keys, invalid IDs/timestamps/enums, more than 20 slots, non-integer stats, weight precision/range, over-limit names/casts/raw text, and invalid nulls. Accept `familiar` because it remains part of the immutable version-1 vocabulary, even though the Legend producer will not emit it.

- [ ] **Step 6: Run contract tests**

Run: `node --test test/equipment-import-contract.test.js`

Expected: PASS.

- [ ] **Step 7: Commit the contract boundary**

```bash
git add www/src/equipment-importer/errors.js www/src/equipment-importer/contract.js \
  www/test/equipment-import-contract.test.js www/test-fixtures/equipment-spool/valid.json
git commit -m "feat: validate equipment spool observations"
```

### Task 2: Additive Official-Item Storage Migration

**Files:**
- Create: `www/src/routes/api/migrations/11.js`
- Create: `www/test/migration-11.test.js`
- Modify: `www/test/migrations.integration.test.js`
- Modify: `www/src/routes/api/items.js`
- Modify: `www/test/item-slot-api.test.js`

**Interfaces:**
- Produces tables `OfficialItemVariants` and `EquipmentSubmissions`.
- Produces `Items.Official` and `Items_AuditTrail.Official` as `TINYINT NOT NULL DEFAULT 0`.
- Produces filter-only `ItemStatInfo.Var = 'official'` metadata.

- [ ] **Step 1: Write failing migration-shape tests**

Assert that migration 11 is non-transactional, widens both item name columns to `VARCHAR(255)`, widens both casts columns to `TEXT`, adds the official columns idempotently, creates both provenance tables with binary 32-byte hashes and unique identity keys, adds filter metadata with `Editable = 0`, and rebuilds `Items_BEFORE_UPDATE` so `OLD.Official` is audited.

- [ ] **Step 2: Run the migration unit test and confirm the missing module failure**

Run: `node --test test/migration-11.test.js`

Expected: FAIL because `migrations/11.js` does not exist.

- [ ] **Step 3: Implement recoverable migration 11**

Create these logical definitions using MySQL 5.7-compatible DDL:

```sql
ALTER TABLE Items ADD COLUMN Official TINYINT NOT NULL DEFAULT 0;
ALTER TABLE Items_AuditTrail ADD COLUMN Official TINYINT NOT NULL DEFAULT 0;
ALTER TABLE Items MODIFY COLUMN Name VARCHAR(255) NOT NULL;
ALTER TABLE Items_AuditTrail MODIFY COLUMN Name VARCHAR(255) NOT NULL;
ALTER TABLE Items MODIFY COLUMN Casts TEXT NULL;
ALTER TABLE Items_AuditTrail MODIFY COLUMN Casts TEXT NULL;

CREATE TABLE OfficialItemVariants (
    Id BIGINT NOT NULL AUTO_INCREMENT,
    ItemId INT NOT NULL,
    Server VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    Vnum INT UNSIGNED NOT NULL,
    ItemFingerprint BINARY(32) NOT NULL,
    FirstSeenOn DATETIME NOT NULL,
    LastSeenOn DATETIME NOT NULL,
    ObservationCount BIGINT UNSIGNED NOT NULL DEFAULT 1,
    PRIMARY KEY (Id),
    UNIQUE KEY UX_OfficialItemVariants_Identity (Server, Vnum, ItemFingerprint),
    UNIQUE KEY UX_OfficialItemVariants_ItemId (ItemId)
) ENGINE=InnoDB;

CREATE TABLE EquipmentSubmissions (
    Id BIGINT NOT NULL AUTO_INCREMENT,
    Server VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    SubmissionId VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    PayloadHash BINARY(32) NOT NULL,
    CanonicalPayload MEDIUMTEXT NOT NULL,
    SourceTimestamp DATETIME NOT NULL,
    ReceivedOn DATETIME NOT NULL,
    SubmittedByCharacter VARCHAR(60) NOT NULL,
    SubmittedByAccountId VARCHAR(128) NULL,
    ItemId INT NOT NULL,
    PRIMARY KEY (Id),
    UNIQUE KEY UX_EquipmentSubmissions_Identity (Server, SubmissionId),
    KEY IX_EquipmentSubmissions_ItemId (ItemId)
) ENGINE=InnoDB;
```

Every DDL step must inspect current state first, and `verify()` must confirm columns, indexes, metadata, and trigger behavior so startup can resume after partial DDL.

- [ ] **Step 4: Keep the official marker server-owned**

Expose `official` on item output and fragments, but delete it from mutation inputs after `getItemFields` constructs them:

```js
let insertItemArgs = getItemFields(false, false);
delete insertItemArgs.official;
// ...
let updateItemArgs = getItemFields(false, false, true);
delete updateItemArgs.official;
```

The metadata row uses `Display='Official'`, `Short='Official'`, `Var='official'`, `Type='bool'`, `FilterString='= 1'`, `DefaultValue='false'`, `ShowColumnDefault=0`, `Editable=0`, category 1, and a stable unused sort number.

- [ ] **Step 5: Add integration assertions**

Extend the real migration test to assert migration ID 11, both provenance tables, widened names/casts, official defaults on existing community rows, filter metadata, and trigger audit coverage.

- [ ] **Step 6: Run migration and API tests**

Run: `node --test test/migration-11.test.js test/item-slot-api.test.js`

Expected: PASS.

- [ ] **Step 7: Commit the storage contract**

```bash
git add www/src/routes/api/migrations/11.js www/test/migration-11.test.js \
  www/test/migrations.integration.test.js www/src/routes/api/items.js \
  www/test/item-slot-api.test.js
git commit -m "feat: add official equipment storage"
```

### Task 3: Map Observations and Import Them Transactionally

**Files:**
- Create: `www/src/equipment-importer/item-mapper.js`
- Create: `www/src/equipment-importer/repository.js`
- Create: `www/test/equipment-import-mapper.test.js`
- Create: `www/test/equipment-import-repository.test.js`

**Interfaces:**
- Consumes: `ParsedObservation` from Task 1 and `slotsToMask()` from `item-slots.js`.
- Produces: `mapOfficialItem(normalizedItem, server): {columns, values, valueByVar}`.
- Produces: `createEquipmentRepository(pool).ingest(parsed, receivedAt): Promise<{status, itemId}>` where status is `created`, `duplicate`, or `replay`.

- [ ] **Step 1: Write failing field-mapping tests**

Assert every producer field maps explicitly to its legacy column: slot vocabulary IDs 0–21, alignment IDs 0–6, weapon type IDs 0–3, governing attribute IDs 0–3, all flags, attributes/caps/resources/combat/weapon/economy fields, `Casts` as a comma-separated display string, `Official=1`, `MobId=0`, `QuestId=0`, `Notes=NULL`, `Deleted=0`, and `ModifiedBy='Legend:testmud'`.

- [ ] **Step 2: Implement deterministic item mapping**

Use explicit constant maps rather than deriving names:

```js
const SLOT_IDS = new Map([
    ["light", 0], ["finger", 1], ["neck", 2], ["body", 3],
    ["head", 4], ["face", 5], ["legs", 6], ["feet", 7],
    ["hands", 8], ["arms", 9], ["shield", 10], ["about", 11],
    ["waist", 12], ["wrist", 13], ["wield", 14], ["hold", 15],
    ["ear", 16], ["arm", 17], ["amulet", 18], ["aux", 19],
    ["familiar", 20], ["other", 21]
]);
```

Choose the lowest numeric capability as legacy `Slot`, preserve all capabilities in `SlotMask`, and return `valueByVar` using the existing lower-camel ItemStatInfo names for net-stat calculation.

- [ ] **Step 3: Run mapper tests**

Run: `node --test test/equipment-import-mapper.test.js`

Expected: PASS.

- [ ] **Step 4: Write failing repository transaction tests**

Use a scripted fake pool/connection to prove:

- a new identity inserts one official item, variant, and submission then commits;
- a new submission with the same vnum/fingerprint reuses the item and increments observation count;
- identical submission replay commits without incrementing observation count;
- a reused submission ID with different payload throws `submission_id_collision` and rolls back;
- the same vnum with a different fingerprint inserts a distinct item;
- a matching community item is never queried for reuse;
- any query failure rolls back and releases the connection.

- [ ] **Step 5: Implement the repository transaction**

Promisify only the acquired connection's callback methods. Lock submission identity first, then variant identity, calculate `NetStat` from `ItemStatInfo.NetStat`, insert the explicit item columns, and retain the inserted item ID in both provenance records. Compare binary hashes with `Buffer.equals()`.

- [ ] **Step 6: Run repository tests**

Run: `node --test test/equipment-import-repository.test.js`

Expected: PASS.

- [ ] **Step 7: Commit transactional ingestion**

```bash
git add www/src/equipment-importer/item-mapper.js \
  www/src/equipment-importer/repository.js \
  www/test/equipment-import-mapper.test.js \
  www/test/equipment-import-repository.test.js
git commit -m "feat: import official equipment variants"
```

### Task 4: Filesystem Claiming, Recovery, Rejection, and Retention

**Files:**
- Create: `www/src/equipment-importer/spool.js`
- Create: `www/test/equipment-import-spool.test.js`

**Interfaces:**
- Consumes: `parseObservation(buffer)` and `repository.ingest(parsed, receivedAt)`.
- Produces: `createSpoolConsumer({root, repository, now, log}).recover()`.
- Produces: `createSpoolConsumer(...).pollOnce(): Promise<{processed, rejected}>`.
- Produces: `createSpoolConsumer(...).applyRetention()`.

- [ ] **Step 1: Write failing temporary-directory workflow tests**

Cover sorted non-hidden `*.json` discovery, atomic `incoming` to `processing` claims, successful `processed` moves, validation/database rejection moves plus safe sidecars, ignoring dotfiles and non-JSON files, one-at-a-time processing, startup recovery, 15-minute stale recovery, and a crash-after-commit replay.

- [ ] **Step 2: Run spool tests and confirm the missing module failure**

Run: `node --test test/equipment-import-spool.test.js`

Expected: FAIL because `spool.js` does not exist.

- [ ] **Step 3: Implement the authoritative polling workflow**

Use `fs.promises.lstat`, `rename`, `open`, and `readFile`. Accept only regular files matching `/^[^.].*\.json$/`, reject oversized files before parsing, and serialize sidecars with mode `0660` through a temporary dotfile followed by rename.

Stable error codes must include at least `invalid_json`, `invalid_utf8`, `file_too_large`, `contract_invalid`, `submission_id_collision`, and `database_error`. Sidecars contain only:

```json
{
  "code": "contract_invalid",
  "message": "The equipment observation is invalid.",
  "failed_at": "2026-08-31T23:00:00.000Z",
  "paths": ["item.slots"]
}
```

- [ ] **Step 4: Implement recovery and retention**

On `recover()`, return every non-hidden processing JSON to incoming. During normal polling, do the same only when `mtime` is older than 15 minutes. `applyRetention()` gzips plain processed JSON older than one day using `zlib`, removes processed JSON/JSON.GZ older than 30 days, and removes rejected JSON/error sidecars older than 90 days.

- [ ] **Step 5: Run spool tests**

Run: `node --test test/equipment-import-spool.test.js`

Expected: PASS.

- [ ] **Step 6: Commit the spool lifecycle**

```bash
git add www/src/equipment-importer/spool.js www/test/equipment-import-spool.test.js
git commit -m "feat: consume equipment spool files"
```

### Task 5: Long-Running Importer Process and Compose Integration

**Files:**
- Create: `www/src/equipment-importer.js`
- Create: `www/test/equipment-import-runner.test.js`
- Create: `docker-compose.equipment-importer.yaml`
- Create: `scripts/test/equipment-importer-compose.test.js`
- Modify: `docker-compose.registry.yaml`
- Modify: `scripts/deploy-test.sh`
- Modify: `scripts/test/registry-compose.test.js`
- Modify: `scripts/test/local-compose.test.js`

**Interfaces:**
- Consumes: migrations, normal MySQL pool, and `createSpoolConsumer`.
- Process environment: `EQUIPMENT_SPOOL_ROOT=/var/spool/legendhub`, `EQUIPMENT_IMPORT_POLL_MS` default `5000`, `EQUIPMENT_IMPORT_STALE_MS` fixed/default `900000`.

- [ ] **Step 1: Write failing runner lifecycle tests**

Assert startup validates an absolute spool root, runs migrations before recovery, performs immediate recovery and poll, waits using an injectable timer, applies retention, logs outcome counts without payload/account data, and closes both database pools on `SIGTERM`/`SIGINT`.

- [ ] **Step 2: Implement the process entry point**

```js
async function start(options = {}) {
    await (options.migrate || migrations.run)();
    const consumer = (options.createConsumer || createConsumerFromEnvironment)();
    await consumer.recover();
    while (!stopping) {
        await consumer.pollOnce();
        await consumer.applyRetention();
        await delay(pollMilliseconds);
    }
}
```

Export lifecycle functions for tests and call `main()` only when the file is executed directly.

- [ ] **Step 3: Add an opt-in Compose overlay**

Define `equipment-importer` with profile `equipment-importer`, the same build/image as `www`, `entrypoint: ["node", "src/equipment-importer.js"]`, MySQL environment, `restart: unless-stopped`, and this bind mount:

```yaml
volumes:
  - type: bind
    source: ${EQUIPMENT_SPOOL_HOST_PATH:?set EQUIPMENT_SPOOL_HOST_PATH}
    target: /var/spool/legendhub
```

The registry overlay assigns `tmckimmey/legendhub-www:${LEGENDHUB_IMAGE_TAG}` to both `www` and `equipment-importer`, with no importer build in registry mode.

- [ ] **Step 4: Update deployment composition**

Make `deploy-test.sh` detect and include `docker-compose.equipment-importer.yaml` like the existing content-sync overlay, pull the shared web image once, and let `COMPOSE_PROFILES=equipment-importer` opt the service in. Rollback to commits predating the overlay must remove a legacy importer container just as it already removes legacy content-sync.

- [ ] **Step 5: Add Compose regression tests**

Assert the importer is absent without its profile, present with the profile, mounts only the configured spool root, uses the immutable web SHA in registry mode, carries no HTTP ports, and does not re-enable content-sync.

- [ ] **Step 6: Run runner and Compose tests**

Run: `node --test www/test/equipment-import-runner.test.js scripts/test/equipment-importer-compose.test.js scripts/test/registry-compose.test.js scripts/test/local-compose.test.js`

Expected: PASS.

- [ ] **Step 7: Commit runtime integration**

```bash
git add www/src/equipment-importer.js www/test/equipment-import-runner.test.js \
  docker-compose.equipment-importer.yaml docker-compose.registry.yaml \
  scripts/deploy-test.sh scripts/test/equipment-importer-compose.test.js \
  scripts/test/registry-compose.test.js scripts/test/local-compose.test.js
git commit -m "feat: run the equipment spool importer"
```

### Task 6: Protect Provenance in Backups and Document Operations

**Files:**
- Modify: `mysql/backup-mysql`
- Modify: `scripts/test/mysql-backup-cron.test.js`
- Create: `docs/operations/equipment-spool-importer.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Public SQL excludes `EquipmentSubmissions` and `OfficialItemVariants`; private backup retains both.
- Operations document defines enable, disable, inspect, retry, and rollback commands without exposing payloads or account IDs.

- [ ] **Step 1: Write a failing backup privacy assertion**

Add both provenance tables to the expected `mysqldump --ignore-table` arguments for the public export and assert they remain absent from the private export exclusions.

- [ ] **Step 2: Run the focused backup test and confirm failure**

Run: `node --test scripts/test/mysql-backup-cron.test.js`

Expected: FAIL because the new exclusions are missing.

- [ ] **Step 3: Update public-backup exclusions**

Add:

```bash
--ignore-table="${MYSQL_DATABASE}.EquipmentSubmissions" \
--ignore-table="${MYSQL_DATABASE}.OfficialItemVariants" \
```

- [ ] **Step 4: Write the operator runbook**

Document the live host path, four directories, required modes, `COMPOSE_PROFILES=equipment-importer`, `EQUIPMENT_SPOOL_HOST_PATH=/home/rufus/legendhub-spool`, safe container-status/log commands, how to inspect filenames without dumping JSON, how to requeue a rejected file only with a new submission ID, and how to disable by emptying the profile then stopping/removing the service.

- [ ] **Step 5: Add player-facing changelog copy**

Under the current release's Added section, state that Legend-submitted equipment can appear as official searchable Builder items and that distinct observed versions remain separate variants.

- [ ] **Step 6: Run backup and documentation tests**

Run: `node --test scripts/test/mysql-backup-cron.test.js test/changelog.test.js test/markdown.test.js`

Expected: PASS.

- [ ] **Step 7: Commit privacy and operations documentation**

```bash
git add mysql/backup-mysql scripts/test/mysql-backup-cron.test.js \
  docs/operations/equipment-spool-importer.md CHANGELOG.md
git commit -m "docs: document equipment spool operations"
```

### Task 7: Local End-to-End Proof and Final Verification

**Files:**
- Modify as required by failures in files already listed above; do not add unrelated refactors.

**Interfaces:**
- Uses a temporary local spool copied from the sanitized fixture.
- Produces evidence for one created import, one idempotent replay, one duplicate observation, one variant, and one rejected document.

- [ ] **Step 1: Run all focused importer tests**

Run:

```bash
node --test \
  test/equipment-import-contract.test.js \
  test/migration-11.test.js \
  test/equipment-import-mapper.test.js \
  test/equipment-import-repository.test.js \
  test/equipment-import-spool.test.js \
  test/equipment-import-runner.test.js
```

Expected: PASS.

- [ ] **Step 2: Run script and Compose tests**

Run: `node --test scripts/test/*.test.js`

Expected: PASS.

- [ ] **Step 3: Run the full web suite**

Run: `npm test`

Expected: all tests pass with only the repository's documented skips.

- [ ] **Step 4: Run real MySQL migration integration**

Create/use only a dedicated `*_migration_test` schema and run:

```bash
MYSQL_MIGRATION_INTEGRATION=1 npm run test:migrations:integration
```

Expected: PASS with migration 11 verified after a partial-DDL retry.

- [ ] **Step 5: Exercise the importer against a copied fixture**

Start the local stack with a temporary host spool and the importer profile. Copy—not move—the sanitized fixture into `incoming/`. Verify the file reaches `processed/`, `Items.Official=1`, the slot mask includes `arm`, one variant and one submission exist, replay is idempotent, a second submission increments observations, a changed stat creates a second item, and malformed JSON produces a safe rejected sidecar.

- [ ] **Step 6: Verify repository hygiene**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors and only intended feature changes.

- [ ] **Step 7: Commit any focused verification corrections**

```bash
git add CHANGELOG.md docker-compose.equipment-importer.yaml \
  docker-compose.registry.yaml docs/operations/equipment-spool-importer.md \
  mysql/backup-mysql scripts/deploy-test.sh scripts/test \
  www/src/equipment-importer www/src/equipment-importer.js \
  www/src/routes/api/items.js www/src/routes/api/migrations/11.js \
  www/test www/test-fixtures/equipment-spool
git commit -m "test: verify equipment spool ingestion"
```

- [ ] **Step 8: Request code review and prepare deployment handoff**

Use `superpowers:requesting-code-review`, address findings through `superpowers:receiving-code-review`, then use `superpowers:verification-before-completion`. Do not push, merge, publish images, modify Dunwich `.env`, or deploy until the user separately authorizes those actions.
