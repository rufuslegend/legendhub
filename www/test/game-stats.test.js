const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const gameStats = require("../src/public/js/services/game-stats");

function calculate(statName, stats, items = []) {
    return gameStats.calculateNaturalStatBonus(statName, stats, items);
}

test("natural HP mirrors the level-50 Legend calculation", function() {
    assert.equal(calculate("hp", {constitution: 30}), 366);
    assert.equal(calculate("hp", {constitution: 89}), 661);
    assert.equal(calculate("hp", {constitution: 90}), 666);
    assert.equal(calculate("hp", {constitution: 91}), 676);
    assert.equal(calculate("hp", {constitution: 100}), 766);
});

test("natural resource formulas default missing quest bonuses to zero", function() {
    assert.equal(calculate("ma", {mind: 0}), 281);
    assert.equal(calculate("ma", {mind: 30}), 431);
    assert.equal(calculate("ma", {mind: 100}), 781);
    assert.equal(calculate("mv", {constitution: 40, dexterity: 50}), 596);
});

test("natural resource formulas add their matching quest bonuses", function() {
    assert.equal(calculate("hp", {constitution: 30, quest_hp: 17}), 383);
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

test("natural spell formulas retain their current behavior", function() {
    assert.equal(calculate("spelldam", {mind: 60}), 4);
    assert.equal(calculate("spellcrit", {mind: 68, perception: 68, spirit: 68}), 9);
});

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

test("hitroll equipment cap increases above 90 dexterity", function() {
    assert.equal(gameStats.calculateHitrollEquipmentCap(89), 30);
    assert.equal(gameStats.calculateHitrollEquipmentCap(90), 30);
    assert.equal(gameStats.calculateHitrollEquipmentCap(91), 31);
    assert.equal(gameStats.calculateHitrollEquipmentCap(100), 40);
    assert.equal(gameStats.calculateHitrollEquipmentCap(110), 50);
});

test("damroll equipment cap increases above 90 strength", function() {
    assert.equal(gameStats.calculateDamrollEquipmentCap(89), 30);
    assert.equal(gameStats.calculateDamrollEquipmentCap(90), 30);
    assert.equal(gameStats.calculateDamrollEquipmentCap(91), 31);
    assert.equal(gameStats.calculateDamrollEquipmentCap(100), 40);
    assert.equal(gameStats.calculateDamrollEquipmentCap(110), 50);
});

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

test("defensive and regeneration formulas retain their current behavior", function() {
    const items = Array(26).fill(null);
    items[25] = {id: 1144};

    assert.equal(calculate("mitigation", {constitution: 80}, items), 1);
    assert.equal(calculate("ac", {
        strength: 40,
        dexterity: 40,
        constitution: 40,
        perception: 40
    }), 72);
    assert.equal(calculate("hpr", {constitution: 80}), 3);
});

test("natural stat dependency lookup is isolated from callers", function() {
    const dependencies = gameStats.getNaturalStatDependencies("hit");
    dependencies.push("mind");

    assert.deepEqual(gameStats.getNaturalStatDependencies("hit"), [
        "dexterity"
    ]);
    assert.deepEqual(gameStats.getNaturalStatDependencies("dam"), [
        "strength"
    ]);
    assert.deepEqual(gameStats.getNaturalStatDependencies("ma"), [
        "mind"
    ]);
    assert.deepEqual(gameStats.getNaturalStatDependencies("hp"), [
        "constitution"
    ]);
    assert.deepEqual(gameStats.getNaturalStatDependencies("unknown"), []);
});

test("browser loading registers the game-stat module with AngularJS", function() {
    let registeredGameStats;
    const browserContext = {
        angular: {
            module: function(moduleName) {
                assert.equal(moduleName, "legendwiki-app");
                return {
                    factory: function(factoryName, createFactory) {
                        assert.equal(factoryName, "gameStats");
                        registeredGameStats = createFactory();
                    }
                };
            }
        }
    };
    browserContext.globalThis = browserContext;

    const source = fs.readFileSync(path.join(
        __dirname,
        "../src/public/js/services/game-stats.js"
    ), "utf8");
    vm.runInNewContext(source, browserContext);

    assert.equal(typeof registeredGameStats.calculateNaturalStatBonus, "function");
    assert.equal(typeof registeredGameStats.calculateHitrollEquipmentCap, "function");
    assert.equal(registeredGameStats.calculateHitrollEquipmentCap(100), 40);
    assert.equal(typeof registeredGameStats.calculateDamrollEquipmentCap, "function");
    assert.equal(registeredGameStats.calculateDamrollEquipmentCap(100), 40);
    assert.equal(typeof registeredGameStats.normalizeQuestResourceBonus, "function");
    assert.equal(registeredGameStats.normalizeQuestResourceBonus(4.9), 4);
    assert.equal(
        registeredGameStats.calculateNaturalStatBonus("ma", {mind: 30}, []),
        431
    );
});
