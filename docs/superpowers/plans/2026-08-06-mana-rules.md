# Mana Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make LegendHUB include assumed Valley completion in its level-50 natural maximum-mana calculation without double-counting saved mana boosts or Mental Enhancement.

**Architecture:** Keep the fixed level-50 and C-derived mind formula in the shared `gameStats` service. Preserve the builder controller's existing generic assembly of equipment, spell, familiar, and Other-slot `ma` values; only the service's natural mana result changes.

**Tech Stack:** Browser-compatible JavaScript, AngularJS, Node.js CommonJS, `node:test`, root Markdown changelog

## Global Constraints

- Model level 50 only; do not add a level selector or calculations for levels 1 through 49.
- Treat the established 296 level-50 base as already including the five saved mana boosts totaling 15.
- Assume `VALLEY_COMPLETE` and add 25 mana to every natural mana result.
- Calculate the mind contribution as five mana per point of final current mind.
- Do not calculate Mental Enhancement in `gameStats`; the builder represents it with a compensating Other-slot object.
- Leave equipment, spell, familiar, and Other-slot `ma` additions unchanged and uncapped.
- Keep package version `2.6.0-beta`; do not move, delete, or reuse release tags.
- Do not publish, deploy, tag, or push as part of implementation.
- Do not modify the user's untracked root `docker-compose-prod.yaml`, `.codex/`, or `.idea/` paths.

---

## File Structure

- `www/src/public/js/services/game-stats.js`: owns the level-50 natural maximum-mana formula and its explanation.
- `www/test/game-stats.test.js`: verifies fixed base assumptions, mind scaling, natural dependencies, and CommonJS/AngularJS behavior.
- `CHANGELOG.md`: records the public mana correction beneath `2.6.0-beta`.

No builder-controller file changes are planned. `www/src/public/js/controllers/builder/main.js` already gets final mind through `getNaturalStatDependencies("ma")`, adds equipment slots 0 through 23, then adds later spell, familiar, and Other-slot values without an `ma` cap.

### Task 1: Correct Level-50 Natural Mana

**Files:**
- Modify: `www/src/public/js/services/game-stats.js:78-79`
- Test: `www/test/game-stats.test.js:13-18`
- Test: `www/test/game-stats.test.js:88-99`
- Test: `www/test/game-stats.test.js:101-133`

**Interfaces:**
- Consumes: `calculateNaturalStatBonus(statName: string, stats: object, items?: object[]): number`
- Consumes: `getNaturalStatDependencies(statName: string): string[]`
- Produces: corrected `calculateNaturalStatBonus("ma", {mind}, items)` result of `471 + ((mind - 30) * 5)`
- Preserves: `getNaturalStatDependencies("ma")` returning a defensive copy of `["mind"]`

- [ ] **Step 1: Replace the old mana characterization with failing level-50 tests**

In `www/test/game-stats.test.js`, remove this assertion from `test("natural resource formulas retain their current behavior", ...)`:

```js
assert.equal(calculate("ma", {mind: 30}), 446);
```

Immediately after that resource-formula test, add:

```js
test("natural mana includes assumed Valley completion at level 50", function() {
    assert.equal(calculate("ma", {mind: 0}), 321);
    assert.equal(calculate("ma", {mind: 30}), 471);
    assert.equal(calculate("ma", {mind: 100}), 821);
});
```

These boundaries prove the fixed 321 mana before the mind contribution, the five-per-mind slope, and the 471 result at the builder's existing 30-mind reference point.

- [ ] **Step 2: Add a mana dependency regression assertion**

In `test("natural stat dependency lookup is isolated from callers", ...)`, add this assertion before the existing unknown-stat assertion:

```js
assert.deepEqual(gameStats.getNaturalStatDependencies("ma"), [
    "mind"
]);
```

This guards the existing data flow in which the builder supplies final current mind to the natural mana calculation.

- [ ] **Step 3: Update the browser-path expectation before changing production code**

In `test("browser loading registers the game-stat module with AngularJS", ...)`, change the final expectation to:

```js
assert.equal(
    registeredGameStats.calculateNaturalStatBonus("ma", {mind: 30}, []),
    471
);
```

- [ ] **Step 4: Run the focused service tests and verify the new expectations fail**

Run:

```bash
cd www
node --test test/game-stats.test.js
```

Expected: FAIL because the CommonJS and AngularJS calculations still return 296, 446, and 796 at mind 0, 30, and 100 instead of 321, 471, and 821. Existing non-mana assertions remain passing.

- [ ] **Step 5: Implement the minimal natural mana correction with the fixed assumptions documented**

In `www/src/public/js/services/game-stats.js`, replace the current `case "ma"` body with:

```js
case "ma":
    /*
     * The builder models level-50 characters. The fixed 296 base already
     * includes the five SAV_*_MANA_BOOST flags (1 + 2 + 3 + 4 + 5 = 15).
     * Assume VALLEY_COMPLETE for another 25 mana.
     *
     * ma_for_mind() is (level * current mind) / MANA_FOR_MIND_DIV. At
     * level 50 with MANA_FOR_MIND_DIV set to 10, that is 5 mana per mind.
     * Mental Enhancement remains represented by compensating Other-slot
     * objects and must not also be included in this natural calculation.
     */
    return 471 + ((stats.mind - 30) * 5);
```

Do not add a new exported helper or change `naturalStatDependencies.ma`; the existing service boundary already supplies everything the level-50-only formula needs.

- [ ] **Step 6: Run the focused service tests and verify they pass**

Run:

```bash
cd www
node --test test/game-stats.test.js
```

Expected: PASS. Natural mana is 321 at mind 0, 471 at mind 30, and 821 at mind 100; the AngularJS factory returns 471 at mind 30; all unrelated game-stat regressions remain green.

- [ ] **Step 7: Run the builder regression tests without changing the controller**

Run:

```bash
cd www
node --test test/builder-game-stats.test.js
```

Expected: PASS, confirming the mana service change did not disturb hitroll or damroll builder assembly. Do not edit the builder controller or builder tests unless this command exposes a directly related regression.

- [ ] **Step 8: Commit the tested service correction**

```bash
git add www/src/public/js/services/game-stats.js www/test/game-stats.test.js
git commit -m "Correct natural mana rules"
```

### Task 2: Record and Verify the Mana Correction

**Files:**
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: corrected level-50 natural mana behavior from Task 1
- Produces: a public `2.6.0-beta` changelog entry and a fully verified feature branch

- [ ] **Step 1: Add the public changelog entry**

Under `## [2.6.0-beta]` → `### Fixed`, add:

```markdown
- Corrected level-50 builder mana to include the assumed Valley completion bonus.
```

Do not change the changelog version or date.

- [ ] **Step 2: Run focused tests after the documentation edit**

Run:

```bash
cd www
node --test test/game-stats.test.js test/builder-game-stats.test.js test/changelog.test.js
```

Expected: all focused game-stat, builder-regression, and changelog tests pass.

- [ ] **Step 3: Run all local verification**

Run each command without publishing, deploying, tagging, or pushing:

```bash
node scripts/verify-release-version.js
node --test scripts/test/*.test.js
cd www && npm test && cd ..
cd css && npm test && cd ..
bash -n scripts/tag-release.sh scripts/publish-images.sh scripts/deploy-test.sh
env LEGENDHUB_IMAGE_TAG=verification EXTERNAL_PORT=7001 PORT=3000 NODE_ENV=test MYSQL_PORT=3306 MYSQL_ROOT_PASSWORD=validation MYSQL_USER=validation MYSQL_PASSWORD=validation MYSQL_DATABASE=validation GITHUB_TOKEN=validation GITHUB_REPOSITORY=rufuslegend/legendhub RECAPTCHA_SITEKEY=validation RECAPTCHA_SECRET=validation docker compose -f docker-compose.yaml -f docker-compose.registry.yaml config --quiet
git diff --check master...HEAD
git status --short --branch
```

Expected: the version verifier prints `2.6.0-beta`; all script tests, web tests, CSS lint, shell syntax checks, merged Compose validation, and whitespace checks pass. Before the changelog commit, status shows only the intended `CHANGELOG.md` modification plus the user's pre-existing untracked `.codex/`, `.idea/`, and `docker-compose-prod.yaml` entries. Those paths remain untouched.

- [ ] **Step 4: Commit the changelog before final branch verification**

```bash
git add CHANGELOG.md
git commit -m "Record mana builder correction"
```

Run the full verification from Step 3 again after this commit so the completion claim is based on the final committed tree.

- [ ] **Step 5: Verify final branch state**

Run:

```bash
git status --short --branch
git log -5 --oneline --decorate
```

Expected: `feat/mana-rules` contains the design, plan, service-rule, and changelog commits. The working tree has no tracked changes; only the user's pre-existing untracked `.codex/`, `.idea/`, and `docker-compose-prod.yaml` entries remain. Nothing has been pushed, tagged, published, or deployed.
