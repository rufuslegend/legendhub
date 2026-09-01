"use strict";

const {slotsToMask} = require("../routes/api/item-slots");

const SLOT_IDS = new Map([
    ["light", 0], ["finger", 1], ["neck", 2], ["body", 3],
    ["head", 4], ["face", 5], ["legs", 6], ["feet", 7],
    ["hands", 8], ["arms", 9], ["shield", 10], ["about", 11],
    ["waist", 12], ["wrist", 13], ["wield", 14], ["hold", 15],
    ["ear", 16], ["arm", 17], ["amulet", 18], ["aux", 19],
    ["familiar", 20], ["other", 21]
]);
const ALIGNMENT_IDS = new Map([
    ["none", 0], ["good-only", 1], ["neutral-only", 2], ["evil-only", 3],
    ["non-good", 4], ["non-neutral", 5], ["non-evil", 6]
]);
const WEAPON_TYPE_IDS = new Map([
    [null, 0], ["bladed", 1], ["piercing", 2], ["blunt", 3]
]);
const WEAPON_ATTRIBUTE_IDS = new Map([
    [null, 0], ["strength", 1], ["dexterity", 2], ["constitution", 3]
]);

function flag(value) {
    return value ? 1 : 0;
}

function lowerCamel(column) {
    return column[0].toLowerCase() + column.slice(1);
}

function mapOfficialItem(item, server) {
    const slotIds = item.slots.map(slot => SLOT_IDS.get(slot)).sort((left, right) => left - right);
    const valuesByColumn = {
        Name: item.name,
        Slot: slotIds[0],
        Strength: item.attributes.strength,
        Mind: item.attributes.mind,
        Dexterity: item.attributes.dexterity,
        Constitution: item.attributes.constitution,
        Perception: item.attributes.perception,
        Spirit: item.attributes.spirit,
        Ac: item.combat.armor_class,
        Hit: item.combat.hitroll,
        Dam: item.combat.damroll,
        Hp: item.resources.hp,
        Hpr: item.resources.hp_regen,
        Ma: item.resources.mana,
        Mar: item.resources.mana_regen,
        Mv: item.resources.movement,
        Mvr: item.resources.movement_regen,
        Spelldam: item.combat.spell_damage,
        Spellcrit: item.combat.spell_critical,
        ManaReduction: item.combat.mana_reduction,
        Mitigation: item.combat.mitigation,
        Accuracy: item.weapon.accuracy,
        Ammo: item.weapon.ammo_limit,
        TwoHanded: flag(item.flags.two_handed),
        Quality: item.weapon.quality,
        MaxDam: item.weapon.maximum_damage,
        AvgDam: item.weapon.average_damage,
        MinDam: item.weapon.minimum_damage,
        Parry: item.combat.parry,
        Holdable: flag(item.flags.holdable),
        Rent: item.economy.rent,
        Value: item.economy.value,
        Weight: item.economy.weight,
        SpeedFactor: item.weapon.speed_factor,
        Notes: null,
        ModifiedBy: `Legend:${server}`,
        UniqueWear: flag(item.flags.unique_wear),
        ModifiedByIP: null,
        ModifiedByIPForward: null,
        AlignRestriction: ALIGNMENT_IDS.get(item.alignment),
        Bonded: flag(item.flags.bonded),
        Casts: item.casts.join(", "),
        Level: item.requirements.level,
        Concentration: item.combat.concentration,
        RangedAccuracy: item.weapon.ranged_accuracy,
        MobId: 0,
        QuestId: 0,
        WeaponType: WEAPON_TYPE_IDS.get(item.weapon.type),
        WeaponStat: WEAPON_ATTRIBUTE_IDS.get(item.weapon.governing_attribute),
        IsLight: flag(item.flags.light),
        IsHeroic: flag(item.flags.heroic),
        Deleted: 0,
        Soulbound: flag(item.flags.soulbound),
        StrengthCap: item.attribute_caps.strength,
        MindCap: item.attribute_caps.mind,
        DexterityCap: item.attribute_caps.dexterity,
        ConstitutionCap: item.attribute_caps.constitution,
        PerceptionCap: item.attribute_caps.perception,
        SpiritCap: item.attribute_caps.spirit,
        IsLimited: flag(item.flags.limited),
        Meleecritperc: item.combat.melee_critical_percent,
        Meleecrit: item.combat.melee_critical,
        Meleedamcap: item.combat.melee_damage_cap,
        Damageshield: item.combat.damage_shield,
        SlotMask: slotsToMask(slotIds),
        Official: 1
    };
    const columns = Object.keys(valuesByColumn);
    return {
        columns,
        values: columns.map(column => valuesByColumn[column]),
        valueByVar: Object.fromEntries(columns.map(column =>
            [lowerCamel(column), valuesByColumn[column]]))
    };
}

module.exports = {
    ALIGNMENT_IDS,
    SLOT_IDS,
    WEAPON_ATTRIBUTE_IDS,
    WEAPON_TYPE_IDS,
    mapOfficialItem
};
