const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ejs = require("ejs");

const gameStats = require("../src/public/js/services/game-stats");

function renderBuilder() {
    return ejs.renderFile(path.join(
        __dirname,
        "../src/views/builder/index.ejs"
    ), {
        cookies: {},
        title: "Builder",
        url: {path: "/builder/"},
        user: null,
        version: "test",
        vm: {
            itemStatCategories: [],
            selectedColumns: []
        }
    });
}

function createEncoder() {
    const digits = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

    return {
        fromNumber: function(number, minLength) {
            let residual = Math.floor(Math.abs(Number(number) || 0));
            let result = "";
            do {
                result = digits[residual % digits.length] + result;
                residual = Math.floor(residual / digits.length);
            } while (residual > 0);
            return result.padStart(minLength || 0, "0");
        },
        toNumber: function(value) {
            return Array.from(value).reduce(function(total, digit) {
                return (total * digits.length) + digits.indexOf(digit);
            }, 0);
        }
    };
}

function createBuilderScope() {
    let builderController;
    const angular = {
        module: function(moduleName) {
            assert.equal(moduleName, "legendwiki-app");
            return {
                controller: function(controllerName, definition) {
                    assert.equal(controllerName, "builder");
                    builderController = definition[definition.length - 1];
                }
            };
        }
    };
    const $ = function() {
        return {
            on: function() {},
            modal: function() {}
        };
    };
    const browserContext = {
        angular,
        console,
        $,
        localStorage: {
            getItem: function() {
                return null;
            }
        }
    };
    browserContext.globalThis = browserContext;

    const source = fs.readFileSync(path.join(
        __dirname,
        "../src/public/js/controllers/builder/main.js"
    ), "utf8");
    vm.runInNewContext(source, browserContext);

    const scope = {};
    const http = function() {
        return {
            then: function() {}
        };
    };
    builderController(
        scope,
        {get: function() {}},
        http,
        {},
        function() {},
        {selectShortOptions: {slot: []}},
        createEncoder(),
        {addCallback: function() {}},
        gameStats
    );
    scope.statInfo = [
        "strength",
        "mind",
        "dexterity",
        "constitution",
        "perception",
        "spirit",
        "hp",
        "ma",
        "mv",
        "hit",
        "dam",
        "meleedamcap",
        "ac",
        "hpr",
        "mar",
        "mvr",
        "spelldam",
        "spellcrit"
    ].map(function(statName) {
        return {var: statName, type: "int"};
    });
    scope.allLists = [];

    return scope;
}

function getRestrictions(scope, statName) {
    return Array.from(scope.statRestrictions[statName], function(entry) {
        return {
            restriction: entry.restriction,
            amount: entry.amount,
            limit: entry.limit
        };
    });
}

function importBuilderList(scope, input) {
    scope.importModel = {
        input,
        lists: [],
        message: "",
        loading: true
    };
    scope.onImportInputChanged();
    return scope.importModel.lists[0].variants[0];
}

function createCompactImport(scope, version, sentinelIndex, sentinelId) {
    const encoder = createEncoder();
    const baseStats = Array(6).fill(encoder.fromNumber(30, 2)).join("");
    const ksmStats = "0".repeat(6);
    const questSelections = "_".repeat(version >= 3 ? 3 : 2);
    const itemCount = version === 2 ? 29 : scope.slotOrder.length;
    const items = Array(itemCount).fill("_");
    items[sentinelIndex] = encoder.fromNumber(sentinelId, 3);
    return `${version}*Version ${version}~Original~${baseStats}${ksmStats}` +
        `${questSelections}${items.join("")}`;
}

function createLegacyImport(scope, name, sentinelIndex, sentinelId) {
    const items = Array(scope.slotOrder.length).fill("0");
    items[sentinelIndex] = String(sentinelId);
    const fields = [
        "30", "30", "30", "30", "30", "30",
        "-1", "-1", "-1",
        ...items
    ];
    return `${name}!Original_${fields.join("_")}`;
}

function assertDefaultEraAbilities(list) {
    assert.deepEqual(list.eraAbilities, {
        mentalEnhancement: 0,
        arcaneFocus: 0,
        hardenedSkin: 0,
        increasedPotential: 0,
        physicalEnhancement: 0,
        weaponFocus: 0,
        innateRegeneration: 0,
        physicalEndurance: 0
    });
}

function createVersion6Import(scope, eraRanks) {
    const encoder = createEncoder();
    const baseStats = Array(6).fill(encoder.fromNumber(30, 2)).join("");
    const ksmStats = "0".repeat(6);
    const questSelections = "_".repeat(3);
    const questResources = "0".repeat(9);
    const items = "_".repeat(scope.slotOrder.length);

    return `6*Version Six~Original~${baseStats}${ksmStats}` +
        `${questSelections}${questResources}${eraRanks}${items}`;
}

function equipStats(scope, overrides) {
    const items = Array.from({length: 25}, function() {
        return {};
    });
    Object.assign(items[0], overrides.equipment);
    Object.assign(items[24], overrides.other);
    scope.selectedList = {
        baseStats: {
            strength: overrides.strength ?? 90,
            mind: overrides.mind ?? 90,
            dexterity: overrides.dexterity ?? 90,
            constitution: overrides.constitution ?? 90,
            perception: 90,
            spirit: 90,
            amulet: -1,
            hazelnut: -1,
            longhouse: -1,
            quest_hp: overrides.quest_hp || 0,
            quest_mana: overrides.quest_mana || 0,
            quest_move: overrides.quest_move || 0
        },
        ksmStats: {},
        eraAbilities: Object.assign(
            gameStats.getDefaultEraAbilityRanks(),
            overrides.eraAbilities
        ),
        items
    };
}

function numericTotal(scope, statName) {
    return Number.parseInt(scope.getStatTotal(statName), 10);
}

test("builder raises only the equipment hitroll cap with final dexterity", function() {
    const scope = createBuilderScope();
    equipStats(scope, {
        dexterity: 100,
        equipment: {dexterity: 10, dexterityCap: 10, hit: 55},
        other: {hit: 5}
    });

    assert.equal(scope.getStatTotal("hit"), "91 (50)");
    assert.equal(scope.statRestrictions.hit.length, 1);
    assert.equal(scope.statRestrictions.hit[0].restriction, "fromItems");
    assert.equal(scope.statRestrictions.hit[0].amount, 55);
    assert.equal(scope.statRestrictions.hit[0].limit, 50);
});

test("builder uses capped dexterity for all hitroll calculations", function() {
    const scope = createBuilderScope();
    equipStats(scope, {
        dexterity: 90,
        equipment: {dexterity: 20, dexterityCap: 4, hit: 55},
        other: {}
    });

    assert.equal(scope.getStatTotal("dexterity"), 104);
    assert.equal(scope.anyStatRestrictions("dexterity"), true);
    assert.equal(scope.statRestrictions.dexterity.length, 1);
    assert.equal(scope.statRestrictions.dexterity[0].restriction, "fromTotalMax");
    assert.equal(scope.statRestrictions.dexterity[0].amount, 110);
    assert.equal(scope.statRestrictions.dexterity[0].limit, 104);
    assert.equal(
        scope.getStatRestrictionText("dexterity"),
        "The overall limit for this stat is 104. You currently have 110."
    );

    assert.equal(scope.getStatTotal("hit"), "78 (44)");
    assert.equal(scope.statRestrictions.hit.length, 1);
    assert.equal(scope.statRestrictions.hit[0].restriction, "fromItems");
    assert.equal(scope.statRestrictions.hit[0].amount, 55);
    assert.equal(scope.statRestrictions.hit[0].limit, 44);
});

test("builder uses the corrected base damroll equipment cap", function() {
    const scope = createBuilderScope();
    equipStats(scope, {
        dexterity: 90,
        equipment: {dam: 35},
        other: {dam: 5}
    });

    assert.equal(scope.getStatTotal("dam"), "64 (30)");
    assert.equal(scope.statRestrictions.dam.length, 1);
    assert.equal(scope.statRestrictions.dam[0].restriction, "fromItems");
    assert.equal(scope.statRestrictions.dam[0].amount, 35);
    assert.equal(scope.statRestrictions.dam[0].limit, 30);
});

test("builder raises only the equipment damroll cap with final strength", function() {
    const scope = createBuilderScope();
    equipStats(scope, {
        dexterity: 90,
        equipment: {strength: 20, strengthCap: 10, dam: 55},
        other: {dam: 5}
    });

    assert.equal(scope.getStatTotal("dam"), "91 (50)");
    assert.equal(scope.statRestrictions.dam.length, 1);
    assert.equal(scope.statRestrictions.dam[0].restriction, "fromItems");
    assert.equal(scope.statRestrictions.dam[0].amount, 55);
    assert.equal(scope.statRestrictions.dam[0].limit, 50);
});

test("builder uses capped strength for all damroll calculations", function() {
    const scope = createBuilderScope();
    equipStats(scope, {
        dexterity: 90,
        equipment: {strength: 20, strengthCap: 4, dam: 55},
        other: {}
    });

    assert.equal(scope.getStatTotal("strength"), 104);
    assert.equal(scope.anyStatRestrictions("strength"), true);
    assert.equal(scope.statRestrictions.strength.length, 1);
    assert.equal(scope.statRestrictions.strength[0].restriction, "fromTotalMax");
    assert.equal(scope.statRestrictions.strength[0].amount, 110);
    assert.equal(scope.statRestrictions.strength[0].limit, 104);
    assert.equal(
        scope.getStatRestrictionText("strength"),
        "The overall limit for this stat is 104. You currently have 110."
    );

    assert.equal(scope.getStatTotal("dam"), "78 (44)");
    assert.equal(scope.statRestrictions.dam.length, 1);
    assert.equal(scope.statRestrictions.dam[0].restriction, "fromItems");
    assert.equal(scope.statRestrictions.dam[0].amount, 55);
    assert.equal(scope.statRestrictions.dam[0].limit, 44);
});

test("builder damage cap uses capped strength and dynamic item modifiers", function() {
    const scope = createBuilderScope();
    equipStats(scope, {
        strength: 90,
        equipment: {
            strength: 20,
            strengthCap: 4,
            meleedamcap: 12
        },
        other: {meleedamcap: 8}
    });

    assert.equal(scope.getStatTotal("strength"), 104);
    assert.deepEqual(getRestrictions(scope, "strength"), [{
        restriction: "fromTotalMax",
        amount: 110,
        limit: 104
    }]);
    assert.equal(scope.getStatTotal("meleedamcap"), 151);
});

test("builder damage cap includes the two-handed Wield bonus exactly once", function() {
    const scope = createBuilderScope();
    equipStats(scope, {
        strength: 100,
        equipment: {
            slot: 14,
            twoHanded: true,
            meleedamcap: 12
        },
        other: {meleedamcap: 8}
    });

    assert.equal(scope.getStatTotal("meleedamcap"), 211);
});

test("builder applies dynamic regen caps and uncapped Other bonuses", function() {
    const scope = createBuilderScope();
    equipStats(scope, {
        mind: 100,
        dexterity: 100,
        constitution: 100,
        equipment: {hpr: 30, mar: 30, mvr: 30},
        other: {hpr: 3, mar: 3, mvr: 3}
    });

    for (const statName of ["hpr", "mar", "mvr"]) {
        assert.equal(scope.getStatTotal(statName), "33 (15)");
        assert.deepEqual(getRestrictions(scope, statName), [{
            restriction: "fromItems",
            amount: 30,
            limit: 15
        }]);
    }
});

test("builder uses capped current stats for all regen calculations", function() {
    const scope = createBuilderScope();
    equipStats(scope, {
        mind: 90,
        dexterity: 90,
        constitution: 90,
        equipment: {
            mind: 20,
            mindCap: 4,
            dexterity: 20,
            dexterityCap: 4,
            constitution: 20,
            constitutionCap: 4,
            hpr: 30,
            mar: 30,
            mvr: 30
        },
        other: {}
    });

    for (const statName of ["mind", "dexterity", "constitution"]) {
        assert.equal(scope.getStatTotal(statName), 104);
        assert.deepEqual(getRestrictions(scope, statName), [{
            restriction: "fromTotalMax",
            amount: 110,
            limit: 104
        }]);
    }

    assert.equal(scope.getStatTotal("hpr"), "30 (15)");
    assert.equal(scope.getStatTotal("mar"), "32 (15)");
    assert.equal(scope.getStatTotal("mvr"), "31 (15)");
    for (const statName of ["hpr", "mar", "mvr"]) {
        assert.deepEqual(getRestrictions(scope, statName), [{
            restriction: "fromItems",
            amount: 30,
            limit: 15
        }]);
    }
});

test("new builder lists default quest resource bonuses to zero", function() {
    const scope = createBuilderScope();
    const list = scope.getDefaultList("Original");

    assert.equal(list.baseStats.quest_hp, 0);
    assert.equal(list.baseStats.quest_mana, 0);
    assert.equal(list.baseStats.quest_move, 0);
});

test("new builder lists default every era ability rank to zero", function() {
    const scope = createBuilderScope();
    const list = scope.getDefaultList("Original");

    assert.deepEqual(list.eraAbilities, {
        mentalEnhancement: 0,
        arcaneFocus: 0,
        hardenedSkin: 0,
        increasedPotential: 0,
        physicalEnhancement: 0,
        weaponFocus: 0,
        innateRegeneration: 0,
        physicalEndurance: 0
    });
});

test("builder applies persistent era ability bonuses to final totals", function() {
    const cases = [
        ["mentalEnhancement", 3, [["ma", 30]]],
        ["arcaneFocus", 5, [["spelldam", 5], ["spellcrit", 5]]],
        ["hardenedSkin", 5, [["ac", -15]]],
        ["physicalEnhancement", 3, [["mv", 60]]],
        ["weaponFocus", 1, [["hit", 5], ["dam", 5]]],
        ["innateRegeneration", 3, [["hpr", 3], ["mar", 3], ["mvr", 3]]],
        ["physicalEndurance", 3, [["hp", 30]]]
    ];

    for (const [ability, rank, effects] of cases) {
        const baseline = createBuilderScope();
        const withAbility = createBuilderScope();
        const stats = {
            strength: 90,
            mind: 90,
            dexterity: 90,
            constitution: 90,
            equipment: {
                ac: -12,
                hit: 4,
                dam: 6,
                hpr: 2,
                mar: 3,
                mvr: 4,
                spelldam: 5,
                spellcrit: 6
            },
            other: {
                ac: -25,
                hit: 2,
                dam: 3,
                hpr: 1,
                mar: 1,
                mvr: 1,
                spelldam: 2,
                spellcrit: 2
            }
        };
        equipStats(baseline, stats);
        equipStats(withAbility, Object.assign({}, stats, {
            eraAbilities: {[ability]: rank}
        }));

        for (const [statName, expectedDifference] of effects) {
            assert.equal(
                numericTotal(withAbility, statName) -
                    numericTotal(baseline, statName),
                expectedDifference,
                `${ability} must change ${statName}`
            );
        }
    }
});

test("Increased Potential raises attribute caps before dependent formulas", function() {
    const baseline = createBuilderScope();
    const withAbility = createBuilderScope();
    const stats = {
        strength: 100,
        equipment: {strength: 10, strengthCap: 4},
        other: {}
    };
    equipStats(baseline, stats);
    equipStats(withAbility, Object.assign({}, stats, {
        eraAbilities: {increasedPotential: 4}
    }));

    assert.equal(baseline.getStatTotal("strength"), 104);
    assert.equal(baseline.getStatTotal("dam"), "34 (0)");
    assert.equal(withAbility.getStatTotal("strength"), 108);
    assert.equal(withAbility.getStatTotal("dam"), "35 (0)");
    assert.deepEqual(getRestrictions(withAbility, "strength"), [{
        restriction: "fromTotalMax",
        amount: 110,
        limit: 108
    }]);
});

test("builder applies each quest bonus only to its matching resource", function() {
    const scope = createBuilderScope();
    equipStats(scope, {
        dexterity: 90,
        quest_hp: 17,
        quest_mana: 23,
        quest_move: 29,
        equipment: {},
        other: {}
    });

    assert.equal(scope.getStatTotal("hp"), 683);
    assert.equal(scope.getStatTotal("ma"), 769);
    assert.equal(scope.getStatTotal("mv"), 825);
});

test("builder movement uses capped dexterity and keeps faux-item bonuses additive", function() {
    const scope = createBuilderScope();
    equipStats(scope, {
        dexterity: 90,
        constitution: 100,
        quest_move: 29,
        equipment: {
            dexterity: 20,
            dexterityCap: 4,
            constitution: 20,
            constitutionCap: 10,
            mv: 11
        },
        other: {mv: 20}
    });

    assert.equal(scope.getStatTotal("dexterity"), 104);
    assert.equal(scope.getStatTotal("constitution"), 110);
    assert.deepEqual(getRestrictions(scope, "dexterity"), [{
        restriction: "fromTotalMax",
        amount: 110,
        limit: 104
    }]);
    assert.equal(scope.getStatTotal("mv"), 926);
});

test("builder AC uses capped dexterity and keeps faux-object bonuses additive", function() {
    const scope = createBuilderScope();
    equipStats(scope, {
        strength: 100,
        dexterity: 90,
        constitution: 100,
        equipment: {
            dexterity: 20,
            dexterityCap: 4,
            ac: -12
        },
        other: {ac: -25}
    });

    assert.equal(scope.getStatTotal("dexterity"), 104);
    assert.deepEqual(getRestrictions(scope, "dexterity"), [{
        restriction: "fromTotalMax",
        amount: 110,
        limit: 104
    }]);
    assert.equal(scope.getStatTotal("ac"), 26);
});

test("builder matches Hakim's corrected 766 mana profile", function() {
    const scope = createBuilderScope();
    equipStats(scope, {
        dexterity: 90,
        equipment: {mind: 15, mindCap: 5, ma: -55},
        other: {}
    });

    assert.equal(scope.getStatTotal("mind"), 105);
    assert.equal(scope.getStatTotal("ma"), 766);
});

test("builder stats block renders the three quest resource inputs", function() {
    const template = fs.readFileSync(path.join(
        __dirname,
        "../src/views/builder/index.ejs"
    ), "utf8");
    const hazelnutIndex = template.indexOf('id="hazelnutSelect"');

    const fields = [
        ["questHpInput", "Quest HP", "quest_hp"],
        ["questManaInput", "Quest Mana", "quest_mana"],
        ["questMoveInput", "Quest Mv", "quest_move"]
    ];

    for (const [id, label, property] of fields) {
        const inputIndex = template.indexOf(`id="${id}"`);
        assert.ok(inputIndex > hazelnutIndex, `${id} must follow Hazelnut`);
        assert.match(template, new RegExp(`for="${id}">${label}<\\/label>`));
        assert.match(template, new RegExp(
            `id="${id}"[^>]*ng-model="selectedList\\.baseStats\\.${property}"`
        ));
    }
});

test("builder renders metadata-driven era ability rank selectors", function() {
    const template = fs.readFileSync(path.join(
        __dirname,
        "../src/views/builder/index.ejs"
    ), "utf8");
    const questMoveIndex = template.indexOf('id="questMoveInput"');
    const eraAbilitiesIndex = template.indexOf("Era Abilities");

    assert.ok(
        eraAbilitiesIndex > questMoveIndex,
        "Era Abilities must follow character quest resources"
    );
    assert.match(template, /ng-repeat="era in eraAbilityEras track by era"/);
    assert.match(
        template,
        /ng-repeat="ability in eraAbilities \| filter:\{era: era\} track by ability\.key"/
    );
    assert.match(
        template,
        /ng-model="selectedList\.eraAbilities\[ability\.key\]"/
    );
    assert.match(template, /ng-change="saveClientSideData\(\)"/);
    assert.match(template, /<option ng-value="0">None<\/option>/);
    assert.match(
        template,
        /ng-repeat="rank in ability\.ranks track by rank" ng-value="rank">Rank \{\{::rank\}\}/
    );
});

test("builder Character card stays content-height beside Stats", async function() {
    const html = await renderBuilder();
    const headingIndex = html.indexOf(">Character</span>");
    const cardStart = html.lastIndexOf('<div class="card border-primary', headingIndex);
    const cardTag = html.slice(cardStart, html.indexOf(">", cardStart) + 1);

    assert.ok(headingIndex >= 0, "missing Character heading");
    assert.ok(cardStart >= 0, "missing Character card");
    assert.doesNotMatch(cardTag, /\bh-100\b/);
});

test("builder keeps KSM quest mods and era abilities in collapsed sections", async function() {
    const html = await renderBuilder();
    const ksmToggle = html.match(
        /<button[^>]*data-target="#ksmQuestMods"[^>]*>[\s\S]*?KSM Swap\/Quest Mods[\s\S]*?<\/button>/
    );
    const eraToggle = html.match(
        /<button[^>]*data-target="#eraAbilities"[^>]*>[\s\S]*?Era Abilities[\s\S]*?<\/button>/
    );

    assert.ok(ksmToggle, "missing KSM Swap/Quest Mods collapse toggle");
    assert.match(ksmToggle[0], /class="[^"]*\bh5\b[^"]*"/);
    assert.match(ksmToggle[0], /data-toggle="collapse"/);
    assert.match(ksmToggle[0], /aria-controls="ksmQuestMods"/);
    assert.match(ksmToggle[0], /aria-expanded="false"/);
    assert.ok(eraToggle, "missing Era Abilities collapse toggle");
    assert.match(eraToggle[0], /class="[^"]*\bh5\b[^"]*"/);
    assert.match(eraToggle[0], /data-toggle="collapse"/);
    assert.match(eraToggle[0], /aria-controls="eraAbilities"/);
    assert.match(eraToggle[0], /aria-expanded="false"/);
    assert.doesNotMatch(ksmToggle[0], /data-parent=/);
    assert.doesNotMatch(eraToggle[0], /data-parent=/);

    const ksmPanel = html.indexOf('<div class="collapse" id="ksmQuestMods">');
    const eraPanel = html.indexOf('<div class="collapse" id="eraAbilities">');
    assert.ok(ksmPanel >= 0, "KSM panel must start collapsed");
    assert.ok(eraPanel > ksmPanel, "Era Abilities panel must start collapsed");
    assert.ok(html.indexOf('id="ksmStrInput"') > ksmPanel);
    assert.ok(html.indexOf('id="questMoveInput"') > ksmPanel);
    assert.ok(html.indexOf('id="questMoveInput"') < eraPanel);
});

test("builder aligns era abilities in three responsive table columns", async function() {
    const html = await renderBuilder();
    const eraColumn = html.match(
        /<div class="col-12 col-md-4[^"]*" ng-repeat="era in eraAbilityEras track by era">([\s\S]*?)<table class="table table-sm table-bordered era-abilities-table[^>]*>([\s\S]*?)<\/table>/
    );

    assert.ok(eraColumn, "missing responsive Era Abilities table column");
    assert.match(eraColumn[1], /<h6[^>]*>\{\{::era\}\}<\/h6>/);
    const table = eraColumn[2];
    assert.match(table, /<col class="era-ability-key-column">/);
    assert.match(table, /<col class="era-ability-value-column">/);
    assert.match(
        table,
        /ng-repeat="ability in eraAbilities \| filter:\{era: era\} track by ability\.key"/
    );
    assert.match(table, /class="custom-select custom-select-sm w-100"/);
    assert.match(html, /\.era-abilities-table\s*\{[^}]*table-layout:\s*fixed/);
    assert.match(html, /\.era-ability-key-column\s*\{[^}]*width:\s*70%/);
    assert.match(html, /\.era-ability-value-column\s*\{[^}]*width:\s*30%/);
});

test("builder version 6 round-trips quest resources and era abilities without shifting items", function() {
    const scope = createBuilderScope();
    const list = scope.getDefaultList("Original");
    Object.assign(list.baseStats, {
        strength: 30,
        mind: 30,
        dexterity: 30,
        constitution: 30,
        perception: 30,
        spirit: 30,
        quest_hp: 17,
        quest_mana: 23,
        quest_move: 300000
    });
    Object.assign(list.eraAbilities, {
        mentalEnhancement: 2,
        arcaneFocus: 5,
        hardenedSkin: 4,
        increasedPotential: 3,
        physicalEnhancement: 1,
        weaponFocus: 1,
        innateRegeneration: 2,
        physicalEndurance: 3
    });
    list.items[0] = {id: 1144, slot: 0, name: "Test Item"};
    scope.allLists = [{name: "Quest Hero", variants: [list]}];
    scope.selectedListIndex = 0;
    scope.selectedListVariantIndex = 0;
    scope.selectedList = list;

    scope.onExportClicked();
    assert.match(scope.exportModel.curVariant, /^6\*/);
    const compactData = scope.exportModel.curVariant.split("~")[2];
    assert.equal(compactData.slice(21, 30), "00H00Nzzz");
    assert.equal(compactData.slice(30, 38), "25431123");

    scope.importModel = {
        input: scope.exportModel.curVariant,
        lists: [],
        message: "",
        loading: true
    };
    scope.onImportInputChanged();

    const imported = scope.importModel.lists[0].variants[0];
    assert.equal(imported.baseStats.quest_hp, 17);
    assert.equal(imported.baseStats.quest_mana, 23);
    assert.equal(imported.baseStats.quest_move, 238327);
    assert.deepEqual(imported.eraAbilities, {
        mentalEnhancement: 2,
        arcaneFocus: 5,
        hardenedSkin: 4,
        increasedPotential: 3,
        physicalEnhancement: 1,
        weaponFocus: 1,
        innateRegeneration: 2,
        physicalEndurance: 3
    });
    assert.equal(imported.items.length, scope.slotOrder.length);
    assert.equal(imported.items[0].id, 1144);
});

test("builder version 5 imports default era abilities without shifting items", function() {
    const scope = createBuilderScope();
    const encoder = createEncoder();
    const baseStats = Array(6).fill(encoder.fromNumber(30, 2)).join("");
    const ksmStats = "0".repeat(6);
    const items = Array(scope.slotOrder.length).fill("_");
    items[7] = encoder.fromNumber(808, 3);
    const imported = importBuilderList(
        scope,
        `5*Version Five~Original~${baseStats}${ksmStats}___` +
            `${"0".repeat(9)}${items.join("")}`
    );

    assertDefaultEraAbilities(imported);
    assert.equal(imported.items[7].id, 808);
    assert.equal(imported.items[7].slot, 5);
});

test("builder version 1 imports its legacy sentinel without shifting items", function() {
    const scope = createBuilderScope();
    const imported = importBuilderList(
        scope,
        `1*${createLegacyImport(scope, "Version One", 1, 101)}`
    );

    assert.equal(imported.baseStats.quest_hp, 0);
    assert.equal(imported.baseStats.quest_mana, 0);
    assert.equal(imported.baseStats.quest_move, 0);
    assertDefaultEraAbilities(imported);
    assert.equal(imported.items.length, scope.slotOrder.length);
    assert.equal(imported.items[1].id, 101);
    assert.equal(imported.items[1].slot, 1);
});

test("builder version 2 imports its compact sentinel without shifting items", function() {
    const scope = createBuilderScope();
    const imported = importBuilderList(
        scope,
        createCompactImport(scope, 2, 5, 202)
    );

    assert.equal(imported.baseStats.quest_hp, 0);
    assert.equal(imported.baseStats.quest_mana, 0);
    assert.equal(imported.baseStats.quest_move, 0);
    assertDefaultEraAbilities(imported);
    assert.equal(imported.items.length, scope.slotOrder.length);
    assert.equal(imported.items[5].id, 202);
    assert.equal(imported.items[5].slot, 3);
});

test("builder version 3 imports its compact sentinel without shifting items", function() {
    const scope = createBuilderScope();
    const imported = importBuilderList(
        scope,
        createCompactImport(scope, 3, 11, 303)
    );

    assert.equal(imported.baseStats.quest_hp, 0);
    assert.equal(imported.baseStats.quest_mana, 0);
    assert.equal(imported.baseStats.quest_move, 0);
    assertDefaultEraAbilities(imported);
    assert.equal(imported.items.length, scope.slotOrder.length);
    assert.equal(imported.items[11].id, 303);
    assert.equal(imported.items[11].slot, 9);
});

test("builder version 4 imports its compact sentinel without shifting items", function() {
    const scope = createBuilderScope();
    const imported = importBuilderList(
        scope,
        createCompactImport(scope, 4, 16, 404)
    );

    assert.equal(imported.baseStats.quest_hp, 0);
    assert.equal(imported.baseStats.quest_mana, 0);
    assert.equal(imported.baseStats.quest_move, 0);
    assertDefaultEraAbilities(imported);
    assert.equal(imported.items.length, scope.slotOrder.length);
    assert.equal(imported.items[16].id, 404);
    assert.equal(imported.items[16].slot, 14);
});

test("unversioned legacy builder imports its sentinel without shifting items", function() {
    const scope = createBuilderScope();
    const imported = importBuilderList(
        scope,
        createLegacyImport(scope, "Legacy", 22, 505)
    );

    assert.equal(imported.baseStats.quest_hp, 0);
    assert.equal(imported.baseStats.quest_mana, 0);
    assert.equal(imported.baseStats.quest_move, 0);
    assertDefaultEraAbilities(imported);
    assert.equal(imported.items.length, scope.slotOrder.length);
    assert.equal(imported.items[22].id, 505);
    assert.equal(imported.items[22].slot, 18);
});

test("unversioned legacy builder imports preserve multiple lists", function() {
    const scope = createBuilderScope();
    scope.importModel = {
        input: [
            createLegacyImport(scope, "Legacy One", 2, 606),
            createLegacyImport(scope, "Legacy Two", 3, 707)
        ].join("*"),
        lists: [],
        message: "",
        loading: true
    };

    scope.onImportInputChanged();

    assert.equal(scope.importModel.lists.length, 2);
    assertDefaultEraAbilities(scope.importModel.lists[0].variants[0]);
    assertDefaultEraAbilities(scope.importModel.lists[1].variants[0]);
    assert.equal(scope.importModel.lists[0].variants[0].items[2].id, 606);
    assert.equal(scope.importModel.lists[1].variants[0].items[3].id, 707);
});

test("builder rejects non-alphanumeric version-6 era ability data", function() {
    const scope = createBuilderScope();

    assert.throws(function() {
        importBuilderList(scope, createVersion6Import(scope, "000_0000"));
    }, /Invalid list/);
});

test("builder rejects truncated version-6 era ability data", function() {
    const scope = createBuilderScope();

    assert.throws(function() {
        importBuilderList(scope, createVersion6Import(scope, "0000000"));
    }, /Invalid list/);
});

test("builder rejects version-6 era ranks above an ability maximum", function() {
    const scope = createBuilderScope();

    assert.throws(function() {
        importBuilderList(scope, createVersion6Import(scope, "40000000"));
    }, /Invalid list/);
});

test("builder rejects malformed version-5 quest resource data", function() {
    const scope = createBuilderScope();
    const encoder = createEncoder();
    const baseStats = Array(6).fill(encoder.fromNumber(30, 2)).join("");
    const ksmStats = "0".repeat(6);
    scope.importModel = {
        input: `5*Broken~Original~${baseStats}${ksmStats}${"_".repeat(12)}`,
        lists: [],
        message: "",
        loading: true
    };

    assert.throws(function() {
        scope.onImportInputChanged();
    }, /Invalid list/);
});

test("builder rejects truncated version-5 quest data followed by a valid item ID", function() {
    const scope = createBuilderScope();
    const encoder = createEncoder();
    const baseStats = Array(6).fill(encoder.fromNumber(30, 2)).join("");
    const ksmStats = "0".repeat(6);
    const items = Array(scope.slotOrder.length).fill("_");
    items[0] = encoder.fromNumber(1144, 3);

    assert.throws(function() {
        importBuilderList(
            scope,
            `5*Truncated~Original~${baseStats}${ksmStats}___000000${items.join("")}`
        );
    }, /Invalid list/);
});

test("builder rejects partial version-5 item tokens", function() {
    const scope = createBuilderScope();
    const encoder = createEncoder();
    const baseStats = Array(6).fill(encoder.fromNumber(30, 2)).join("");
    const ksmStats = "0".repeat(6);
    const items = Array(scope.slotOrder.length).fill("_");
    items[items.length - 1] = "0I";

    assert.throws(function() {
        importBuilderList(
            scope,
            `5*Partial~Original~${baseStats}${ksmStats}___000000000${items.join("")}`
        );
    }, /Invalid list/);
});

test("builder rejects partial version-5 rune tokens that consume the next item", function() {
    const scope = createBuilderScope();
    const encoder = createEncoder();
    const baseStats = Array(6).fill(encoder.fromNumber(30, 2)).join("");
    const ksmStats = "0".repeat(6);
    const items = Array(scope.slotOrder.length + 1).fill("_");
    items[3] = "-AAAA";

    assert.throws(function() {
        importBuilderList(
            scope,
            `5*Partial Rune~Original~${baseStats}${ksmStats}___000000000${items.join("")}`
        );
    }, /Invalid list/);
});

test("builder rejects version-5 item over-counts", function() {
    const scope = createBuilderScope();
    const encoder = createEncoder();
    const baseStats = Array(6).fill(encoder.fromNumber(30, 2)).join("");
    const ksmStats = "0".repeat(6);
    const items = "_".repeat(scope.slotOrder.length + 1);

    assert.throws(function() {
        importBuilderList(
            scope,
            `5*Overflow~Original~${baseStats}${ksmStats}___000000000${items}`
        );
    }, /Invalid list/);
});
