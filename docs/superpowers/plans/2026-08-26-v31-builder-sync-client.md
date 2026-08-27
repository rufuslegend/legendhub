# LegendHUB 3.1 Builder Synchronization Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the Builder and account UI to account-backed storage while preserving complete anonymous use, explicit migration consent, cross-device preferences, and non-destructive conflicts.

**Architecture:** Introduce pure client adapters for account API calls, source selection, migration fingerprints, autosave scheduling, and preference updates. Keep anonymous persistence unchanged and isolated; verified sessions fetch server profiles into memory and never mirror them into anonymous localStorage. Integrate focused React components for migration, sync status, conflicts, storage usage, export, and delete-all, then verify with two independent browser contexts.

**Tech Stack:** React 19, Vite 8, GraphQL fetch client, Web Crypto, browser localStorage/cookies, Node test runner, Playwright/axe.

**Spec:** `docs/superpowers/specs/2026-08-26-v31-account-storage-design.md`

## Global Constraints

- Complete Plans 1 and 2 before starting this plan.
- Anonymous and unverified players retain current localStorage/cookie behavior.
- Verified account profiles stay in memory/server state and are never copied into anonymous `cln` automatically.
- Anonymous import requires an explicit player action and never deletes the local source.
- Unchanged anonymous data is not offered repeatedly after import or dismissal.
- Account autosave waits 750 ms after the last edit.
- Retry delays are 1, 2, 4, 8, 16, then at most 30 seconds.
- Authentication, validation, quota, revision, and generation errors do not retry automatically.
- Logout immediately hides account data and restores prior anonymous state.
- Cookie consent, login tokens, and timezone remain device-only.
- Sync status and every new dialog/error must be keyboard accessible and announced.
- Do not push, publish, deploy, tag, or alter production Compose during implementation.

## File Structure

- `www/client/features/builder/builder-account-api.js`: exact GraphQL account-storage calls.
- `www/client/features/builder/builder-source.js`: pure anonymous/account initial-load selection and profile conversion.
- `www/client/features/builder/builder-migration.js`: fingerprinting, preview classification, acknowledgement, and import request construction.
- `www/client/features/builder/builder-sync-controller.js`: debounced per-profile save queue and bounded retry policy.
- `www/client/features/builder/BuilderMigrationDialog.jsx`: explicit import choices and result report.
- `www/client/features/builder/BuilderSyncStatus.jsx`: accessible mode/save/conflict status.
- `www/client/lib/account-preferences-store.js`: page-local canonical preference state and save serialization.
- `www/client/features/account/BuilderStorageManager.jsx`: usage, export-all, and delete-all UI.
- Existing `Builder.jsx`, Item Search, theme menu, and account settings consume those focused modules.

---

### Task 1: Add account API and source-selection boundaries

**Files:**
- Create: `www/client/features/builder/builder-account-api.js`
- Create: `www/client/features/builder/builder-source.js`
- Create: `www/test/client/builder-account-api.test.js`
- Create: `www/test/client/builder-source.test.js`
- Modify: `www/src/routes/builder.js`
- Modify: `www/src/views/builder/index.ejs`
- Modify: `www/test/characterization.test.js`

**Interfaces:**
- Produces API functions: `loadBuilderAccountState`, `exportAccountBuilderData`, `createAccountProfile`, `updateAccountProfile`, `deleteAccountProfile`, `importAccountProfiles`, `updateAccountPreferences`, and `deleteAllAccountBuilderData`.
- Produces: `loadBuilderSource({accountContext, loadAccount, readAnonymous, decode}) -> {mode, profiles, preferences, anonymousSnapshot, accountState}`.
- Produces Builder prop `accountContext: {authenticated, emailVerified, canUseAccountStorage, storageNamespace}`; no email address is embedded in Builder markup.

- [ ] **Step 1: Write failing API-variable and source-isolation tests**

```js
test("verified source loads account profiles without returning anonymous profiles", async function() {
    const result = await loadBuilderSource({
        accountContext: {canUseAccountStorage: true},
        loadAccount: async () => accountState,
        readAnonymous: () => anonymousSnapshot,
        decode: decodeProfiles
    });
    assert.equal(result.mode, "account");
    assert.deepEqual(result.profiles, decodedAccountProfiles);
    assert.equal(result.anonymousSnapshot, anonymousSnapshot);
});

test("anonymous source never calls the account API", async function() {
    let calls = 0;
    const result = await loadBuilderSource({
        accountContext: {canUseAccountStorage: false},
        loadAccount: async () => { calls++; },
        readAnonymous: () => anonymousSnapshot,
        decode: decodeProfiles
    });
    assert.equal(result.mode, "anonymous");
    assert.equal(calls, 0);
});
```

- [ ] **Step 2: Run tests and verify missing-module failures**

Run: `node --test test/client/builder-account-api.test.js test/client/builder-source.test.js test/characterization.test.js` from `www/`.
Expected: FAIL on the two new imports.

- [ ] **Step 3: Implement API calls and route-provided eligibility**

Every API call reads `loginToken` from `document.cookie`, uses one mutation,
and sends no member ID. `loadBuilderAccountState` requests profile ID, name,
payload, version, revision, updated time, preferences, preference revision,
storage generation, used bytes, and quota bytes.

```js
export async function loadBuilderSource({accountContext, loadAccount, readAnonymous, decode}) {
    const anonymousSnapshot = readAnonymous();
    if (!accountContext.canUseAccountStorage) {
        return {
            mode: "anonymous",
            profiles: decode(anonymousSnapshot.encodedLists),
            preferences: anonymousSnapshot,
            anonymousSnapshot,
            accountState: null
        };
    }
    const accountState = await loadAccount();
    return {
        mode: "account",
        profiles: accountState.profiles.map(profile => ({
            ...decode(profile.payload)[0],
            account: {id: profile.id, revision: profile.revision, updatedOn: profile.updatedOn}
        })),
        preferences: JSON.parse(accountState.preferences),
        anonymousSnapshot,
        accountState
    };
}
```

The Builder route derives eligibility only from `res.locals.user`; unverified
and anonymous users receive a false context. Serialize no email address or
token into HTML.

- [ ] **Step 4: Run API, source, route, and build tests**

Run: `node --test test/client/builder-account-api.test.js test/client/builder-source.test.js test/characterization.test.js test/client-build.test.js`
Expected: PASS.

- [ ] **Step 5: Commit client boundaries**

```bash
git add www/client/features/builder/builder-account-api.js www/client/features/builder/builder-source.js www/src/routes/builder.js www/src/views/builder/index.ejs www/test/client/builder-account-api.test.js www/test/client/builder-source.test.js www/test/characterization.test.js
git commit -m "feat: select anonymous or account Builder storage"
```

---

### Task 2: Integrate account state without changing anonymous persistence

**Files:**
- Modify: `www/client/features/builder/Builder.jsx`
- Modify: `www/client/features/builder/builder-reducer.js`
- Modify: `www/client/features/builder/builder-persistence.js`
- Modify: `www/test/client/builder-reducer.test.js`
- Modify: `www/test/client/builder-persistence.test.js`
- Modify: `www/accessibility/react-builder.spec.js`

**Interfaces:**
- Builder state gains `storageMode`, `accountState`, `syncStatus`, `syncMessage`, and per-list `account` metadata.
- Produces reducer actions: `source/loaded`, `account/profile-saved`, `account/profile-conflicted`, `account/profile-deleted`, `account/generation-changed`, and `sync/status`.
- Anonymous `createBuilderPersistencePlan` remains byte-for-byte compatible.

- [ ] **Step 1: Write failing reducer and persistence-separation tests**

```js
test("account source keeps stable profile metadata through character rename", function() {
    let state = createInitialBuilderState();
    state = builderReducer(state, {type: "source/loaded", mode: "account", profiles: accountProfiles, accountState});
    state = builderReducer(state, {type: "character/rename", name: "Renamed"});
    assert.equal(state.allLists[0].account.id, "profile-id");
    assert.equal(state.allLists[0].account.revision, 4);
});

test("account mode never creates an anonymous persistence plan", function() {
    assert.equal(createBuilderPersistencePlan({...input, storageMode: "account"}), null);
});
```

- [ ] **Step 2: Run Builder state tests and verify failures**

Run: `node --test test/client/builder-reducer.test.js test/client/builder-persistence.test.js`
Expected: FAIL because storage mode and account metadata are absent.

- [ ] **Step 3: Load the selected source and preserve its identity**

Replace the Builder startup's direct localStorage read with
`loadBuilderSource`. Keep item hydration after source decoding. An account
initial-load failure must show a Retry action and must not fall back to or
overwrite anonymous data. If the verified account has no profiles, create an
in-memory `Untitled` character marked `account: {id:null, revision:0}` so the
sync controller creates it after the first edit.

Guard the existing persistence effect:

```js
if (state.storageMode !== "anonymous")
    return;
```

Preserve `account` metadata in every character-level reducer action and remove
it from export/import strings. Logout is naturally isolated because a new
anonymous render reads only localStorage.

- [ ] **Step 4: Run reducer, persistence, Builder accessibility, and build tests**

Run: `node --test test/client/builder-reducer.test.js test/client/builder-persistence.test.js test/client-build.test.js`
Run: `npm run test:a11y -- --grep "Builder startup|saved Builder"`
Expected: PASS; existing anonymous localStorage assertions remain unchanged.

- [ ] **Step 5: Commit source integration**

```bash
git add www/client/features/builder/Builder.jsx www/client/features/builder/builder-reducer.js www/client/features/builder/builder-persistence.js www/test/client/builder-reducer.test.js www/test/client/builder-persistence.test.js www/accessibility/react-builder.spec.js
git commit -m "feat: load account-backed Builder profiles"
```

---

### Task 3: Add explicit local-data migration and fingerprint acknowledgement

**Files:**
- Create: `www/client/features/builder/builder-migration.js`
- Create: `www/client/features/builder/BuilderMigrationDialog.jsx`
- Create: `www/test/client/builder-migration.test.js`
- Modify: `www/client/features/builder/Builder.jsx`
- Modify: `www/client/features/builder/builder-reducer.js`
- Modify: `www/test/client/builder-reducer.test.js`
- Modify: `www/accessibility/react-builder.spec.js`

**Interfaces:**
- Produces: `fingerprintAnonymousData(snapshot, crypto) -> Promise<hexSha256>`.
- Produces: `migrationAcknowledgementKey(storageNamespace) -> "legendhub-builder-import:<namespace>"`.
- Produces: `shouldOfferMigration({snapshot, fingerprint, acknowledgedFingerprint}) -> boolean`.
- Produces: `buildImportRequest({snapshot, preferencesChoice, storageGeneration})`.
- Dialog result actions: `migration/dismissed`, `migration/requested`, `migration/succeeded`, `migration/failed`.

- [ ] **Step 1: Write failing fingerprint, offer, and request tests**

```js
test("unchanged acknowledged anonymous data is not offered twice", async function() {
    const fingerprint = await fingerprintAnonymousData(snapshot, webCrypto);
    assert.equal(shouldOfferMigration({snapshot, fingerprint, acknowledgedFingerprint: fingerprint}), false);
    assert.equal(shouldOfferMigration({snapshot: changedSnapshot, fingerprint: changedFingerprint, acknowledgedFingerprint: fingerprint}), true);
});

test("migration request strips device-only values", function() {
    const request = buildImportRequest({snapshot, preferencesChoice: "browser", storageGeneration: 3});
    assert.equal(Object.hasOwn(request.preferences, "cookieConsent"), false);
    assert.equal(Object.hasOwn(request.preferences, "loginToken"), false);
    assert.equal(Object.hasOwn(request.preferences, "timezone"), false);
});
```

- [ ] **Step 2: Run migration tests and verify missing-module failures**

Run: `node --test test/client/builder-migration.test.js test/client/builder-reducer.test.js`
Expected: FAIL because migration helpers and state do not exist.

- [ ] **Step 3: Implement explicit copy, preference choice, and result report**

Fingerprint canonical anonymous list payload plus syncable preferences with
`crypto.subtle.digest("SHA-256", ...)`. Store only the hex fingerprint under
the opaque namespace key. Offer the dialog when a verified account and
nonempty anonymous snapshot coexist and the fingerprint differs.

The dialog lists local character names, states that data will be copied and
the browser source retained, and makes **Copy all to my account** the primary
action. Default preference choice to browser only when account preferences are
absent; otherwise default to account. Dismissal and successful import both
write the fingerprint. Failure writes no acknowledgement.

Render copied, renamed (`Name Local`), deduplicated, and rejected results
without including raw payload text. Dispatch `source/loaded` with the returned
account state after success.

- [ ] **Step 4: Run migration unit and accessibility tests**

Run: `node --test test/client/builder-migration.test.js test/client/builder-reducer.test.js`
Run: `npm run test:a11y -- --grep "local Builder data|migration"`
Expected: PASS, including focus entering the dialog and returning to its trigger.

- [ ] **Step 5: Commit migration UX**

```bash
git add www/client/features/builder/builder-migration.js www/client/features/builder/BuilderMigrationDialog.jsx www/client/features/builder/Builder.jsx www/client/features/builder/builder-reducer.js www/test/client/builder-migration.test.js www/test/client/builder-reducer.test.js www/accessibility/react-builder.spec.js
git commit -m "feat: migrate local Builder data into accounts"
```

---

### Task 4: Add autosave, retries, conflict copies, and sync status

**Files:**
- Create: `www/client/features/builder/builder-sync-controller.js`
- Create: `www/client/features/builder/BuilderSyncStatus.jsx`
- Create: `www/test/client/builder-sync-controller.test.js`
- Modify: `www/client/features/builder/Builder.jsx`
- Modify: `www/client/features/builder/builder-reducer.js`
- Modify: `www/test/client/builder-reducer.test.js`
- Modify: `www/accessibility/react-builder.spec.js`

**Interfaces:**
- Produces: `createBuilderSyncController({saveProfile, deleteProfile, schedule, cancel, onResult, onStatus})`.
- Controller methods: `queue(snapshot)`, `remove(profile)`, `flush()`, `dispose()`.
- A snapshot is `{id, name, payload, revision, storageGeneration, fingerprint}`.
- Status values: `browser`, `saving`, `saved`, `problem`, `conflict`, `generation-changed`.

- [ ] **Step 1: Write failing scheduler and conflict tests with a fake clock**

```js
test("multiple edits save once 750 ms after the last edit", async function() {
    controller.queue(first);
    clock.tick(500);
    controller.queue(second);
    clock.tick(749);
    assert.equal(saves.length, 0);
    clock.tick(1);
    await clock.flush();
    assert.deepEqual(saves, [second]);
});

test("network retries use bounded delays and validation never retries", async function() {
    saveProfile.rejectWith(networkError, networkError, success);
    controller.queue(snapshot);
    await clock.runAll();
    assert.deepEqual(clock.delays, [750, 1000, 2000]);
    saveProfile.rejectWith(validationError);
    controller.queue(changedSnapshot);
    await clock.runAll();
    assert.equal(saveProfile.callsFor(changedSnapshot), 1);
});
```

- [ ] **Step 2: Run sync tests and verify the absent controller failure**

Run: `node --test test/client/builder-sync-controller.test.js test/client/builder-reducer.test.js`
Expected: FAIL on missing controller and actions.

- [ ] **Step 3: Implement per-profile queues and UI result handling**

Derive one canonical snapshot per character after each account-mode reducer
change. Compare fingerprints so selecting a character without modifying it
does not save the profile. Queue changed profiles independently; creation uses
`createAccountProfile`, existing IDs use `updateAccountProfile`, and deletion
uses `deleteAccountProfile` immediately after confirmation.

On `saved`, update ID/revision/generation metadata. On `conflict`, replace the
original with the returned server profile, append the returned `Name Conflict`
copy, select neither automatically, and show a persistent notice. On
generation conflict, stop every queue, show an export-first message, and never
recreate deleted data. Keep network-failed edits in reducer memory.

`BuilderSyncStatus` renders **Saved in this browser** in anonymous mode and an
`aria-live="polite"` account status for saving/saved/problem. Conflict and
generation errors use `role="alert"` and focusable recovery actions.

- [ ] **Step 4: Run sync, reducer, build, and accessibility tests**

Run: `node --test test/client/builder-sync-controller.test.js test/client/builder-reducer.test.js test/client-build.test.js`
Run: `npm run test:a11y -- --grep "Saving|Sync problem|conflict"`
Expected: PASS.

- [ ] **Step 5: Commit autosave and conflicts**

```bash
git add www/client/features/builder/builder-sync-controller.js www/client/features/builder/BuilderSyncStatus.jsx www/client/features/builder/Builder.jsx www/client/features/builder/builder-reducer.js www/test/client/builder-sync-controller.test.js www/test/client/builder-reducer.test.js www/accessibility/react-builder.spec.js
git commit -m "feat: autosave Builder profiles safely"
```

---

### Task 5: Synchronize theme, columns, paging, and selections

**Files:**
- Create: `www/client/lib/account-preferences-store.js`
- Create: `www/test/client/account-preferences-store.test.js`
- Modify: `www/src/routes/auth.js`
- Modify: `www/src/views/shared/meta.ejs`
- Modify: `www/src/views/shared/scripts.ejs`
- Modify: `www/client/entries/shell.js`
- Modify: `www/client/lib/theme-menu.js`
- Modify: `www/client/features/items/ItemSearch.jsx`
- Modify: `www/client/features/builder/Builder.jsx`
- Modify: `www/client/features/builder/builder-persistence.js`
- Modify: `www/test/client/theme-menu.test.js`
- Modify: `www/test/client/item-search-reducer.test.js`
- Modify: `www/test/client/builder-persistence.test.js`
- Modify: `www/test/theme-menu.test.js`

**Interfaces:**
- Produces: `createAccountPreferencesStore({initialState, save, schedule, onStatus})` with `get`, `patch`, `subscribe`, `flush`, and `dispose`.
- Server embeds `accountPreferenceContext: {enabled, payload, revision, storageGeneration}` in escaped JSON; it contains no email or token.
- Preference patch keys: `theme`, `itemsPerPage`, `itemColumns`, `builderColumns`, `selectedProfileId`, `selectedVariant`.

- [ ] **Step 1: Write failing serialization and last-write tests**

```js
test("preference store merges page patches and saves one canonical document", async function() {
    store.patch({theme: "dark"});
    store.patch({itemsPerPage: 50, selectedProfileId: "profile"});
    clock.tick(750);
    await clock.flush();
    assert.deepEqual(saved[0].document, {
        version: 1, theme: "dark", itemsPerPage: 50,
        itemColumns: initial.itemColumns, builderColumns: initial.builderColumns,
        selectedProfileId: "profile", selectedVariant: initial.selectedVariant
    });
});

test("account theme wins during server render and anonymous theme still uses cookie", function() {
    assert.match(renderMeta({accountTheme: "dark", cookieTheme: "light"}), /bootstrap-dark/);
    assert.match(renderMeta({accountTheme: null, cookieTheme: "light"}), /bootstrap-light/);
});
```

- [ ] **Step 2: Run preference and existing cookie tests**

Run: `node --test test/client/account-preferences-store.test.js test/client/theme-menu.test.js test/client/builder-persistence.test.js test/theme-menu.test.js`
Expected: FAIL because the store and account render context are absent.

- [ ] **Step 3: Implement account preference bootstrap and page adapters**

Join `AccountPreferences` into authenticated page context after Plan 2's
migration exists. Parse only the canonical document and expose it through a
JSON script block. `meta.ejs` chooses verified account theme first, then the
anonymous cookie, avoiding a cross-device theme flash.

The shell creates one preference store per page. Theme choices patch `theme`
in account mode and retain current consent-gated cookies in anonymous mode.
Item Search patches `itemColumns`; Builder patches items-per-page,
per-profile columns, selected stable profile ID, and selected variant. Account
preference saves use the same 750 ms delay and report failures independently
from profile sync. Timezone and cookie consent never enter patches.

- [ ] **Step 4: Run preference, theme, Item Search, Builder, and build tests**

Run: `node --test test/client/account-preferences-store.test.js test/client/theme-menu.test.js test/client/item-search-reducer.test.js test/client/builder-persistence.test.js test/theme-menu.test.js test/client-build.test.js`
Expected: PASS, including unchanged anonymous cookie behavior.

- [ ] **Step 5: Commit cross-device preferences**

```bash
git add www/client/lib/account-preferences-store.js www/src/routes/auth.js www/src/views/shared/meta.ejs www/src/views/shared/scripts.ejs www/client/entries/shell.js www/client/lib/theme-menu.js www/client/features/items/ItemSearch.jsx www/client/features/builder/Builder.jsx www/client/features/builder/builder-persistence.js www/test/client/account-preferences-store.test.js www/test/client/theme-menu.test.js www/test/client/item-search-reducer.test.js www/test/client/builder-persistence.test.js www/test/theme-menu.test.js
git commit -m "feat: sync account preferences across browsers"
```

---

### Task 6: Add account storage management, export, and delete-all

**Files:**
- Create: `www/client/features/account/BuilderStorageManager.jsx`
- Create: `www/test/client/builder-storage-manager.test.js`
- Modify: `www/src/routes/account.js`
- Modify: `www/src/views/account/index.ejs`
- Modify: `www/client/features/account/account-api.js`
- Modify: `www/client/features/account/account-reducer.js`
- Modify: `www/client/features/account/AccountSettings.jsx`
- Modify: `www/test/client/account-reducer.test.js`
- Modify: `www/accessibility/account-email.spec.js`

**Interfaces:**
- Account props gain `builderStorage: {enabled, profiles, usedBytes, quotaBytes, storageGeneration}`.
- Consumes: `exportAccountBuilderData() -> current versioned compact string` from Task 1 and Plan 2's `exportBuilderData` query.
- Produces reducer actions: `storage/delete-requested`, `storage/delete-succeeded`, `storage/delete-failed`, and `storage/dialog-closed`.

- [ ] **Step 1: Write failing export and delete confirmation tests**

```js
test("export all downloads the fresh canonical account payload", async function() {
    api.exportAccountBuilderData.resolve("6*Hero~Original~encoded*");
    const value = await clickExportAll();
    assert.match(value, /^6\*/);
    assert.equal(api.exportAccountBuilderData.calls, 1);
});

test("delete all requires a separate confirmation before calling the API", async function() {
    renderStorageManager();
    click("Delete all synced Builder data");
    assert.equal(apiCalls.length, 0);
    click("Permanently delete synced Builder data");
    assert.equal(apiCalls.length, 1);
});
```

- [ ] **Step 2: Run account storage UI tests and verify missing component failure**

Run: `node --test test/client/builder-storage-manager.test.js test/client/account-reducer.test.js`
Expected: FAIL because the manager and reducer state do not exist.

- [ ] **Step 3: Implement usage, export, and generation-safe delete**

Show human-readable used/10 MB values only for verified accounts. Export
requests a fresh canonical combined payload from the protected API and then
downloads `legendhub-builder-YYYY-MM-DD.txt`. The response is kept in memory
only long enough to create and revoke the download object URL.

Delete-all opens an accessible confirmation dialog, calls the generation-
checked API only from its destructive confirm button, clears displayed
profiles after success, and shows the returned incremented generation. It
does not remove anonymous data or the migration fingerprint. Failure retains
all UI state and focuses an error message.

- [ ] **Step 4: Run account UI and accessibility tests**

Run: `node --test test/client/builder-storage-manager.test.js test/client/account-reducer.test.js test/client-build.test.js`
Run: `npm run test:a11y -- --grep "Builder storage|Delete all|Export all"`
Expected: PASS.

- [ ] **Step 5: Commit storage management**

```bash
git add www/client/features/account/BuilderStorageManager.jsx www/src/routes/account.js www/src/views/account/index.ejs www/client/features/account/account-api.js www/client/features/account/account-reducer.js www/client/features/account/AccountSettings.jsx www/test/client/builder-storage-manager.test.js www/test/client/account-reducer.test.js www/accessibility/account-email.spec.js
git commit -m "feat: manage account Builder storage"
```

---

### Task 7: Verify work/home behavior and complete release documentation

**Files:**
- Create: `www/accessibility/account-builder-sync.spec.js`
- Modify: `www/test/smoke.test.js`
- Modify: `scripts/test/mysql-backup-cron.test.js`
- Modify: `scripts/test/production-preflight.test.js`
- Modify: `scripts/preflight-production.sh`
- Modify: `CHANGELOG.md`
- Modify: `docs/superpowers/specs/2026-08-26-v31-account-storage-design.md`

**Interfaces:**
- Two Playwright contexts represent work and home with independent cookies/localStorage but one verified account.
- Production preflight adds public 200 checks for `/forgot-password.html` and the verification landing route without submitting actions.

- [ ] **Step 1: Write the failing two-browser acceptance journey**

```js
test("verified Builder data follows the player between work and home", async ({browser}) => {
    const work = await browser.newContext();
    const home = await browser.newContext();
    await loginVerified(work, account);
    await loginVerified(home, account);
    await createCharacter(work, "Work Hero");
    await expectSyncStatus(work, "Saved to account");
    await openBuilder(home);
    await expectCharacter(home, "Work Hero");
});

test("simultaneous edits preserve a conflict copy", async ({browser}) => {
    const {work, home} = await openSameProfileInTwoContexts(browser);
    await editVariant(work, "Work Edit");
    await expectSyncStatus(work, "Saved to account");
    await editVariant(home, "Home Edit");
    await expectCharacter(home, "Hero Conflict");
    await expectCharacter(home, "Hero");
});
```

Also cover: anonymous-only use, unverified sync denial, explicit import,
dedupe/rename/rejection report, network retry, logout restoring anonymous
data, preference following, and delete-all stale-tab rejection.

- [ ] **Step 2: Run the new acceptance suite and verify remaining gaps**

Run: `npm run test:a11y -- --grep "account Builder sync"` from `www/`.
Expected: FAIL on any integration not completed by Tasks 1–6; fix only the responsible focused module and add its unit regression before rerunning.

- [ ] **Step 3: Complete operational coverage and player documentation**

Assert database backups include `AccountActionTokens`, `BuilderProfiles`,
`AccountPreferences`, and `BuilderImportReceipts` and still exclude only the
intentionally ignored ephemeral tables. Add read-only preflight route checks
for recovery/verification landing pages. Do not make preflight send mail or
create an account.

Consolidate the 3.1 changelog into player-friendly Added/Changed/Fixed bullets
covering verified email, recovery, anonymous continuity, explicit migration,
autosave, work/home access, synced preferences, conflict preservation, export,
and delete-all. Update the design status to `Implemented` only after every
verification below passes.

- [ ] **Step 4: Run the complete release-candidate verification**

Run from `www/`:

```bash
npm test
npm run test:a11y
npm audit --audit-level=critical
```

Run from `css/`:

```bash
npm test
npm audit --audit-level=critical
```

Run from the repository root:

```bash
node --test scripts/test/*.test.js
python3 -m unittest discover -s mysql/test
node scripts/verify-release-version.js
git diff --check
docker compose -f docker-compose.yaml -f docker-compose.local.yaml config --quiet
docker compose -f docker-compose.yaml -f docker-compose.registry.yaml config --quiet
```

Expected: all test suites pass, both audits report zero critical
vulnerabilities, Compose validates, version verification prints
`3.1.0-beta`, and diff check is clean.

- [ ] **Step 5: Commit the completed 3.1 feature**

```bash
git add www/accessibility/account-builder-sync.spec.js www/test/smoke.test.js scripts/test/mysql-backup-cron.test.js scripts/test/production-preflight.test.js scripts/preflight-production.sh CHANGELOG.md docs/superpowers/specs/2026-08-26-v31-account-storage-design.md
git commit -m "feat: complete cross-device Builder storage"
```

## Release Handoff Gate

Implementation is complete only when review confirms:

- Anonymous Builder behavior and deployed legacy formats remain intact.
- Verified work/home contexts converge without sharing browser storage.
- Migration never silently uploads or removes anonymous data.
- Profile autosave, network failure, conflicts, quota errors, and generation errors display truthful accessible status.
- Theme, columns, paging, and last selections follow the account; consent, login token, and timezone do not.
- Logout reveals only the browser's prior anonymous state.
- Export and delete-all are independently usable and stale tabs cannot undo delete-all.
- Full Task 7 verification passes on the implementation commit.
- Dunwich deployment remains a separately authorized action after code review.
- Production remains command-only for the maintainer and requires separate release authorization.
