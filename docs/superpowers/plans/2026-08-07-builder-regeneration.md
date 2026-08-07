# Builder Regeneration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the level-50 builder's HP, mana, and move regeneration totals, equipment caps, restriction details, and displayed equipment breakdowns to match Legend's current C formulas.

**Architecture:** Keep `game-stats.js` as the source of truth for C-derived natural bonuses and add one shared level-50 regeneration equipment-cap helper. Keep the builder controller's existing aggregation pipeline: normal equipment is capped before Familiar and Other-slot bonuses are added, while the controller asks the service for each governing stat's dynamic allowance.

**Tech Stack:** JavaScript, AngularJS, Node.js built-in test runner, CommonJS browser/service dual export, Markdown.

## Global Constraints

- The builder models level-50 player characters; the normal equipment regeneration cap is `(50 / 3) + 4`, or 20 using C integer division.
- `/Users/toddmckimmey/projects/legendmud/` is read-only. Do not change, format, generate into, or commit anything there.
- Use the builder's capped current Constitution, Mind, and Dexterity values for regeneration; raw over-cap totals remain visible only through existing restriction warnings.
- Cap regeneration from the first 24 equipment positions. Add Familiar and Other-slot regeneration afterward without applying the equipment cap.
- Keep Innate Regeneration represented only by a compensating Other-slot object.
- Do not change the saved-profile format, database schema, item data, era-ability UI, regeneration timing, or non-regeneration stats.
- Keep the public version at `2.6.0-beta`.
- Do not modify the user-owned untracked `docker-compose-prod.yaml`, `.codex/`, or `.idea/` paths.
- Do not push, publish images, deploy, or create/move a release tag without separate authorization for that specific action.

---

### Task 1: C-Derived Regeneration Service Formulas

**Files:**
- Modify: `www/test/game-stats.test.js:103-165`
- Modify: `www/src/public/js/services/game-stats.js:18-228`

**Interfaces:**
- Consumes: `calculateNaturalStatBonus(statName: string, stats: object, items?: object[]): number`
- Produces: `calculateRegenEquipmentCap(governingStat: number): number`
- Produces: natural dependency mappings `hpr -> constitution`, `mar -> mind`, and `mvr -> dexterity`
- Produces: C-derived natural bonuses for `hpr`, `mar`, and `mvr`

- [ ] **Step 1: Replace the obsolete regeneration assertion with failing formula and cap tests**

In `www/test/game-stats.test.js`, keep the mitigation and AC assertions in a renamed defensive test, and add these focused tests:

```js
test("defensive formulas retain their current behavior", function() {
    const items = Array(26).fill(null);
    items[25] = {id: 1144};

    assert.equal(calculate("mitigation", {constitution: 80}, items), 1);
    assert.equal(calculate("ac", {
        strength: 40,
        dexterity: 40,
        constitution: 40,
        perception: 40
    }), 72);
});

test("natural regeneration mirrors Legend stat formulas", function() {
    assert.equal(calculate("hpr", {constitution: 79}), 7);
    assert.equal(calculate("hpr", {constitution: 80}), 9);
    assert.equal(calculate("hpr", {constitution: 100}), 15);
    assert.equal(calculate("hpr", {constitution: 105}), 16);
    assert.equal(calculate("hpr", {constitution: 110}), 19);

    assert.equal(calculate("mar", {mind: 79}), 7);
    assert.equal(calculate("mar", {mind: 80}), 9);
    assert.equal(calculate("mar", {mind: 100}), 15);
    assert.equal(calculate("mar", {mind: 105}), 18);
    assert.equal(calculate("mar", {mind: 110}), 23);

    assert.equal(calculate("mvr", {dexterity: 53}), 0);
    assert.equal(calculate("mvr", {dexterity: 54}), 1);
    assert.equal(calculate("mvr", {dexterity: 79}), 6);
    assert.equal(calculate("mvr", {dexterity: 80}), 7);
    assert.equal(calculate("mvr", {dexterity: 100}), 15);
    assert.equal(calculate("mvr", {dexterity: 105}), 17);
});

test("regeneration equipment allowance includes the high-stat contribution", function() {
    assert.equal(gameStats.calculateRegenEquipmentCap(79), 20);
    assert.equal(gameStats.calculateRegenEquipmentCap(80), 19);
    assert.equal(gameStats.calculateRegenEquipmentCap(100), 15);
    assert.equal(gameStats.calculateRegenEquipmentCap(105), 14);
});

test("regeneration formulas safely default missing governing stats", function() {
    assert.equal(calculate("hpr", {}), 0);
    assert.equal(calculate("mar", {}), 0);
    assert.equal(calculate("mvr", {}), 0);
});
```

Extend `natural stat dependency lookup is isolated from callers` with:

```js
assert.deepEqual(gameStats.getNaturalStatDependencies("hpr"), [
    "constitution"
]);
assert.deepEqual(gameStats.getNaturalStatDependencies("mar"), [
    "mind"
]);
assert.deepEqual(gameStats.getNaturalStatDependencies("mvr"), [
    "dexterity"
]);
```

Extend `browser loading registers the game-stat module with AngularJS` with:

```js
assert.equal(typeof registeredGameStats.calculateRegenEquipmentCap, "function");
assert.equal(registeredGameStats.calculateRegenEquipmentCap(100), 15);
```

- [ ] **Step 2: Run the service test and verify the new behavior fails**

Run from `www/`:

```bash
node --test test/game-stats.test.js
```

Expected: FAIL because `calculateRegenEquipmentCap` is undefined, the old HP regen formula returns 11 instead of 15 at Constitution 100, and `mar`/`mvr` return zero.

- [ ] **Step 3: Add the shared equipment-cap helpers and dependencies**

In `www/src/public/js/services/game-stats.js`, add `mar` and `mvr` to `naturalStatDependencies`:

```js
ac: ["strength", "dexterity", "constitution", "perception"],
hpr: ["constitution"],
mar: ["mind"],
mvr: ["dexterity"]
```

Near the existing equipment-cap functions, add:

```js
const LEVEL_50_REGEN_EQUIPMENT_CAP = Math.trunc(50 / 3) + 4;

function normalizeRegenStat(value) {
    const stat = Number(value);
    return Number.isFinite(stat) ? stat : 0;
}

function calculateRegenInsideCapContribution(value) {
    const stat = normalizeRegenStat(value);
    return stat > 79 ? Math.trunc((stat - 75) / 5) : 0;
}

function calculateRegenEquipmentCap(governingStat) {
    return LEVEL_50_REGEN_EQUIPMENT_CAP -
        calculateRegenInsideCapContribution(governingStat);
}
```

Add this comment above the helpers:

```js
/*
 * Legend's get_*_regen_evt() functions add the high-stat contribution to
 * object regeneration before get_max_regen() applies the level-50 cap of 20.
 * Reducing the builder's equipment allowance by the same contribution keeps
 * MIN(equipment + stat contribution, 20) equivalent to the C calculation.
 */
```

- [ ] **Step 4: Replace the obsolete HP formula and add mana/move formulas**

At the start of `calculateNaturalStatBonus()`, safely initialize `stats`:

```js
stats = stats || {};
items = items || [];
```

Replace the current `hpr` case and add `mar` and `mvr` cases:

```js
case "hpr": {
    const con = normalizeRegenStat(stats.constitution);
    let naturalBonus = Math.trunc(con / 10);
    if (con > 100) {
        naturalBonus += Math.trunc((con - 100) / 10);
    }

    return calculateRegenInsideCapContribution(con) + naturalBonus;
}
case "mar": {
    const mind = normalizeRegenStat(stats.mind);
    let naturalBonus = Math.trunc(mind / 10);
    if (mind > 100) {
        naturalBonus += Math.trunc((mind - 100) / 2);
    }

    return calculateRegenInsideCapContribution(mind) + naturalBonus;
}
case "mvr": {
    const dex = normalizeRegenStat(stats.dexterity);
    const naturalBonus = dex > 53 ? Math.trunc((dex - 49) / 5) : 0;

    return calculateRegenInsideCapContribution(dex) + naturalBonus;
}
```

Add this comment immediately before the three cases:

```js
/*
 * These natural terms mirror get_hp_regen_con_bonus_internal(),
 * get_mana_regen_mind_bonus(), and get_move_regen_wsp(). Innate
 * Regeneration and spell/ability bonuses are supplied separately by the
 * builder's uncapped Familiar and Other slots.
 */
```

Export the new public helper:

```js
return {
    calculateDamrollEquipmentCap,
    calculateHitrollEquipmentCap,
    calculateNaturalStatBonus,
    calculateRegenEquipmentCap,
    getNaturalStatDependencies,
    normalizeQuestResourceBonus
};
```

- [ ] **Step 5: Run the focused service tests**

Run from `www/`:

```bash
node --test test/game-stats.test.js
```

Expected: PASS with all service tests green.

- [ ] **Step 6: Check the diff and commit the service behavior**

Run from the repository root:

```bash
git diff --check
git diff -- www/src/public/js/services/game-stats.js www/test/game-stats.test.js
git add www/src/public/js/services/game-stats.js www/test/game-stats.test.js
git commit -m "Correct builder regeneration formulas"
```

Expected: no whitespace errors; the commit contains only the service and its focused tests.

---

### Task 2: Builder Caps, Restrictions, and Display

**Files:**
- Modify: `www/test/builder-game-stats.test.js:84-162`
- Modify: `www/test/builder-game-stats.test.js` after the damroll regression tests
- Modify: `www/src/public/js/controllers/builder/main.js:2004-2031`
- Modify: `www/src/public/js/controllers/builder/main.js:2217-2224`

**Interfaces:**
- Consumes: `gameStats.calculateRegenEquipmentCap(governingStat: number): number` from Task 1
- Consumes: `gameStats.calculateNaturalStatBonus("hpr" | "mar" | "mvr", stats): number` from Task 1
- Produces: dynamic normal-equipment limits for `hpr`, `mar`, and `mvr`
- Produces: display strings `total (effective equipment)` for all three regen stats

- [ ] **Step 1: Expand the builder test fixture for regeneration stats**

In `createBuilderScope()`, add the three regen fields to `scope.statInfo`:

```js
"hit",
"dam",
"hpr",
"mar",
"mvr"
```

Add a host-context restriction normalizer after `createBuilderScope()` so VM
objects can be compared reliably:

```js
function getRestrictions(scope, statName) {
    return Array.from(scope.statRestrictions[statName], function(entry) {
        return {
            restriction: entry.restriction,
            amount: entry.amount,
            limit: entry.limit
        };
    });
}
```

Update `equipStats()` so each governing base stat can be set independently while preserving existing test defaults:

```js
baseStats: {
    strength: overrides.strength ?? 90,
    mind: overrides.mind ?? 90,
    dexterity: overrides.dexterity ?? 90,
    constitution: overrides.constitution ?? 90,
    perception: 90,
    spirit: 90,
    amulet: -1,
    hazelnut: -1,
    longhouse: -1,
    quest_hp: overrides.quest_hp || 0,
    quest_mana: overrides.quest_mana || 0,
    quest_move: overrides.quest_move || 0
}
```

- [ ] **Step 2: Add failing builder integration tests**

Add these tests after the damroll cap tests:

```js
test("builder applies dynamic regen caps and uncapped Other bonuses", function() {
    const scope = createBuilderScope();
    equipStats(scope, {
        mind: 100,
        dexterity: 100,
        constitution: 100,
        equipment: {hpr: 30, mar: 30, mvr: 30},
        other: {hpr: 3, mar: 3, mvr: 3}
    });

    for (const statName of ["hpr", "mar", "mvr"]) {
        assert.equal(scope.getStatTotal(statName), "33 (15)");
        assert.deepEqual(getRestrictions(scope, statName), [{
            restriction: "fromItems",
            amount: 30,
            limit: 15
        }]);
    }
});

test("builder uses capped current stats for all regen calculations", function() {
    const scope = createBuilderScope();
    equipStats(scope, {
        mind: 90,
        dexterity: 90,
        constitution: 90,
        equipment: {
            mind: 20,
            mindCap: 4,
            dexterity: 20,
            dexterityCap: 4,
            constitution: 20,
            constitutionCap: 4,
            hpr: 30,
            mar: 30,
            mvr: 30
        },
        other: {}
    });

    for (const statName of ["mind", "dexterity", "constitution"]) {
        assert.equal(scope.getStatTotal(statName), 104);
        assert.deepEqual(getRestrictions(scope, statName), [{
            restriction: "fromTotalMax",
            amount: 110,
            limit: 104
        }]);
    }

    assert.equal(scope.getStatTotal("hpr"), "30 (15)");
    assert.equal(scope.getStatTotal("mar"), "32 (15)");
    assert.equal(scope.getStatTotal("mvr"), "31 (15)");
    for (const statName of ["hpr", "mar", "mvr"]) {
        assert.deepEqual(getRestrictions(scope, statName), [{
            restriction: "fromItems",
            amount: 30,
            limit: 15
        }]);
    }
});
```

`getRestrictions()` creates both the array and its entry objects in the host
context because the original restrictions originate inside the VM context.

- [ ] **Step 3: Run the builder tests and verify the controller behavior fails**

Run from `www/`:

```bash
node --test test/builder-game-stats.test.js
```

Expected: FAIL because Mana Regen and Move Regen still use a static cap of 20
and do not show an equipment breakdown. The HP assertions already exercise the
same shared helper behavior established in Task 1.

- [ ] **Step 4: Use the shared dynamic caps in the controller**

In `getItemTotalMax()`, replace the existing regen cases with:

```js
case "hpr":
    max = gameStats.calculateRegenEquipmentCap(
        $scope.getStatTotal("constitution")
    );
    break;
case "mar":
    max = gameStats.calculateRegenEquipmentCap(
        $scope.getStatTotal("mind")
    );
    break;
case "mvr":
    max = gameStats.calculateRegenEquipmentCap(
        $scope.getStatTotal("dexterity")
    );
    break;
```

Do not change the existing loops: indices `0..23` remain normal equipment and indices `24..items.length - 1` remain uncapped Familiar/Other contributions.

- [ ] **Step 5: Display the effective equipment contribution for every regen stat**

In the final formatting switch in `getStatTotal()`, add `mar` and `mvr` beside `hpr`:

```js
case "dam":
case "hit":
case "hpr":
case "mar":
case "mvr":
case "spelldam":
case "spellcrit":
    total = total + " (" + fromItems + ")";
    break;
```

- [ ] **Step 6: Run focused and combined regeneration tests**

Run from `www/`:

```bash
node --test test/builder-game-stats.test.js
node --test test/game-stats.test.js test/builder-game-stats.test.js
```

Expected: PASS; existing hitroll, damroll, resource, and import regressions remain green.

- [ ] **Step 7: Check the diff and commit the builder integration**

Run from the repository root:

```bash
git diff --check
git diff -- www/src/public/js/controllers/builder/main.js www/test/builder-game-stats.test.js
git add www/src/public/js/controllers/builder/main.js www/test/builder-game-stats.test.js
git commit -m "Apply dynamic builder regeneration caps"
```

Expected: no whitespace errors; the commit contains only controller integration and builder regression tests.

---

### Task 3: Public Changelog and Complete Verification

**Files:**
- Modify: `www/test/changelog.test.js` after the imports and helper definitions
- Modify: `CHANGELOG.md:20-28`

**Interfaces:**
- Consumes: the completed service and builder behavior from Tasks 1 and 2
- Produces: public `2.6.0-beta` release-note coverage for the regeneration fix

- [ ] **Step 1: Add a failing changelog regression test**

In `www/test/changelog.test.js`, add:

```js
test("tracked changelog records the builder regeneration fix", () => {
    const tracked = fs.readFileSync(path.join(__dirname, "../../CHANGELOG.md"), "utf8");

    assert.match(tracked,
        /Corrected builder hit point, mana, and move regeneration/);
    assert.match(tracked, /stat-adjusted equipment caps/);
});
```

- [ ] **Step 2: Run the changelog test and verify the release note is missing**

Run from `www/`:

```bash
node --test test/changelog.test.js
```

Expected: FAIL because the tracked changelog does not yet contain the regeneration correction.

- [ ] **Step 3: Add the public bug-fix entry**

Under `## [2.6.0-beta] - 2026-08-05` → `### Fixed` in root `CHANGELOG.md`, add:

```markdown
- Corrected builder hit point, mana, and move regeneration to match Legend's current stat bonuses and stat-adjusted equipment caps while leaving Familiar and Other-slot bonuses uncapped.
```

Do not change the version or date.

- [ ] **Step 4: Run changelog and complete test suites**

Run from `www/`:

```bash
node --test test/changelog.test.js
npm test
```

Expected: the changelog tests pass; the complete suite has zero failures and only the existing expected migration skip.

- [ ] **Step 5: Perform final static and scope checks**

Run from the repository root:

```bash
git diff --check
git status --short --branch
git diff --stat HEAD
git diff -- CHANGELOG.md www/test/changelog.test.js
```

Expected: no whitespace errors; only the intended changelog and changelog-test files remain uncommitted for this task, alongside the user's untouched untracked paths.

- [ ] **Step 6: Commit the public documentation**

Run from the repository root:

```bash
git add CHANGELOG.md www/test/changelog.test.js
git commit -m "Record builder regeneration fix"
git status --short --branch
```

Expected: the commit succeeds; the feature branch is clean except for the pre-existing user-owned untracked paths.
