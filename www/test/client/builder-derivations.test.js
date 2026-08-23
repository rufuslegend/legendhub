"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

async function loadDerivations() {
    return import("../../client/features/builder/builder-derivations.js");
}

// Catches the faux runecharm path losing its legacy base AC/rent values when no charms are selected.
test("builder derives the literal empty runecharm item", async function() {
    const {deriveRuneCharmStats} = await loadDerivations();

    assert.deepEqual(deriveRuneCharmStats("AAAAA"), {
        strength: 0, mind: 0, dexterity: 0, constitution: 0, perception: 0, spirit: 0,
        hit: 0, dam: 0, hp: 0, ma: 0, mv: 0, hpr: 0, mar: 0, mvr: 0,
        spellcrit: 0, spelldam: 0, ac: -5, rangedAccuracy: 0,
        manaReduction: 0, concentration: 0, rent: 225, charmName: ""
    });
});

// Catches rune selection applying charm bonuses without the corresponding name and rent contributions.
test("builder combines literal runecharm selections", async function() {
    const {deriveRuneCharmStats} = await loadDerivations();

    assert.deepEqual(deriveRuneCharmStats("ABHKA"), {
        strength: 1, mind: 0, dexterity: 0, constitution: 0, perception: 0, spirit: 0,
        hit: 2, dam: 0, hp: 10, ma: 0, mv: 0, hpr: 0, mar: 0, mvr: 0,
        spellcrit: 0, spelldam: 0, ac: -5, rangedAccuracy: 0,
        manaReduction: 0, concentration: 0, rent: 1553,
        charmName: "Uruz/Eihwaz/Gebo/"
    });
});

function blank(slot) {
    return {id: 0, slot};
}

// Catches item warnings drifting from the deployed unique, strength/weight, limited-item, and hand-limit rules.
test("builder derives literal equipment restrictions and warning text", async function() {
    const {deriveItemRestrictions, getItemRestrictionText} = await loadDerivations();
    const items = [
        {id: 101, slot: 1, uniqueWear: true},
        {id: 101, slot: 1, uniqueWear: true},
        {id: 201, slot: 14, weight: 30, twoHanded: true},
        {id: 202, slot: 15, twoHanded: true},
        {id: 301, slot: 3, isLimited: true},
        {id: 302, slot: 4, isLimited: true},
        {id: 303, slot: 5, isLimited: true},
        {id: 304, slot: 6, isLimited: true},
        blank(7)
    ];

    const restrictions = deriveItemRestrictions({items, strength: 100});

    assert.deepEqual(restrictions, [
        ["unique"], ["unique"], ["weight", "twohanded"], ["twohanded"],
        [], [], [], ["limited"], []
    ]);
    assert.equal(
        getItemRestrictionText(restrictions[2], items[2]),
        "You need 120 strength to wield this.<br /><br />You do not have enough hands to hold this item."
    );
    assert.equal(
        getItemRestrictionText(restrictions[7], items[7]),
        "You can only have three limited items equipped."
    );
});
