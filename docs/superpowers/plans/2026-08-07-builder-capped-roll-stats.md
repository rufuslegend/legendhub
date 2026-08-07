# Builder Capped Roll Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock the builder's capped-stat hitroll and damroll behavior with regressions and document the fix publicly.

**Architecture:** Keep the existing builder calculation and UI paths unchanged. Add controller-level characterization tests that exercise raw primary stats above raised caps, verify the retained raw restriction, and prove that both natural roll bonuses and equipment roll caps consume the capped current stat; then tighten the existing changelog bullets.

**Tech Stack:** Browser-compatible JavaScript, AngularJS builder controller, Node.js `node:test`, root Markdown changelog.

## Global Constraints

- Treat `/Users/toddmckimmey/projects/legendmud/` as read-only; make no changes there.
- Preserve `current stat = min(raw stat, 100 + existing *Cap bonuses)`.
- Preserve the `fromTotalMax` restriction with its raw amount and capped limit; it drives the existing red total-cell indicator and tooltip.
- Natural damroll and its equipment cap must use capped current strength.
- Natural hitroll and its equipment cap must use capped current dexterity.
- Equipment roll bonuses remain capped separately from spells, familiars, and faux Other-slot roll bonuses.
- Do not change stat aggregation, roll formulas, UI markup, tooltip copy, controller interfaces, or service interfaces.
- Use synthetic values in tests; do not couple regressions to mutable database item IDs.
- Keep the public version at `2.6.0-beta`.
- Do not push, publish images, deploy, tag, promote a release, or modify root `docker-compose-prod.yaml`.

---

### Task 1: Add capped-stat roll regressions

**Files:**
- Modify: `www/test/builder-game-stats.test.js:164-207`

**Interfaces:**
- Consumes: test helper `equipStats(scope, overrides)`, `$scope.getStatTotal(statName: string): number|string`, `$scope.anyStatRestrictions(statName: string): boolean`, and `$scope.statRestrictions[statName]: object[]`.
- Produces: regression coverage proving that the unchanged builder returns capped primary stats, retains raw `fromTotalMax` restrictions, and uses capped values for natural and equipment hitroll/damroll calculations.

- [ ] **Step 1: Add the capped-dexterity hitroll regression**

Immediately after the existing `builder raises only the equipment hitroll cap with final dexterity` test in `www/test/builder-game-stats.test.js`, add:

```js
test("builder uses capped dexterity for all hitroll calculations", function() {
    const scope = createBuilderScope();
    equipStats(scope, {
        dexterity: 90,
        equipment: {dexterity: 20, dexterityCap: 4, hit: 55},
        other: {}
    });

    assert.equal(scope.getStatTotal("dexterity"), 104);
    assert.equal(scope.anyStatRestrictions("dexterity"), true);
    assert.equal(scope.statRestrictions.dexterity.length, 1);
    assert.equal(scope.statRestrictions.dexterity[0].restriction, "fromTotalMax");
    assert.equal(scope.statRestrictions.dexterity[0].amount, 110);
    assert.equal(scope.statRestrictions.dexterity[0].limit, 104);
    assert.equal(
        scope.getStatRestrictionText("dexterity"),
        "The overall limit for this stat is 104. You currently have 110."
    );

    assert.equal(scope.getStatTotal("hit"), "78 (44)");
    assert.equal(scope.statRestrictions.hit.length, 1);
    assert.equal(scope.statRestrictions.hit[0].restriction, "fromItems");
    assert.equal(scope.statRestrictions.hit[0].amount, 55);
    assert.equal(scope.statRestrictions.hit[0].limit, 44);
});
```

This verifies raw dexterity 110, displayed dexterity 104, natural hitroll 34, equipment hitroll capped from 55 to 44, and final display `78 (44)`.

- [ ] **Step 2: Add the capped-strength damroll regression**

Immediately after the existing `builder raises only the equipment damroll cap with final strength` test, add:

```js
test("builder uses capped strength for all damroll calculations", function() {
    const scope = createBuilderScope();
    equipStats(scope, {
        dexterity: 90,
        equipment: {strength: 20, strengthCap: 4, dam: 55},
        other: {}
    });

    assert.equal(scope.getStatTotal("strength"), 104);
    assert.equal(scope.anyStatRestrictions("strength"), true);
    assert.equal(scope.statRestrictions.strength.length, 1);
    assert.equal(scope.statRestrictions.strength[0].restriction, "fromTotalMax");
    assert.equal(scope.statRestrictions.strength[0].amount, 110);
    assert.equal(scope.statRestrictions.strength[0].limit, 104);
    assert.equal(
        scope.getStatRestrictionText("strength"),
        "The overall limit for this stat is 104. You currently have 110."
    );

    assert.equal(scope.getStatTotal("dam"), "78 (44)");
    assert.equal(scope.statRestrictions.dam.length, 1);
    assert.equal(scope.statRestrictions.dam[0].restriction, "fromItems");
    assert.equal(scope.statRestrictions.dam[0].amount, 55);
    assert.equal(scope.statRestrictions.dam[0].limit, 44);
});
```

This verifies raw strength 110, displayed strength 104, natural damroll 34, equipment damroll capped from 55 to 44, and final display `78 (44)`.

- [ ] **Step 3: Run the focused builder suite as a characterization check**

Run from `www/`:

```bash
node --test test/builder-game-stats.test.js
```

Expected: PASS. These are characterization regressions for behavior already confirmed by direct diagnostics, so a red phase is not expected. If either new test fails, stop without changing production code and return to the approved design; production changes are explicitly outside this task's scope.

- [ ] **Step 4: Verify that only the intended test file changed**

Run from the repository root:

```bash
git diff --check
git status --short --branch
git diff -- www/test/builder-game-stats.test.js
```

Expected: `git diff --check` has no output, and the tracked diff contains only the two new regression tests. Leave `.codex/`, `.idea/`, and `docker-compose-prod.yaml` unstaged and untouched.

- [ ] **Step 5: Commit the regression coverage**

Run from the repository root:

```bash
git add www/test/builder-game-stats.test.js
git commit -m "Test capped roll stat calculations"
```

---

### Task 2: Record and verify the capped-stat fix

**Files:**
- Modify: `CHANGELOG.md:26-27`
- Test: `www/test/changelog.test.js`

**Interfaces:**
- Consumes: the capped-stat behavior protected by Task 1.
- Produces: public `2.6.0-beta` release notes stating that hitroll and damroll use capped current stats while retaining raw over-cap warnings.

- [ ] **Step 1: Tighten the existing damroll and hitroll bullets**

Replace the two existing bullets in `CHANGELOG.md` with exactly:

```markdown
- Corrected builder damroll to use capped current strength alone for its natural bonus and equipment cap while retaining raw over-cap warnings.
- Corrected builder hitroll to use capped current dexterity alone for its natural bonus and equipment cap while retaining raw over-cap warnings.
```

Do not add duplicate bullets or change the `2.6.0-beta` heading.

- [ ] **Step 2: Run the changelog test**

Run from `www/`:

```bash
node --test test/changelog.test.js
```

Expected: PASS with the tracked changelog still rendering safely and its route remaining valid.

- [ ] **Step 3: Run the combined focused regression suites**

Run from `www/`:

```bash
node --test test/game-stats.test.js test/builder-game-stats.test.js test/changelog.test.js
```

Expected: PASS, including both new raw-110/capped-104 roll regressions and all existing hitroll, damroll, mana, HP, quest-resource, and changelog checks.

- [ ] **Step 4: Run the complete web suite**

Run from `www/`:

```bash
npm test
```

Expected: all web tests pass with only the repository's existing expected skip, if still present.

- [ ] **Step 5: Verify patch hygiene and scope**

Run from the repository root:

```bash
git diff --check
git status --short --branch
git diff -- CHANGELOG.md
```

Expected: `git diff --check` has no output. The only uncommitted tracked change is the two-line `CHANGELOG.md` replacement; `.codex/`, `.idea/`, and `docker-compose-prod.yaml` remain unstaged and untouched.

- [ ] **Step 6: Commit the release record**

Run from the repository root:

```bash
git add CHANGELOG.md
git commit -m "Record capped roll stat fix"
```

- [ ] **Step 7: Confirm final branch state without publishing**

Run from the repository root:

```bash
git status --short --branch
git log -4 --oneline
```

Expected: the feature branch contains the design, plan, regression-test, and changelog commits. Only the user's pre-existing untracked paths remain. Stop without pushing, publishing images, deploying, tagging, or merging to `master`.
