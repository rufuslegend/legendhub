(function(factory) {
    const gameStats = factory();

    if (typeof module === "object" && module.exports) {
        module.exports = gameStats;
    }

})(function() {
    "use strict";

    const MAX_QUEST_RESOURCE_BONUS = 238327;

    const eraAbilities = [
        {
            key: "mentalEnhancement",
            name: "Mental Enhancement",
            era: "Ancient",
            maxRank: 3,
            effects: {ma: 10}
        },
        {
            key: "arcaneFocus",
            name: "Arcane Focus",
            era: "Ancient",
            maxRank: 5,
            effects: {spelldam: 1, spellcrit: 1}
        },
        {
            key: "hardenedSkin",
            name: "Hardened Skin",
            era: "Medieval",
            maxRank: 5,
            effects: {ac: -3}
        },
        {
            key: "increasedPotential",
            name: "Increased Potential",
            era: "Medieval",
            maxRank: 5,
            effects: {
                strengthCap: 1,
                mindCap: 1,
                dexterityCap: 1,
                constitutionCap: 1,
                perceptionCap: 1,
                spiritCap: 1
            }
        },
        {
            key: "physicalEnhancement",
            name: "Physical Enhancement",
            era: "Medieval",
            maxRank: 3,
            effects: {mv: 20}
        },
        {
            key: "weaponFocus",
            name: "Weapon Focus",
            era: "Medieval",
            maxRank: 1,
            effects: {hit: 5, dam: 5}
        },
        {
            key: "innateRegeneration",
            name: "Innate Regeneration",
            era: "Medieval",
            maxRank: 3,
            effects: {hpr: 1, mar: 1, mvr: 1}
        },
        {
            key: "physicalEndurance",
            name: "Physical Endurance",
            era: "Industrial",
            maxRank: 3,
            effects: {hp: 10}
        }
    ];

    function getEraAbilities() {
        return eraAbilities.map(function(ability) {
            return {
                key: ability.key,
                name: ability.name,
                era: ability.era,
                maxRank: ability.maxRank,
                ranks: Array.from(
                    {length: ability.maxRank},
                    function(unused, index) {
                        return index + 1;
                    }
                )
            };
        });
    }

    function getDefaultEraAbilityRanks() {
        const ranks = {};
        for (const ability of eraAbilities) {
            ranks[ability.key] = 0;
        }
        return ranks;
    }

    function normalizeEraAbilityRanks(ranks) {
        const normalized = getDefaultEraAbilityRanks();
        ranks = ranks || {};

        for (const ability of eraAbilities) {
            const rank = Number(ranks[ability.key]);
            if (Number.isFinite(rank)) {
                normalized[ability.key] = Math.min(
                    Math.max(Math.trunc(rank), 0),
                    ability.maxRank
                );
            }
        }

        return normalized;
    }

    function calculateEraAbilityBonus(statName, ranks) {
        const normalized = normalizeEraAbilityRanks(ranks);
        let bonus = 0;

        for (const ability of eraAbilities) {
            bonus += normalized[ability.key] * (ability.effects[statName] || 0);
        }

        return bonus;
    }

    function calculateEraAbilityStatCapBonus(ranks) {
        return normalizeEraAbilityRanks(ranks).increasedPotential;
    }

    const naturalStatDependencies = {
        hp: ["constitution"],
        ma: ["mind"],
        mv: ["dexterity"],
        spelldam: ["mind"],
        spellcrit: ["mind", "perception", "spirit"],
        hit: ["dexterity"],
        dam: ["strength"],
        meleedamcap: ["strength"],
        mitigation: ["constitution"],
        ac: ["dexterity"],
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

    function hasEquippedTwoHandedWeapon(items) {
        for (let i = 0; i < items.length; ++i) {
            const item = items[i];
            if (item && item.slot == 14 && item.twoHanded) {
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
                 * boosts. The controller adds Physical Endurance separately.
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
                 * exactly once. The controller adds Mental Enhancement separately.
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
                 * is explicit, while the controller adds Physical Enhancement separately.
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
            case "meleedamcap": {
                /*
                 * Legend initializes ch->damcap from DAMCAP (102). APPLY_DAMCAP is not
                 * accumulated in mod_damcap; get_damcap_mod() sums objects and affects
                 * on demand, so the builder's generic item path adds those separately.
                 */
                const parsedStrength = Number(stats.strength);
                const strength = Number.isFinite(parsedStrength) ?
                    Math.trunc(parsedStrength) : 0;
                let damageCap = 102;

                if (strength > 50) {
                    damageCap += Math.trunc((strength - 50) / 2);
                    if (strength > 100) {
                        damageCap += Math.trunc((strength - 99) / 2);
                    }
                }

                if (hasEquippedTwoHandedWeapon(items)) {
                    damageCap += 64;
                }

                return damageCap;
            }
            case "mitigation":
                return hasBattleTraining(items) ?
                    parseInt(Math.max(stats.constitution - 75, 0) / 5) : 0;
            case "ac":
                /*
                 * The Builder models a standing, neutral-wary, non-vehicle character.
                 * Mirror get_naked_ac() and get_stat_ac(); the controller adds Hardened
                 * Skin, while skills, spells, buffs, and other conditional modifiers
                 * remain faux objects.
                 */
                return 100 - Math.trunc((stats.dexterity - 30) / 2);
            /*
             * These natural terms mirror get_hp_regen_con_bonus_internal(),
             * get_mana_regen_mind_bonus(), and get_move_regen_wsp(). The controller
             * adds Innate Regeneration; spell and buff bonuses remain available through
             * the builder's uncapped Familiar and Other slots.
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

    function calculateBuilderAlignment(items) {
        let canUseGood = true;
        let canUseNeutral = true;
        let canUseEvil = true;

        for (const item of items || []) {
            switch (item.alignRestriction) {
                case 1:
                    canUseNeutral = false;
                    canUseEvil = false;
                    break;
                case 2:
                    canUseGood = false;
                    canUseEvil = false;
                    break;
                case 3:
                    canUseGood = false;
                    canUseNeutral = false;
                    break;
                case 4:
                    canUseGood = false;
                    break;
                case 5:
                    canUseNeutral = false;
                    break;
                case 6:
                    canUseEvil = false;
                    break;
            }
        }

        if (!canUseGood && !canUseNeutral && !canUseEvil)
            return "ERROR";
        return (canUseGood ? "G " : "  ") +
            (canUseNeutral ? "N " : "  ") +
            (canUseEvil ? "E" : " ");
    }

    function calculateStatQuestBonus(statName, baseStats) {
        const totalBaseStats = [
            "strength", "mind", "dexterity",
            "constitution", "perception", "spirit"
        ].reduce(function(total, stat) {
            return total + baseStats[stat];
        }, 0);
        let bonus = totalBaseStats < 244 ? 3 : 0;

        switch (statName) {
            case "strength":
                if (baseStats.amulet == 0)
                    bonus += 10;
                if (baseStats.hazelnut == 0)
                    bonus += 10;
                if (baseStats.longhouse == 3)
                    bonus += 5;
                if (baseStats.longhouse == 2)
                    bonus += 3;
                break;
            case "mind":
                if (baseStats.amulet == 1)
                    bonus += 10;
                if (baseStats.hazelnut == 1)
                    bonus += 10;
                if (baseStats.longhouse == 1 || baseStats.longhouse == 8)
                    bonus += 5;
                if (baseStats.longhouse == 0)
                    bonus += 3;
                if (baseStats.longhouse == 12)
                    bonus += 10;
                break;
            case "dexterity":
                if (baseStats.amulet == 2)
                    bonus += 10;
                if (baseStats.hazelnut == 2)
                    bonus += 10;
                if (baseStats.longhouse == 10)
                    bonus += 8;
                if (baseStats.longhouse == 4 || baseStats.longhouse == 6)
                    bonus += 5;
                if (baseStats.longhouse == 1 || baseStats.longhouse == 7)
                    bonus += 3;
                if (baseStats.longhouse == 12)
                    bonus -= 2;
                break;
            case "constitution":
                if (baseStats.amulet == 3)
                    bonus += 10;
                if (baseStats.hazelnut == 3)
                    bonus += 10;
                if (baseStats.longhouse == 5)
                    bonus += 5;
                if (baseStats.longhouse == 3 || baseStats.longhouse == 6)
                    bonus += 3;
                break;
            case "perception":
                if (baseStats.amulet == 4)
                    bonus += 10;
                if (baseStats.hazelnut == 4)
                    bonus += 10;
                if (baseStats.longhouse == 11)
                    bonus += 8;
                if (baseStats.longhouse == 2 || baseStats.longhouse == 7)
                    bonus += 5;
                if (baseStats.longhouse == 4)
                    bonus += 3;
                break;
            case "spirit":
                if (baseStats.amulet == 5)
                    bonus += 10;
                if (baseStats.hazelnut == 5)
                    bonus += 10;
                if (baseStats.longhouse == 0)
                    bonus += 5;
                if (baseStats.longhouse == 5 || baseStats.longhouse == 8)
                    bonus += 3;
                if (baseStats.longhouse == 9)
                    bonus += 8;
                break;
            default:
                return 0;
        }
        return bonus;
    }

    function calculateBuilderStatTotal(list, statName) {
        if (!list)
            return {value: "", restrictions: []};
        if (statName === "alignRestriction")
            return {value: calculateBuilderAlignment(list.items), restrictions: []};

        const baseStats = list.baseStats || {};
        const ksmStats = list.ksmStats || {};
        const items = list.items || [];
        const totals = new Map();

        function calculate(name) {
            if (totals.has(name))
                return totals.get(name);

            const restrictions = [];
            let equipment = 0;
            for (let index = 0; index < Math.min(24, items.length); ++index)
                equipment += items[index] && items[index][name] || 0;

            let equipmentMax = null;
            switch (name) {
                case "hit":
                    equipmentMax = calculateHitrollEquipmentCap(calculate("dexterity").numericValue);
                    break;
                case "dam":
                    equipmentMax = calculateDamrollEquipmentCap(calculate("strength").numericValue);
                    break;
                case "spelldam":
                case "spellcrit":
                    equipmentMax = 40;
                    break;
                case "hpr":
                    equipmentMax = calculateRegenEquipmentCap(calculate("constitution").numericValue);
                    break;
                case "mar":
                    equipmentMax = calculateRegenEquipmentCap(calculate("mind").numericValue);
                    break;
                case "mvr":
                    equipmentMax = calculateRegenEquipmentCap(calculate("dexterity").numericValue);
                    break;
            }
            if (equipmentMax != null && equipment > equipmentMax) {
                restrictions.push({restriction: "fromItems", amount: equipment, limit: equipmentMax});
                equipment = equipmentMax;
            }

            let spells = 0;
            for (let index = 24; index < items.length; ++index)
                spells += items[index] && items[index][name] || 0;

            const dependencyStats = {};
            for (const dependency of getNaturalStatDependencies(name))
                dependencyStats[dependency] = calculate(dependency).numericValue;
            dependencyStats.quest_hp = baseStats.quest_hp;
            dependencyStats.quest_mana = baseStats.quest_mana;
            dependencyStats.quest_move = baseStats.quest_move;

            let total = (baseStats[name] || 0) +
                (ksmStats[name] || 0) +
                calculateStatQuestBonus(name, baseStats) +
                equipment +
                spells +
                calculateNaturalStatBonus(name, dependencyStats, items) +
                calculateEraAbilityBonus(name, list.eraAbilities);

            let totalMax = null;
            switch (name) {
                case "strength":
                case "mind":
                case "dexterity":
                case "constitution":
                case "perception":
                case "spirit":
                    totalMax = 100 + calculateEraAbilityStatCapBonus(list.eraAbilities);
                    for (const item of items)
                        totalMax += item && item[`${name}Cap`] || 0;
                    break;
                case "manaReduction":
                    totalMax = 50;
                    break;
                case "mitigation":
                    totalMax = parseInt(
                        Math.max(Math.min(calculate("constitution").numericValue, 70) - 30, 0) / 2
                    );
                    if (hasBattleTraining(items))
                        totalMax += 10;
                    break;
            }
            if (totalMax != null && total > totalMax) {
                restrictions.push({restriction: "fromTotalMax", amount: total, limit: totalMax});
                total = totalMax;
            }
            if (name === "ac" && total < -250)
                restrictions.push({restriction: "fromTotalMin", amount: total, limit: -250});

            const formattedStats = ["dam", "hit", "hpr", "mar", "mvr", "spelldam", "spellcrit"];
            const result = {
                value: formattedStats.includes(name) ? `${total} (${equipment})` : total,
                numericValue: total,
                restrictions
            };
            totals.set(name, result);
            return result;
        }

        const result = calculate(statName);
        return {value: result.value, restrictions: result.restrictions};
    }

    function calculateBuilderTotals(list, statNames) {
        const totals = {};
        for (const statName of statNames) {
            const total = calculateBuilderStatTotal(list, statName);
            totals[statName] = total.value;
        }
        return totals;
    }

    return {
        calculateDamrollEquipmentCap,
        calculateBuilderAlignment,
        calculateBuilderStatTotal,
        calculateBuilderTotals,
        calculateEraAbilityBonus,
        calculateEraAbilityStatCapBonus,
        calculateHitrollEquipmentCap,
        calculateNaturalStatBonus,
        calculateRegenEquipmentCap,
        getDefaultEraAbilityRanks,
        getEraAbilities,
        getNaturalStatDependencies,
        normalizeEraAbilityRanks,
        normalizeQuestResourceBonus
    };
});
