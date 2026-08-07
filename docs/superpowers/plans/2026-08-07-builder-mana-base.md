# Builder Mana Base Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the level-50 builder use Legend's quest-less 296 reroll mana base and prove Hakim's corrected profile totals 766 mana.

**Architecture:** Keep the existing `gameStats.calculateNaturalStatBonus("ma", stats, items)` interface and builder aggregation flow. Derive the level-50 rerolled mana from named C-equivalent constants inside the service, add the existing current-mind and normalized Quest Mana contributions, and cover both the isolated formula and the builder's cap/equipment aggregation path.

**Tech Stack:** Browser-compatible JavaScript, AngularJS builder controller, Node.js `node:test`, root Markdown changelog.

## Global Constraints

- Treat `/Users/toddmckimmey/projects/legendmud/` as read-only; make no changes there.
- Model only level 50; do not add support for levels 1 through 49 or a configurable builder level.
- Use `BASE_MANA = 100`, `MANA_PER_LEVEL = 4`, level 50, and `MANA_FOR_MIND_DIV = 10` behavior from the inspected Legend source.
- The resulting quest-less rerolled base must be `100 + (4 * (50 - 1)) = 296`.
- Add normalized `quest_mana` exactly once; do not infer individual mana quest flags.
- Keep Mental Enhancement represented by a compensating Other-slot object; do not add it to natural mana.
- Do not change the Quest Mana UI, normalization, serialization, controller data flow, or any non-mana stat formula.
- Keep the public version at `2.6.0-beta`.
- Do not push, publish images, deploy, tag, or modify root `docker-compose-prod.yaml`.

---

### Task 1: Correct and regress the builder mana calculation

**Files:**
- Modify: `www/test/game-stats.test.js:21-30,165-168`
- Modify: `www/test/builder-game-stats.test.js:218-232`
- Modify: `www/src/public/js/services/game-stats.js:110-128`

**Interfaces:**
- Consumes: `calculateNaturalStatBonus(statName: string, stats: object, items?: object[]): number`, `normalizeQuestResourceBonus(value): number`, and `$scope.getStatTotal(statName: string): number|string`.
- Produces: unchanged `calculateNaturalStatBonus` behavior for all stats except corrected `ma` values; natural mana becomes `296 + trunc((50 * stats.mind) / 10) + normalizeQuestResourceBonus(stats.quest_mana)`.

- [ ] **Step 1: Update the service-level expectations and add the 105-mind boundary case**

In `www/test/game-stats.test.js`, replace the mana assertions in the resource tests with:

```js
test("natural resource formulas default missing quest bonuses to zero", function() {
    assert.equal(calculate("ma", {mind: 0}), 296);
    assert.equal(calculate("ma", {mind: 30}), 446);
    assert.equal(calculate("ma", {mind: 100}), 796);
    assert.equal(calculate("ma", {mind: 105}), 821);
    assert.equal(calculate("mv", {constitution: 40, dexterity: 50}), 596);
});

test("natural resource formulas add their matching quest bonuses", function() {
    assert.equal(calculate("hp", {constitution: 30, quest_hp: 17}), 383);
    assert.equal(calculate("ma", {mind: 30, quest_mana: 23}), 469);
    assert.equal(calculate("mv", {
        constitution: 40,
        dexterity: 50,
        quest_move: 29
    }), 625);
});
```

In the browser-registration test, update the registered-service assertion to:

```js
assert.equal(
    registeredGameStats.calculateNaturalStatBonus("ma", {mind: 30}, []),
    446
);
```

- [ ] **Step 2: Add the builder-level Hakim regression and update Quest Mana aggregation**

In `www/test/builder-game-stats.test.js`, change the existing matching-resource mana expectation from `754` to `769`:

```js
assert.equal(scope.getStatTotal("ma"), 769);
```

Immediately after that test, add a regression that exercises final current mind, its raised cap, and negative equipment mana:

```js
test("builder matches Hakim's corrected 766 mana profile", function() {
    const scope = createBuilderScope();
    equipStats(scope, {
        dexterity: 90,
        equipment: {mind: 15, mindCap: 5, ma: -55},
        other: {}
    });

    assert.equal(scope.getStatTotal("mind"), 105);
    assert.equal(scope.getStatTotal("ma"), 766);
});
```

This fixture represents the relevant totals from the imported profile without coupling the test to mutable database item IDs: base mind 90 plus 15 equipment mind under a 105 cap, Quest Mana zero, and -55 equipment mana.

- [ ] **Step 3: Run the focused tests and verify the old 281 base fails**

Run from `www/`:

```bash
node --test test/game-stats.test.js test/builder-game-stats.test.js
```

Expected: FAIL. Mana assertions should be 15 below the new expected values, including Hakim receiving 751 instead of 766. Non-mana assertions should continue to pass.

- [ ] **Step 4: Derive the 296 rerolled base and remove the assumed quest subtraction**

Replace the `case "ma"` block in `www/src/public/js/services/game-stats.js` with:

```js
case "ma": {
    /*
     * The builder models level-50 characters. reroll_mana_internal() starts
     * with BASE_MANA (100) and adds MANA_PER_LEVEL (4) for levels 2 through
     * 50, producing a quest-less rerolled base of 296.
     *
     * ma_for_mind() is (level * current mind) / MANA_FOR_MIND_DIV. At
     * level 50 with MANA_FOR_MIND_DIV set to 10, that is 5 mana per mind.
     * Quest Mana contains all completed resource-quest bonuses and is added
     * exactly once. Mental Enhancement remains represented by compensating
     * Other-slot objects and must not also be included here.
     */
    const level = 50;
    const baseMana = 100;
    const manaPerLevel = 4;
    const manaForMindDiv = Math.max(10, 1);
    const rerolledMana = baseMana + (manaPerLevel * (level - 1));
    const manaForMind = Math.trunc((level * stats.mind) / manaForMindDiv);

    return rerolledMana + manaForMind +
        normalizeQuestResourceBonus(stats.quest_mana);
}
```

- [ ] **Step 5: Run focused tests and verify the corrected formula passes**

Run from `www/`:

```bash
node --test test/game-stats.test.js test/builder-game-stats.test.js
```

Expected: PASS, including natural mana values 296, 446, 796, 821, and 469; the existing Quest Mana builder case at 769; and Hakim at 766.

- [ ] **Step 6: Commit the tested application change**

Run from the repository root:

```bash
git add www/src/public/js/services/game-stats.js www/test/game-stats.test.js www/test/builder-game-stats.test.js
git commit -m "Correct builder mana base"
```

---

### Task 2: Record and verify the correction

**Files:**
- Modify: `CHANGELOG.md:25`
- Test: `www/test/changelog.test.js`

**Interfaces:**
- Consumes: the corrected level-50 mana behavior from Task 1.
- Produces: a public `2.6.0-beta` release note that accurately describes the 296 quest-less base and explicit Quest Mana addition.

- [ ] **Step 1: Tighten the existing mana changelog entry**

Replace the current builder-mana bullet under `### Fixed` with:

```markdown
- Corrected level-50 builder mana to use Legend's 296 quest-less reroll base before adding entered Quest Mana.
```

Do not add a second mana bullet or change the version heading.

- [ ] **Step 2: Run the changelog test**

Run from `www/`:

```bash
node --test test/changelog.test.js
```

Expected: PASS with the `2.6.0-beta` heading and rendered changelog route still valid.

- [ ] **Step 3: Run the complete web test suite**

Run from `www/`:

```bash
npm test
```

Expected: all web tests PASS with only the repository's existing expected skip, if still present.

- [ ] **Step 4: Verify patch hygiene and scope**

Run from the repository root:

```bash
git diff --check
git status --short --branch
```

Expected: `git diff --check` has no output. Status shows only the intended `CHANGELOG.md` change plus the user's pre-existing untracked `.codex/`, `.idea/`, and `docker-compose-prod.yaml`; do not stage those user-owned paths.

- [ ] **Step 5: Commit the release record**

Run from the repository root:

```bash
git add CHANGELOG.md
git commit -m "Record builder mana base correction"
```

- [ ] **Step 6: Confirm final branch state without publishing**

Run from the repository root:

```bash
git status --short --branch
git log -3 --oneline
```

Expected: the feature branch contains the design, application, and release-record commits. Only the user's pre-existing untracked paths remain. Stop without pushing, publishing images, deploying, tagging, or merging to `master`.
