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

    const MAX_QUEST_RESOURCE_BONUS = 238327;

    const naturalStatDependencies = {
        hp: ["constitution"],
        ma: ["mind"],
        mv: ["dexterity"],
        spelldam: ["mind"],
        spellcrit: ["mind", "perception", "spirit"],
        hit: ["dexterity"],
        dam: ["strength"],
        mitigation: ["constitution"],
        ac: ["strength", "dexterity", "constitution", "perception"],
        hpr: ["constitution"],
        mar: ["mind"],
        mvr: ["dexterity"]
    };

    function normalizeQuestResourceBonus(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) {
            return 0;
        }

        return Math.min(
            Math.max(Math.trunc(number), 0),
            MAX_QUEST_RESOURCE_BONUS
        );
    }

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

    /*
     * Legend's get_*_regen_evt() functions add the high-stat contribution to
     * object regeneration before get_max_regen() applies the level-50 cap of 20.
     * Reducing the builder's equipment allowance by the same contribution keeps
     * MIN(equipment + stat contribution, 20) equivalent to the C calculation.
     */
    const LEVEL_50_REGEN_EQUIPMENT_CAP = Math.trunc(50 / 3) + 4;

    function normalizeRegenStat(value) {
        const stat = Number(value);
        return Number.isFinite(stat) ? stat : 0;
    }

    function calculateRegenInsideCapContribution(value) {
        const stat = normalizeRegenStat(value);
        return stat > 79 ? Math.trunc((stat - 75) / 5) : 0;
    }

    function calculateRegenEquipmentCap(governingStat) {
        return LEVEL_50_REGEN_EQUIPMENT_CAP -
            calculateRegenInsideCapContribution(governingStat);
    }

    function calculateNaturalStatBonus(statName, stats, items) {
        stats = stats || {};
        items = items || [];

        switch (statName) {
            case "hp": {
                /*
                 * The builder models level-50 characters. Mirror reroll_hps_internal()
                 * and hp_for_con_internal() using the current Legend configuration.
                 * Quest HP supplies all permanent quest boosts, including the five India
                 * boosts. Physical Endurance is represented by a compensating object.
                 */
                const level = 50;
                const baseHp = 20;
                const hpPerLevel = 4;
                const conCutoff = 89;
                const hpForConDiv = Math.max(10, 1);
                const rerolledHp = baseHp + (hpPerLevel * (level - 1));
                let effectiveConstitution = stats.constitution;

                if (effectiveConstitution > conCutoff) {
                    effectiveConstitution += effectiveConstitution - conCutoff - 1;
                }

                const hpForConstitution = Math.trunc(
                    (level * effectiveConstitution) / hpForConDiv
                );

                return rerolledHp + hpForConstitution +
                    normalizeQuestResourceBonus(stats.quest_hp);
            }
            case "ma": {
                /*
                 * The builder models level-50 characters. reroll_mana_internal() starts
                 * with BASE_MANA (100) and adds MANA_PER_LEVEL (4) for levels 2 through
                 * 50, producing a quest-less rerolled base of 296.
                 *
                 * ma_for_mind() is (level * current mind) / MANA_FOR_MIND_DIV. At
                 * level 50 with MANA_FOR_MIND_DIV set to 10, that is 5 mana per mind.
                 * Quest Mana contains all completed resource-quest bonuses and is added
                 * exactly once. Mental Enhancement remains represented by compensating
                 * Other-slot objects and must not also be included here.
                 */
                const level = 50;
                const baseMana = 100;
                const manaPerLevel = 4;
                const manaForMindDiv = Math.max(10, 1);
                const rerolledMana = baseMana + (manaPerLevel * (level - 1));
                const manaForMind = Math.trunc((level * stats.mind) / manaForMindDiv);

                return rerolledMana + manaForMind +
                    normalizeQuestResourceBonus(stats.quest_mana);
            }
            case "mv": {
                /*
                 * The builder models level-50 characters. reroll_move_internal() starts
                 * with BASE_MOVE (150) and adds MOVE_PER_LEVEL (4) for levels 2 through
                 * 50, producing a stat-independent rerolled base of 346.
                 *
                 * MV_STATIC_SUBTITUTE_FOR_DEX is configured to zero, so mv_for_stat()
                 * uses capped current dexterity: (level * dexterity) / MV_DIV. Quest Mv
                 * is explicit, while Physical Enhancement remains represented by its
                 * faux builder item and must not also be included here.
                 */
                const level = 50;
                const baseMove = 150;
                const movePerLevel = 4;
                const moveForStatDiv = Math.max(10, 1);
                const rerolledMove = baseMove + (movePerLevel * (level - 1));
                const moveForDexterity = Math.trunc(
                    (level * stats.dexterity) / moveForStatDiv
                );

                return rerolledMove + moveForDexterity +
                    normalizeQuestResourceBonus(stats.quest_move);
            }
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
            /*
             * These natural terms mirror get_hp_regen_con_bonus_internal(),
             * get_mana_regen_mind_bonus(), and get_move_regen_wsp(). Innate
             * Regeneration and spell/ability bonuses are supplied separately by the
             * builder's uncapped Familiar and Other slots.
             */
            case "hpr": {
                const con = normalizeRegenStat(stats.constitution);
                let naturalBonus = Math.trunc(con / 10);
                if (con > 100) {
                    naturalBonus += Math.trunc((con - 100) / 10);
                }

                return calculateRegenInsideCapContribution(con) + naturalBonus;
            }
            case "mar": {
                const mind = normalizeRegenStat(stats.mind);
                let naturalBonus = Math.trunc(mind / 10);
                if (mind > 100) {
                    naturalBonus += Math.trunc((mind - 100) / 2);
                }

                return calculateRegenInsideCapContribution(mind) + naturalBonus;
            }
            case "mvr": {
                const dex = normalizeRegenStat(stats.dexterity);
                const naturalBonus = dex > 53 ? Math.trunc((dex - 49) / 5) : 0;

                return calculateRegenInsideCapContribution(dex) + naturalBonus;
            }
            default:
                return 0;
        }
    }

    return {
        calculateDamrollEquipmentCap,
        calculateHitrollEquipmentCap,
        calculateNaturalStatBonus,
        calculateRegenEquipmentCap,
        getNaturalStatDependencies,
        normalizeQuestResourceBonus
    };
});
