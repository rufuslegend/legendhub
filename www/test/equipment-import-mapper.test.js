"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {parseObservation} = require("../src/equipment-importer/contract");
const {mapOfficialItem} = require("../src/equipment-importer/item-mapper");

function parsedFixture() {
    const fixture = fs.readFileSync(path.join(__dirname, "..", "test-fixtures",
        "equipment-spool", "valid.json"));
    return parseObservation(fixture);
}

function valueByColumn(mapping) {
    return Object.fromEntries(mapping.columns.map((column, index) =>
        [column, mapping.values[index]]));
}

test("maps every sample field to an explicit legacy item column", () => {
    const parsed = parsedFixture();
    const mapping = mapOfficialItem(parsed.normalizedItem, "testmud");
    const item = valueByColumn(mapping);

    assert.equal(item.Name, "Cuchullain's shield");
    assert.equal(item.Slot, 17);
    assert.equal(item.SlotMask, 2 ** 17);
    assert.equal(item.Strength, 5);
    assert.equal(item.Constitution, 5);
    assert.equal(item.Perception, -3);
    assert.equal(item.Spirit, -2);
    assert.equal(item.Ac, -17);
    assert.equal(item.AlignRestriction, 6);
    assert.equal(item.Rent, 2161);
    assert.equal(item.Value, 2161);
    assert.equal(item.Weight, "10.00");
    assert.equal(item.WeaponType, 0);
    assert.equal(item.WeaponStat, 0);
    assert.equal(item.Official, 1);
    assert.equal(item.Deleted, 0);
    assert.equal(item.MobId, 0);
    assert.equal(item.QuestId, 0);
    assert.equal(item.ModifiedBy, "Legend:testmud");
    assert.equal(item.ModifiedByIP, null);
    assert.equal(item.Notes, null);
    assert.equal(item.Casts, "");
    assert.equal(mapping.valueByVar.strength, 5);
    assert.equal(mapping.valueByVar.ac, -17);
    assert.equal(mapping.columns.length, new Set(mapping.columns).size);
});

test("maps mitigation cap modifiers and defaults older observations to zero", () => {
    const {normalizedItem} = parsedFixture();
    assert.equal(valueByColumn(mapOfficialItem(normalizedItem, "testmud")).MitigationCap, 0);
    normalizedItem.combat.mitigation_cap = -10;
    const mapped = mapOfficialItem(normalizedItem, "testmud");
    assert.equal(valueByColumn(mapped).MitigationCap, -10);
    assert.equal(mapped.valueByVar.mitigationCap, -10);
});

test("maps all flags, stats, weapon values, and casts without implicit defaults", () => {
    const parsed = parsedFixture();
    const item = parsed.normalizedItem;
    for (const key of Object.keys(item.flags))
        item.flags[key] = true;
    Object.assign(item.resources, {
        hp: 11, mana: 12, movement: 13,
        hp_regen: 14, mana_regen: 15, movement_regen: 16
    });
    Object.assign(item.combat, {
        hitroll: 17, damroll: 18, spell_damage: 19, spell_critical: 20,
        mana_reduction: 21, concentration: 22, mitigation: 23, parry: 24,
        damage_shield: 25, melee_critical_percent: 26, melee_critical: 27,
        melee_damage_cap: 28
    });
    Object.assign(item.weapon, {
        type: "piercing", governing_attribute: "dexterity", accuracy: 29,
        ranged_accuracy: 30, ammo_limit: 31, quality: 32, speed_factor: 33,
        minimum_damage: 34, maximum_damage: 35, average_damage: 36
    });
    item.casts = ["aura", "bless"];

    const mapped = valueByColumn(mapOfficialItem(item, "legend"));
    assert.deepEqual({
        UniqueWear: mapped.UniqueWear, IsLimited: mapped.IsLimited,
        IsHeroic: mapped.IsHeroic, Soulbound: mapped.Soulbound,
        Bonded: mapped.Bonded, IsLight: mapped.IsLight,
        Holdable: mapped.Holdable, TwoHanded: mapped.TwoHanded
    }, {
        UniqueWear: 1, IsLimited: 1, IsHeroic: 1, Soulbound: 1,
        Bonded: 1, IsLight: 1, Holdable: 1, TwoHanded: 1
    });
    assert.deepEqual({Hp: mapped.Hp, Ma: mapped.Ma, Mv: mapped.Mv,
        Hpr: mapped.Hpr, Mar: mapped.Mar, Mvr: mapped.Mvr},
    {Hp: 11, Ma: 12, Mv: 13, Hpr: 14, Mar: 15, Mvr: 16});
    assert.equal(mapped.Hit, 17);
    assert.equal(mapped.Dam, 18);
    assert.equal(mapped.Spelldam, 19);
    assert.equal(mapped.Spellcrit, 20);
    assert.equal(mapped.ManaReduction, 21);
    assert.equal(mapped.Damageshield, 25);
    assert.equal(mapped.Meleecritperc, 26);
    assert.equal(mapped.Meleecrit, 27);
    assert.equal(mapped.Meleedamcap, 28);
    assert.equal(mapped.WeaponType, 2);
    assert.equal(mapped.WeaponStat, 2);
    assert.equal(mapped.Accuracy, 29);
    assert.equal(mapped.RangedAccuracy, 30);
    assert.equal(mapped.Ammo, 31);
    assert.equal(mapped.MinDam, 34);
    assert.equal(mapped.MaxDam, 35);
    assert.equal(mapped.AvgDam, 36);
    assert.equal(mapped.Casts, "aura, bless");
});

test("uses the lowest slot ID as legacy primary while preserving every capability", () => {
    const parsed = parsedFixture();
    parsed.normalizedItem.slots = ["wield", "hold", "arm"];
    const mapped = valueByColumn(mapOfficialItem(parsed.normalizedItem, "testmud"));
    assert.equal(mapped.Slot, 14);
    assert.equal(mapped.SlotMask, (2 ** 14) + (2 ** 15) + (2 ** 17));
});
