const assert = require("node:assert/strict");
const test = require("node:test");
const gameStats = require("../src/public/js/services/game-stats");
const {createDefaultVariant} = require("../client/features/builder/builder-reducer.js");

function build({strength = 50, constitution = 70, equipment = 0, affects = 0, training = false} = {}) {
    const variant = createDefaultVariant("Mitigation");
    // Keep the base total at 244 so the automatic +3 stat quests do not apply.
    Object.assign(variant.baseStats, {strength, constitution, mind: 244 - strength - constitution});
    variant.items[0].mitigation = equipment;
    variant.items[34].mitigation = affects;
    if (training) variant.items[28].id = 1144;
    return variant;
}

test("Battle Training takes the better whole-point Strength or Constitution mitigation bonus", function() {
    for (const id of [1144, 1137]) {
        const items = build({training: true}).items;
        items[28].id = id;
        for (const [stats, expected] of [
            [{strength: 106, constitution: 73}, 11],
            [{strength: 60, constitution: 100}, 5],
            [{strength: 64, constitution: 79}, 2],
            [{strength: 49, constitution: 74}, 0],
            [{constitution: 80}, 1],
            [{}, 0]
        ]) {
            assert.equal(gameStats.calculateNaturalStatBonus("mitigation", stats, items), expected);
        }
    }
    assert.equal(gameStats.calculateNaturalStatBonus("mitigation", {strength: 106, constitution: 100}, []), 0);
});

test("mitigation caps equipment plus training before adding affects for a Strength build", function() {
    const variant = build({strength: 90, constitution: 73, equipment: 23, training: true});
    Object.assign(variant.items[0], {strength: 16, strengthCap: 6});
    variant.items[32].mitigation = 2;
    variant.items[34].mitigation = 3;

    assert.equal(gameStats.calculateBuilderStatTotal(variant, "strength").value, 106);
    assert.deepEqual(gameStats.calculateBuilderStatTotal(variant, "mitigation"), {
        value: 35,
        restrictions: [{restriction: "fromEquipmentAndNatural", amount: 34, limit: 30}]
    });
    assert.equal(gameStats.calculateBuilderStatTotal(variant, "mitigationCap").value, 30);
});

test("mitigation cap rounds like the game and floors only after the Battle Training allowance", function() {
    for (const [constitution, training, expected] of [
        [0, true, 0], [20, true, 5], [28, true, 9], [29, true, 10],
        [28, false, 0], [31, false, 0], [33, false, 1],
        [69, false, 19], [70, false, 20], [100, false, 20], [73, true, 30]
    ]) {
        assert.equal(gameStats.calculateBuilderStatTotal(build({constitution, training}), "mitigationCap").value, expected,
            `Constitution ${constitution}, Battle Training ${training}`);
    }
});

test("affects above the mitigation cap do not cause a false cap warning", function() {
    assert.deepEqual(gameStats.calculateBuilderStatTotal(build({equipment: 20, affects: 5}), "mitigation"), {
        value: 25, restrictions: []
    });
});

test("negative mitigation affects apply after excess equipment is discarded", function() {
    assert.equal(gameStats.calculateBuilderStatTotal(build({equipment: 25, affects: -5}), "mitigation").value, 15);
});

test("natural mitigation uses capped Strength rather than the raw equipment total", function() {
    const variant = build({strength: 90, equipment: 1, training: true});
    variant.items[0].strength = 30;
    assert.equal(gameStats.calculateBuilderStatTotal(variant, "mitigation").value, 11);
});
