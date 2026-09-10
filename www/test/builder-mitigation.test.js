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

// Adding a cap allowance for an existing post-cap skill bonus must not also
// release the same amount of equipment mitigation: the reported build is 35/32.
test("adding Bastion's matching cap bonus keeps mitigation 35 and raises the cap to 32", function() {
    const variant = build({strength: 90, constitution: 73, equipment: 23, training: true});
    Object.assign(variant.items[0], {strength: 16, strengthCap: 6});
    Object.assign(variant.items[32], {id: 1772, mitigation: 2});
    variant.items[34].mitigation = 3;
    assert.equal(gameStats.calculateBuilderStatTotal(variant, "mitigation").value, 35);
    assert.equal(gameStats.calculateBuilderStatTotal(variant, "mitigationCap").value, 30);

    variant.items[32].mitigationCap = 2;
    assert.deepEqual(gameStats.calculateBuilderStatTotal(variant, "mitigation"), {
        value: 35,
        restrictions: [{restriction: "fromEquipmentAndNatural", amount: 34, limit: 30}]
    });
    assert.equal(gameStats.calculateBuilderStatTotal(variant, "mitigationCap").value, 32);
    assert.equal(variant.items[32].mitigation, 2);

    // The same fields on another skill follow the same rule; no Bastion ID special case.
    variant.items[32].id = 9001;
    variant.items[0].mitigation = 10;
    assert.equal(gameStats.calculateBuilderStatTotal(variant, "mitigation").value, 26);
    assert.equal(gameStats.calculateBuilderStatTotal(variant, "mitigationCap").value, 32);
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

test("equipment and Other mitigation-cap modifiers change the cap before mitigation affects apply", function() {
    const variant = build({strength: 100, equipment: 30, affects: 5, training: true});
    variant.items[0].mitigationCap = 4;
    variant.items[32].mitigationCap = 3;
    variant.items[34].mitigationCap = -2;
    assert.equal(gameStats.calculateBuilderStatTotal(variant, "mitigationCap").value, 35);
    assert.equal(gameStats.calculateBuilderStatTotal(variant, "mitigation").value, 40);
    variant.items[0].mitigationCap = 0;
    assert.equal(gameStats.calculateBuilderStatTotal(variant, "mitigationCap").value, 31);
    assert.equal(gameStats.calculateBuilderStatTotal(variant, "mitigation").value, 36);
});

test("negative cap modifiers floor the cap at zero without discarding mitigation affects", function() {
    const variant = build({equipment: 20, affects: 5});
    variant.items[34].mitigationCap = -30;
    assert.equal(gameStats.calculateBuilderStatTotal(variant, "mitigationCap").value, 0);
    assert.equal(gameStats.calculateBuilderStatTotal(variant, "mitigation").value, 5);
});
