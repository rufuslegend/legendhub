(function(root, factory) {
    const gameStats = factory();

    if (typeof module === "object" && module.exports) {
        module.exports = gameStats;
    }

    if (root && root.angular) {
        root.angular
            .module("legendwiki-app")
            .factory("gameStats", function() {
                return gameStats;
            });
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
    "use strict";

    const naturalStatDependencies = {
        hp: ["constitution"],
        ma: ["mind"],
        mv: ["constitution", "dexterity"],
        spelldam: ["mind"],
        spellcrit: ["mind", "perception", "spirit"],
        hit: ["dexterity"],
        dam: ["strength"],
        mitigation: ["constitution"],
        ac: ["strength", "dexterity", "constitution", "perception"],
        hpr: ["constitution"]
    };

    function getNaturalStatDependencies(statName) {
        const dependencies = naturalStatDependencies[statName];
        return dependencies ? dependencies.slice() : [];
    }

    function hasEquippedWeaponUsing(items, weaponStat) {
        for (let i = 0; i < items.length; ++i) {
            const item = items[i];
            if (item && (item.slot == 14 || item.slot == 15) && item.weaponStat == weaponStat) {
                return true;
            }
        }

        return false;
    }

    function hasBattleTraining(items) {
        for (let i = 25; i < items.length; ++i) {
            const item = items[i];
            if (item && (item.id == 1144 || item.id == 1137)) {
                return true;
            }
        }

        return false;
    }

    function calculateHitrollEquipmentCap(dexterity) {
        return 30 + Math.max(dexterity - 90, 0);
    }

    function calculateDamrollEquipmentCap(strength) {
        return 30 + Math.max(strength - 90, 0);
    }

    function calculateNaturalStatBonus(statName, stats, items) {
        items = items || [];

        switch (statName) {
            case "hp": {
                const con = stats.constitution;
                let bonus = 381 + ((con - 30) * 5);
                if (con > 89) {
                    bonus += Math.max(con - 88, 0) * 5;
                }
                return bonus;
            }
            case "ma": {
                /*
                 * The builder models level-50 characters. The fixed 296 base already
                 * includes the five SAV_*_MANA_BOOST flags (1 + 2 + 3 + 4 + 5 = 15).
                 * Assume VALLEY_COMPLETE for another 25 mana.
                 *
                 * ma_for_mind() is (level * current mind) / MANA_FOR_MIND_DIV. At
                 * level 50 with MANA_FOR_MIND_DIV set to 10, that is 5 mana per mind.
                 * Mental Enhancement remains represented by compensating Other-slot
                 * objects and must not also be included in this natural calculation.
                 */
                const level = 50;
                const manaForMindDiv = Math.max(10, 1);
                const manaForMind = Math.trunc((level * stats.mind) / manaForMindDiv);

                return 296 + 25 + manaForMind;
            }
            case "mv":
                return 496 + ((Math.max(stats.constitution, stats.dexterity) - 30) * 5);
            case "spelldam":
                return parseInt((stats.mind - 52) / 2);
            case "spellcrit":
                return parseInt((stats.mind - 60) / 4) +
                    parseInt(Math.max(stats.perception - 60, 0) / 8) +
                    parseInt(Math.max(stats.spirit - 60, 0) / 8) + 5;
            case "hit": {
                const dexHitroll = Math.trunc((stats.dexterity - 1) / 3);

                /*
                 * The live game retains strength and constitution hitroll alternatives
                 * behind a C-side feature flag, but that flag is disabled. Keep the prior
                 * formulas documented here so these zero values and the weapon-selection
                 * branches below remain intentional and traceable:
                 *
                 * strength: Math.floor(Math.min(Math.max(stats.strength / 4, 0), 25))
                 * constitution: Math.floor(Math.min(Math.max(stats.constitution / 4, 0), 25))
                 */
                const strHitroll = 0;
                const conHitroll = 0;
                let bestStat = dexHitroll;

                if (hasEquippedWeaponUsing(items, 1) && strHitroll > dexHitroll) {
                    bestStat = strHitroll;
                }
                if (hasEquippedWeaponUsing(items, 3) && conHitroll > dexHitroll) {
                    bestStat = conHitroll;
                }

                return bestStat;
            }
            case "dam": {
                const strDamroll = Math.trunc((stats.strength - 1) / 3);

                /*
                 * The live game can select constitution- or dexterity-derived
                 * damroll from the wielded weapon's base damage type, but
                 * STR_ONLY_DAMROLL is enabled. Keep the inactive C-side formulas
                 * documented here so these zero values and the weapon-selection
                 * branches below remain intentional:
                 *
                 * constitution: Math.trunc(Math.min(stats.constitution, 100) / 4)
                 * dexterity: Math.trunc(Math.min(stats.dexterity, 100) / 5)
                 */
                const conDamroll = 0;
                const dexDamroll = 0;
                let bestStat = strDamroll;

                if (hasEquippedWeaponUsing(items, 2) && dexDamroll > strDamroll) {
                    bestStat = dexDamroll;
                }
                if (hasEquippedWeaponUsing(items, 3) && conDamroll > strDamroll) {
                    bestStat = conDamroll;
                }

                return bestStat;
            }
            case "mitigation":
                return hasBattleTraining(items) ?
                    parseInt(Math.max(stats.constitution - 75, 0) / 5) : 0;
            case "ac": {
                let total = 83;
                total += parseInt(Math.max(stats.dexterity - 40, 0) * -0.5);
                total += parseInt(Math.max(stats.perception - 30, 0) / -6);
                if (stats.strength >= 20 && stats.dexterity >= 20 && stats.constitution >= 20) {
                    total -= 5;
                    if (stats.dexterity >= 40 && stats.constitution >= 40) {
                        total -= 5;
                    }
                }
                return total;
            }
            case "hpr": {
                const con = stats.constitution;
                let bonus = parseInt(Math.max(con - 75, 0) * 0.2);
                if (con > 79) {
                    bonus += parseInt(Math.max(con - 70, 0) * 0.2);
                }
                bonus += Math.max(con - 100, 0);
                return bonus;
            }
            default:
                return 0;
        }
    }

    return {
        calculateDamrollEquipmentCap,
        calculateHitrollEquipmentCap,
        calculateNaturalStatBonus,
        getNaturalStatDependencies
    };
});
