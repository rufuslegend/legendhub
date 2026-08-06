# Hitroll Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make LegendHUB calculate natural and equipment-derived hitroll with the live game's dexterity-only rules.

**Architecture:** Keep C-derived formulas in the CommonJS/AngularJS `gameStats` service and leave the builder controller responsible only for collecting character totals and applying the returned cap. Add service unit tests for formula boundaries and a VM-loaded controller test for the equipment-versus-spell data flow.

**Tech Stack:** JavaScript, AngularJS, Node.js 22 built-in test runner, CommonJS, `node:assert/strict`, `node:vm`

## Global Constraints

- Keep the package and changelog version at `2.6.0-beta`.
- Do not modify, move, delete, or reuse the immutable `v2.6.0-beta` or `v2.6.0` tags.
- Do not publish images, deploy, tag, push, or touch root `docker-compose-prod.yaml`.
- Change hitroll only; damroll and every other stat remain behaviorally unchanged.
- Do not add a JavaScript feature flag or a generic stat-cap framework.
- Preserve the disabled strength and constitution hitroll formulas in ample adjacent comments.

---

### Task 1: Implement and Test Hitroll Game Rules

**Files:**
- Modify: `www/test/game-stats.test.js:25-75`
- Modify: `www/src/public/js/services/game-stats.js:18-141`

**Interfaces:**
- Consumes: `calculateNaturalStatBonus(statName: string, stats: object, items?: object[]): number` and `getNaturalStatDependencies(statName: string): string[]`
- Produces: `calculateHitrollEquipmentCap(dexterity: number): number`, exported from the CommonJS module and AngularJS `gameStats` factory

- [ ] **Step 1: Replace the obsolete hitroll expectations with failing dexterity-only tests**

Replace the two current hitroll tests and update the hitroll dependency assertion in `www/test/game-stats.test.js`:

```js
test("natural hitroll uses exact C-style dexterity division", function() {
    assert.equal(calculate("hit", {dexterity: 1}), 0);
    assert.equal(calculate("hit", {dexterity: 3}), 0);
    assert.equal(calculate("hit", {dexterity: 4}), 1);
    assert.equal(calculate("hit", {dexterity: 40}), 13);
});

test("natural hitroll ignores disabled weapon-stat alternatives", function() {
    const stats = {strength: 100, dexterity: 40, constitution: 100};
    const items = [
        {slot: 14, weaponStat: 1},
        {slot: 15, weaponStat: 3}
    ];

    assert.equal(calculate("hit", stats, [{slot: 14, weaponStat: 1}]), 13);
    assert.equal(calculate("hit", stats, [{slot: 15, weaponStat: 3}]), 13);
    assert.equal(calculate("hit", stats, items), 13);
});
```

Change the existing dependency expectation to:

```js
assert.deepEqual(gameStats.getNaturalStatDependencies("hit"), [
    "dexterity"
]);
```

- [ ] **Step 2: Add failing equipment-cap boundary tests**

Add this focused test after the hitroll tests:

```js
test("hitroll equipment cap increases above 90 dexterity", function() {
    assert.equal(gameStats.calculateHitrollEquipmentCap(89), 30);
    assert.equal(gameStats.calculateHitrollEquipmentCap(90), 30);
    assert.equal(gameStats.calculateHitrollEquipmentCap(91), 31);
    assert.equal(gameStats.calculateHitrollEquipmentCap(100), 40);
    assert.equal(gameStats.calculateHitrollEquipmentCap(110), 50);
});
```

Extend the browser-registration test with:

```js
assert.equal(typeof registeredGameStats.calculateHitrollEquipmentCap, "function");
assert.equal(registeredGameStats.calculateHitrollEquipmentCap(100), 40);
```

- [ ] **Step 3: Run the focused tests and verify the new expectations fail**

Run:

```bash
cd www
node --test test/game-stats.test.js
```

Expected: FAIL because dexterity 1 still returns 1, weapon-stat alternatives still return strength or constitution values, the dependency list still includes three stats, and `calculateHitrollEquipmentCap` does not exist.

- [ ] **Step 4: Implement the dexterity-only natural hitroll rule**

In `www/src/public/js/services/game-stats.js`, change the hit dependency:

```js
hit: ["dexterity"],
```

Replace the local calculations at the start of `case "hit"` with:

```js
const dexHitroll = Math.trunc((stats.dexterity - 1) / 3);

/*
 * The live game retains strength and constitution hitroll alternatives
 * behind a C-side feature flag, but that flag is disabled. Keep the prior
 * formulas documented here so these zero values and the weapon-selection
 * branches below remain intentional and traceable:
 *
 * strength: Math.floor(Math.min(Math.max(stats.strength / 4, 0), 25))
 * constitution: Math.floor(Math.min(Math.max(stats.constitution / 4, 0), 25))
 */
const strHitroll = 0;
const conHitroll = 0;
```

Leave `bestStat` and both existing `hasEquippedWeaponUsing` branches in place.

- [ ] **Step 5: Implement and export the equipment-cap formula**

Add this focused function before `calculateNaturalStatBonus`:

```js
function calculateHitrollEquipmentCap(dexterity) {
    return 30 + Math.max(dexterity - 90, 0);
}
```

Export it from the factory result:

```js
return {
    calculateHitrollEquipmentCap,
    calculateNaturalStatBonus,
    getNaturalStatDependencies
};
```

- [ ] **Step 6: Run the focused service tests and verify they pass**

Run:

```bash
cd www
node --test test/game-stats.test.js
```

Expected: all game-stat tests pass, including CommonJS and AngularJS registration paths.

- [ ] **Step 7: Commit the service rule change**

```bash
git add www/src/public/js/services/game-stats.js www/test/game-stats.test.js
git commit -m "Fix natural hitroll rules"
```

### Task 2: Apply the Dynamic Cap in the Builder

**Files:**
- Create: `www/test/builder-game-stats.test.js`
- Modify: `www/src/public/js/controllers/builder/main.js:1933-1946`

**Interfaces:**
- Consumes: `gameStats.calculateHitrollEquipmentCap(dexterity: number): number` from Task 1 and `$scope.getStatTotal(statName: string): number|string`
- Produces: builder hitroll totals whose equipment subtotal uses the dynamic cap while later spell/familiar slots remain uncapped

- [ ] **Step 1: Add a focused builder-controller test harness**

Create `www/test/builder-game-stats.test.js` with a VM harness that captures and instantiates the registered AngularJS controller without making an HTTP request:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const gameStats = require("../src/public/js/services/game-stats");

function createBuilderScope() {
    let builderController;
    const angular = {
        module: function(moduleName) {
            assert.equal(moduleName, "legendwiki-app");
            return {
                controller: function(controllerName, definition) {
                    assert.equal(controllerName, "builder");
                    builderController = definition[definition.length - 1];
                }
            };
        }
    };
    const browserContext = {
        angular,
        console,
        localStorage: {
            getItem: function() {
                return null;
            }
        }
    };
    browserContext.globalThis = browserContext;

    const source = fs.readFileSync(path.join(
        __dirname,
        "../src/public/js/controllers/builder/main.js"
    ), "utf8");
    vm.runInNewContext(source, browserContext);

    const scope = {};
    const http = function() {
        return {
            then: function() {}
        };
    };
    builderController(
        scope,
        {get: function() {}},
        http,
        {},
        function() {},
        {selectShortOptions: {slot: []}},
        {},
        {addCallback: function() {}},
        gameStats
    );
    scope.statInfo = [
        "strength",
        "mind",
        "dexterity",
        "constitution",
        "perception",
        "spirit",
        "hit",
        "dam"
    ].map(function(statName) {
        return {var: statName, type: "int"};
    });

    return scope;
}

function equipStats(scope, overrides) {
    const items = Array.from({length: 25}, function() {
        return {};
    });
    Object.assign(items[0], overrides.equipment);
    Object.assign(items[24], overrides.other);
    scope.selectedList = {
        baseStats: {
            strength: 90,
            mind: 90,
            dexterity: overrides.dexterity,
            constitution: 90,
            perception: 90,
            spirit: 90,
            amulet: -1,
            hazelnut: -1,
            longhouse: -1
        },
        ksmStats: {},
        items
    };
}
```

- [ ] **Step 2: Add failing dynamic-cap and source-grouping tests**

Append these tests:

```js
test("builder raises only the equipment hitroll cap with final dexterity", function() {
    const scope = createBuilderScope();
    equipStats(scope, {
        dexterity: 100,
        equipment: {dexterity: 10, dexterityCap: 10, hit: 55},
        other: {hit: 5}
    });

    assert.equal(scope.getStatTotal("hit"), "91 (50)");
    assert.equal(scope.statRestrictions.hit.length, 1);
    assert.equal(scope.statRestrictions.hit[0].restriction, "fromItems");
    assert.equal(scope.statRestrictions.hit[0].amount, 55);
    assert.equal(scope.statRestrictions.hit[0].limit, 50);
});

test("builder leaves the damroll equipment cap at 27", function() {
    const scope = createBuilderScope();
    equipStats(scope, {
        dexterity: 90,
        equipment: {dam: 35},
        other: {dam: 5}
    });

    assert.equal(scope.getStatTotal("dam"), "61 (27)");
    assert.equal(scope.statRestrictions.dam.length, 1);
    assert.equal(scope.statRestrictions.dam[0].restriction, "fromItems");
    assert.equal(scope.statRestrictions.dam[0].amount, 35);
    assert.equal(scope.statRestrictions.dam[0].limit, 27);
});
```

The hitroll total proves all three requirements together: final dexterity is
110 after the dexterity-cap item, equipment hitroll is capped at 50, the later
slot contributes 5 above the cap, and natural hitroll contributes 36.

- [ ] **Step 3: Run the builder test and verify the hitroll case fails**

Run:

```bash
cd www
node --test test/builder-game-stats.test.js
```

Expected: the hitroll test FAILS with the old 27 equipment cap; the damroll regression test passes.

- [ ] **Step 4: Route the builder's hitroll cap through `gameStats`**

Split the shared hit/dam branch in `getItemTotalMax`:

```js
case "hit":
    max = gameStats.calculateHitrollEquipmentCap(
        $scope.getStatTotal("dexterity")
    );
    break;
case "dam":
    max = 27;
    break;
```

Do not change the existing slot loops, restriction structure, display string,
or any other cap.

- [ ] **Step 5: Run focused builder and service tests**

Run:

```bash
cd www
node --test test/game-stats.test.js test/builder-game-stats.test.js
```

Expected: all focused tests pass; the builder reports `91 (50)` for hitroll and `61 (27)` for damroll.

- [ ] **Step 6: Commit the builder integration**

```bash
git add www/src/public/js/controllers/builder/main.js www/test/builder-game-stats.test.js
git commit -m "Apply dynamic hitroll equipment cap"
```

### Task 3: Record and Verify the Hitroll Correction

**Files:**
- Modify: `CHANGELOG.md:19-24`

**Interfaces:**
- Consumes: completed hitroll behavior from Tasks 1 and 2
- Produces: a public `2.6.0-beta` changelog entry and a fully verified feature branch

- [ ] **Step 1: Add the public changelog entry**

Under `## [2.6.0-beta]` → `### Fixed`, add:

```markdown
- Corrected builder hitroll calculations to use dexterity alone and raise the equipment cap when dexterity exceeds 90.
```

- [ ] **Step 2: Run the focused tests after the documentation edit**

Run:

```bash
cd www
node --test test/game-stats.test.js test/builder-game-stats.test.js test/changelog.test.js
```

Expected: all focused hitroll and changelog tests pass.

- [ ] **Step 3: Run all local verification**

Run each command without publishing, deploying, tagging, or pushing:

```bash
node scripts/verify-release-version.js
node --test scripts/test/*.test.js
cd www && npm test && cd ..
cd css && npm test && cd ..
bash -n scripts/tag-release.sh scripts/publish-images.sh scripts/deploy-test.sh
env LEGENDHUB_IMAGE_TAG=verification EXTERNAL_PORT=7001 PORT=3000 NODE_ENV=test MYSQL_PORT=3306 MYSQL_ROOT_PASSWORD=validation MYSQL_USER=validation MYSQL_PASSWORD=validation MYSQL_DATABASE=validation GITHUB_TOKEN=validation GITHUB_REPOSITORY=rufuslegend/legendhub RECAPTCHA_SITEKEY=validation RECAPTCHA_SECRET=validation docker compose -f docker-compose.yaml -f docker-compose.registry.yaml config --quiet
git diff --check
git status --short --branch
```

Expected: the version verifier prints `2.6.0-beta`; all script tests, web tests,
CSS lint, shell syntax checks, merged Compose validation, and whitespace checks
pass. Status shows only the intended changelog edit plus the user's pre-existing
untracked `.codex/`, `.idea/`, and `docker-compose-prod.yaml` entries. The
untracked files remain untouched.

- [ ] **Step 4: Commit the changelog**

```bash
git add CHANGELOG.md
git commit -m "Record hitroll builder correction"
```

- [ ] **Step 5: Verify final branch state**

Run:

```bash
git status --short --branch
git log -4 --oneline --decorate
```

Expected: the feature branch contains the design, service-rule, builder-cap,
and changelog commits. The working tree has no tracked changes; only the user's
pre-existing untracked `.codex/`, `.idea/`, and `docker-compose-prod.yaml`
entries remain. Nothing has been pushed, tagged, published, or deployed.
