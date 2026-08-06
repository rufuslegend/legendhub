# Damroll Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make LegendHUB calculate strength-only natural damroll and apply the live game's strength-dependent cap only to equipment damroll.

**Architecture:** Keep C-derived formulas in the shared `gameStats` service and keep the builder controller responsible for subtotal assembly. Mirror the existing hitroll boundary: the service exposes a focused cap helper, while the builder caps equipment slots 0 through 23 before adding later spell, familiar, and other-slot bonuses.

**Tech Stack:** Browser-compatible JavaScript, AngularJS, Node.js CommonJS, `node:test`, root Markdown changelog

## Global Constraints

- `STR_ONLY_DAMROLL` is enabled: strength is the only active natural damroll dependency.
- Natural damroll is `Math.trunc((strength - 1) / 3)`.
- Equipment damroll cap is `30 + Math.max(finalStrength - 90, 0)`.
- The cap applies only to equipment slots 0 through 23; later spell, familiar, and other-slot damroll remains uncapped.
- Retain ample comments documenting the disabled constitution and dexterity weapon formulas.
- Defer Weapon Focus and martial-arts expert-wield bonuses; do not add an ability control or persistence migration.
- Keep package version `2.6.0-beta`; do not move or reuse release tags.
- Do not publish, deploy, tag, or push as part of implementation.
- Do not modify the user's untracked root `docker-compose-prod.yaml`, `.codex/`, or `.idea/` paths.

---

## File Structure

- `www/src/public/js/services/game-stats.js`: owns natural damroll dependencies, C-equivalent formulas, the focused equipment-cap helper, and CommonJS/AngularJS exports.
- `www/test/game-stats.test.js`: verifies service formulas, disabled weapon alternatives, dependency declarations, cap boundaries, and both module-loading paths.
- `www/src/public/js/controllers/builder/main.js`: obtains the damroll equipment cap from final strength while preserving existing subtotal ordering and restriction reporting.
- `www/test/builder-game-stats.test.js`: verifies fixed and dynamic equipment caps and proves later bonuses remain uncapped.
- `CHANGELOG.md`: records the public builder correction beneath `2.6.0-beta`.

### Task 1: Correct and Export Damroll Game Rules

**Files:**
- Modify: `www/src/public/js/services/game-stats.js`
- Test: `www/test/game-stats.test.js`

**Interfaces:**
- Consumes: `calculateNaturalStatBonus(statName: string, stats: object, items?: object[]): number` and `getNaturalStatDependencies(statName: string): string[]`
- Produces: `calculateDamrollEquipmentCap(strength: number): number`, exported through CommonJS and the AngularJS `gameStats` factory

- [ ] **Step 1: Replace the old damroll characterization with failing strength-only tests**

Replace `test("damroll defaults to strength and follows an equipped weapon stat", ...)` in `www/test/game-stats.test.js` with:

```js
test("natural damroll uses exact C-style strength division", function() {
    assert.equal(calculate("dam", {strength: 1}), 0);
    assert.equal(calculate("dam", {strength: 3}), 0);
    assert.equal(calculate("dam", {strength: 4}), 1);
    assert.equal(calculate("dam", {strength: 40}), 13);
});

test("natural damroll ignores disabled weapon-stat alternatives", function() {
    const stats = {strength: 40, dexterity: 100, constitution: 100};

    assert.equal(calculate("dam", stats, [{slot: 14, weaponStat: 2}]), 13);
    assert.equal(calculate("dam", stats, [{slot: 15, weaponStat: 3}]), 13);
});
```

- [ ] **Step 2: Add failing dependency and equipment-cap tests**

Add these assertions to `www/test/game-stats.test.js`:

```js
test("damroll equipment cap increases above 90 strength", function() {
    assert.equal(gameStats.calculateDamrollEquipmentCap(89), 30);
    assert.equal(gameStats.calculateDamrollEquipmentCap(90), 30);
    assert.equal(gameStats.calculateDamrollEquipmentCap(91), 31);
    assert.equal(gameStats.calculateDamrollEquipmentCap(100), 40);
    assert.equal(gameStats.calculateDamrollEquipmentCap(110), 50);
});
```

Extend the dependency-copy test with:

```js
assert.deepEqual(gameStats.getNaturalStatDependencies("dam"), [
    "strength"
]);
```

Extend the browser-registration test with:

```js
assert.equal(typeof registeredGameStats.calculateDamrollEquipmentCap, "function");
assert.equal(registeredGameStats.calculateDamrollEquipmentCap(100), 40);
```

- [ ] **Step 3: Run the focused service test and verify the new expectations fail**

Run:

```bash
cd www
node --test test/game-stats.test.js
```

Expected: FAIL because weapon-stat alternatives still override strength, damroll still declares three dependencies, and `calculateDamrollEquipmentCap` does not exist.

- [ ] **Step 4: Implement the focused equipment-cap helper and export**

Add beside `calculateHitrollEquipmentCap` in `www/src/public/js/services/game-stats.js`:

```js
function calculateDamrollEquipmentCap(strength) {
    return 30 + Math.max(strength - 90, 0);
}
```

Add `calculateDamrollEquipmentCap` to the returned service object:

```js
return {
    calculateDamrollEquipmentCap,
    calculateHitrollEquipmentCap,
    calculateNaturalStatBonus,
    getNaturalStatDependencies
};
```

- [ ] **Step 5: Implement strength-only natural damroll with disabled-formula comments**

Change `naturalStatDependencies.dam` to:

```js
dam: ["strength"],
```

Replace the local formula declarations at the start of `case "dam"` with:

```js
const strDamroll = Math.trunc((stats.strength - 1) / 3);

/*
 * The live game can select constitution- or dexterity-derived damroll from
 * the wielded weapon's base damage type, but STR_ONLY_DAMROLL is enabled.
 * Keep the inactive C-side formulas documented here so these zero values
 * and the weapon-selection branches below remain intentional:
 *
 * constitution: Math.trunc(Math.min(stats.constitution, 100) / 4)
 * dexterity: Math.trunc(Math.min(stats.dexterity, 100) / 5)
 */
const conDamroll = 0;
const dexDamroll = 0;
```

Keep `bestStat` initialized from `strDamroll` and retain the existing weapon-selection branches. Do not add a JavaScript feature flag, Weapon Focus, or martial-arts logic.

- [ ] **Step 6: Run the focused service test and verify it passes**

Run:

```bash
cd www
node --test test/game-stats.test.js
```

Expected: all game-stat service tests pass, including low-strength boundaries, disabled weapon alternatives, dependency lookup, cap boundaries, and browser registration.

- [ ] **Step 7: Commit the service rules**

```bash
git add www/src/public/js/services/game-stats.js www/test/game-stats.test.js
git commit -m "Fix natural damroll rules"
```

### Task 2: Apply the Dynamic Equipment Cap in the Builder

**Files:**
- Modify: `www/src/public/js/controllers/builder/main.js`
- Test: `www/test/builder-game-stats.test.js`

**Interfaces:**
- Consumes: `gameStats.calculateDamrollEquipmentCap(strength: number): number` from Task 1 and `$scope.getStatTotal(statName: string): number|string`
- Produces: builder damroll totals whose equipment subtotal uses final strength while later bonuses remain uncapped

- [ ] **Step 1: Replace the old fixed-cap regression with failing base-cap coverage**

Replace `test("builder leaves the damroll equipment cap at 27", ...)` with:

```js
test("builder uses the corrected base damroll equipment cap", function() {
    const scope = createBuilderScope();
    equipStats(scope, {
        dexterity: 90,
        equipment: {dam: 35},
        other: {dam: 5}
    });

    assert.equal(scope.getStatTotal("dam"), "64 (30)");
    assert.equal(scope.statRestrictions.dam.length, 1);
    assert.equal(scope.statRestrictions.dam[0].restriction, "fromItems");
    assert.equal(scope.statRestrictions.dam[0].amount, 35);
    assert.equal(scope.statRestrictions.dam[0].limit, 30);
});
```

- [ ] **Step 2: Add failing dynamic-cap and uncapped-later-bonus coverage**

Add:

```js
test("builder raises only the equipment damroll cap with final strength", function() {
    const scope = createBuilderScope();
    equipStats(scope, {
        dexterity: 90,
        equipment: {strength: 10, strengthCap: 10, dam: 55},
        other: {dam: 5}
    });

    assert.equal(scope.getStatTotal("dam"), "78 (40)");
    assert.equal(scope.statRestrictions.dam.length, 1);
    assert.equal(scope.statRestrictions.dam[0].restriction, "fromItems");
    assert.equal(scope.statRestrictions.dam[0].amount, 55);
    assert.equal(scope.statRestrictions.dam[0].limit, 40);
});
```

The expected total is capped equipment `40` + natural strength damroll `33` + uncapped later-slot damroll `5`.

- [ ] **Step 3: Run focused builder and service tests and verify the builder tests fail**

Run:

```bash
cd www
node --test test/game-stats.test.js test/builder-game-stats.test.js
```

Expected: service tests pass; the builder damroll tests fail because `getItemTotalMax("dam")` still returns 27.

- [ ] **Step 4: Route the builder damroll cap through final strength**

In `getItemTotalMax` within `www/src/public/js/controllers/builder/main.js`, replace the fixed damroll cap:

```js
case "dam":
    max = gameStats.calculateDamrollEquipmentCap(
        $scope.getStatTotal("strength")
    );
    break;
```

Do not change the equipment loop boundary, later-slot loop, restriction format, total display, hitroll cap, or any other stat cap.

- [ ] **Step 5: Run focused builder and service tests and verify they pass**

Run:

```bash
cd www
node --test test/game-stats.test.js test/builder-game-stats.test.js
```

Expected: all focused tests pass; base-strength damroll reports `64 (30)`, final-strength 100 damroll reports `78 (40)`, and hitroll remains unchanged.

- [ ] **Step 6: Commit the builder integration**

```bash
git add www/src/public/js/controllers/builder/main.js www/test/builder-game-stats.test.js
git commit -m "Apply dynamic damroll equipment cap"
```

### Task 3: Record and Verify the Damroll Correction

**Files:**
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: completed damroll behavior from Tasks 1 and 2
- Produces: a public `2.6.0-beta` changelog entry and a fully verified feature branch

- [ ] **Step 1: Add the public changelog entry**

Under `## [2.6.0-beta]` → `### Fixed`, add:

```markdown
- Corrected builder damroll calculations to use strength alone and raise the equipment cap when strength exceeds 90.
```

- [ ] **Step 2: Run focused tests after the documentation edit**

Run:

```bash
cd www
node --test test/game-stats.test.js test/builder-game-stats.test.js test/changelog.test.js
```

Expected: all focused damroll, builder, and changelog tests pass.

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
git commit -m "Record damroll builder correction"
```

Run the full verification from Step 3 again after this commit so the completion claim is based on the final committed tree.

- [ ] **Step 5: Verify final branch state**

Run:

```bash
git status --short --branch
git log -5 --oneline --decorate
```

Expected: `feat/damroll-rules` contains the design, plan, service-rule, builder-cap, and changelog commits. The working tree has no tracked changes; only the user's pre-existing untracked `.codex/`, `.idea/`, and `docker-compose-prod.yaml` entries remain. Nothing has been pushed, tagged, published, or deployed.
