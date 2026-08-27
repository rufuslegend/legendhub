# LegendHUB 3.1 Builder Storage Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add authenticated, per-character Builder storage and synchronized preference APIs using the existing compact representation.

**Architecture:** Extract the current Builder codec into one browser-and-server ESM module, then validate every stored payload on the server. Add per-character rows, preference state, import receipts, revisions, deletion markers, and account-storage generation through an additive MySQL 5.7 migration. Expose focused GraphQL operations backed by transactional services; profile conflicts preserve both copies and preference conflicts use last-commit-wins.

**Tech Stack:** Node.js 22 CommonJS plus shared ESM, GraphQL 16, MySQL 5.7, React/Vite codec consumer, Node test runner.

**Spec:** `docs/superpowers/specs/2026-08-26-v31-account-storage-design.md`

## Global Constraints

- Complete Plan 1, `2026-08-26-v31-email-identity-recovery.md`, before this plan.
- Account storage is available only when `auth.emailVerified === true`.
- Store one encoded text payload per character, including all its variants.
- Preserve every currently supported Builder format and existing import/export strings.
- Validate and canonicalize payloads server-side before persistence.
- Enforce 10,485,760 encoded bytes per account; deleted payloads do not count.
- Profile updates use exact revisions; stale edits preserve both versions.
- Preference documents are versioned and last committed update wins.
- Delete-all increments account storage generation so stale tabs cannot repopulate data.
- All database reads and mutations derive `MemberId` from the login token.
- Database changes are additive and remain compatible with v3.0 application rollback.
- Do not push, publish images, deploy, tag, or modify production Compose during implementation.

## File Structure

- `www/shared/builder-codec.mjs`: canonical encoder/decoder shared by browser and server.
- `www/client/features/builder/builder-encoding.js`: compatibility re-export for existing client imports.
- `www/src/routes/api/builder-payload.js`: lazy shared-codec loading plus server validation/canonicalization.
- `www/src/routes/api/migrations/9.js`: profile, preference, and import-receipt schema.
- `www/src/routes/api/builder-profile-repository.js`: parameterized MySQL persistence only.
- `www/src/routes/api/builder-storage-service.js`: ownership, validation, quota, revisions, conflicts, import, and generation rules.
- `www/src/routes/api/builder-storage.js`: GraphQL types and thin resolvers.
- `www/test/builder-storage-*.test.js`: migration, payload, repository/service, and GraphQL contracts.

---

### Task 1: Extract and harden the shared Builder codec

**Files:**
- Create: `www/shared/builder-codec.mjs`
- Create: `www/src/routes/api/builder-payload.js`
- Create: `www/test/builder-payload.test.js`
- Modify: `www/client/features/builder/builder-encoding.js`
- Modify: `www/test/client/builder-encoding.test.js`
- Modify: `www/Dockerfile`

**Interfaces:**
- Produces ESM exports: `fromBase62`, `toBase62`, `decodeBuilderEntries`, `decodeBuilderLists`, `encodeBuilderVariant`, `encodeBuilderLists`, and `readBuilderFormatVersion`.
- Produces CommonJS async `validateBuilderProfile({name, payload}) -> {name, payload, payloadVersion, byteLength, decoded}`.
- `validateBuilderProfile` accepts exactly one character, all current variants, letters/digits/spaces names, and payload formats 1–6; it returns canonical current-format text.

- [ ] **Step 1: Add failing shared-codec and server-validation tests**

```js
test("server validator canonicalizes one legacy character", async function() {
    const result = await validateBuilderProfile({name: "Hero", payload: legacyHero});
    assert.equal(result.name, "Hero");
    assert.match(result.payload, /^6\*Hero~/);
    assert.equal(result.payloadVersion, 6);
    assert.equal(result.byteLength, Buffer.byteLength(result.payload, "utf8"));
});

test("server validator rejects collections and mismatched names", async function() {
    await assert.rejects(validateBuilderProfile({name: "Hero", payload: twoCharacters}), /exactly one character/);
    await assert.rejects(validateBuilderProfile({name: "Other", payload: encodedHero}), /name does not match/);
});
```

Extend the existing fixture loop to import both the compatibility module and
`shared/builder-codec.mjs`, asserting identical decoded and encoded results for
unversioned and versions 1–6.

- [ ] **Step 2: Run codec tests and verify missing shared module failures**

Run: `node --test test/client/builder-encoding.test.js test/builder-payload.test.js` from `www/`.
Expected: FAIL because `shared/builder-codec.mjs` and `builder-payload.js` do not exist.

- [ ] **Step 3: Move—not duplicate—the codec**

Move the environment-neutral code from
`client/features/builder/builder-encoding.js` into
`shared/builder-codec.mjs`. Keep the client file as:

```js
export {
    decodeBuilderEntries,
    decodeBuilderLists,
    encodeBuilderLists,
    encodeBuilderVariant,
    fromBase62,
    readBuilderFormatVersion,
    toBase62
} from "../../../shared/builder-codec.mjs";
```

`builder-payload.js` must cache one dynamic import and enforce the spec:

```js
let codecPromise;
function loadCodec() {
    codecPromise ||= import("../../../shared/builder-codec.mjs");
    return codecPromise;
}

async function validateBuilderProfile({name, payload}) {
    const codec = await loadCodec();
    const lists = codec.decodeBuilderLists(payload);
    if (lists.length !== 1)
        throw new BadRequestError("A profile must contain exactly one character.");
    if (lists[0].name !== name)
        throw new BadRequestError("The encoded character name does not match.");
    const canonical = codec.encodeBuilderLists(lists);
    return {name, payload: canonical, payloadVersion: codec.readBuilderFormatVersion(canonical), byteLength: Buffer.byteLength(canonical), decoded: lists[0]};
}
```

Copy `www/shared` in both Docker build stages so server dynamic imports work in
the final image.

- [ ] **Step 4: Run codec, client build, and Docker-context tests**

Run: `node --test test/client/builder-encoding.test.js test/builder-payload.test.js test/client-build.test.js`
Expected: PASS.

- [ ] **Step 5: Commit the shared codec**

```bash
git add www/shared/builder-codec.mjs www/src/routes/api/builder-payload.js www/client/features/builder/builder-encoding.js www/test/builder-payload.test.js www/test/client/builder-encoding.test.js www/Dockerfile
git commit -m "refactor: share the Builder codec with the server"
```

---

### Task 2: Add Builder storage schema migration

**Files:**
- Create: `www/src/routes/api/migrations/9.js`
- Create: `www/test/builder-storage-migration.test.js`
- Modify: `www/test/migrations.integration.test.js`

**Interfaces:**
- Produces: `BuilderProfiles`, `AccountPreferences`, and `BuilderImportReceipts`.
- Consumes: migration context from `migrations.js`; migration mode is `non-transactional`.

- [ ] **Step 1: Write failing state and retry tests**

```js
test("storage migration creates all tables and verifies a partial retry", async function() {
    const context = createSchemaContext({tables: ["BuilderProfiles"]});
    await migration.up(context);
    assert.deepEqual(context.tables(), ["AccountPreferences", "BuilderImportReceipts", "BuilderProfiles"]);
    assert.equal(await migration.verify(context), true);
    await migration.up(context);
    assert.equal(await migration.verify(context), true);
});
```

- [ ] **Step 2: Run migration tests and verify missing migration failure**

Run: `node --test test/builder-storage-migration.test.js test/migrations.test.js`
Expected: FAIL with missing migration 9.

- [ ] **Step 3: Implement exact MySQL 5.7 tables**

```sql
CREATE TABLE BuilderProfiles (
  Id BIGINT NOT NULL AUTO_INCREMENT,
  PublicId CHAR(36) CHARACTER SET ascii NOT NULL,
  MemberId INT NOT NULL,
  Name TEXT NOT NULL,
  ActiveNameHash BINARY(32) NULL,
  Payload MEDIUMTEXT NULL,
  PayloadVersion SMALLINT NULL,
  PayloadBytes INT NOT NULL DEFAULT 0,
  Revision BIGINT NOT NULL DEFAULT 1,
  CreatedOn DATETIME NOT NULL,
  UpdatedOn DATETIME NOT NULL,
  DeletedOn DATETIME NULL,
  PRIMARY KEY (Id),
  UNIQUE KEY UX_BuilderProfiles_PublicId (PublicId),
  UNIQUE KEY UX_BuilderProfiles_ActiveName (MemberId, ActiveNameHash),
  KEY IX_BuilderProfiles_MemberUpdated (MemberId, UpdatedOn),
  CONSTRAINT FK_BuilderProfiles_Members FOREIGN KEY (MemberId) REFERENCES Members (Id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE AccountPreferences (
  MemberId INT NOT NULL,
  DocumentVersion INT NOT NULL DEFAULT 1,
  Payload JSON NOT NULL,
  Revision BIGINT NOT NULL DEFAULT 1,
  StorageGeneration BIGINT NOT NULL DEFAULT 1,
  UpdatedOn DATETIME NOT NULL,
  PRIMARY KEY (MemberId),
  CONSTRAINT FK_AccountPreferences_Members FOREIGN KEY (MemberId) REFERENCES Members (Id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE BuilderImportReceipts (
  Id BIGINT NOT NULL AUTO_INCREMENT,
  MemberId INT NOT NULL,
  IdempotencyKey CHAR(64) CHARACTER SET ascii NOT NULL,
  ResultPayload JSON NOT NULL,
  CreatedOn DATETIME NOT NULL,
  PRIMARY KEY (Id),
  UNIQUE KEY UX_BuilderImportReceipts_Key (MemberId, IdempotencyKey),
  KEY IX_BuilderImportReceipts_Created (CreatedOn),
  CONSTRAINT FK_BuilderImportReceipts_Members FOREIGN KEY (MemberId) REFERENCES Members (Id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

`ActiveNameHash` is SHA-256 of the exact case-sensitive UTF-8 name. Deleted
rows set it to null, permitting later reuse while keeping the tombstone.
`verify()` must assert tables, columns, keys, JSON types, and foreign keys.

- [ ] **Step 4: Run unit and MySQL integration migration tests**

Run: `node --test test/builder-storage-migration.test.js test/migrations.test.js`
Expected: PASS.

With the dedicated database configured, run:
`MYSQL_MIGRATION_INTEGRATION=1 node --test test/migrations.integration.test.js`
Expected: migration 9 verifies on MySQL 5.7 and is retry-safe.

- [ ] **Step 5: Commit storage schema**

```bash
git add www/src/routes/api/migrations/9.js www/test/builder-storage-migration.test.js www/test/migrations.integration.test.js
git commit -m "feat: add account Builder storage schema"
```

---

### Task 3: Implement profile persistence, quota, and conflict behavior

**Files:**
- Create: `www/src/routes/api/builder-profile-repository.js`
- Create: `www/src/routes/api/builder-storage-service.js`
- Create: `www/test/builder-profile-repository.test.js`
- Create: `www/test/builder-storage-service.test.js`
- Modify: `www/src/routes/api/auth.js`
- Modify: `www/test/account-characterization.test.js`

**Interfaces:**
- Produces: `createBuilderProfileRepository({pool})` with `list`, `findByPublicIdForUpdate`, `insert`, `update`, `markDeleted`, `usedBytes`, `readPreferencesForUpdate`, `writePreferences`, `readImportReceipt`, and `writeImportReceipt`.
- Produces: `createBuilderStorageService({pool, repository, validateProfile, clock, randomUUID})`.
- Service methods: `readState(auth)`, `exportAll(auth)`, `createProfile(auth, input)`, `updateProfile(auth, input)`, `deleteProfile(auth, input)`, `updatePreferences(auth, input)`, `deleteAll(auth, input)`.
- Adds `auth.utils.authenticate(req, token, {renew, permissions})`; existing `authQuery`/`authMutation` delegate to it.

- [ ] **Step 1: Write failing service tests for ownership, quota, and conflict copies**

```js
test("stale update preserves the server row and creates a conflict copy", async function() {
    const result = await service.updateProfile(auth, {
        id: "profile-id", name: "Hero", payload: stalePayload,
        revision: 3, storageGeneration: 1
    });
    assert.equal(result.status, "conflict");
    assert.equal(result.profile.revision, 4);
    assert.equal(result.conflictProfile.name, "Hero Conflict");
    assert.equal(result.conflictProfile.payload, canonicalStalePayload);
});

test("account quota counts only active encoded bytes", async function() {
    repository.usedBytesResult = 10_485_700;
    await assert.rejects(service.createProfile(auth, seventyByteInput), error => error.extensions.code === 413);
});

test("unverified member cannot read or mutate account storage", async function() {
    await assert.rejects(service.readState({...auth, emailVerified: false}), error => error.extensions.code === 403);
});
```

- [ ] **Step 2: Run repository/service tests and verify missing-module failures**

Run: `node --test test/builder-profile-repository.test.js test/builder-storage-service.test.js test/account-characterization.test.js`
Expected: FAIL on missing repository/service imports.

- [ ] **Step 3: Implement parameterized repository and transactional service**

Use exact case-sensitive name hashes:

```js
function nameHash(name) {
    return crypto.createHash("sha256").update(name, "utf8").digest();
}
```

Every service method must reject unverified auth before querying profiles.
Within `updateProfile`, lock preferences/generation and the profile row. On a
revision match, validate, quota-check the byte delta, update payload/version/
bytes/revision, and return `saved`. On a stale or individually deleted row,
insert a canonical conflict copy using the first available exact name from
`Hero Conflict`, `Hero Conflict 2`, and upward; return both current and copy.
On generation mismatch, return a 409 generation error without creating data.

`deleteProfile` clears `Payload`, `PayloadVersion`, `PayloadBytes`, and
`ActiveNameHash`, sets `DeletedOn`, and increments revision. `deleteAll` locks
preferences, marks every active row deleted, increments `StorageGeneration`,
and commits together.

Refactor authentication to expose:

```js
authenticate(req, token, {renew = false, permissions = false} = {})
```

Storage autosave will call it with `renew:false`; do not rotate the login token
on every save.

- [ ] **Step 4: Run service, auth, and transaction tests**

Run: `node --test test/builder-profile-repository.test.js test/builder-storage-service.test.js test/database.test.js test/account-characterization.test.js`
Expected: PASS.

- [ ] **Step 5: Commit core storage behavior**

```bash
git add www/src/routes/api/builder-profile-repository.js www/src/routes/api/builder-storage-service.js www/src/routes/api/auth.js www/test/builder-profile-repository.test.js www/test/builder-storage-service.test.js www/test/account-characterization.test.js
git commit -m "feat: persist account Builder profiles"
```

---

### Task 4: Implement preferences and idempotent batch import

**Files:**
- Create: `www/src/routes/api/builder-preferences.js`
- Create: `www/src/routes/api/builder-import.js`
- Create: `www/test/builder-preferences.test.js`
- Create: `www/test/builder-import.test.js`
- Modify: `www/src/routes/api/builder-storage-service.js`
- Modify: `www/test/builder-storage-service.test.js`

**Interfaces:**
- Produces: `validatePreferences(payload) -> {version: 1, theme, itemsPerPage, itemColumns, builderColumns, selectedProfileId, selectedVariant}`.
- Produces: `classifyImport({localProfiles, accountProfiles}) -> per-profile actions`.
- Service method: `importProfiles(auth, {idempotencyKey, profiles, preferencePayload, replacePreferences, storageGeneration})`.
- Import result: `{copied, renamed, deduplicated, rejected, preferencesImported, state}`.

- [ ] **Step 1: Write failing preference and import classification tests**

```js
test("preferences whitelist syncable fields", function() {
    assert.deepEqual(validatePreferences(JSON.stringify({
        version: 1, theme: "dark", itemsPerPage: 50,
        itemColumns: ["Name"], builderColumns: {id: ["Slot"]},
        selectedProfileId: "id", selectedVariant: "Tank",
        cookieConsent: true, loginToken: "secret", timezone: 300
    })), expectedWithoutDeviceFields);
});

test("import deduplicates identical data and renames different same-name data", async function() {
    const result = await service.importProfiles(auth, importInput);
    assert.deepEqual(result.deduplicated, ["Same"]);
    assert.deepEqual(result.renamed, [{from: "Hero", to: "Hero Local"}]);
});

test("repeating an import key returns the stored result without new rows", async function() {
    const first = await service.importProfiles(auth, importInput);
    const second = await service.importProfiles(auth, importInput);
    assert.deepEqual(second, first);
    assert.equal(repository.insertCount, first.copied.length + first.renamed.length);
});
```

- [ ] **Step 2: Run preference/import tests and verify missing modules**

Run: `node --test test/builder-preferences.test.js test/builder-import.test.js test/builder-storage-service.test.js`
Expected: FAIL on missing modules and service method.

- [ ] **Step 3: Implement strict preference validation and import transaction**

Accept themes only from the existing nine theme slugs, `itemsPerPage` only
from current supported page sizes, arrays of known nonempty column strings,
and builder-column keys matching active profile IDs. Strip rather than store
`cookieConsent`, `loginToken`, `timezone`, and unknown fields. Serialize one
canonical version-1 document.

Validate every import profile independently before opening the write
transaction. Inside the transaction, return an existing receipt for the same
member/key; lock state and generation; classify canonical payload equality;
insert valid unique profiles; generate `Name Local`, `Name Local 2`, and upward
for collisions; store rejected reasons without raw payloads; optionally write
preferences; store the result receipt; and commit. Enforce the 10 MB quota
across the complete accepted batch before any insert.

- [ ] **Step 4: Run preference, import, and quota tests**

Run: `node --test test/builder-preferences.test.js test/builder-import.test.js test/builder-storage-service.test.js test/builder-payload.test.js`
Expected: PASS.

- [ ] **Step 5: Commit preferences and import**

```bash
git add www/src/routes/api/builder-preferences.js www/src/routes/api/builder-import.js www/src/routes/api/builder-storage-service.js www/test/builder-preferences.test.js www/test/builder-import.test.js www/test/builder-storage-service.test.js
git commit -m "feat: import Builder data and preferences"
```

---

### Task 5: Expose the authenticated GraphQL storage API

**Files:**
- Create: `www/src/routes/api/builder-storage.js`
- Create: `www/test/builder-storage-api.test.js`
- Modify: `www/src/routes/api.js`
- Modify: `www/src/create-app.js`
- Modify: `www/test/characterization.test.js`
- Modify: `www/test/auth-logging.test.js`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Queries: `getBuilderAccountState(authToken: String!): BuilderAccountState!` and `exportBuilderData(authToken: String!): String!`.
- Mutations: `createBuilderProfile`, `updateBuilderProfile`, `deleteBuilderProfile`, `updateBuilderPreferences`, `importBuilderProfiles`, `deleteAllBuilderData`.
- Inputs use explicit GraphQL scalars; preference and result documents are canonical JSON strings rather than an unbounded JSON scalar.
- Profile result fields: `status`, `profile`, `conflictProfile`, `storageGeneration`, `usedBytes`, `quotaBytes`.

- [ ] **Step 1: Write failing GraphQL contract and ownership tests**

```js
test("storage API derives ownership from auth and never exposes MemberId arguments", async function() {
    const fields = require("../src/routes/api/builder-storage");
    for (const operation of Object.values({...fields.queryFields, ...fields.mutationFields}))
        assert.equal(Object.hasOwn(operation.args || {}, "memberId"), false);
});

test("profile conflict returns both safe copies and no raw database error", async function() {
    const result = await mutation.resolve(null, variables, request);
    assert.equal(result.status, "conflict");
    assert.equal(result.profile.name, "Hero");
    assert.equal(result.conflictProfile.name, "Hero Conflict");
});
```

- [ ] **Step 2: Run API tests and verify missing GraphQL module failure**

Run: `node --test test/builder-storage-api.test.js test/characterization.test.js test/auth-logging.test.js`
Expected: FAIL because the module is absent from the schema.

- [ ] **Step 3: Implement thin resolvers and an API-only body limit**

Add `builder-storage.js` to `importGraphs`. Each resolver calls
`authenticate(req, authToken, {renew:false})`, then exactly one service method.
Map 400/409/413/429 errors through existing GraphQL extensions and replace
unexpected SQL messages with `The request could not be completed.`.

`exportBuilderData` reads a fresh authorized snapshot, decodes each active
profile, and returns one canonical current-format string containing all
characters. It returns the current empty-format string when no profiles exist.

Move API parsing ahead of the default parsers:

```js
app.use("/api", express.json({limit: "11mb"}), apiRouter);
app.use(express.json());
app.use(express.urlencoded({extended: false}));
```

Add tests proving `/api` accepts a 10 MB encoded envelope, rejects larger
bodies with 413, and ordinary form routes retain the default small limit.
Update the changelog with account-backed per-character storage, synchronized
preferences, safe conflicts, and the 10 MB account limit.

- [ ] **Step 4: Run the complete backend phase verification**

Run from `www/`:

```bash
npm test
node --test test/builder-storage-api.test.js test/builder-storage-service.test.js test/builder-import.test.js test/builder-payload.test.js
```

Run from the repository root:

```bash
node scripts/verify-release-version.js
git diff --check
```

Expected: all tests pass, version verification prints `3.1.0-beta`, and diff
check is clean.

- [ ] **Step 5: Commit the API phase gate**

```bash
git add www/src/routes/api/builder-storage.js www/src/routes/api.js www/src/create-app.js www/test/builder-storage-api.test.js www/test/characterization.test.js www/test/auth-logging.test.js CHANGELOG.md
git commit -m "feat: expose account Builder storage API"
```

## Phase Completion Gate

Do not begin the client synchronization plan until review confirms:

- Browser and server use one codec implementation and all legacy fixtures pass.
- Migration 9 is retry-safe on MySQL 5.7.
- A member cannot access another member's profile by public ID.
- Stale per-profile edits create a safe conflict copy without touching unrelated characters.
- Delete-all generation blocks stale-tab recreation.
- Import is explicit, per-profile validated, quota-safe, and idempotent.
- Device-only fields never enter `AccountPreferences`.
- The GraphQL API accepts 10 MB and rejects oversized input without widening form-route limits.
- All Task 5 verification commands pass.
