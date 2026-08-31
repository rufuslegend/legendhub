# Multi-Slot Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store every valid wear location for an item and make Item Search, item editing, item details, and Builder use those authoritative capabilities while Builder correctly models Legend's three-hand pool.

**Architecture:** Add an internal unsigned `SlotMask` to `Items` and `Items_AuditTrail`, retain `Slot` as a deprecated compatible primary, and expose a computed sorted `slots` GraphQL field. Upgrade Builder's positional codec to version 7 with a version-specific 37-row layout, then use the equipped row as the chosen role and a shared three-unit hand-capacity calculation.

**Tech Stack:** Node.js 22, CommonJS GraphQL server, MySQL 5.7 migrations, React 19, EJS, shared ES-module Builder codec, Node test runner, Playwright, axe-core, Bootstrap 4.

**Spec:** `docs/superpowers/specs/2026-08-31-multi-slot-items-design.md`

## Global Constraints

- Preserve every existing `Items` row and `Id`; do not merge apparent duplicates.
- Slot IDs remain the integers 0 through 21; `Other` is slot 21 and cannot be combined.
- Existing migration mapping is singleton `Slot`, plus Hold (15) only when `Slot = 14` and `Holdable = 1`.
- `SlotMask` is authoritative; deprecated `Slot` must always be one of its capabilities.
- `Familiar` (20) and `Other` (21) remain Hub-visible capabilities.
- Builder has Shield x1, Wield x1, Hold x3, sharing exactly three hand units.
- A normal hand item costs one unit; `TwoHanded` costs two.
- Builder versions 1–6 retain their original 35-position interpretation; version 7 has 37 positions.
- Existing invalid or over-capacity Builder data stays visible with warnings and is never silently deleted.
- Update root `CHANGELOG.md` in player-friendly language.
- Do not implement spool ingestion, deduplicate rows, publish images, push, tag, or deploy.
- Use test-driven development: observe each focused test fail for the intended reason before production edits.

## File Structure

- `www/src/routes/api/item-slots.js`: the single server-side slot vocabulary, mask conversion, validation, and compatible primary-slot policy.
- `www/src/routes/api/migrations/10.js`: restart-safe schema/backfill/audit-trigger migration.
- `www/src/routes/api/items.js`: GraphQL `slots`, write normalization, history/revert behavior, and authoritative Builder slot query.
- `www/src/routes/api/item-filters.js`: bit-membership Item Search slot filtering.
- `www/client/features/editors/ItemEditor.jsx`: accessible multi-slot editor and capability-based weapon visibility.
- `www/client/features/editors/editor-api.js`: `[Int!]` mutation input and variables.
- `www/src/views/items/display.ejs`: all-capability details/history output.
- `www/shared/builder-codec.mjs`: version-specific list layouts and legacy-to-v7 insertion.
- `www/client/features/builder/item-constants.js`: current 37-position layout/version constants.
- `www/src/routes/api/builder-payload.js`: server validation against the v7 layout.
- `www/client/features/builder/builder-derivations.js`: unique-wear and three-hand calculations.
- `www/client/features/builder/builder-api.js`, `Builder.jsx`, `builder-reducer.js`, and `EquipmentPanel.jsx`: authoritative role hydration and picker capacity UX.
- Focused tests live beside the existing migration, API, editor, Builder codec, derivation, markup, and browser suites.

---

### Task 1: Slot mask domain rules

**Files:**
- Create: `www/src/routes/api/item-slots.js`
- Create: `www/test/item-slots.test.js`

**Interfaces:**
- Produces: `SLOT_COUNT = 22`, `OTHER_SLOT = 21`, `SlotValidationError`, `slotBit(slotId) -> number`, `slotsToMask(slots) -> number`, `maskToSlots(mask) -> number[]`, and `resolveSlotWrite(input) -> {slots, slot, slotMask}`.
- `resolveSlotWrite` consumes `{slots?, slot?, holdable?, currentSlot?, currentMask?, insert}` and implements both authoritative-array and legacy-scalar compatibility.

- [ ] **Step 1: Write failing mask conversion and validation tests**

```js
test("slot masks round-trip in canonical order", function() {
    assert.equal(slotsToMask([15, 2, 14]), (2 ** 2) + (2 ** 14) + (2 ** 15));
    assert.deepEqual(maskToSlots((2 ** 15) + (2 ** 2) + (2 ** 14)), [2, 14, 15]);
});

test("slot masks reject empty, unknown, and Other-combined capabilities", function() {
    for (const slots of [[], [-1], [22], [1, 21], [1.5]])
        assert.throws(() => slotsToMask(slots), SlotValidationError);
});
```

- [ ] **Step 2: Run the new test and verify the module is missing**

Run from `www/`: `node --test test/item-slots.test.js`

Expected: FAIL because `../src/routes/api/item-slots` does not exist.

- [ ] **Step 3: Implement exact mask primitives**

```js
"use strict";

const SLOT_COUNT = 22;
const OTHER_SLOT = 21;
const VALID_MASK = (2 ** SLOT_COUNT) - 1;

class SlotValidationError extends Error {}

function slotBit(slotId) {
    if (!Number.isInteger(slotId) || slotId < 0 || slotId >= SLOT_COUNT)
        throw new SlotValidationError("Slot IDs must be integers from 0 through 21.");
    return 2 ** slotId;
}

function slotsToMask(values) {
    if (!Array.isArray(values) || values.length === 0)
        throw new SlotValidationError("Choose at least one slot.");
    const slots = [...new Set(values)].sort((left, right) => left - right);
    for (const slot of slots)
        slotBit(slot);
    if (slots.includes(OTHER_SLOT) && slots.length !== 1)
        throw new SlotValidationError("Other cannot be combined with another slot.");
    return slots.reduce((mask, slot) => mask + slotBit(slot), 0);
}

function maskToSlots(mask) {
    if (!Number.isSafeInteger(mask) || mask <= 0 || (mask & ~VALID_MASK) !== 0)
        throw new SlotValidationError("The stored slot mask is invalid.");
    return Array.from({length: SLOT_COUNT}, (_, slot) => slot)
        .filter(slot => (mask & slotBit(slot)) !== 0);
}
```

- [ ] **Step 4: Add failing compatible-write policy tests**

```js
test("authoritative arrays retain a selected primary then fall back canonically", function() {
    assert.deepEqual(resolveSlotWrite({slots: [15, 2], currentSlot: 15, insert: false}), {
        slots: [2, 15], slot: 15, slotMask: (2 ** 2) + (2 ** 15)
    });
    assert.equal(resolveSlotWrite({slots: [15, 2], currentSlot: 14, insert: false}).slot, 2);
});

test("legacy creates infer only Holdable Wield and legacy updates preserve masks", function() {
    assert.deepEqual(resolveSlotWrite({slot: 14, holdable: true, insert: true}).slots, [14, 15]);
    assert.deepEqual(resolveSlotWrite({slot: 10, holdable: true, insert: true}).slots, [10]);
    assert.deepEqual(resolveSlotWrite({currentSlot: 14, currentMask: (2 ** 14) + (2 ** 15), insert: false}).slots, [14, 15]);
    assert.equal(resolveSlotWrite({slot: 15, currentSlot: 14, currentMask: (2 ** 14) + (2 ** 15), insert: false}).slot, 15);
    assert.throws(() => resolveSlotWrite({slot: 10, currentSlot: 14, currentMask: (2 ** 14) + (2 ** 15), insert: false}), SlotValidationError);
});
```

- [ ] **Step 5: Implement `resolveSlotWrite` and exports**

```js
function resolveSlotWrite({slots, slot, holdable = false, currentSlot, currentMask, insert}) {
    const authoritative = slots !== undefined && slots !== null;
    let normalized;
    if (authoritative) {
        const slotMask = slotsToMask(slots);
        normalized = maskToSlots(slotMask);
    }
    else if (insert) {
        normalized = [slot];
        if (slot === 14 && holdable)
            normalized.push(15);
        slotsToMask(normalized);
    }
    else {
        normalized = maskToSlots(currentMask);
        if (slot !== undefined && slot !== null && !normalized.includes(slot))
            throw new SlotValidationError("The primary slot must be an item capability.");
    }
    const primary = !insert && !authoritative && slot !== undefined && slot !== null
        ? slot
        : !insert && normalized.includes(currentSlot)
            ? currentSlot
            : normalized[0];
    return {slots: normalized, slot: primary, slotMask: slotsToMask(normalized)};
}

module.exports = {
    OTHER_SLOT, SLOT_COUNT, SlotValidationError,
    maskToSlots, resolveSlotWrite, slotBit, slotsToMask
};
```

- [ ] **Step 6: Run focused tests and commit**

Run from `www/`: `node --test test/item-slots.test.js`

Expected: PASS.

```bash
git add www/src/routes/api/item-slots.js www/test/item-slots.test.js
git commit -m "feat: define item slot capability rules"
```

### Task 2: Restart-safe SlotMask migration and audit history

**Files:**
- Create: `www/src/routes/api/migrations/10.js`
- Create: `www/test/migration-10.test.js`
- Modify: `www/test/migrations.integration.test.js`

**Interfaces:**
- Consumes: MySQL migration context `query(operation, sql, values?)`.
- Produces: `Items.SlotMask INT UNSIGNED NOT NULL`, `Items_AuditTrail.SlotMask INT UNSIGNED NOT NULL`, fully backfilled masks, and `Items_BEFORE_UPDATE` that records `OLD.SlotMask`.

- [ ] **Step 1: Write a failing unit test for resumable migration operations**

Use a fake `query` that returns missing columns, representative item rows, and a missing trigger. Assert that `up()` executes these operations in order:

```js
assert.deepEqual(operations.slice(0, 4), [
    "inspect Items.SlotMask",
    "add Items.SlotMask",
    "inspect Items_AuditTrail.SlotMask",
    "add Items_AuditTrail.SlotMask"
]);
assert.match(sqlByOperation.get("backfill Items.SlotMask"), /Slot = 14 AND Holdable = 1/);
assert.match(sqlByOperation.get("create Items_BEFORE_UPDATE"), /OLD\.`SlotMask`/);
assert.doesNotMatch([...sqlByOperation.values()].join("\n"), /DELETE FROM Items|GROUP BY Name/);
```

Also cover a partially completed run where both columns already exist and are non-null but the trigger is missing; assert no `ADD COLUMN` runs and the trigger is recreated.

- [ ] **Step 2: Run the migration test and verify migration 10 is missing**

Run from `www/`: `node --test test/migration-10.test.js`

Expected: FAIL because migration 10 does not exist.

- [ ] **Step 3: Implement idempotent DDL and exact legacy backfill**

Declare `exports.mode = "non-transactional"`. Inspect each column before adding it nullable, backfill all null masks, verify the data, and only then alter it non-null:

```sql
UPDATE Items
SET SlotMask = (1 << Slot) |
    IF(Slot = 14 AND Holdable = 1, (1 << 15), 0)
WHERE SlotMask IS NULL;

UPDATE Items_AuditTrail
SET SlotMask = (1 << Slot) |
    IF(Slot = 14 AND Holdable = 1, (1 << 15), 0)
WHERE SlotMask IS NULL;
```

Before each `ALTER ... NOT NULL`, query for null, zero, unknown-bit, `Other`-combined, or primary-not-contained rows and throw if any exist. Do not update names, IDs, or delete rows.

- [ ] **Step 4: Rebuild the audit trigger from common schema columns**

Read ordered column names for `Items` and `Items_AuditTrail` from
`information_schema.columns`. Generate identifiers only from those database
results, quote each with a helper that doubles backticks, and build the complete
statement before dropping the old trigger:

```js
const auditNames = new Set(auditColumns.map(column => column.COLUMN_NAME));
const sharedNames = itemColumns
    .map(column => column.COLUMN_NAME)
    .filter(name => name !== "Id" && auditNames.has(name));
const insertNames = ["ItemId", ...sharedNames].map(quoteIdentifier).join(", ");
const oldValues = ["OLD.`Id`", ...sharedNames.map(name => `OLD.${quoteIdentifier(name)}`)]
    .join(", ");
const createTriggerSql = `
    CREATE TRIGGER Items_BEFORE_UPDATE BEFORE UPDATE ON Items FOR EACH ROW
    BEGIN
        IF (@DISABLE_NOTIFICATIONS IS NULL AND NEW.Deleted = OLD.Deleted) THEN
            INSERT INTO Items_AuditTrail (${insertNames}) VALUES (${oldValues});
        END IF;
    END`;
```

On retry, inspect `information_schema.triggers`; recreate the trigger when it is
missing or when its `ACTION_STATEMENT` does not contain `OLD.\`SlotMask\``.

- [ ] **Step 5: Implement `verify()` and integration coverage**

`verify()` returns true only when both columns are exactly `int unsigned`, non-null, all masks satisfy the data-integrity query, and the trigger records `SlotMask`. Extend the dedicated migration integration test with three rows:

```js
await query(pool, `
    INSERT INTO Items (Id, Name, Slot, Holdable, Deleted)
    VALUES
        (101, 'Holdable sword', 14, 1, 0),
        (102, 'Shield', 10, 1, 0),
        (103, 'Held focus', 15, 0, 0)
`);
```

After migration, assert masks `49152`, `1024`, and `32768`, IDs still `[101, 102, 103]`, and an update to row 101 writes audit mask `49152`. Force a failed first attempt after column creation, rerun, and assert the same final state.

- [ ] **Step 6: Run migration tests and commit**

Run from `www/`:

```bash
node --test test/migration-10.test.js test/migrations.test.js
npm run test:migrations:integration
```

Expected: unit tests PASS. The integration test either PASSes with its dedicated configured database or reports its existing environment-controlled skip when `MYSQL_MIGRATION_INTEGRATION` is unset.

```bash
git add www/src/routes/api/migrations/10.js www/test/migration-10.test.js www/test/migrations.integration.test.js
git commit -m "feat: migrate item slot capability masks"
```

### Task 3: GraphQL items and authoritative search filtering

**Files:**
- Modify: `www/src/routes/api/items.js`
- Modify: `www/src/routes/api/item-filters.js`
- Modify: `www/test/item-filters.test.js`
- Modify: `www/test/client/builder-api.test.js`
- Create: `www/test/item-slot-api.test.js`

**Interfaces:**
- Consumes: Task 1's `maskToSlots`, `resolveSlotWrite`, `slotBit`, and `SlotValidationError`.
- Produces: GraphQL `Item.slots: [Int!]!`, optional mutation argument `slots: [Int!]`, compatible `slot`, and bit-membership queries.

- [ ] **Step 1: Write failing filter and schema tests**

Change the expected slot filter to:

```js
{
    clause: " AND (IsLight = 1) AND ((SlotMask & ?) <> 0) AND (Name <> '')" +
        " AND (Strength <> 0) AND (Weight > 0)",
    values: [8]
}
```

In the API test metadata include `SlotMask`. Assert the schema validates:

```graphql
query { getItemById(id: 7) { id slot slots } }
```

and that `itemApi.fragment` contains `slots` but not `slotMask`.

- [ ] **Step 2: Run focused tests and observe scalar-only failures**

Run from `www/`: `node --test test/item-filters.test.js test/item-slot-api.test.js test/client/builder-api.test.js`

Expected: FAIL because filtering still uses `Slot = ?` and `Item.slots` is absent.

- [ ] **Step 3: Special-case slot filtering by mask membership**

In `resolveItemFilters`, after validating a select value, emit this only for metadata `Var === "slot"`:

```js
clause += " AND ((SlotMask & ?) <> 0)";
values.push(slotBit(value));
continue;
```

Keep every other metadata-driven filter behavior unchanged and continue rejecting malformed tokens before calling `slotBit`.

- [ ] **Step 4: Expose computed slots without exposing the physical mask**

Keep `SlotMask` in `itemSelectSQL`, but exclude it from generic GraphQL fields and the generated fragment. Add this to `Item`:

```js
slots() {
    return maskToSlots(this.slotMask);
}
```

Add this field explicitly:

```js
f.slots = {
    type: new graphql.GraphQLNonNull(
        new graphql.GraphQLList(new graphql.GraphQLNonNull(graphql.GraphQLInt))
    )
};
```

Append `slots` to `fragment ItemAll on Item` and retain scalar `slot`.

- [ ] **Step 5: Write failing create/update policy tests**

Mock authentication and MySQL like the existing item API tests. Cover:

- insert `[15, 2]` writes mask `32772` and primary `2`;
- legacy insert `slot: 14, holdable: true` writes mask `49152`;
- update `[2, 15]` retains current primary 15;
- update `[2]` falls back to primary 2;
- omitted `slots` preserves current mask;
- a legacy scalar update to a capability absent from the current mask returns code 400;
- empty, unknown, and `Other`-combined arrays return code 400 before an update query.

- [ ] **Step 6: Normalize insert, update, and revert writes**

Override insert `slot` to nullable, add nullable `slots: [Int!]`, and enforce at least one of the two inside the resolver. On insert, append `Slot` and `SlotMask` once to the generated columns. On update, select the current row first, resolve capabilities, and append both fields to the same update statement.

Convert `SlotValidationError` to a client error that names the failing field:

```js
throw new apiUtils.BadRequestError(`Slots: ${error.message}`);
```

When reverting a history row, restore both `Slot` and `SlotMask` from that audit record; never reconstruct the historical mask from current `Holdable`.

- [ ] **Step 7: Replace Builder slot inference and run focused tests**

Use one validated membership predicate:

```sql
FROM Items
WHERE (SlotMask & ?) <> 0 AND Deleted = 0
ORDER BY Name ASC
```

Pass `slotBit(slotId)` and reject IDs outside 0–21. Remove every `OR Slot = ...` and `Holdable` inference branch.

Run from `www/`:

```bash
node --test test/item-slots.test.js test/item-filters.test.js test/item-slot-api.test.js test/client/builder-api.test.js test/revert-api.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add www/src/routes/api/items.js www/src/routes/api/item-filters.js www/test/item-filters.test.js www/test/item-slot-api.test.js www/test/client/builder-api.test.js
git commit -m "feat: expose and query item slot capabilities"
```

### Task 4: Multi-slot item editor, search results, details, and history

**Files:**
- Modify: `www/client/features/editors/ItemEditor.jsx`
- Modify: `www/client/features/editors/editor-api.js`
- Modify: `www/test/client/item-editor.test.js`
- Modify: `www/client/features/items/ItemSearch.jsx`
- Create: `www/test/item-search-markup.test.js`
- Modify: `www/src/views/items/display.ejs`
- Modify: `www/test/characterization.test.js`

**Interfaces:**
- Consumes: GraphQL `item.slots` and mutation `slots: [Int!]` from Task 3.
- Produces: accessible multi-select editing, capability-based weapon fields, and all-slot display.

- [ ] **Step 1: Write failing editor rendering and mutation tests**

Render an item with `{slot: 14, slots: [14, 15]}` and assert:

```js
assert.match(markup, /<fieldset[^>]*>/);
assert.match(markup, /<legend[^>]*>Slots<\/legend>/);
assert.match(markup, /name="slots"[^>]*value="14"[^>]*checked/);
assert.match(markup, /name="slots"[^>]*value="15"[^>]*checked/);
```

Submit it and assert the GraphQL declaration and variables include:

```js
assert.match(request.query, /\$slots: \[Int!\]/);
assert.deepEqual(request.variables.slots, [14, 15]);
assert.equal(Object.hasOwn(request.variables, "slot"), false);
```

Also assert no selection disables Save, selecting Other clears every other checkbox, selecting a wearable slot clears Other, and `[15]` exposes applicable weapon fields even when deprecated primary `slot` is not 15.

- [ ] **Step 2: Run editor tests and verify the scalar editor fails them**

Run from `www/`: `node --test test/client/item-editor.test.js`

Expected: FAIL because the editor renders one `<select>` and emits only `slot`.

- [ ] **Step 3: Implement one accessible capability control**

Initialize `slots` with `item.slots` or `[item.slot]` for transitional server data. Suppress the metadata-driven `slot` field and render a `fieldset` in the Basic category:

```jsx
<fieldset className="form-group col-12">
  <legend className="h6">Slots</legend>
  <div className="row">
    {constants.selectOptions.slot.map((label, slot) => (
      <label className="col-6 col-md-3" key={slot}>
        <input
          type="checkbox"
          name="slots"
          value={slot}
          checked={draft.slots.includes(slot)}
          onChange={() => change("slots", toggleSlot(draft.slots, slot))}
        /> {label}
      </label>
    ))}
  </div>
</fieldset>
```

`toggleSlot` returns `[21]` when selecting Other, removes 21 when selecting another slot, and otherwise toggles the requested ID in numeric order. `itemValid` requires a nonempty `slots` array.

- [ ] **Step 4: Move weapon visibility to capability membership**

Define `hasSlot(item, slot) => item.slots.includes(slot)`. Show the Weapon category when Wield or Hold is present. Show Wield-only fields only for capability 14 and accuracy for either 14 or 15. Remove every editor visibility decision based on scalar `item.slot`.

- [ ] **Step 5: Emit `[Int!]` and no editable scalar slot**

In `editor-api.js`, exclude `slot` from `editableItemStats`, add `{name: "slots", type: "[Int!]"}` to insert and update mutation fields, and set `variables.slots` to a numeric copy. The server continues owning compatible primary selection.

- [ ] **Step 6: Write failing details/history view tests and render all slots**

Update characterization fixtures to supply `slots: [14, 15]`. Assert both page metadata and the visible definition list contain `Wield, Hold`. Replace direct scalar lookups with:

```ejs
<%= vm.item.slots.map(slot => vm.constants.selectOptions.slot[slot]).join(", ") %>
```

Use `vm.item.slots.includes(14)` and `.includes(15)` for weapon category/field visibility. The same EJS handles current and historical items because audit GraphQL objects expose computed `slots`.

- [ ] **Step 7: Render every capability in Item Search's Slot column**

Create a Vite SSR markup test with a visible Slot column and an item whose
`slots` is `[2, 15]`. Assert the result cell contains `Neck, Hold`. In
`ItemSearch.jsx`, special-case the slot metadata before the generic select
lookup:

```jsx
if (stat.var === "slot") {
    const labels = (item.slots || [item.slot])
        .map(slot => constants.selectShortOptions.slot?.[slot])
        .filter(Boolean);
    return <span>{labels.join(", ")}</span>;
}
```

Retain scalar `slot` as the sort key; only the rendered eligibility value uses
`slots`.

- [ ] **Step 8: Run focused tests and commit**

Run from `www/`:

```bash
node --test test/client/item-editor.test.js test/item-search-markup.test.js test/characterization.test.js
```

Expected: PASS.

```bash
git add www/client/features/editors/ItemEditor.jsx www/client/features/editors/editor-api.js www/test/client/item-editor.test.js www/client/features/items/ItemSearch.jsx www/test/item-search-markup.test.js www/src/views/items/display.ejs www/test/characterization.test.js
git commit -m "feat: edit and display every item slot"
```

### Task 5: Builder codec version 7 without legacy position shifts

**Files:**
- Modify: `www/shared/builder-codec.mjs`
- Modify: `www/client/features/builder/item-constants.js`
- Modify: `www/client/features/builder/Builder.jsx`
- Modify: `www/src/routes/api/builder-payload.js`
- Modify: `www/test/client/builder-encoding.test.js`
- Modify: `www/test/builder-payload.test.js`
- Modify: `www/test/builder-game-stats.test.js`
- Modify current-format fixtures in: `www/test/builder-storage-service.test.js`, `www/test/builder-storage-api.test.js`, `www/accessibility/account-builder-sync.spec.js`, `www/accessibility/account-email.spec.js`, `www/accessibility/react-builder.spec.js`

**Interfaces:**
- Produces: `BUILDER_LIST_VERSION = 7`, `LEGACY_SLOT_ORDER` (35 entries), `SLOT_ORDER` (37 entries), and decoding that always returns the current 37-row semantic model.
- Current `SLOT_ORDER` is exactly `[0,1,1,2,2,3,4,5,6,7,8,9,10,11,12,13,13,14,15,15,15,16,16,17,18,19,20,21,21,21,21,21,21,21,21,21,21]`.

- [ ] **Step 1: Write failing layout and legacy-upgrade tests**

For every existing version 1–6 fixture, assert decoded length 37, index 12 is empty Shield, index 20 is empty third Hold, and representative old items retain their semantic slots. Add a v6 fixture with IDs immediately before and after both insertion points:

```js
assert.deepEqual(decoded.items.slice(11, 22).map(item => [item.id, item.slot]), [
    [111, 9], [0, 10], [112, 11], [113, 12], [114, 13], [115, 13],
    [116, 14], [117, 15], [118, 15], [0, 15], [119, 16]
]);
```

Add a literal v7 37-item round trip and assert new encoding starts with `7*`.

- [ ] **Step 2: Run codec and payload tests and observe version/layout failures**

Run from `www/`: `node --test test/client/builder-encoding.test.js test/builder-payload.test.js`

Expected: FAIL because current encoding is v6/35 and versions share one slot order.

- [ ] **Step 3: Separate legacy and current layouts**

Keep the existing array unchanged as `LEGACY_SLOT_ORDER`. Define the 37-entry current array from Interfaces. Decode versions 1–6 with the legacy order and version 7 with current order. After legacy decoding, upgrade each variant with:

```js
function upgradeLegacyItems(items) {
    const upgraded = items.map(item => ({...item}));
    upgraded.splice(12, 0, {id: 0, slot: 10, locked: false});
    upgraded.splice(20, 0, {id: 0, slot: 15, locked: false});
    return upgraded;
}
```

Use legacy rune-charm indices `{3,4,14,15}` while decoding versions 1–6 and current indices `{3,4,15,16}` for version 7 encoding/decoding. This preserves Wrist rune charms after the Shield insertion.

- [ ] **Step 4: Update client and server current-layout validation**

Set `BUILDER_LIST_VERSION` to 7 and current `SLOT_ORDER` to 37 entries in `item-constants.js`. Set client and server current rune maps to `{3: "charm1", 4: "charm2", 15: "charm3", 16: "charm4"}`. In `builder-payload.js`, validate decoded current items against the same 37-entry order and use those current rune indices. Continue accepting input versions 1–6 through the shared codec, then store their canonical v7 encoding.

- [ ] **Step 5: Remove hard-coded v6 export prefixes**

Import `BUILDER_LIST_VERSION` in `Builder.jsx` and construct current character/variant exports with `${BUILDER_LIST_VERSION}*`. Keep literal v6 fixtures where the test intentionally proves old input compatibility; change assertions and fixtures representing newly generated or stored canonical data to v7, `payloadVersion: 7`, and 37 positions.

Audit every remaining current-version literal with:

```bash
rg -n 'payloadVersion: 6|payloadVersion, 6|\^6\\\*|version-6|canonical literal v6|BUILDER_LIST_VERSION = 6' www/client www/shared www/src www/test www/accessibility
```

For each result, retain `6` only when the test input is explicitly exercising
backward compatibility. Change generated-output assertions, saved canonical
records, and current-version fixture metadata to `7`.

- [ ] **Step 6: Run all codec/storage consumers and commit**

Run from `www/`:

```bash
node --test test/client/builder-encoding.test.js test/builder-payload.test.js test/builder-game-stats.test.js test/builder-storage-service.test.js test/builder-storage-api.test.js test/client/builder-persistence.test.js test/client/builder-source.test.js
```

Expected: PASS, including every intentional v1–v6 fixture.

```bash
git add www/shared/builder-codec.mjs www/client/features/builder/item-constants.js www/client/features/builder/Builder.jsx www/src/routes/api/builder-payload.js www/test/client/builder-encoding.test.js www/test/builder-payload.test.js www/test/builder-game-stats.test.js www/test/builder-storage-service.test.js www/test/builder-storage-api.test.js www/accessibility/account-builder-sync.spec.js www/accessibility/account-email.spec.js www/accessibility/react-builder.spec.js
git commit -m "feat: upgrade Builder equipment layout to version 7"
```

### Task 6: Builder role eligibility and three-hand capacity

**Files:**
- Modify: `www/client/features/builder/builder-api.js`
- Modify: `www/client/features/builder/Builder.jsx`
- Modify: `www/client/features/builder/builder-reducer.js`
- Modify: `www/client/features/builder/builder-derivations.js`
- Modify: `www/client/features/builder/EquipmentPanel.jsx`
- Modify: `www/test/client/builder-api.test.js`
- Modify: `www/test/client/builder-reducer.test.js`
- Modify: `www/test/client/builder-derivations.test.js`
- Modify: `www/test/builder-item-picker-markup.test.js`

**Interfaces:**
- Produces: `handCost(item) -> 0|1|2`, `handUnits(items) -> number`, `handUnitsAfterReplacement(items, index, candidate) -> number`, `canOpenEquipmentRow(items, index) -> boolean`, and `canEquipHandCandidate(items, index, candidate) -> boolean` from `builder-derivations.js`.
- Picker candidates retain GraphQL `slots`, but their `slot` is overwritten with the currently chosen equipment role before selection.

- [ ] **Step 1: Write failing role hydration and filter-removal tests**

Make the GraphQL test fixture return `{id: 41, slot: 14, slots: [14, 15]}`. Assert hydration preserves `slots` while preserving the saved equipped role:

```js
assert.deepEqual(hydrated.items[0].slots, [14, 15]);
assert.equal(hydrated.items[0].slot, 15);
```

Render the Hold picker and assert it contains the multi-role item but no `Slot Filter`, no `wieldSlotFilter`, and no `realSlot` behavior.

- [ ] **Step 2: Run focused API/reducer/markup tests and observe old inference UX**

Run from `www/`: `node --test test/client/builder-api.test.js test/client/builder-reducer.test.js test/builder-item-picker-markup.test.js`

Expected: FAIL because Builder still stores `realSlot` and renders the hand-role filter.

- [ ] **Step 3: Make the opened row authoritative**

In `Builder.jsx`, map each queried result as `{...result, slot: item.slot}` and remove `realSlot`. The server has already returned only items whose `slots` contains the requested row. Remove `wieldSlotFilter` state, `search/wield`, and `selectFilteredItems`' hand-role filtering. Remove the Slot Filter control from `EquipmentPanel.jsx`.

- [ ] **Step 4: Write failing three-hand and unique-wear tests**

Cover these exact totals:

```js
assert.equal(handUnitsAfterReplacement([
    {id: 1, slot: 10}, {id: 2, slot: 14}, {id: 3, slot: 15}
], 2, {id: 4, slot: 15}), 3);
assert.equal(handUnitsAfterReplacement([
    {id: 1, slot: 10}, {id: 2, slot: 14, twoHanded: true}, {id: 0, slot: 15}
], 2, {id: 3, slot: 15}), 4);
assert.equal(handUnitsAfterReplacement([
    {id: 1, slot: 10}, {id: 2, slot: 14, twoHanded: true}, {id: 3, slot: 15}
], 1, {id: 4, slot: 14}), 3);
```

Assert an occupied over-capacity legacy row remains present and all occupied hand items receive `twohanded` warnings. Assert duplicate `uniqueWear` IDs are warned across Shield/Hold and Body/Other, not only the old repeated-slot allowlist.

Also assert an empty Shield/Wield/Hold row cannot open when the other hand rows
already use three units, while every occupied row can still open for
replacement.

- [ ] **Step 5: Implement pure hand-capacity calculations and restrictions**

```js
const HAND_SLOTS = new Set([10, 14, 15]);

export function handCost(item) {
    if (!item || item.id === 0 || !HAND_SLOTS.has(Number(item.slot)))
        return 0;
    return item.twoHanded ? 2 : 1;
}

export function handUnitsAfterReplacement(items, index, candidate) {
    return items.reduce((total, item, itemIndex) =>
        total + handCost(itemIndex === index ? candidate : item), 0);
}

export function handUnits(items) {
    return items.reduce((total, item) => total + handCost(item), 0);
}

export function canOpenEquipmentRow(items, index) {
    const current = items[index];
    return handCost(current) > 0 || !HAND_SLOTS.has(Number(current?.slot)) ||
        handUnits(items) < 3;
}

export function canEquipHandCandidate(items, index, candidate) {
    return handUnitsAfterReplacement(items, index, candidate) <= 3;
}
```

In `deriveItemRestrictions`, detect duplicate nonzero IDs for every `uniqueWear` item. Sum all occupied slots 10, 14, and 15. When total exceeds three, add `twohanded` once to every occupied hand-role row. Keep Wield strength, limited-item, and warning text behavior unchanged.

- [ ] **Step 6: Disable only choices that exceed replacement-adjusted capacity**

In the equipment table, use `canOpenEquipmentRow` to disable the Name/stat
buttons and row click only for an empty hand-role row when the pool already uses
all three units. Occupied rows always retain their picker action. Give a blocked
empty row the accessible explanation `All three hands are already in use.`

For each result row compute:

```js
const capacityBlocked = !canEquipHandCandidate(
    state.selectedList.items,
    state.currentItemIndex,
    item
);
const disabled = current.locked || capacityBlocked;
```

Use `disabled` for the row class, click handler, and button. Add a stable status element with ID `builder-picker-hand-status` and text `This item would use more than your character's three hands.`; point capacity-disabled buttons to it with `aria-describedby`. The empty item remains selectable because its cost is zero. An occupied current row remains open even when the current build already exceeds capacity.

- [ ] **Step 7: Run Builder unit/markup tests and commit**

Run from `www/`:

```bash
node --test test/client/builder-api.test.js test/client/builder-reducer.test.js test/client/builder-derivations.test.js test/builder-item-picker-markup.test.js test/builder-game-stats.test.js
```

Expected: PASS.

```bash
git add www/client/features/builder/builder-api.js www/client/features/builder/Builder.jsx www/client/features/builder/builder-reducer.js www/client/features/builder/builder-derivations.js www/client/features/builder/EquipmentPanel.jsx www/test/client/builder-api.test.js www/test/client/builder-reducer.test.js www/test/client/builder-derivations.test.js www/test/builder-item-picker-markup.test.js
git commit -m "feat: model Builder hand roles and capacity"
```

### Task 7: Browser coverage, player documentation, and full verification

**Files:**
- Modify: `www/accessibility/react-builder.spec.js`
- Modify: `www/accessibility/react-editors.spec.js`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: completed multi-slot API/UI and Builder v7 behavior.
- Produces: end-to-end accessibility evidence and player-facing release notes.

- [ ] **Step 1: Add failing browser coverage for the five hand rows**

Update the Builder fixture fragment to request `slots`, return role-specific candidates, and add one test named `Builder models five hand rows with one three-hand pool`. Assert:

- equipment rows contain exactly one Shield, one Wield, and three Hold labels;
- a `[14, 15]` weapon appears in both Wield and Hold pickers;
- the Slot Filter is absent;
- Shield + two-handed Wield disables a normal candidate in an empty Hold row;
- replacing the two-handed Wield with a one-handed Wield remains enabled;
- the disabled candidate exposes the three-hands explanation; and
- axe reports no violations for the open picker.

- [ ] **Step 2: Add failing browser coverage for the multi-slot editor**

Open the item editor with Wield and Hold selected. Assert the Slots fieldset has 22 named checkboxes, keyboard interaction can add/remove a capability, Other clears the wearable choices, the Save button reflects empty/nonempty validity, and axe reports no violations.

- [ ] **Step 3: Run the new browser tests and verify the intended failures**

Run from `www/`:

```bash
npm run test:a11y -- --grep "five hand rows|multi-slot editor"
```

Expected: FAIL until fixtures and final accessibility details match the new UI.

- [ ] **Step 4: Complete fixtures and accessibility behavior**

Use v6 strings only when a scenario is explicitly testing legacy input. All newly saved fixture responses use version 7 and `payloadVersion: 7`. Ensure checkbox labels, fieldset legend, disabled-result explanation, dialog focus, and row/button disabled states match the unit-tested semantics.

- [ ] **Step 5: Add the player-facing changelog entry**

Under `3.1.0-beta` add:

```markdown
- Items can now list every place they may be worn, so Item Search and Builder find the same item in each valid slot without requiring duplicate entries.
- Builder now models Legend characters' three hands with one Shield row, one Wield row, and three Hold rows, including the two-hand cost of two-handed equipment.
```

- [ ] **Step 6: Run focused browser tests**

Run from `www/`:

```bash
npm run test:a11y -- --grep "five hand rows|multi-slot editor|item name cells|picker item rows"
```

Expected: PASS.

- [ ] **Step 7: Run the complete repository verification set**

Run from `www/`:

```bash
npm test
npm run test:a11y
```

Run from the repository root:

```bash
npm --prefix css test
node --test scripts/test/*.test.js
git diff --check
```

Expected: all unit, script, lint, and relevant browser tests PASS. If the broad Playwright run reproduces a pre-existing shared-state or contrast failure, rerun the failing spec alone, record both outputs, and do not describe it as caused or fixed by this feature without evidence.

- [ ] **Step 8: Inspect migration/data invariants and final diff**

On the isolated local test database after migration, run read-only assertions through the existing MySQL container:

```sql
SELECT COUNT(*) AS InvalidMasks
FROM Items
WHERE SlotMask = 0
   OR (SlotMask & ~4194303) <> 0
   OR (SlotMask & (1 << Slot)) = 0
   OR ((SlotMask & (1 << 21)) <> 0 AND SlotMask <> (1 << 21));
```

Expected: `InvalidMasks = 0`. Compare `COUNT(*)` and `COUNT(DISTINCT Id)` before and after migration; both counts must remain identical. Update one disposable fixture item, confirm its audit row contains the previous mask, then restore it through the ordinary test-database teardown.

Inspect:

```bash
git status --short
git diff --stat master...HEAD
git diff --check master...HEAD
```

Confirm the two user-owned untracked spool feedback documents were not added.

- [ ] **Step 9: Commit verification documentation**

```bash
git add CHANGELOG.md www/accessibility/react-builder.spec.js www/accessibility/react-editors.spec.js
git commit -m "test: verify multi-slot item workflows"
```

Do not push, publish images, tag, or deploy; each requires separate authorization.
