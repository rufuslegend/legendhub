# Builder Shared Column Layouts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Builder export strings carry each character's visible-column layout, and importing a character the player does not already have shows the sharer's columns.

**Architecture:** The shared codec gains a share format (version 8) that is the version 7 build segments followed by `~Character~Col-Col` column segments; saved payloads stay at version 7. The React Builder encodes columns into the three Export fields and, on import, applies shared columns to new characters through the existing column-persistence paths (per-character cookie in anonymous mode, per-profile account preference in account mode).

**Tech Stack:** Node `node --test` unit tests, React 18 Builder (`www/client/features/builder`), shared ESM codec (`www/shared/builder-codec.mjs`), Playwright end-to-end tests (`www/e2e`).

Spec: `docs/superpowers/specs/2026-10-15-builder-shared-columns-design.md`.

## Global Constraints

- Branch: `feat/builder-shared-columns` (cut from `fix/builder-import-selection`). Do not commit to `master`.
- `BUILDER_LIST_VERSION` stays `7`. Saved payloads (cookie `cln`, account profiles, sync baselines) must still start with `7*`. Only Export fields emit `8*`.
- Version 7 and older import strings must decode exactly as before.
- Column segment grammar: `~<character name>~<Short>-<Short>-...`, one per character, after the build segments. Shorts are `ItemStatInfo.Short` values (letters, digits, spaces).
- Imported shared columns apply only when the imported character does not already exist in the importer's lists. Existing characters keep the importer's columns.
- Unknown column shorts are dropped silently on import.
- Every player-facing change updates root `CHANGELOG.md` under `[4.0.0-beta]` and `docs/user-manual.md` in the same branch.
- Run unit tests from `www/` with `npm test`. Run end-to-end tests from `www/` with `npm run test:e2e -- e2e/builder-transfer.spec.js`.
- No deployment, tagging, or pushing is part of this plan.

---

### Task 1: Codec share format (encode and decode)

**Files:**
- Modify: `www/shared/builder-codec.mjs`
- Modify: `www/client/features/builder/builder-encoding.js`
- Test: `www/test/client/builder-encoding.test.js`
- Modify: `docs/superpowers/specs/2026-10-15-builder-shared-columns-design.md` (version-constant amendment)

**Interfaces:**
- Produces: `export const BUILDER_SHARE_VERSION = 8`
- Produces: `encodeBuilderShare(lists, columnsByCharacter = {}) -> string` where `lists` is `[{name, variants: [...]}]` (same shape `encodeBuilderLists` takes) and `columnsByCharacter` is `{[characterName]: string[]}`.
- Produces: `decodeBuilderShare(value) -> {entries, columns}` where `entries` is exactly what `decodeBuilderEntries(value)` returns (one entry per build segment, not merged) and `columns` is `{[characterName]: string[]}` (empty object when no column segments).
- `decodeBuilderEntries`, `decodeBuilderLists`, `encodeBuilderLists`, `readBuilderFormatVersion` keep their current signatures and return shapes. `decodeBuilderEntries` and `decodeBuilderLists` accept version 8 input and ignore column segments.

- [ ] **Step 1: Write the failing tests**

Append to `www/test/client/builder-encoding.test.js` (the file already defines `baseStats`, `blanks37`, `loadEncoding`, `loadSharedCodec`):

```js
const buildSegment = (name, variant = "Original") =>
    `${name}~${variant}~${baseStats}000000___00000000000000000${blanks37}`;

// Catches share strings that drop, reorder, or misattribute a character's
// column layout, or that leak column segments into saved-payload decoding.
test("share strings append one column segment per character and decode back to the same builds", async function() {
    const {decodeBuilderLists, decodeBuilderShare, encodeBuilderLists, encodeBuilderShare, readBuilderFormatVersion} = await loadEncoding();
    const lists = decodeBuilderLists(`7*${buildSegment("Hero")}*${buildSegment("Hero", "Caster")}*${buildSegment("Scout")}*`);
    const columns = {Hero: ["Name", "Ac", "Ma Redux"], Scout: [], Stranger: ["Rent"]};

    const encoded = encodeBuilderShare(lists, columns);

    assert.equal(encoded,
        `8*${buildSegment("Hero")}*${buildSegment("Hero", "Caster")}*${buildSegment("Scout")}*~Hero~Name-Ac-Ma Redux*`);
    assert.equal(readBuilderFormatVersion(encoded), 8);
    const share = decodeBuilderShare(encoded);
    assert.equal(share.entries.length, 3);
    assert.deepEqual(share.entries.map(entry => [entry.name, entry.variants[0].name]),
        [["Hero", "Original"], ["Hero", "Caster"], ["Scout", "Original"]]);
    assert.deepEqual(share.columns, {Hero: ["Name", "Ac", "Ma Redux"]});
    assert.deepEqual(decodeBuilderLists(encoded), lists);
    assert.match(encodeBuilderLists(decodeBuilderLists(encoded)), /^7\*/);
});

// Catches the share decoder rejecting plain version 7 strings or accepting
// column segments on versions that never defined them.
test("share decoding tolerates older strings and rejects malformed column segments", async function() {
    const {decodeBuilderShare, encodeBuilderShare} = await loadEncoding();
    const seven = `7*${buildSegment("Hero")}*`;

    assert.deepEqual(decodeBuilderShare(seven).columns, {});
    assert.equal(decodeBuilderShare(seven).entries.length, 1);
    assert.equal(decodeBuilderShare(`8*${buildSegment("Hero")}*`).entries.length, 1);
    assert.deepEqual(decodeBuilderShare(`8*${buildSegment("Hero")}*`).columns, {});
    assert.equal(encodeBuilderShare([]), "8*");
    assert.throws(() => decodeBuilderShare(`7*${buildSegment("Hero")}*~Hero~Name*`), /Invalid list/);
    assert.throws(() => decodeBuilderShare(`8*${buildSegment("Hero")}*~Hero~*`), /Invalid list/);
    assert.throws(() => decodeBuilderShare(`8*${buildSegment("Hero")}*~Hero*`), /Invalid list/);
    assert.throws(() => decodeBuilderShare(`8*${buildSegment("Hero")}*~Hero~Na~me*`), /Invalid list/);
    assert.throws(() => decodeBuilderShare(`9*${buildSegment("Hero")}*`), /Invalid list/);
});

// Catches the client compatibility module exporting a different share codec than the server.
test("client share codec matches the shared module", async function() {
    const compatibility = await loadEncoding();
    const shared = await loadSharedCodec();
    const lists = shared.decodeBuilderLists(`7*${buildSegment("Hero")}*`);
    const encoded = shared.encodeBuilderShare(lists, {Hero: ["Name", "Rent"]});

    assert.equal(compatibility.encodeBuilderShare(lists, {Hero: ["Name", "Rent"]}), encoded);
    assert.deepEqual(compatibility.decodeBuilderShare(encoded), shared.decodeBuilderShare(encoded));
    assert.equal(compatibility.BUILDER_SHARE_VERSION, 8);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run from `www/`: `node --test test/client/builder-encoding.test.js`
Expected: the three new tests FAIL (`encodeBuilderShare is not a function` or similar); all existing tests in the file PASS.

- [ ] **Step 3: Implement the codec changes**

In `www/shared/builder-codec.mjs`, directly under `export const BUILDER_LIST_VERSION = 7;` add:

```js
export const BUILDER_SHARE_VERSION = 8;
```

Add this helper after `takeSelection`:

```js
function decodeColumnSegment(segment) {
    const [name, encoded] = takeName(segment.slice(1));
    const columns = encoded.split("-").filter(Boolean);
    if (!columns.length || !columns.every(column => /^[A-Za-z\d ]+$/.test(column)))
        invalidList();
    return [name, columns];
}
```

Replace the whole `decodeEntries` function with:

```js
function decodeShare(value) {
    if (!value)
        return {entries: [], columns: {}};
    let encoded = value;
    const version = readBuilderFormatVersion(encoded);
    if (version !== null)
        encoded = encoded.slice(encoded.indexOf("*") + 1);
    if (version !== null && (version < 1 || version > BUILDER_SHARE_VERSION))
        invalidList();

    const entries = [];
    const columns = {};
    for (const listString of encoded.split("*").filter(Boolean)) {
        if (listString[0] === "~") {
            if (version === null || version < BUILDER_SHARE_VERSION)
                invalidList();
            const [name, selected] = decodeColumnSegment(listString);
            columns[name] = selected;
            continue;
        }
        let decoded;
        if (version === 1)
            decoded = decodeLegacy(listString);
        else if (version > 1)
            decoded = decodeCompact(listString, version);
        else {
            try {
                decoded = decodeCompact(listString, 2);
            } catch (error) {
                decoded = decodeLegacy(listString);
            }
        }
        if (version === null || version <= 6)
            decoded.variants[0].items = upgradeLegacyItems(decoded.variants[0].items);
        entries.push(decoded);
    }
    return {entries, columns};
}

function decodeEntries(value) {
    return decodeShare(value).entries;
}

export function decodeBuilderShare(value) {
    return decodeShare(value);
}
```

(`decodeCompact(listString, 8)` already uses the version 7 slot layout because its checks are `version >= 7`.)

After `encodeBuilderLists` add:

```js
export function encodeBuilderShare(lists, columnsByCharacter = {}) {
    const prefix = `${BUILDER_LIST_VERSION}*`;
    let encoded = `${BUILDER_SHARE_VERSION}*${encodeBuilderLists(lists).slice(prefix.length)}`;
    const seen = new Set();
    for (const list of lists) {
        if (seen.has(list.name))
            continue;
        seen.add(list.name);
        const columns = (columnsByCharacter[list.name] || []).filter(Boolean);
        if (columns.length)
            encoded += `~${list.name}~${columns.join("-")}*`;
    }
    return encoded;
}
```

Replace `www/client/features/builder/builder-encoding.js` with:

```js
export {
    BUILDER_SHARE_VERSION,
    decodeBuilderEntries,
    decodeBuilderLists,
    decodeBuilderShare,
    encodeBuilderLists,
    encodeBuilderShare,
    encodeBuilderVariant,
    fromBase62,
    readBuilderFormatVersion,
    toBase62
} from "../../../shared/builder-codec.mjs";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run from `www/`: `node --test test/client/builder-encoding.test.js`
Expected: all tests PASS, including the three new ones.

Then run the full unit suite from `www/`: `npm test`
Expected: PASS (no test asserts anything about version 8 yet, and version 7 output is unchanged).

- [ ] **Step 5: Amend the spec for the version constant**

In `docs/superpowers/specs/2026-10-15-builder-shared-columns-design.md`:

Replace the paragraph beginning "`BUILDER_LIST_VERSION` moves from 7 to 8." with:

```markdown
`BUILDER_LIST_VERSION` stays 7. A new `BUILDER_SHARE_VERSION = 8` is used only by the Export fields. A version 8 string is:
```

Replace the paragraph beginning "Only the three Export fields (All Lists, Current List, Current Variant) emit version 8 strings" with:

```markdown
Only the three Export fields (All Lists, Current List, Current Variant) emit version 8 strings with column segments. Saved payloads (cookie `cln`, account profile payloads, sync baselines) continue to be written by `encodeBuilderLists` at version 7 with no column segments, so stored `payloadVersion` values and the server's canonical form are unchanged. The decoder accepts version 8 and parses its build segments with the version 7 layout.
```

In the "Codec changes" list, replace the first bullet (`BUILDER_LIST_VERSION = 8`) with `- `BUILDER_SHARE_VERSION = 8`; `BUILDER_LIST_VERSION` remains 7.` and in the second bullet change "accepts versions 1 through 8" wording to "accepts versions 1 through `BUILDER_SHARE_VERSION`".

In the "Testing" section, replace the "Server:" bullet with:

```markdown
- Server: no change. `validateBuilderProfile` canonicalizes through `encodeBuilderLists`, so a client that pastes a share string as a profile payload gets its column segments stripped and `payloadVersion` stays 7.
```

- [ ] **Step 6: Commit**

```bash
git add www/shared/builder-codec.mjs www/client/features/builder/builder-encoding.js www/test/client/builder-encoding.test.js docs/superpowers/specs/2026-10-15-builder-shared-columns-design.md
git commit -m "Add version 8 Builder share format carrying column layouts"
```

---

### Task 2: Column-preference helpers for export and import fallback

**Files:**
- Modify: `www/client/features/builder/builder-persistence.js`
- Test: `www/test/client/builder-persistence.test.js`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `accountPreferenceColumns(document, character, statInfo, sharedColumns = null)` — unchanged behavior when `sharedColumns` is null or empty; when the profile has no saved `builderColumns` entry and `sharedColumns` is a non-empty array, those columns are applied instead of the `itemColumns`/default fallback. Saved profile columns always win over `sharedColumns`.
- Produces: `exportColumnsByCharacter({mode, characters, selectedCharacterName, selectedColumns, cookies = {}, document = null}) -> {[characterName]: string[]}`. `mode` is `"anonymous"` or `"account"`. The selected character always maps to `selectedColumns`. Other characters map to their `sc-<name>` cookie (anonymous) or `document.builderColumns[character.account.id]` (account) when present and non-empty; characters with nothing saved are omitted.

- [ ] **Step 1: Write the failing tests**

Append to `www/test/client/builder-persistence.test.js` (the file defines `loadPersistence`):

```js
// Catches shared import columns being ignored for an unsaved profile, or
// overriding a profile whose columns the account already saved.
test("account preference columns fall back to shared columns only until the profile saves its own", async function() {
    const {accountPreferenceColumns} = await loadPersistence();
    const statInfo = [
        {short: "Name", var: "name", showColumnDefault: true},
        {short: "Rent", showColumnDefault: true},
        {short: "Hp", showColumnDefault: false}
    ];
    const visible = (document, character, shared) => accountPreferenceColumns(document, character, statInfo, shared)
        .filter(stat => stat.showColumn)
        .map(stat => stat.short);
    const unsaved = {name: "Hero", account: {id: null, revision: 0}};
    const saved = {name: "Hero", account: {id: "profile-a", revision: 1}};

    assert.deepEqual(visible({itemColumns: [], builderColumns: {}}, unsaved, ["Name", "Hp"]), ["Name", "Hp"]);
    assert.deepEqual(visible({itemColumns: [], builderColumns: {}}, saved, ["Name", "Hp"]), ["Name", "Hp"]);
    assert.deepEqual(visible({itemColumns: [], builderColumns: {"profile-a": ["Rent"]}}, saved, ["Name", "Hp"]), ["Name", "Rent"]);
    assert.deepEqual(visible({itemColumns: ["Rent"], builderColumns: {}}, unsaved, []), ["Name", "Rent"]);
    assert.deepEqual(visible({itemColumns: [], builderColumns: {}}, unsaved, ["Name", "Unknown"]), ["Name"]);
});

// Catches exports that read the wrong storage for the current mode, leak the
// Items-search fallback as a per-character layout, or drop the on-screen columns.
test("export columns come from the screen for the selected character and saved layouts for the rest", async function() {
    const {exportColumnsByCharacter} = await loadPersistence();
    const characters = [
        {name: "Hero", account: {id: "profile-a"}},
        {name: "Scout", account: {id: "profile-b"}},
        {name: "Blank", account: {id: null}}
    ];
    const cookies = {"sc-Scout": "Name-Rent-", "sc-Blank": "", sc2: "Name-Hp-", "sc-Hero": "Name-"};
    const document = {itemColumns: ["Hp"], builderColumns: {"profile-b": ["Name", "Ac"]}};

    assert.deepEqual(exportColumnsByCharacter({
        mode: "anonymous", characters, selectedCharacterName: "Hero",
        selectedColumns: ["Name", "Str"], cookies, document
    }), {Hero: ["Name", "Str"], Scout: ["Name", "Rent"]});
    assert.deepEqual(exportColumnsByCharacter({
        mode: "account", characters, selectedCharacterName: "Hero",
        selectedColumns: ["Name", "Str"], cookies, document
    }), {Hero: ["Name", "Str"], Scout: ["Name", "Ac"]});
    assert.deepEqual(exportColumnsByCharacter({
        mode: "account", characters: [], selectedCharacterName: "Hero", selectedColumns: ["Name"]
    }), {});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run from `www/`: `node --test test/client/builder-persistence.test.js`
Expected: the two new tests FAIL (shared columns ignored; `exportColumnsByCharacter is not a function`).

- [ ] **Step 3: Implement the helpers**

In `www/client/features/builder/builder-persistence.js`, replace `accountPreferenceColumns` with:

```js
export function accountPreferenceColumns(document, character, statInfo, sharedColumns = null) {
    const profileId = typeof character?.account?.id === "string" && character.account.id
        ? character.account.id
        : null;
    const hasProfileColumns = profileId && hasOwn(document?.builderColumns, profileId);
    const columns = hasProfileColumns
        ? document.builderColumns[profileId]
        : Array.isArray(sharedColumns) && sharedColumns.length
            ? sharedColumns
            : (document?.itemColumns?.length ? document.itemColumns : null);
    return applySelectedColumns(columns, statInfo);
}
```

Add after it:

```js
export function exportColumnsByCharacter({mode, characters, selectedCharacterName, selectedColumns, cookies = {}, document = null}) {
    const result = {};
    for (const character of characters) {
        let columns = null;
        if (character.name === selectedCharacterName)
            columns = selectedColumns;
        else if (mode === "account") {
            const profileId = typeof character.account?.id === "string" && character.account.id
                ? character.account.id
                : null;
            if (profileId && hasOwn(document?.builderColumns, profileId))
                columns = document.builderColumns[profileId];
        }
        else if (typeof cookies[`sc-${character.name}`] === "string")
            columns = cookies[`sc-${character.name}`].split("-");
        columns = (columns || []).filter(Boolean);
        if (columns.length)
            result[character.name] = columns;
    }
    return result;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run from `www/`: `node --test test/client/builder-persistence.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add www/client/features/builder/builder-persistence.js www/test/client/builder-persistence.test.js
git commit -m "Add shared-column fallback and export column collection helpers"
```

---

### Task 3: Wire export and import in the Builder component

**Files:**
- Modify: `www/client/features/builder/Builder.jsx` (imports near line 18-20; refs near line 100-110; `selectedAccountPreferenceStatInfo` near line 118; preference patch effect near line 266-280; `action()` near line 485; `exportValue`, `importChange`, `submitImport` near line 652-680)

**Interfaces:**
- Consumes: `encodeBuilderShare`, `decodeBuilderShare` (Task 1); `accountPreferenceColumns(..., sharedColumns)`, `exportColumnsByCharacter` (Task 2).
- Produces: `importModel.columns` (`{[characterName]: string[]}`) stored alongside `importModel.lists`; the `lists/import` action now carries `columns`. The reducer ignores `columns`.

No unit test covers this component; Task 4's end-to-end tests are its verification. Build the client after editing to catch syntax errors.

- [ ] **Step 1: Update imports**

Change the `builder-encoding.js` import to:

```js
import {decodeBuilderEntries, decodeBuilderLists, decodeBuilderShare, encodeBuilderLists, encodeBuilderShare, encodeBuilderVariant} from "./builder-encoding.js";
```

Change the `builder-persistence.js` import to:

```js
import {accountPreferenceColumns, applyBuilderPersistencePlan, applySelectedColumns, calculateStorageSize, createBuilderAccountPreferencePatch, createBuilderPersistencePlan, exportColumnsByCharacter, formatStorageSize, readBuilderPersistence} from "./builder-persistence.js";
```

(`decodeBuilderEntries` and `encodeBuilderVariant` may become unused after this task; remove them from the import if the linter complains.)

- [ ] **Step 2: Add the shared-columns ref and use it for account identity changes**

Next to `const latestStateRef = useRef(state);` add:

```js
    const sharedColumnsRef = useRef(new Map());
```

Change the `selectedAccountPreferenceStatInfo` computation to pass shared columns:

```js
    const selectedAccountPreferenceStatInfo = selectedAccountPreferenceIdentityChanged
        ? accountPreferenceColumns(
            preferenceStoreRef.current?.get?.().document,
            selectedCharacter,
            state.defaultStatInfo,
            sharedColumnsRef.current.get(selectedCharacter?.name) || null
        )
        : null;
```

In the account preference patch effect (the one calling `store.patch(createBuilderAccountPreferencePatch({...}))`), after the `store.patch(...)` call add:

```js
        if (typeof character.account?.id === "string" && character.account.id)
            sharedColumnsRef.current.delete(character.name);
```

- [ ] **Step 3: Apply shared columns on import in `action()`**

Replace the `action` function with:

```js
    function action(value) {
        const currentState = latestStateRef.current;
        const imported = value.type === "lists/import"
            ? value.lists.find(list => !list.exists || list.overwrite)
            : null;
        const characterName = value.type === "variant/select"
            ? currentState.allLists[value.listIndex].name
            : imported?.name ?? null;
        const isNewCharacter = Boolean(imported) && !currentState.allLists.some(list => list.name === imported.name);
        const sharedColumns = isNewCharacter ? value.columns?.[imported.name] : null;
        if (Array.isArray(sharedColumns) && sharedColumns.length) {
            if (currentState.storageMode === "account")
                sharedColumnsRef.current.set(imported.name, sharedColumns);
            dispatch({type: "ui/patch", value: {statInfo: applySelectedColumns(sharedColumns, currentState.defaultStatInfo)}});
        }
        else if (currentState.storageMode === "anonymous" && characterName && characterName !== currentState.allLists[currentState.selectedListIndex].name) {
            const cookieValues = cookies();
            dispatch({type: "ui/patch", value: {statInfo: applySelectedColumns(cookieValues[`sc-${characterName}`] || cookieValues.sc2, currentState.defaultStatInfo)}});
        }
        dispatch(value);
    }
```

How this persists: in anonymous mode the existing persistence effect writes `sc-<name>` from `state.statInfo` once the imported character is selected. In account mode the new character starts with `account.id === null`; the identity-change effect reads `sharedColumnsRef` through `accountPreferenceColumns` so it does not override the shared columns with the fallback, and once the sync controller assigns the profile id the patch effect saves `builderColumns[profileId]` and clears the ref entry.

- [ ] **Step 4: Encode columns in the Export dialog**

Replace `exportValue` with:

```js
    function exportValue() {
        const character = state.allLists[state.selectedListIndex];
        const exportLists = state.allLists.map(({account: _account, ...list}) => list);
        const columns = exportColumnsByCharacter({
            mode: state.storageMode,
            characters: state.allLists,
            selectedCharacterName: character.name,
            selectedColumns: state.statInfo.filter(stat => stat.showColumn).map(stat => stat.short),
            cookies: cookies(),
            document: preferenceStoreRef.current?.get?.().document
        });
        return {
            allLists: encodeBuilderShare(exportLists, columns),
            curList: encodeBuilderShare([{name: character.name, variants: character.variants}], columns),
            curVariant: encodeBuilderShare([{name: character.name, variants: [selected]}], columns),
            characterName: character.name,
            variantName: selected.name
        };
    }
```

- [ ] **Step 5: Decode columns in the Import dialog and pass them through**

Replace `importChange` with:

```js
    function importChange(input, overwriteIndex, overwrite) {
        let lists = [];
        let columns = {};
        let message = "";
        try {
            if (input)
                ({entries: lists, columns} = decodeBuilderShare(input));
        }
        catch (_error) { message = "Invalid list import string."; }
        lists = lists.map(entry => { const existing = state.allLists.find(list => list.name === entry.name)?.variants.some(variant => variant.name === entry.variants[0].name); return {...entry, exists: Boolean(existing), overwrite: existing}; });
        if (overwriteIndex !== undefined) { const existingRows = lists.filter(list => list.exists); if (existingRows[overwriteIndex]) existingRows[overwriteIndex].overwrite = overwrite; }
        if (!message && lists.some(list => list.exists)) message = "The following lists already exist and will be overwritten unless otherwise specified:";
        dispatch({type: "ui/patch", value: {importModel: {input, lists, columns, message, loading: false}}});
    }
```

In `submitImport`, change the dispatch line to:

```js
            action({type: "lists/import", lists, columns: state.importModel.columns || {}});
```

- [ ] **Step 6: Build the client and run the unit suite**

Run from `www/`: `npm run build:client`
Expected: build succeeds with no errors.

Run from `www/`: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add www/client/features/builder/Builder.jsx
git commit -m "Carry Builder column layouts through export and import"
```

---

### Task 4: End-to-end coverage for shared columns

**Files:**
- Modify: `www/e2e/builder-transfer.spec.js`

**Interfaces:**
- Consumes: the running Builder from Task 3. Helpers from `www/e2e/support/builder.js`: `button`, `profiles`, `renameCharacter`, `exportLists`, `importLists`, `freshLogin`. Fixtures from `www/e2e/support/fixtures.js`: `signedIn`, `account`, `stack`, `newDevice`.
- The baseline stat table (`www/e2e/support/builder-baseline.sql`) has a `Rent` column with `ShowColumnDefault = 1`, so Rent is visible by default and is the column these tests hide.

- [ ] **Step 1: Write the failing tests**

Add this helper near the top of `www/e2e/builder-transfer.spec.js`, after the `require` lines:

```js
const rentHeader = page => page.locator(".builder-equipment-table thead th").filter({hasText: /^Rent$/});
async function hideRent(page) {
    await button(page, "Hide/Show Columns").click();
    const columns = page.getByRole("dialog", {name: "Select visible columns"});
    const rent = columns.getByRole("button", {name: "Rent", exact: true});
    await expect(rent).toHaveAttribute("aria-pressed", "true");
    await rent.click();
    await columns.getByRole("button", {name: "Close", exact: true}).click();
    await expect(rentHeader(page)).toHaveCount(0);
}
async function showRent(page) {
    await button(page, "Hide/Show Columns").click();
    const columns = page.getByRole("dialog", {name: "Select visible columns"});
    const rent = columns.getByRole("button", {name: "Rent", exact: true});
    await expect(rent).toHaveAttribute("aria-pressed", "false");
    await rent.click();
    await columns.getByRole("button", {name: "Close", exact: true}).click();
    await expect(rentHeader(page)).toHaveCount(1);
}
```

Append these tests:

```js
test("shared column layouts follow a new character into another account and survive a fresh login", async ({signedIn: {page}, account, stack, newDevice}) => {
    await renameCharacter(page, "Layout Hero");
    await hideRent(page);
    const payload = await exportLists(page);
    expect(payload).toMatch(/^8\*/);
    const segment = payload.match(/\*~Layout Hero~([^*]*)\*/);
    expect(segment).not.toBeNull();
    expect(segment[1].split("-")).toContain("Name");
    expect(segment[1].split("-")).not.toContain("Rent");

    const recipient = await stack.createAccount();
    const destination = await freshLogin(newDevice, recipient);
    await expect(rentHeader(destination.page)).toHaveCount(1);
    await importLists(destination.page, payload);
    await expect(destination.page.getByLabel("Character", {exact: true}).locator("option:checked")).toHaveText("Layout Hero");
    await expect(rentHeader(destination.page)).toHaveCount(0);

    const imported = (await profiles(stack, recipient.id)).find(row => row.Name === "Layout Hero");
    expect(imported).toBeDefined();
    await expect.poll(async () => {
        const [row] = await stack.query("SELECT Payload FROM AccountPreferences WHERE MemberId = ?", [recipient.id]);
        return row ? JSON.parse(row.Payload).builderColumns?.[imported.PublicId] ?? null : null;
    }).not.toBeNull();
    const [row] = await stack.query("SELECT Payload FROM AccountPreferences WHERE MemberId = ?", [recipient.id]);
    expect(JSON.parse(row.Payload).builderColumns[imported.PublicId]).not.toContain("Rent");

    const fresh = await freshLogin(newDevice, recipient);
    await expect(fresh.page.getByLabel("Character", {exact: true}).locator("option:checked")).toHaveText("Layout Hero");
    await expect(rentHeader(fresh.page)).toHaveCount(0);
    expect(await profiles(stack, account.id)).toHaveLength(1);
});

test("anonymous imports apply shared columns to new characters and keep layouts for existing ones", async ({signedIn: {page}, newDevice}) => {
    await renameCharacter(page, "Layout Hero");
    await hideRent(page);
    const payload = await exportLists(page);
    expect(payload).toMatch(/^8\*/);

    const {page: guest} = await newDevice();
    await guest.goto("/builder/");
    await expect(guest.getByText("Saved in this browser", {exact: true})).toBeVisible();
    await guest.getByRole("button", {name: "Agree", exact: true}).click();
    await expect(rentHeader(guest)).toHaveCount(1);
    const importAnonymously = async () => {
        await button(guest, "Import").click();
        const dialog = guest.getByRole("dialog", {name: "Import Lists"});
        await dialog.getByLabel("Builder list import string").fill(payload);
        await dialog.getByRole("button", {name: "Import", exact: true}).click();
        await expect(dialog).toHaveCount(0);
    };

    await importAnonymously();
    await expect(guest.getByLabel("Character", {exact: true}).locator("option:checked")).toHaveText("Layout Hero");
    await expect(rentHeader(guest)).toHaveCount(0);

    await guest.getByLabel("Character", {exact: true}).selectOption({index: 0});
    await expect(guest.getByLabel("Character", {exact: true}).locator("option:checked")).not.toHaveText("Layout Hero");
    await expect(rentHeader(guest)).toHaveCount(1);

    await guest.reload();
    await guest.getByLabel("Character", {exact: true}).selectOption({label: "Layout Hero"});
    await expect(rentHeader(guest)).toHaveCount(0);

    await showRent(guest);
    await importAnonymously();
    await expect(guest.getByLabel("Character", {exact: true}).locator("option:checked")).toHaveText("Layout Hero");
    await expect(rentHeader(guest)).toHaveCount(1);
});
```

Also update the first existing test in the file: change `expect(payload).toMatch(/^7\*/);` to `expect(payload).toMatch(/^8\*/);`.

- [ ] **Step 2: Confirm the tests exercise new behavior**

These tests cannot run red in isolation because Task 3 is already committed. Their red condition is documented here instead: before Task 3, `exportLists` returns a `7*` string with no `~Layout Hero~` segment, so the `toMatch(/^8\*/)` and `segment` assertions fail, and the import shows Rent (count 1) where the tests expect 0. Read the tests once more against that description before running them.

- [ ] **Step 3: Run the end-to-end transfer suite**

Run from `www/`: `npm run test:e2e -- e2e/builder-transfer.spec.js`
Expected: all tests in the file PASS. If the account-mode test fails on the `expect.poll` for `builderColumns`, confirm the preference patch effect in `Builder.jsx` runs after the sync controller assigns `account.id` (Task 3 Step 2) and that the key used is the profile's `PublicId`.

- [ ] **Step 4: Run the related accessibility suite**

Run from `www/`: `npm run test:a11y -- accessibility/react-builder.spec.js`
Expected: PASS. These tests import version 7 strings and check cookie-driven columns; the new code leaves that path unchanged.

- [ ] **Step 5: Commit**

```bash
git add www/e2e/builder-transfer.spec.js
git commit -m "Cover shared Builder column layouts end to end"
```

---

### Task 5: Player documentation

**Files:**
- Modify: `CHANGELOG.md` (`[4.0.0-beta]` → `### Changed`)
- Modify: `docs/user-manual.md` ("Export, import, and share builds" section)

- [ ] **Step 1: Update the changelog**

In `CHANGELOG.md`, under `## [4.0.0-beta]` → `### Changed`, add as the first bullet:

```markdown
- Exported Builder lists now carry each character's column layout. Importing a character you do not already have shows the columns its sharer used, and those columns become your saved layout for that character. Importing into a character you already have keeps your own columns. Older export strings still import.
```

- [ ] **Step 2: Update the user manual**

In `docs/user-manual.md`, replace the paragraph beginning "These values are encoded text." with:

```markdown
These values are encoded text. Each export also includes the column layout shown for every character it contains, so a shared build opens with the same columns you were viewing. To back up or share a build, copy the chosen string and store or send it yourself; there is no Share button.
```

Replace the paragraph beginning "Select **Import**, paste a **Builder list import string**" with:

```markdown
Select **Import**, paste a **Builder list import string**, and review any name collisions. Existing character-and-variant collisions are listed with selectable **Overwrite?** choices, so you control which existing variants may be replaced. When an import adds a character you do not already have, the Builder shows the column layout from the string and saves it as that character's columns. Importing into a character you already have keeps your current columns. An invalid string is rejected. If imported item details cannot load, keep the encoded string and use the offered retry path rather than repeatedly changing the source text.
```

- [ ] **Step 3: Verify the manual still passes its checks**

Run from `www/`: `node --test test/manual.test.js test/manual-content.test.js`
Expected: PASS. These tests check the manual's structure and vocabulary; no headings change in this task.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md docs/user-manual.md
git commit -m "Document shared Builder column layouts"
```

---

## Final verification

- [ ] From `www/`: `npm test` → PASS.
- [ ] From `www/`: `npm run build:client` → succeeds.
- [ ] From `www/`: `npm run test:e2e -- e2e/builder-transfer.spec.js` → PASS.
- [ ] From `www/`: `npm run test:a11y -- accessibility/react-builder.spec.js` → PASS.
- [ ] `git log --oneline fix/builder-import-selection..feat/builder-shared-columns` lists the spec commits plus five implementation commits.
- [ ] Report results to Rufus. Deployment to Dunwich is a separate, explicitly authorized step.
