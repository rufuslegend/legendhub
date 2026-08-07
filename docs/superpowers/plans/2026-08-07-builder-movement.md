# Builder Movement Formula Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the level-50 builder's maximum-movement total to follow Legend's capped-dexterity-only calculation while retaining explicit Quest Mv and faux-item bonuses.

**Architecture:** Keep the source-derived calculation in the shared `gameStats` service, where natural resource formulas already live. Change movement's declared dependency to dexterity only, express the configured level-50 C calculation with named constants, add Quest Mv in `gameStats`, and let the existing builder total pipeline continue adding equipment, Familiar, and Other-slot values.

**Tech Stack:** Browser-compatible JavaScript, AngularJS builder controller, Node.js built-in test runner, CommonJS test loading.

## Global Constraints

- Treat `/Users/toddmckimmey/projects/legendmud/current` as read-only; do not modify the Legend source repository.
- Model level 50 only; do not add support for levels 1 through 49 or a configurable builder level.
- Use capped current dexterity as the only stat-derived movement input.
- Add normalized Quest Mv exactly once.
- Preserve existing equipment, spell, Familiar, and Other-slot movement behavior without adding a movement cap.
- Exclude Physical Enhancement from the natural formula because its faux builder item supplies the 20 movement.
- Do not alter Quest Mv storage, import, export, or normalization.
- Do not change movement regeneration or any other stat formula.
- Keep the changelog version at `2.6.0-beta`.
- Do not publish images, deploy, tag, push, or promote a release without separate authorization.
- Leave `.codex/`, `.idea/`, and the user-owned untracked `docker-compose-prod.yaml` untouched.

---

## File Structure

- `www/src/public/js/services/game-stats.js`: owns natural stat dependencies and the C-derived level-50 movement formula.
- `www/test/game-stats.test.js`: verifies movement formula boundaries, quest addition, and dexterity-only dependency behavior in isolation.
- `www/test/builder-game-stats.test.js`: verifies capped builder stats and equipment/faux-item movement combine through the real controller path.
- `CHANGELOG.md`: records the public-facing movement correction under `2.6.0-beta`.

### Task 1: Implement the dexterity-only level-50 movement calculation

**Files:**
- Modify: `www/test/game-stats.test.js:13-37`
- Modify: `www/test/builder-game-stats.test.js:344-370`
- Modify: `www/src/public/js/services/game-stats.js:20-24,158-161`

**Interfaces:**
- Consumes: `gameStats.calculateNaturalStatBonus(statName, stats, items)` and `gameStats.getNaturalStatDependencies(statName)`.
- Produces: `getNaturalStatDependencies("mv") -> ["dexterity"]` and `calculateNaturalStatBonus("mv", stats, items) -> number` using the configured level-50 movement formula.

- [ ] **Step 1: Write failing service tests for the C-derived formula and dependency**

In `www/test/game-stats.test.js`, remove the existing movement assertion from `natural resource formulas default missing quest bonuses to zero` and add this focused test immediately after the HP test:

```js
test("natural movement mirrors the level-50 Legend calculation", function() {
    assert.deepEqual(gameStats.getNaturalStatDependencies("mv"), ["dexterity"]);
    assert.equal(calculate("mv", {constitution: 100, dexterity: 0}), 346);
    assert.equal(calculate("mv", {constitution: 100, dexterity: 30}), 496);
    assert.equal(calculate("mv", {constitution: 100, dexterity: 50}), 596);
    assert.equal(calculate("mv", {constitution: 30, dexterity: 100}), 846);
    assert.equal(calculate("mv", {constitution: 30, dexterity: 105}), 871);
});
```

Keep the existing Quest Mv assertion, but reduce its inputs to the actual movement dependency:

```js
assert.equal(calculate("mv", {
    dexterity: 50,
    quest_move: 29
}), 625);
```

- [ ] **Step 2: Write a failing builder integration test for capped dexterity, higher constitution, Quest Mv, equipment, and the faux item**

Add this test after `builder applies each quest bonus only to its matching resource` in `www/test/builder-game-stats.test.js`:

```js
test("builder movement uses capped dexterity and keeps faux-item bonuses additive", function() {
    const scope = createBuilderScope();
    equipStats(scope, {
        dexterity: 90,
        constitution: 100,
        quest_move: 29,
        equipment: {
            dexterity: 20,
            dexterityCap: 4,
            constitution: 20,
            constitutionCap: 10,
            mv: 11
        },
        other: {mv: 20}
    });

    assert.equal(scope.getStatTotal("dexterity"), 104);
    assert.equal(scope.getStatTotal("constitution"), 110);
    assert.deepEqual(getRestrictions(scope, "dexterity"), [{
        restriction: "fromTotalMax",
        amount: 110,
        limit: 104
    }]);
    assert.equal(scope.getStatTotal("mv"), 926);
});
```

The expected total is `346` rerolled movement + `520` from capped 104 dexterity + `29` Quest Mv + `11` equipment movement + `20` from the Physical Enhancement faux item.

- [ ] **Step 3: Run the focused tests and verify the new regressions fail for the intended reason**

Run from `www/`:

```bash
node --test test/game-stats.test.js test/builder-game-stats.test.js
```

Expected: FAIL. The service dependency is still `["constitution", "dexterity"]`; movement with constitution 100 and lower dexterity is too high; the builder integration total is `956` because the old formula uses constitution 110 instead of capped dexterity 104.

- [ ] **Step 4: Replace the opaque movement expression with the configured C calculation**

In `www/src/public/js/services/game-stats.js`, change the movement dependency to:

```js
mv: ["dexterity"],
```

Replace the current `case "mv"` implementation with:

```js
case "mv": {
    /*
     * The builder models level-50 characters. reroll_move_internal() starts
     * with BASE_MOVE (150) and adds MOVE_PER_LEVEL (4) for levels 2 through
     * 50, producing a stat-independent rerolled base of 346.
     *
     * MV_STATIC_SUBTITUTE_FOR_DEX is configured to zero, so mv_for_stat()
     * uses capped current dexterity: (level * dexterity) / MV_DIV. Quest Mv
     * is explicit, while Physical Enhancement remains represented by its
     * faux builder item and must not also be included here.
     */
    const level = 50;
    const baseMove = 150;
    const movePerLevel = 4;
    const moveForStatDiv = Math.max(10, 1);
    const rerolledMove = baseMove + (movePerLevel * (level - 1));
    const moveForDexterity = Math.trunc(
        (level * stats.dexterity) / moveForStatDiv
    );

    return rerolledMove + moveForDexterity +
        normalizeQuestResourceBonus(stats.quest_move);
}
```

Do not add a `PhysicalEnhancement` flag or special case to the service. Do not change the generic builder total path; it already adds equipment and Other-slot movement after the natural calculation.

- [ ] **Step 5: Run the focused tests and verify they pass**

Run from `www/`:

```bash
node --test test/game-stats.test.js test/builder-game-stats.test.js
```

Expected: PASS. In particular, constitution 100 with dexterity 50 produces 596 natural movement, the builder uses capped dexterity 104 even though capped constitution is 110, and the integrated total is 926.

- [ ] **Step 6: Review the focused diff and commit the implementation**

Run from the repository root:

```bash
git diff --check
git diff -- www/src/public/js/services/game-stats.js www/test/game-stats.test.js www/test/builder-game-stats.test.js
git status --short
```

Confirm only the three Task 1 files are modified and the user-owned untracked files remain untouched. Then commit:

```bash
git add www/src/public/js/services/game-stats.js www/test/game-stats.test.js www/test/builder-game-stats.test.js
git commit -m "Correct builder movement formula"
```

### Task 2: Record and fully verify the movement correction

**Files:**
- Modify: `CHANGELOG.md:20-29`

**Interfaces:**
- Consumes: the completed dexterity-only movement calculation from Task 1.
- Produces: a public `2.6.0-beta` changelog entry describing the corrected behavior.

- [ ] **Step 1: Add the changelog entry**

Add this bullet at the top of the `### Fixed` section in `CHANGELOG.md`:

```markdown
- Corrected level-50 builder movement to use Legend's current capped-dexterity-only formula while retaining entered Quest Mv and faux-item bonuses.
```

Do not change the version or date.

- [ ] **Step 2: Run focused release-record verification**

Run from `www/`:

```bash
node --test test/game-stats.test.js test/builder-game-stats.test.js test/changelog.test.js
```

Expected: PASS with no failures.

- [ ] **Step 3: Run the complete repository verification suite**

Run these commands from the repository root:

```bash
node --test scripts/test/*.test.js
(cd www && npm test)
(cd css && npm test)
git diff --check
```

Expected: all script tests, all web tests apart from any documented expected skip, and CSS checks pass; `git diff --check` produces no output.

- [ ] **Step 4: Review scope and commit the release record**

Run:

```bash
git diff -- CHANGELOG.md
git status --short --branch
```

Confirm `CHANGELOG.md` is the only tracked change and `.codex/`, `.idea/`, and `docker-compose-prod.yaml` remain untracked and untouched. Then commit:

```bash
git add CHANGELOG.md
git commit -m "Record builder movement fix"
```

- [ ] **Step 5: Perform final commit-level verification**

Run from the repository root after the commit:

```bash
git status --short --branch
git log -3 --oneline --decorate
git diff --check master...HEAD
git diff --stat master...HEAD
```

Expected: the branch contains the design, plan, implementation, and changelog commits; only the known user-owned paths are untracked; the branch diff contains only the movement fix, tests, changelog, and planning documents. Do not push or deploy without fresh authorization.
