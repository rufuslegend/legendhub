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
        hit: ["strength", "dexterity", "constitution"],
        dam: ["strength", "dexterity", "constitution"],
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
            case "ma":
                return 446 + ((stats.mind - 30) * 5);
            case "mv":
                return 496 + ((Math.max(stats.constitution, stats.dexterity) - 30) * 5);
            case "spelldam":
                return parseInt((stats.mind - 52) / 2);
            case "spellcrit":
                return parseInt((stats.mind - 60) / 4) +
                    parseInt(Math.max(stats.perception - 60, 0) / 8) +
                    parseInt(Math.max(stats.spirit - 60, 0) / 8) + 5;
            case "hit": {
                const dexHitroll = Math.floor(Math.max(stats.dexterity - 4, 0) / 3) + 1;
                const strHitroll = Math.floor(Math.min(Math.max(stats.strength / 4, 0), 25));
                const conHitroll = Math.floor(Math.min(Math.max(stats.constitution / 4, 0), 25));
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
                const dexDamroll = Math.floor(Math.min(Math.max(stats.dexterity / 4, 0), 25));
                const strDamroll = Math.floor(Math.max(stats.strength - 4, 0) / 3) + 1;
                const conDamroll = Math.floor(Math.min(Math.max(stats.constitution / 4, 0), 25));
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
        calculateNaturalStatBonus,
        getNaturalStatDependencies
    };
});
