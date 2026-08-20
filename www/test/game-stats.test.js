const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const gameStats = require("../src/public/js/services/game-stats");

function calculate(statName, stats, items = []) {
    return gameStats.calculateNaturalStatBonus(statName, stats, items);
}

test("era ability catalog exposes the supported ranks in stable order", function() {
    assert.deepEqual(gameStats.getEraAbilities(), [
        {
            key: "mentalEnhancement",
            name: "Mental Enhancement",
            era: "Ancient",
            maxRank: 3,
            ranks: [1, 2, 3]
        },
        {
            key: "arcaneFocus",
            name: "Arcane Focus",
            era: "Ancient",
            maxRank: 5,
            ranks: [1, 2, 3, 4, 5]
        },
        {
            key: "hardenedSkin",
            name: "Hardened Skin",
            era: "Medieval",
            maxRank: 5,
            ranks: [1, 2, 3, 4, 5]
        },
        {
            key: "increasedPotential",
            name: "Increased Potential",
            era: "Medieval",
            maxRank: 5,
            ranks: [1, 2, 3, 4, 5]
        },
        {
            key: "physicalEnhancement",
            name: "Physical Enhancement",
            era: "Medieval",
            maxRank: 3,
            ranks: [1, 2, 3]
        },
        {
            key: "weaponFocus",
            name: "Weapon Focus",
            era: "Medieval",
            maxRank: 1,
            ranks: [1]
        },
        {
            key: "innateRegeneration",
            name: "Innate Regeneration",
            era: "Medieval",
            maxRank: 3,
            ranks: [1, 2, 3]
        },
        {
            key: "physicalEndurance",
            name: "Physical Endurance",
            era: "Industrial",
            maxRank: 3,
            ranks: [1, 2, 3]
        }
    ]);
});

test("era ability catalog and defaults are isolated from callers", function() {
    const abilities = gameStats.getEraAbilities();
    const defaults = gameStats.getDefaultEraAbilityRanks();

    abilities[0].name = "Changed";
    abilities[0].ranks.push(4);
    defaults.mentalEnhancement = 3;

    assert.equal(gameStats.getEraAbilities()[0].name, "Mental Enhancement");
    assert.deepEqual(gameStats.getEraAbilities()[0].ranks, [1, 2, 3]);
    assert.deepEqual(gameStats.getDefaultEraAbilityRanks(), {
        mentalEnhancement: 0,
        arcaneFocus: 0,
        hardenedSkin: 0,
        increasedPotential: 0,
        physicalEnhancement: 0,
        weaponFocus: 0,
        innateRegeneration: 0,
        physicalEndurance: 0
    });
});

test("era ability ranks normalize to known integer rank ranges", function() {
    assert.deepEqual(gameStats.normalizeEraAbilityRanks({
        mentalEnhancement: "2.9",
        arcaneFocus: 99,
        hardenedSkin: -2,
        increasedPotential: "not a number",
        physicalEnhancement: 1.8,
        weaponFocus: Infinity,
        physicalEndurance: 2.9,
        unknownAbility: 5
    }), {
        mentalEnhancement: 2,
        arcaneFocus: 5,
        hardenedSkin: 0,
        increasedPotential: 0,
        physicalEnhancement: 1,
        weaponFocus: 0,
        innateRegeneration: 0,
        physicalEndurance: 2
    });

    assert.deepEqual(
        gameStats.normalizeEraAbilityRanks(),
        gameStats.getDefaultEraAbilityRanks()
    );
});

test("era abilities apply their persistent per-rank stat bonuses", function() {
    assert.equal(gameStats.calculateEraAbilityBonus("ac", {
        hardenedSkin: 5
    }), -15);
    assert.equal(gameStats.calculateEraAbilityBonus("hp", {
        physicalEndurance: 3
    }), 30);
    assert.equal(gameStats.calculateEraAbilityBonus("ma", {
        mentalEnhancement: 3
    }), 30);
    assert.equal(gameStats.calculateEraAbilityBonus("mv", {
        physicalEnhancement: 3
    }), 60);
    assert.equal(gameStats.calculateEraAbilityBonus("hit", {
        weaponFocus: 1
    }), 5);
    assert.equal(gameStats.calculateEraAbilityBonus("dam", {
        weaponFocus: 1
    }), 5);

    for (const statName of ["hpr", "mar", "mvr"]) {
        assert.equal(gameStats.calculateEraAbilityBonus(statName, {
            innateRegeneration: 3
        }), 3);
    }

    for (const statName of ["spelldam", "spellcrit"]) {
        assert.equal(gameStats.calculateEraAbilityBonus(statName, {
            arcaneFocus: 5
        }), 5);
    }
});

test("era ability calculations clamp ranks and ignore unrelated stats", function() {
    assert.equal(gameStats.calculateEraAbilityBonus("hp", {
        physicalEndurance: 99
    }), 30);
    assert.equal(gameStats.calculateEraAbilityBonus("mitigation", {
        hardenedSkin: 5,
        physicalEndurance: 3
    }), 0);
    assert.equal(gameStats.calculateEraAbilityStatCapBonus({
        increasedPotential: 4
    }), 4);
    assert.equal(gameStats.calculateEraAbilityStatCapBonus({
        increasedPotential: 99
    }), 5);
    assert.equal(gameStats.calculateEraAbilityStatCapBonus(), 0);
});

test("natural HP mirrors the level-50 Legend calculation", function() {
    assert.equal(calculate("hp", {constitution: 30}), 366);
    assert.equal(calculate("hp", {constitution: 89}), 661);
    assert.equal(calculate("hp", {constitution: 90}), 666);
    assert.equal(calculate("hp", {constitution: 91}), 676);
    assert.equal(calculate("hp", {constitution: 100}), 766);
});

test("natural movement mirrors the level-50 Legend calculation", function() {
    assert.deepEqual(gameStats.getNaturalStatDependencies("mv"), ["dexterity"]);
    assert.equal(calculate("mv", {constitution: 100, dexterity: 0}), 346);
    assert.equal(calculate("mv", {constitution: 100, dexterity: 30}), 496);
    assert.equal(calculate("mv", {constitution: 100, dexterity: 50}), 596);
    assert.equal(calculate("mv", {constitution: 30, dexterity: 100}), 846);
    assert.equal(calculate("mv", {constitution: 30, dexterity: 105}), 871);
});

test("natural resource formulas default missing quest bonuses to zero", function() {
    assert.equal(calculate("ma", {mind: 0}), 296);
    assert.equal(calculate("ma", {mind: 30}), 446);
    assert.equal(calculate("ma", {mind: 100}), 796);
    assert.equal(calculate("ma", {mind: 105}), 821);
});

test("natural resource formulas add their matching quest bonuses", function() {
    assert.equal(calculate("hp", {constitution: 30, quest_hp: 17}), 383);
    assert.equal(calculate("ma", {mind: 30, quest_mana: 23}), 469);
    assert.equal(calculate("mv", {
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

test("melee damage cap depends on current strength", function() {
    assert.deepEqual(
        gameStats.getNaturalStatDependencies("meleedamcap"),
        ["strength"]
    );
});

test("natural melee damage cap mirrors Legend's base and strength contribution", function() {
    assert.equal(calculate("meleedamcap", {}), 102);
    assert.equal(calculate("meleedamcap", {strength: 50}), 102);
    assert.equal(calculate("meleedamcap", {strength: 51}), 102);
    assert.equal(calculate("meleedamcap", {strength: 52}), 103);
    assert.equal(calculate("meleedamcap", {strength: 99}), 126);
    assert.equal(calculate("meleedamcap", {strength: 100}), 127);
    assert.equal(calculate("meleedamcap", {strength: 101}), 128);
    assert.equal(calculate("meleedamcap", {strength: 104}), 131);
});

test("natural melee damage cap adds the two-handed Wield bonus once", function() {
    const stats = {strength: 100};

    assert.equal(calculate("meleedamcap", stats, [
        {slot: 14, twoHanded: true}
    ]), 191);
    assert.equal(calculate("meleedamcap", stats, [
        {slot: 15, twoHanded: true}
    ]), 127);
    assert.equal(calculate("meleedamcap", stats, [
        {slot: 14, twoHanded: false}
    ]), 127);
    assert.equal(calculate("meleedamcap", stats, [
        {slot: 14, twoHanded: true},
        {slot: 14, twoHanded: true}
    ]), 191);
});

test("natural armor class depends only on dexterity", function() {
    assert.deepEqual(gameStats.getNaturalStatDependencies("ac"), [
        "dexterity"
    ]);
});

test("natural armor class mirrors Legend's C-style dexterity rule", function() {
    const cases = [
        {dexterity: 20, expected: 105},
        {dexterity: 29, expected: 100},
        {dexterity: 30, expected: 100},
        {dexterity: 31, expected: 100},
        {dexterity: 32, expected: 99},
        {dexterity: 40, expected: 95},
        {dexterity: 100, expected: 65}
    ];

    for (const entry of cases) {
        assert.equal(
            calculate("ac", {dexterity: entry.dexterity}),
            entry.expected,
            `dexterity ${entry.dexterity}`
        );
    }
});

test("natural armor class ignores non-dexterity stats", function() {
    assert.equal(calculate("ac", {
        strength: 20,
        dexterity: 80,
        constitution: 20,
        perception: 20
    }), 75);
    assert.equal(calculate("ac", {
        strength: 120,
        dexterity: 80,
        constitution: 120,
        perception: 120
    }), 75);
});

test("natural mitigation retains its Battle Training behavior", function() {
    const items = Array(26).fill(null);
    items[25] = {id: 1144};

    assert.equal(calculate("mitigation", {constitution: 80}, items), 1);
});

test("natural regeneration mirrors Legend stat formulas", function() {
    assert.equal(calculate("hpr", {constitution: 79}), 7);
    assert.equal(calculate("hpr", {constitution: 80}), 9);
    assert.equal(calculate("hpr", {constitution: 100}), 15);
    assert.equal(calculate("hpr", {constitution: 105}), 16);
    assert.equal(calculate("hpr", {constitution: 110}), 19);

    assert.equal(calculate("mar", {mind: 79}), 7);
    assert.equal(calculate("mar", {mind: 80}), 9);
    assert.equal(calculate("mar", {mind: 100}), 15);
    assert.equal(calculate("mar", {mind: 105}), 18);
    assert.equal(calculate("mar", {mind: 110}), 23);

    assert.equal(calculate("mvr", {dexterity: 53}), 0);
    assert.equal(calculate("mvr", {dexterity: 54}), 1);
    assert.equal(calculate("mvr", {dexterity: 79}), 6);
    assert.equal(calculate("mvr", {dexterity: 80}), 7);
    assert.equal(calculate("mvr", {dexterity: 100}), 15);
    assert.equal(calculate("mvr", {dexterity: 105}), 17);
});

test("regeneration equipment allowance includes the high-stat contribution", function() {
    assert.equal(gameStats.calculateRegenEquipmentCap(79), 20);
    assert.equal(gameStats.calculateRegenEquipmentCap(80), 19);
    assert.equal(gameStats.calculateRegenEquipmentCap(100), 15);
    assert.equal(gameStats.calculateRegenEquipmentCap(105), 14);
});

test("regeneration formulas safely default missing governing stats", function() {
    assert.equal(calculate("hpr", {}), 0);
    assert.equal(calculate("mar", {}), 0);
    assert.equal(calculate("mvr", {}), 0);
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
    assert.deepEqual(gameStats.getNaturalStatDependencies("hpr"), [
        "constitution"
    ]);
    assert.deepEqual(gameStats.getNaturalStatDependencies("mar"), [
        "mind"
    ]);
    assert.deepEqual(gameStats.getNaturalStatDependencies("mvr"), [
        "dexterity"
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
    assert.equal(typeof registeredGameStats.calculateRegenEquipmentCap, "function");
    assert.equal(registeredGameStats.calculateRegenEquipmentCap(100), 15);
    assert.equal(typeof registeredGameStats.normalizeQuestResourceBonus, "function");
    assert.equal(registeredGameStats.normalizeQuestResourceBonus(4.9), 4);
    assert.equal(
        registeredGameStats.calculateNaturalStatBonus("ma", {mind: 30}, []),
        446
    );
});
