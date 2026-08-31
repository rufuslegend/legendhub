import {CHARM_OPTIONS} from "./item-constants.js";

const EMPTY_RUNE_CHARM_STATS = {
    strength: 0, mind: 0, dexterity: 0, constitution: 0, perception: 0, spirit: 0,
    hit: 0, dam: 0, hp: 0, ma: 0, mv: 0, hpr: 0, mar: 0, mvr: 0,
    spellcrit: 0, spelldam: 0, ac: -5, rangedAccuracy: 0,
    manaReduction: 0, concentration: 0, rent: 225, charmName: ""
};

const HAND_SLOTS = new Set([10, 14, 15]);

export function handCost(item) {
    if (!item || item.id === 0 || !HAND_SLOTS.has(Number(item.slot)))
        return 0;
    return item.twoHanded ? 2 : 1;
}

export function handUnits(items) {
    return items.reduce((total, item) => total + handCost(item), 0);
}

export function handUnitsAfterReplacement(items, index, candidate) {
    return items.reduce((total, item, itemIndex) =>
        total + handCost(itemIndex === index ? candidate : item), 0);
}

export function canOpenEquipmentRow(items, index) {
    const current = items[index];
    return handCost(current) > 0 || !HAND_SLOTS.has(Number(current?.slot)) ||
        handUnits(items) < 3;
}

export function canEquipHandCandidate(items, index, candidate) {
    return handUnitsAfterReplacement(items, index, candidate) <= 3;
}

export function deriveRuneCharmStats(charmString) {
    const stats = {...EMPTY_RUNE_CHARM_STATS};
    for (const charmId of String(charmString || "")) {
        if (charmId === "A")
            continue;
        const charm = CHARM_OPTIONS[charmId];
        if (!charm)
            continue;
        stats.charmName += `${charm.name}/`;
        for (const effect of charm.stats)
            stats[effect.statVar] += effect.value;
    }
    return stats;
}

export function deriveItemRestrictions({items = [], strength = 0} = {}) {
    const restrictions = items.map(() => []);
    let limitedCount = 0;

    for (let index = 0; index < items.length; ++index) {
        const item = items[index];
        if (!item)
            continue;

        if (item.uniqueWear) {
            for (let otherIndex = 0; otherIndex < items.length; ++otherIndex) {
                if (index == otherIndex)
                    continue;
                if (item.id != 0 && item.id == items[otherIndex]?.id) {
                    restrictions[index].push("unique");
                    break;
                }
            }
        }

        if (item.slot == 14 && item.weight * 4 > strength)
            restrictions[index].push("weight");

        if (item.isLimited) {
            limitedCount += 1;
            if (limitedCount > 3)
                restrictions[index].push("limited");
        }
    }

    if (handUnits(items) > 3) {
        for (let index = 0; index < items.length; ++index) {
            if (handCost(items[index]) > 0)
                restrictions[index].push("twohanded");
        }
    }
    return restrictions;
}

export function getItemRestrictionText(restrictions = [], item = {}) {
    return restrictions.map(function(restriction) {
        switch (restriction) {
            case "unique":
                return "You cannot wear two of this item.";
            case "weight":
                return `You need ${item.weight * 4} strength to wield this.`;
            case "holdWeight":
                return `You need ${item.weight * 5} strength to hold this with one hand.`;
            case "twohanded":
                return "You do not have enough hands to hold this item.";
            case "limited":
                return "You can only have three limited items equipped.";
            default:
                return "";
        }
    }).join("<br /><br />");
}
