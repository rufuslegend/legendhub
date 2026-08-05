const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const gameStats = require("../src/public/js/services/game-stats");

function calculate(statName, stats, items = []) {
    return gameStats.calculateNaturalStatBonus(statName, stats, items);
}

test("natural resource formulas retain their current behavior", function() {
    assert.equal(calculate("hp", {constitution: 30}), 381);
    assert.equal(calculate("hp", {constitution: 90}), 691);
    assert.equal(calculate("ma", {mind: 30}), 446);
    assert.equal(calculate("mv", {constitution: 40, dexterity: 50}), 596);
});

test("natural spell formulas retain their current behavior", function() {
    assert.equal(calculate("spelldam", {mind: 60}), 4);
    assert.equal(calculate("spellcrit", {mind: 68, perception: 68, spirit: 68}), 9);
});

test("hitroll defaults to dexterity and follows an equipped weapon stat", function() {
    const stats = {strength: 100, dexterity: 40, constitution: 80};

    assert.equal(calculate("hit", stats), 13);
    assert.equal(calculate("hit", stats, [{slot: 14, weaponStat: 1}]), 25);
    assert.equal(calculate("hit", stats, [{slot: 15, weaponStat: 3}]), 20);
});

test("hitroll retains current constitution precedence with two weapon stats", function() {
    const stats = {strength: 100, dexterity: 40, constitution: 80};
    const items = [
        {slot: 14, weaponStat: 1},
        {slot: 15, weaponStat: 3}
    ];

    assert.equal(calculate("hit", stats, items), 20);
});

test("damroll defaults to strength and follows an equipped weapon stat", function() {
    const stats = {strength: 40, dexterity: 100, constitution: 80};

    assert.equal(calculate("dam", stats), 13);
    assert.equal(calculate("dam", stats, [{slot: 14, weaponStat: 2}]), 25);
    assert.equal(calculate("dam", stats, [{slot: 15, weaponStat: 3}]), 20);
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
        "strength",
        "dexterity",
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
    assert.equal(
        registeredGameStats.calculateNaturalStatBonus("ma", {mind: 30}, []),
        446
    );
});
