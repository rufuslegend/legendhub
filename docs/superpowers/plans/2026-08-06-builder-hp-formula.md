# Builder HP Formula Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the level-50 builder HP total mirror the current Legend base and constitution calculation while treating Quest HP as the complete explicit quest bonus.

**Architecture:** Keep `game-stats.js` as the source of truth for natural resource formulas and translate the C calculation structurally with named local values. The builder controller continues to add equipment, spells, familiars, and Other-slot objects independently, so the Physical Endurance compensating object remains outside natural HP.

**Tech Stack:** Browser-compatible JavaScript, AngularJS builder controller, Node.js 22 built-in test runner, CommonJS service tests, Markdown changelog.

## Global Constraints

- Treat `/Users/toddmckimmey/projects/legendmud/` as strictly read-only.
- Model level-50 characters only; do not add a level selector or generalized level API.
- Use `BASE_HP = 20`, `HP_PER_LEVEL = 4`, `CON_FOR_ADDITIONAL_HP_CUTOFF = 89`, and `HP_FOR_CON_DIV = 10`.
- Quest HP is the complete explicit total of permanent quest HP, including the five India boosts; assume none internally.
- Missing or zero Quest HP continues to normalize to zero through `normalizeQuestResourceBonus()`.
- Physical Endurance remains represented only by its compensating object and must not be included in natural HP.
- Do not change equipment, spell, familiar, Other-slot, persistence, or non-HP stat behavior.
- Keep the public version at `2.6.0-beta`.
- Do not push, publish images, tag, deploy, or promote a release without separate authorization.

---

### Task 1: Mirror the Legend HP calculation

**Files:**
- Modify: `www/test/game-stats.test.js:13-28,119-136`
- Modify: `www/test/builder-game-stats.test.js:217-231`
- Modify: `www/src/public/js/services/game-stats.js:85-95`

**Interfaces:**
- Consumes: `calculateNaturalStatBonus("hp", stats, items)`, where `stats.constitution` is the final current constitution and `stats.quest_hp` is the optional explicit quest total.
- Produces: The existing numeric return from `calculateNaturalStatBonus("hp", stats, items)` with no signature or export changes.

- [ ] **Step 1: Add focused failing service tests for the C boundaries**

In `www/test/game-stats.test.js`, remove the two HP assertions from `natural resource formulas default missing quest bonuses to zero` and add this focused test immediately before it:

```js
test("natural HP mirrors the level-50 Legend calculation", function() {
    assert.equal(calculate("hp", {constitution: 30}), 366);
    assert.equal(calculate("hp", {constitution: 89}), 661);
    assert.equal(calculate("hp", {constitution: 90}), 666);
    assert.equal(calculate("hp", {constitution: 91}), 676);
    assert.equal(calculate("hp", {constitution: 100}), 766);
});
```

Update the HP assertion in `natural resource formulas add their matching quest bonuses` so it proves that Quest HP is added exactly once:

```js
assert.equal(calculate("hp", {constitution: 30, quest_hp: 17}), 383);
```

Extend `natural stat dependency lookup is isolated from callers` with the unchanged HP dependency contract:

```js
assert.deepEqual(gameStats.getNaturalStatDependencies("hp"), [
    "constitution"
]);
```

- [ ] **Step 2: Update the builder integration expectation**

In `www/test/builder-game-stats.test.js`, update the HP assertion in `builder applies each quest bonus only to its matching resource`. The fixture has 90 constitution, 17 Quest HP, and no HP equipment, so it must expect:

```js
assert.equal(scope.getStatTotal("hp"), 683);
```

Leave the mana and movement expectations unchanged.

- [ ] **Step 3: Run the focused tests and verify the old formula fails**

Run from `www/`:

```bash
node --test test/game-stats.test.js test/builder-game-stats.test.js
```

Expected: FAIL on HP assertions because the old builder calculation includes an implicit 15 quest HP and uses the former high-constitution adjustment. The mana, movement, persistence, and non-HP tests should remain passing.

- [ ] **Step 4: Translate the C calculation directly**

Replace the `case "hp"` body in `www/src/public/js/services/game-stats.js` with:

```js
case "hp": {
    /*
     * The builder models level-50 characters. Mirror reroll_hps_internal()
     * and hp_for_con_internal() using the current Legend configuration.
     * Quest HP supplies all permanent quest boosts, including the five India
     * boosts. Physical Endurance is represented by a compensating object.
     */
    const level = 50;
    const baseHp = 20;
    const hpPerLevel = 4;
    const conCutoff = 89;
    const hpForConDiv = Math.max(10, 1);
    const rerolledHp = baseHp + (hpPerLevel * (level - 1));
    let effectiveConstitution = stats.constitution;

    if (effectiveConstitution > conCutoff) {
        effectiveConstitution += effectiveConstitution - conCutoff - 1;
    }

    const hpForConstitution = Math.trunc(
        (level * effectiveConstitution) / hpForConDiv
    );

    return rerolledHp + hpForConstitution +
        normalizeQuestResourceBonus(stats.quest_hp);
}
```

Do not change `naturalStatDependencies`, `normalizeQuestResourceBonus()`, or any other stat case.

- [ ] **Step 5: Run the focused tests and verify they pass**

Run from `www/`:

```bash
node --test test/game-stats.test.js test/builder-game-stats.test.js
```

Expected: all focused tests PASS, including the 89/90/91 constitution boundary and the builder Quest HP integration.

- [ ] **Step 6: Commit the formula and tests**

Run from the repository root:

```bash
git add www/src/public/js/services/game-stats.js www/test/game-stats.test.js www/test/builder-game-stats.test.js
git commit -m "Correct builder HP calculation"
```

### Task 2: Record and verify the correction

**Files:**
- Modify: `CHANGELOG.md:17-23`
- Verify: `www/test/changelog.test.js`

**Interfaces:**
- Consumes: The corrected level-50 HP behavior from Task 1.
- Produces: A user-facing `2.6.0-beta` changelog entry; no runtime interface changes.

- [ ] **Step 1: Add the public changelog entry**

Under `## [2.6.0-beta]` → `### Fixed` in `CHANGELOG.md`, add:

```markdown
- Corrected level-50 builder hit points to mirror Legend's current base and constitution formulas while using entered Quest HP instead of assuming India quest boosts.
```

Keep the version and date unchanged.

- [ ] **Step 2: Run the changelog test**

Run from `www/`:

```bash
node --test test/changelog.test.js
```

Expected: all changelog tests PASS and the tracked Markdown remains renderable through the public changelog route.

- [ ] **Step 3: Run the complete web test suite**

Run from `www/`:

```bash
npm test
```

Expected: all tests PASS except any test explicitly marked as skipped. No existing mana, movement, hitroll, damroll, builder persistence, or route behavior regresses.

- [ ] **Step 4: Check patch formatting and scope**

Run from the repository root:

```bash
git diff --check
git status --short
```

Expected: `git diff --check` produces no output. Status shows only `CHANGELOG.md` plus the known user-owned untracked `.codex/`, `.idea/`, and `docker-compose-prod.yaml`; application/test files from Task 1 are already committed. Confirm no path beneath `/Users/toddmckimmey/projects/legendmud/` was modified.

- [ ] **Step 5: Commit the release record**

Run from the repository root:

```bash
git add CHANGELOG.md
git commit -m "Record builder HP correction"
```

- [ ] **Step 6: Verify the completed branch from a clean application diff**

Run from `www/`:

```bash
npm test
```

Then run from the repository root:

```bash
git diff --check master...HEAD
git status --short --branch
```

Expected: the full suite still passes, the branch diff has no whitespace errors, and only the known user-owned untracked files remain. Do not push or deploy.
