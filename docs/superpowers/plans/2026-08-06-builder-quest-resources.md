# Builder Quest Resource Bonuses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent Quest HP, Quest Mana, and Quest Mv builder inputs and apply them to the level-50 natural resource formulas while removing mana's fixed 40-point quest assumption.

**Architecture:** Keep resource math and quest-value normalization in the existing UMD `gameStats` service. Store the three character-specific values in each builder variant's `baseStats`, pass them to the calculation service without making them recursive stat dependencies, and extend the compact builder-list codec to version 5 with backward-compatible zero defaults.

**Tech Stack:** AngularJS builder controller and EJS template, browser/CommonJS JavaScript service, Node.js built-in test runner, compact base-62 builder-list encoding.

## Global Constraints

- The builder models level-50 characters.
- New, missing, and pre-version-5 quest resource values default to zero.
- Quest resource values are non-negative whole numbers from 0 through 238,327.
- Mana is `281 + trunc((50 * mind) / 10) + quest_mana`; do not retain the old fixed 15 saved-boost points or 25 Valley points.
- Quest resource values are not equipment bonuses and are never subject to equipment caps.
- Persist version-5 values in the order `quest_hp`, `quest_mana`, `quest_move`, using exactly three base-62 characters each after Hazelnut and before item data.
- Version-1 through version-4 lists must continue loading with zero quest values and unchanged item alignment.
- Keep root `CHANGELOG.md` at `2.6.0-beta`.
- Do not touch the user-owned untracked `docker-compose-prod.yaml`, `.codex/`, or `.idea/` paths.
- Do not push, publish images, tag, or deploy without separate authorization for that action.

## File Map

- `www/src/public/js/services/game-stats.js`: normalize quest resource values and calculate HP, mana, and movement totals.
- `www/test/game-stats.test.js`: unit coverage for resource formulas, compatibility defaults, and normalization.
- `www/src/views/builder/index.ejs`: render the three labeled numeric inputs beneath the existing quest-selection row.
- `www/src/public/js/controllers/builder/main.js`: initialize fields, pass them into `gameStats`, and save/load version-5 compact lists.
- `www/test/builder-game-stats.test.js`: builder integration, template bindings, default-list, and compact-codec compatibility coverage.
- `CHANGELOG.md`: public-facing builder enhancement and corrected mana description.

---

### Task 1: Quest-aware natural resource formulas

**Files:**
- Modify: `www/test/game-stats.test.js:11-32`
- Modify: `www/test/game-stats.test.js:112-139`
- Modify: `www/src/public/js/services/game-stats.js:1-105`
- Modify: `www/src/public/js/services/game-stats.js:180-188`

**Interfaces:**
- Produces: `gameStats.normalizeQuestResourceBonus(value) -> integer` in the inclusive range 0 through 238,327.
- Produces: `calculateNaturalStatBonus("hp"|"ma"|"mv", stats, items)` consuming optional `stats.quest_hp`, `stats.quest_mana`, and `stats.quest_move`.
- Preserves: `getNaturalStatDependencies("hp"|"ma"|"mv")`; quest inputs are direct values, not recursive dependencies.

- [ ] **Step 1: Replace the resource characterization tests with failing quest-aware expectations**

In `www/test/game-stats.test.js`, replace the current resource and mana tests with:

```js
test("natural resource formulas default missing quest bonuses to zero", function() {
    assert.equal(calculate("hp", {constitution: 30}), 381);
    assert.equal(calculate("hp", {constitution: 90}), 691);
    assert.equal(calculate("ma", {mind: 0}), 281);
    assert.equal(calculate("ma", {mind: 30}), 431);
    assert.equal(calculate("ma", {mind: 100}), 781);
    assert.equal(calculate("mv", {constitution: 40, dexterity: 50}), 596);
});

test("natural resource formulas add their matching quest bonuses", function() {
    assert.equal(calculate("hp", {constitution: 30, quest_hp: 17}), 398);
    assert.equal(calculate("ma", {mind: 30, quest_mana: 23}), 454);
    assert.equal(calculate("mv", {
        constitution: 40,
        dexterity: 50,
        quest_move: 29
    }), 625);
});

test("quest resource bonuses normalize to the version-5 storage range", function() {
    assert.equal(gameStats.normalizeQuestResourceBonus(undefined), 0);
    assert.equal(gameStats.normalizeQuestResourceBonus("not a number"), 0);
    assert.equal(gameStats.normalizeQuestResourceBonus(Infinity), 0);
    assert.equal(gameStats.normalizeQuestResourceBonus(-4), 0);
    assert.equal(gameStats.normalizeQuestResourceBonus(4.9), 4);
    assert.equal(gameStats.normalizeQuestResourceBonus("23"), 23);
    assert.equal(gameStats.normalizeQuestResourceBonus(238328), 238327);
});
```

Update the browser-registration assertion at the bottom from `471` to `431`, and add:

```js
assert.equal(typeof registeredGameStats.normalizeQuestResourceBonus, "function");
assert.equal(registeredGameStats.normalizeQuestResourceBonus(4.9), 4);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd www
node --test test/game-stats.test.js
```

Expected: FAIL because `normalizeQuestResourceBonus` is not exported, mana still includes 40 fixed points, and the three quest values are ignored.

- [ ] **Step 3: Implement normalization and the three formulas**

In `www/src/public/js/services/game-stats.js`, add near the top of the factory:

```js
const MAX_QUEST_RESOURCE_BONUS = 238327;

function normalizeQuestResourceBonus(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        return 0;
    }

    return Math.min(
        Math.max(Math.trunc(number), 0),
        MAX_QUEST_RESOURCE_BONUS
    );
}
```

Change only the resource cases in `calculateNaturalStatBonus`:

```js
case "hp": {
    const con = stats.constitution;
    let bonus = 381 + ((con - 30) * 5);
    if (con > 89) {
        bonus += Math.max(con - 88, 0) * 5;
    }
    return bonus + normalizeQuestResourceBonus(stats.quest_hp);
}
case "ma": {
    /*
     * The builder models level-50 characters. A fixed base character has
     * 100 mana plus 4 mana for each of levels 2 through 50: 296 total.
     * Remove the five assumed SAV_*_MANA_BOOST values (15), leaving 281.
     * VALLEY_COMPLETE and other resource quests are entered as Quest Mana.
     *
     * ma_for_mind() is (level * current mind) / MANA_FOR_MIND_DIV. At
     * level 50 with MANA_FOR_MIND_DIV set to 10, that is 5 mana per mind.
     * Mental Enhancement remains represented by compensating Other-slot
     * objects and must not also be included in this natural calculation.
     */
    const level = 50;
    const manaForMindDiv = Math.max(10, 1);
    const manaForMind = Math.trunc((level * stats.mind) / manaForMindDiv);

    return 281 + manaForMind +
        normalizeQuestResourceBonus(stats.quest_mana);
}
case "mv":
    return 496 +
        ((Math.max(stats.constitution, stats.dexterity) - 30) * 5) +
        normalizeQuestResourceBonus(stats.quest_move);
```

Add `normalizeQuestResourceBonus` to the returned public API beside `calculateNaturalStatBonus`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
cd www
node --test test/game-stats.test.js
```

Expected: all `game-stats.test.js` tests PASS, including mana values 281, 431, and 781.

- [ ] **Step 5: Commit the calculation unit**

```bash
git add www/src/public/js/services/game-stats.js www/test/game-stats.test.js
git commit -m "Add quest resource bonuses to natural stats"
```

---

### Task 2: Builder fields and calculation data flow

**Files:**
- Modify: `www/test/builder-game-stats.test.js:1-115`
- Modify: `www/src/public/js/controllers/builder/main.js:120-140`
- Modify: `www/src/public/js/controllers/builder/main.js:1884-1906`
- Modify: `www/src/views/builder/index.ejs:146-175`

**Interfaces:**
- Consumes: `gameStats.calculateNaturalStatBonus(statName, stats, items)` and its optional `stats.quest_*` properties from Task 1.
- Produces: `selectedList.baseStats.quest_hp`, `quest_mana`, and `quest_move`, each defaulting to `0`.
- Produces: HTML inputs `questHpInput`, `questManaInput`, and `questMoveInput` bound to those properties.

- [ ] **Step 1: Add failing builder integration, default, and template tests**

In the `statInfo` array created by `createBuilderScope`, include `"hp"`, `"ma"`, and `"mv"` before `"hit"`.

Add zero quest properties to the `equipStats` baseStats fixture:

```js
quest_hp: overrides.quest_hp || 0,
quest_mana: overrides.quest_mana || 0,
quest_move: overrides.quest_move || 0,
```

Add these tests:

```js
test("new builder lists default quest resource bonuses to zero", function() {
    const scope = createBuilderScope();
    const list = scope.getDefaultList("Original");

    assert.equal(list.baseStats.quest_hp, 0);
    assert.equal(list.baseStats.quest_mana, 0);
    assert.equal(list.baseStats.quest_move, 0);
});

test("builder applies each quest bonus only to its matching resource", function() {
    const scope = createBuilderScope();
    equipStats(scope, {
        dexterity: 90,
        quest_hp: 17,
        quest_mana: 23,
        quest_move: 29,
        equipment: {},
        other: {}
    });

    assert.equal(scope.getStatTotal("hp"), 708);
    assert.equal(scope.getStatTotal("ma"), 754);
    assert.equal(scope.getStatTotal("mv"), 825);
});

test("builder stats block renders the three quest resource inputs", function() {
    const template = fs.readFileSync(path.join(
        __dirname,
        "../src/views/builder/index.ejs"
    ), "utf8");
    const hazelnutIndex = template.indexOf('id="hazelnutSelect"');

    const fields = [
        ["questHpInput", "Quest HP", "quest_hp"],
        ["questManaInput", "Quest Mana", "quest_mana"],
        ["questMoveInput", "Quest Mv", "quest_move"]
    ];

    for (const [id, label, property] of fields) {
        const inputIndex = template.indexOf(`id="${id}"`);
        assert.ok(inputIndex > hazelnutIndex, `${id} must follow Hazelnut`);
        assert.match(template, new RegExp(`for="${id}">${label}<\\/label>`));
        assert.match(template, new RegExp(
            `id="${id}"[^>]*ng-model="selectedList\\.baseStats\\.${property}"`
        ));
    }
});
```

- [ ] **Step 2: Run the focused builder test and verify RED**

Run:

```bash
cd www
node --test test/builder-game-stats.test.js
```

Expected: FAIL because default lists omit the fields, builder calculations do not pass them to `gameStats`, and the template inputs do not exist.

- [ ] **Step 3: Add the default properties and calculation data flow**

Expand the default `baseStats` object in `getDefaultList`:

```js
list.baseStats = {
    "strength": 0,
    "mind": 0,
    "dexterity": 0,
    "constitution": 0,
    "perception": 0,
    "spirit": 0,
    "longhouse": -1,
    "hazelnut": -1,
    "amulet": -1,
    "quest_hp": 0,
    "quest_mana": 0,
    "quest_move": 0
};
```

In `getTotalFromStatBonuses`, pass the selected variant's direct quest fields after resolving recursive dependencies:

```js
const baseStats = $scope.selectedList.baseStats || {};
stats.quest_hp = baseStats.quest_hp;
stats.quest_mana = baseStats.quest_mana;
stats.quest_move = baseStats.quest_move;
```

Do not add quest properties to `naturalStatDependencies`; doing so would route them through `getStatTotal` and treat form values as derived stats.

- [ ] **Step 4: Render the input row beneath Longhouse/Amulet/Hazelnut**

After the existing row's closing `</div>` in `www/src/views/builder/index.ejs`, add:

```html
<div class="row mt-3">
    <div class="input-group input-group-sm col-8 col-sm-4 mb-3 mb-sm-0">
        <div class="input-group-prepend">
            <label class="input-group-text" for="questHpInput">Quest HP</label>
        </div>
        <input type="number" id="questHpInput" class="form-control form-control-sm"
            ng-model="selectedList.baseStats.quest_hp"
            ng-change="saveClientSideData()"
            ng-model-options="{debounce:250}" min="0" max="238327" step="1">
    </div>
    <div class="input-group input-group-sm col-8 col-sm-4 mb-3 mb-sm-0">
        <div class="input-group-prepend">
            <label class="input-group-text" for="questManaInput">Quest Mana</label>
        </div>
        <input type="number" id="questManaInput" class="form-control form-control-sm"
            ng-model="selectedList.baseStats.quest_mana"
            ng-change="saveClientSideData()"
            ng-model-options="{debounce:250}" min="0" max="238327" step="1">
    </div>
    <div class="input-group input-group-sm col-8 col-sm-4">
        <div class="input-group-prepend">
            <label class="input-group-text" for="questMoveInput">Quest Mv</label>
        </div>
        <input type="number" id="questMoveInput" class="form-control form-control-sm"
            ng-model="selectedList.baseStats.quest_move"
            ng-change="saveClientSideData()"
            ng-model-options="{debounce:250}" min="0" max="238327" step="1">
    </div>
</div>
```

- [ ] **Step 5: Run the focused builder and game-stat tests and verify GREEN**

Run:

```bash
cd www
node --test test/game-stats.test.js test/builder-game-stats.test.js
```

Expected: all focused tests PASS, including builder totals HP 708, mana 754, and movement 825.

- [ ] **Step 6: Commit the builder input unit**

```bash
git add www/src/views/builder/index.ejs www/src/public/js/controllers/builder/main.js www/test/builder-game-stats.test.js
git commit -m "Add builder quest resource fields"
```

---

### Task 3: Version-5 save, export, import, and legacy compatibility

**Files:**
- Modify: `www/test/builder-game-stats.test.js:1-90`
- Modify: `www/test/builder-game-stats.test.js` after the quest input tests
- Modify: `www/src/public/js/controllers/builder/main.js:5-10`
- Modify: `www/src/public/js/controllers/builder/main.js:235-282`
- Modify: `www/src/public/js/controllers/builder/main.js:345-375`
- Modify: `www/src/public/js/controllers/builder/main.js:775-810`

**Interfaces:**
- Consumes: `gameStats.normalizeQuestResourceBonus(value)` from Task 1.
- Produces: builder-list format version `5`.
- Produces: version-5 compact segment `[quest_hp:3][quest_mana:3][quest_move:3]` after Hazelnut.
- Preserves: version-1 through version-4 imports with all three properties set to zero.

- [ ] **Step 1: Give the controller test harness a compatible encoder and modal stub**

Add this test helper near the top of `www/test/builder-game-stats.test.js`:

```js
function createEncoder() {
    const digits = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

    return {
        fromNumber: function(number, minLength) {
            let residual = Math.floor(Math.abs(Number(number) || 0));
            let result = "";
            do {
                result = digits[residual % digits.length] + result;
                residual = Math.floor(residual / digits.length);
            } while (residual > 0);
            return result.padStart(minLength || 0, "0");
        },
        toNumber: function(value) {
            return Array.from(value).reduce(function(total, digit) {
                return (total * digits.length) + digits.indexOf(digit);
            }, 0);
        }
    };
}
```

Make the jQuery test stub return both methods:

```js
return {
    on: function() {},
    modal: function() {}
};
```

Inject `createEncoder()` instead of `{}` as the controller's encoder argument.

- [ ] **Step 2: Add failing version-5 and version-4 compatibility tests**

Add:

```js
test("builder version 5 round-trips quest resources without shifting items", function() {
    const scope = createBuilderScope();
    const list = scope.getDefaultList("Original");
    Object.assign(list.baseStats, {
        strength: 30,
        mind: 30,
        dexterity: 30,
        constitution: 30,
        perception: 30,
        spirit: 30,
        quest_hp: 17,
        quest_mana: 23,
        quest_move: 29
    });
    list.items[0] = {id: 1144, slot: 0, name: "Test Item"};
    scope.allLists = [{name: "Quest Hero", variants: [list]}];
    scope.selectedListIndex = 0;
    scope.selectedListVariantIndex = 0;
    scope.selectedList = list;

    scope.onExportClicked();
    assert.match(scope.exportModel.curVariant, /^5\*/);

    scope.importModel = {
        input: scope.exportModel.curVariant,
        lists: [],
        message: "",
        loading: true
    };
    scope.onImportInputChanged();

    const imported = scope.importModel.lists[0].variants[0];
    assert.equal(imported.baseStats.quest_hp, 17);
    assert.equal(imported.baseStats.quest_mana, 23);
    assert.equal(imported.baseStats.quest_move, 29);
    assert.equal(imported.items.length, scope.slotOrder.length);
    assert.equal(imported.items[0].id, 1144);
});

test("builder version 4 imports default quest resources without shifting items", function() {
    const scope = createBuilderScope();
    const encoder = createEncoder();
    const baseStats = Array(6).fill(encoder.fromNumber(30, 2)).join("");
    const ksmStats = "0".repeat(6);
    const questSelectionsAndItems = "_".repeat(3 + scope.slotOrder.length);
    scope.importModel = {
        input: `4*Legacy~Original~${baseStats}${ksmStats}${questSelectionsAndItems}`,
        lists: [],
        message: "",
        loading: true
    };

    scope.onImportInputChanged();

    const imported = scope.importModel.lists[0].variants[0];
    assert.equal(imported.baseStats.quest_hp, 0);
    assert.equal(imported.baseStats.quest_mana, 0);
    assert.equal(imported.baseStats.quest_move, 0);
    assert.equal(imported.items.length, scope.slotOrder.length);
    assert.equal(imported.items[0].id, 0);
});

test("legacy builder imports default quest resources without shifting items", function() {
    const scope = createBuilderScope();
    const fields = [
        "30", "30", "30", "30", "30", "30",
        "-1", "-1", "-1",
        ...Array(scope.slotOrder.length).fill("0")
    ];
    scope.importModel = {
        input: `Legacy!Original_${fields.join("_")}`,
        lists: [],
        message: "",
        loading: true
    };

    scope.onImportInputChanged();

    const imported = scope.importModel.lists[0].variants[0];
    assert.equal(imported.baseStats.quest_hp, 0);
    assert.equal(imported.baseStats.quest_mana, 0);
    assert.equal(imported.baseStats.quest_move, 0);
    assert.equal(imported.items.length, scope.slotOrder.length);
    assert.equal(imported.items[0].id, 0);
});

test("builder rejects malformed version-5 quest resource data", function() {
    const scope = createBuilderScope();
    const encoder = createEncoder();
    const baseStats = Array(6).fill(encoder.fromNumber(30, 2)).join("");
    const ksmStats = "0".repeat(6);
    scope.importModel = {
        input: `5*Broken~Original~${baseStats}${ksmStats}${"_".repeat(12)}`,
        lists: [],
        message: "",
        loading: true
    };

    assert.throws(function() {
        scope.onImportInputChanged();
    }, /Invalid list/);
});
```

- [ ] **Step 3: Run the focused builder test and verify RED**

Run:

```bash
cd www
node --test test/builder-game-stats.test.js
```

Expected: FAIL because exports still report version 4, version-5 quest bytes are not written/read, and old decoded objects omit the zero fields.

- [ ] **Step 4: Add backward-compatible decode behavior**

Set `$scope.listVer = 5` in `initialize`.

In legacy `createListFromString`, after decoding Hazelnut, initialize:

```js
newList.baseStats.quest_hp = 0;
newList.baseStats.quest_mana = 0;
newList.baseStats.quest_move = 0;
```

In `createListFromStringV2`, immediately after the existing Hazelnut version branch, add:

```js
baseStats.quest_hp = 0;
baseStats.quest_mana = 0;
baseStats.quest_move = 0;

// v5: character-specific quest resource bonuses
if (listVersion >= 5) {
    const encodedQuestResources = listStr.slice(0, 9);
    if (!(/^[0-9A-Za-z]{9}$/).test(encodedQuestResources)) {
        throw "Invalid list.";
    }

    baseStats.quest_hp = encoder.toNumber(encodedQuestResources.slice(0, 3));
    baseStats.quest_mana = encoder.toNumber(encodedQuestResources.slice(3, 6));
    baseStats.quest_move = encoder.toNumber(encodedQuestResources.slice(6, 9));
    listStr = listStr.substring(9);
}
```

This must run before item decoding. Version 2 through 4 consume no extra characters.

- [ ] **Step 5: Write normalized version-5 quest fields before item data**

In `createStringFromList`, immediately after writing Hazelnut and before `charmStr` or the item loop, add:

```js
const questResourceStats = ["quest_hp", "quest_mana", "quest_move"];
for (const questResourceStat of questResourceStats) {
    const value = gameStats.normalizeQuestResourceBonus(
        list.baseStats[questResourceStat]
    );
    listCookieStr += encoder.fromNumber(value, 3);
}
```

Because every value is normalized to 0 through 238,327, `fromNumber(value, 3)` always emits exactly three characters.

- [ ] **Step 6: Run all focused tests and verify GREEN**

Run:

```bash
cd www
node --test test/game-stats.test.js test/builder-game-stats.test.js
```

Expected: all focused tests PASS, including version-5 round trip, version-4 zero defaults, item alignment, and malformed-data rejection.

- [ ] **Step 7: Commit the persistence unit**

```bash
git add www/src/public/js/controllers/builder/main.js www/test/builder-game-stats.test.js
git commit -m "Persist builder quest resource bonuses"
```

---

### Task 4: Public changelog and full verification

**Files:**
- Modify: `CHANGELOG.md:7-24`

**Interfaces:**
- Consumes: completed resource formulas, builder UI, and version-5 persistence from Tasks 1 through 3.
- Produces: an accurate `2.6.0-beta` public changelog entry.

- [ ] **Step 1: Update the changelog without leaving contradictory mana text**

Under `### Added`, add:

```markdown
- Added builder fields for character-specific quest hit points, mana, and movement.
```

Under `### Fixed`, replace:

```markdown
- Corrected level-50 builder mana to include the assumed Valley completion bonus.
```

with:

```markdown
- Corrected level-50 builder mana to use the entered quest bonus instead of assuming completed mana quests.
```

Keep the version heading exactly `2.6.0-beta`.

- [ ] **Step 2: Run the complete web test suite**

Run:

```bash
cd www
npm test
```

Expected: zero failures and only the existing environment-dependent migration test skipped.

- [ ] **Step 3: Verify formatting and the final diff**

Run:

```bash
git diff --check
git status --short --branch
git diff master -- CHANGELOG.md www/src www/test
```

Expected:

- `git diff --check` exits 0 with no output.
- Only the intended feature files and committed design/plan documents differ from `master`.
- `.codex/`, `.idea/`, and `docker-compose-prod.yaml` remain untracked and untouched.
- No release tags, deployment files, or version headings changed.

- [ ] **Step 4: Commit documentation**

```bash
git add CHANGELOG.md
git commit -m "Record builder quest resource fields"
```

- [ ] **Step 5: Run final post-commit verification**

Run:

```bash
cd www
npm test
cd ..
git diff --check
git status --short --branch
```

Expected: the full suite again reports zero failures, `git diff --check` is clean, and the branch is ready for review without any push or deployment.
