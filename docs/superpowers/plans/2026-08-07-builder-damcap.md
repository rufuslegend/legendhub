# Builder Damage Cap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a builder melee damage-cap total that matches Legend's normal configured base, capped-strength contribution, dynamic item modifiers, and two-handed Wield bonus.

**Architecture:** Extend the shared `gameStats` natural-stat service with the source-derived base and strength calculation, then add the two-handed Wield rule by inspecting the selected item array. Keep item, Familiar, and Other-slot damage-cap modifiers in the builder's existing generic aggregation path; the `meleedamcap` schema, editor, Melee-category metadata, and hidden-by-default column behavior already exist and remain unchanged.

**Tech Stack:** Browser-compatible JavaScript, AngularJS builder controller, Node.js built-in test runner, CommonJS test loading, Markdown changelog.

## Global Constraints

- Treat `/Users/toddmckimmey/projects/legendmud/current` as read-only; do not modify the Legend source repository or `sysconfig.lst`.
- Use `DAMCAP = 102` and `DAMCAP_TWOHANDED_BONUS = 64` from the current Legend configuration.
- Derive damage cap from capped current strength, never the raw over-cap strength total.
- Add editable `meleedamcap` modifiers from equipment, Familiar, and Other slots through the existing builder aggregation path.
- Apply the 64-point two-handed bonus only to a selected item with `slot == 14` and `twoHanded` enabled.
- Keep `MeDamCap` in the Melee category and hidden by default under “Hide/Show Columns.”
- Do not model Evasion, Deadly Precision, or other temporary combat states.
- Do not add a damage-cap limit, warning, parenthesized equipment subtotal, builder base field, or saved-list format change.
- Do not change the item schema, migrations, GraphQL types, item editor, column metadata, or other stat formulas.
- Keep the changelog version at `2.6.0-beta`.
- Do not publish images, deploy, tag, push, or promote a release without separate authorization.
- Leave `.codex/`, `.idea/`, and the user-owned untracked `docker-compose-prod.yaml` untouched.

---

## File Structure

- `www/src/public/js/services/game-stats.js`: owns the configured damage-cap base, capped-strength contribution, natural dependency, and two-handed Wield detection.
- `www/test/game-stats.test.js`: verifies the source-derived formula and item-slot boundaries in isolation.
- `www/test/builder-game-stats.test.js`: verifies capped strength and all modifier sources through the real builder controller path.
- `CHANGELOG.md`: records the public-facing builder damage-cap total under `2.6.0-beta`.

The existing `meleedamcap` database column and `ItemStatInfo` row require no changes.

### Task 1: Add the configured base and capped-strength damage-cap calculation

**Files:**
- Modify: `www/test/game-stats.test.js:1-115`
- Modify: `www/test/builder-game-stats.test.js:65-100,240-350`
- Modify: `www/src/public/js/services/game-stats.js:15-35,170-275`

**Interfaces:**
- Consumes: `gameStats.calculateNaturalStatBonus(statName, stats, items)`, `gameStats.getNaturalStatDependencies(statName)`, and the builder's existing capped `$scope.getStatTotal("strength")` dependency resolution.
- Produces: `getNaturalStatDependencies("meleedamcap") -> ["strength"]` and `calculateNaturalStatBonus("meleedamcap", stats, items) -> number` containing the configured base plus Legend's strength contribution.

- [ ] **Step 1: Write failing service tests for the natural dependency and strength boundaries**

Add these tests after the existing natural damroll tests in `www/test/game-stats.test.js`:

```js
test("melee damage cap depends on current strength", function() {
    assert.deepEqual(
        gameStats.getNaturalStatDependencies("meleedamcap"),
        ["strength"]
    );
});

test("natural melee damage cap mirrors Legend's base and strength contribution", function() {
    assert.equal(calculate("meleedamcap", {}), 102);
    assert.equal(calculate("meleedamcap", {strength: 50}), 102);
    assert.equal(calculate("meleedamcap", {strength: 51}), 102);
    assert.equal(calculate("meleedamcap", {strength: 52}), 103);
    assert.equal(calculate("meleedamcap", {strength: 99}), 126);
    assert.equal(calculate("meleedamcap", {strength: 100}), 127);
    assert.equal(calculate("meleedamcap", {strength: 101}), 128);
    assert.equal(calculate("meleedamcap", {strength: 104}), 131);
});
```

- [ ] **Step 2: Expose the existing damage-cap item field to the builder test harness and write a failing integration test**

Add `"meleedamcap"` to `createBuilderScope()`'s `scope.statInfo` array in `www/test/builder-game-stats.test.js`:

```js
"dam",
"meleedamcap",
"hpr",
```

Add this test after the capped-damroll integration tests:

```js
test("builder damage cap uses capped strength and dynamic item modifiers", function() {
    const scope = createBuilderScope();
    equipStats(scope, {
        strength: 90,
        equipment: {
            strength: 20,
            strengthCap: 4,
            meleedamcap: 12
        },
        other: {meleedamcap: 8}
    });

    assert.equal(scope.getStatTotal("strength"), 104);
    assert.deepEqual(getRestrictions(scope, "strength"), [{
        restriction: "fromTotalMax",
        amount: 110,
        limit: 104
    }]);
    assert.equal(scope.getStatTotal("meleedamcap"), 151);
});
```

The expected total is `102` configured base + `29` from capped strength 104 + `12` equipment damage cap + `8` from the Other entry. Raw strength 110 must remain visible only in the existing restriction record.

- [ ] **Step 3: Run the focused tests and verify the new regressions fail for the intended reason**

Run from `www/`:

```bash
node --test test/game-stats.test.js test/builder-game-stats.test.js
```

Expected: FAIL. `getNaturalStatDependencies("meleedamcap")` returns `[]`, the service calculation returns `0`, and the builder returns only the 20 selected modifier points instead of 151. Existing unrelated tests remain green.

- [ ] **Step 4: Add the source-derived base and strength calculation**

In `www/src/public/js/services/game-stats.js`, add the natural dependency beside damroll:

```js
dam: ["strength"],
meleedamcap: ["strength"],
mitigation: ["constitution"],
```

Add this case immediately after the existing `case "dam"` block:

```js
case "meleedamcap": {
    /*
     * Legend initializes ch->damcap from DAMCAP (102). APPLY_DAMCAP is not
     * accumulated in mod_damcap; get_damcap_mod() sums objects and affects
     * on demand, so the builder's generic item path adds those separately.
     */
    const parsedStrength = Number(stats.strength);
    const strength = Number.isFinite(parsedStrength) ?
        Math.trunc(parsedStrength) : 0;
    let damageCap = 102;

    if (strength > 50) {
        damageCap += Math.trunc((strength - 50) / 2);
        if (strength > 100) {
            damageCap += Math.trunc((strength - 99) / 2);
        }
    }

    return damageCap;
}
```

Do not add `meleedamcap` to `getItemTotalMax()`, `getStatTotalMax()`, or the controller's parenthesized-total switch. Do not change the generic item and spell/Familiar/Other summation loops.

- [ ] **Step 5: Run the focused tests and verify they pass**

Run from `www/`:

```bash
node --test test/game-stats.test.js test/builder-game-stats.test.js
```

Expected: PASS. The service returns each specified boundary value, and the builder returns numeric total 151 while retaining the strength restriction `{amount: 110, limit: 104}`.

- [ ] **Step 6: Review and commit the base calculation**

Run from the repository root:

```bash
git diff --check
git diff -- www/src/public/js/services/game-stats.js www/test/game-stats.test.js www/test/builder-game-stats.test.js
git status --short
```

Confirm only the three Task 1 files are modified and user-owned untracked files remain untouched. Then commit:

```bash
git add www/src/public/js/services/game-stats.js www/test/game-stats.test.js www/test/builder-game-stats.test.js
git commit -m "Add builder damage cap calculation"
```

### Task 2: Add the two-handed Wield bonus and release record

**Files:**
- Modify: `www/test/game-stats.test.js:70-135`
- Modify: `www/test/builder-game-stats.test.js:260-390`
- Modify: `www/src/public/js/services/game-stats.js:35-65,220-290`
- Modify: `CHANGELOG.md:20-30`

**Interfaces:**
- Consumes: Task 1's `calculateNaturalStatBonus("meleedamcap", stats, items)` implementation and the selected builder item array whose entries expose `slot` and `twoHanded`.
- Produces: damage-cap natural totals with one 64-point bonus when any selected item represents a two-handed Wield item; a public `2.6.0-beta` changelog entry.

- [ ] **Step 1: Write failing service tests for two-handed item placement**

Add this test after the Task 1 damage-cap service tests in `www/test/game-stats.test.js`:

```js
test("natural melee damage cap adds the two-handed Wield bonus once", function() {
    const stats = {strength: 100};

    assert.equal(calculate("meleedamcap", stats, [
        {slot: 14, twoHanded: true}
    ]), 191);
    assert.equal(calculate("meleedamcap", stats, [
        {slot: 15, twoHanded: true}
    ]), 127);
    assert.equal(calculate("meleedamcap", stats, [
        {slot: 14, twoHanded: false}
    ]), 127);
    assert.equal(calculate("meleedamcap", stats, [
        {slot: 14, twoHanded: true},
        {slot: 14, twoHanded: true}
    ]), 191);
});
```

- [ ] **Step 2: Write a failing builder test for the complete normal profile**

Add this test after the Task 1 builder damage-cap test in `www/test/builder-game-stats.test.js`:

```js
test("builder damage cap includes the two-handed Wield bonus exactly once", function() {
    const scope = createBuilderScope();
    equipStats(scope, {
        strength: 100,
        equipment: {
            slot: 14,
            twoHanded: true,
            meleedamcap: 12
        },
        other: {meleedamcap: 8}
    });

    assert.equal(scope.getStatTotal("meleedamcap"), 211);
});
```

The expected total is `102` configured base + `25` from strength 100 + `12` equipment damage cap + `8` from the Other entry + `64` for the two-handed Wield item.

- [ ] **Step 3: Run the focused tests and verify only the new two-handed regressions fail**

Run from `www/`:

```bash
node --test test/game-stats.test.js test/builder-game-stats.test.js
```

Expected: FAIL. The new service case returns 127 rather than 191 for a two-handed Wield item, and the new builder case returns 147 rather than 211. Task 1's base, strength, modifier, and restriction tests remain green.

- [ ] **Step 4: Implement one-time two-handed Wield detection**

Add this helper near `hasEquippedWeaponUsing()` in `www/src/public/js/services/game-stats.js`:

```js
function hasEquippedTwoHandedWeapon(items) {
    for (let i = 0; i < items.length; ++i) {
        const item = items[i];
        if (item && item.slot == 14 && item.twoHanded) {
            return true;
        }
    }

    return false;
}
```

Before returning `damageCap` from the `case "meleedamcap"` implementation, add:

```js
if (hasEquippedTwoHandedWeapon(items)) {
    damageCap += 64;
}
```

The boolean helper ensures malformed duplicate Wield entries cannot apply the configured bonus more than once. Do not inspect Hold or other slots.

- [ ] **Step 5: Run the focused tests and verify they pass**

Run from `www/`:

```bash
node --test test/game-stats.test.js test/builder-game-stats.test.js
```

Expected: PASS. Strength 100 produces 127 without a two-handed Wield item and 191 with one; the full builder profile produces 211.

- [ ] **Step 6: Add the public changelog entry**

Add this bullet at the top of the `### Fixed` section in `CHANGELOG.md`:

```markdown
- Added the builder's melee damage-cap total using Legend's configured base, capped-strength contribution, item modifiers, and two-handed wield bonus.
```

Do not change the version or date.

- [ ] **Step 7: Run focused release-record verification**

Run from `www/`:

```bash
node --test test/game-stats.test.js test/builder-game-stats.test.js test/changelog.test.js
```

Expected: PASS with no failures.

- [ ] **Step 8: Run the complete repository verification suite**

Run these commands from the repository root:

```bash
node --test scripts/test/*.test.js
(cd www && npm test)
(cd css && npm test)
git diff --check
```

Expected: all script tests, all web tests apart from any documented expected skip, and CSS checks pass; `git diff --check` produces no output.

- [ ] **Step 9: Review scope and commit the completed behavior**

Run:

```bash
git diff --check
git diff -- www/src/public/js/services/game-stats.js www/test/game-stats.test.js www/test/builder-game-stats.test.js CHANGELOG.md
git status --short --branch
```

Confirm only the four Task 2 files are modified and `.codex/`, `.idea/`, and `docker-compose-prod.yaml` remain untracked and untouched. Then commit:

```bash
git add www/src/public/js/services/game-stats.js www/test/game-stats.test.js www/test/builder-game-stats.test.js CHANGELOG.md
git commit -m "Complete builder damage cap calculation"
```

- [ ] **Step 10: Perform final commit-level verification**

Run from the repository root after the commit:

```bash
git status --short --branch
git log -5 --oneline --decorate
git diff --check master...HEAD
git diff --stat master...HEAD
```

Expected: the branch contains the design, plan, base-calculation, and completed-behavior commits; only known user-owned paths remain untracked; the branch diff contains only the approved damage-cap feature, tests, changelog, and planning documents. Do not push or deploy without fresh authorization.
