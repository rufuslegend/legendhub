import {CHARM_OPTIONS} from "./item-constants.js";

const EMPTY_RUNE_CHARM_STATS = {
    strength: 0, mind: 0, dexterity: 0, constitution: 0, perception: 0, spirit: 0,
    hit: 0, dam: 0, hp: 0, ma: 0, mv: 0, hpr: 0, mar: 0, mvr: 0,
    spellcrit: 0, spelldam: 0, ac: -5, rangedAccuracy: 0,
    manaReduction: 0, concentration: 0, rent: 225, charmName: ""
};

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
    let handCount = 0;
    let handApplied = false;

    for (let index = 0; index < items.length; ++index) {
        const item = items[index];
        if (!item)
            continue;

        if (item.slot == 1 || item.slot == 2 || item.slot == 13 || item.slot == 14 || item.slot == 15 || item.slot == 16) {
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
        }

        if (item.slot == 14 && item.weight * 4 > strength)
            restrictions[index].push("weight");

        if (item.isLimited) {
            limitedCount += 1;
            if (limitedCount > 3)
                restrictions[index].push("limited");
        }

        // Preserve the live builder's original operator precedence for slot 15.
        if ((!handApplied && item.slot == 14) || item.slot == 15) {
            if (item.twoHanded !== undefined)
                handCount += item.twoHanded ? 2 : 1;
            if (handCount > 3) {
                for (let otherIndex = 0; otherIndex < items.length; ++otherIndex) {
                    if (items[otherIndex]?.slot == 14 || items[otherIndex]?.slot == 15)
                        restrictions[otherIndex].push("twohanded");
                }
                handApplied = true;
            }
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
