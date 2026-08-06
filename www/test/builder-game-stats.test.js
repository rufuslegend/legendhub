const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const gameStats = require("../src/public/js/services/game-stats");

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
            on: function() {}
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
        {},
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
        "hit",
        "dam"
    ].map(function(statName) {
        return {var: statName, type: "int"};
    });

    return scope;
}

function equipStats(scope, overrides) {
    const items = Array.from({length: 25}, function() {
        return {};
    });
    Object.assign(items[0], overrides.equipment);
    Object.assign(items[24], overrides.other);
    scope.selectedList = {
        baseStats: {
            strength: 90,
            mind: 90,
            dexterity: overrides.dexterity,
            constitution: 90,
            perception: 90,
            spirit: 90,
            amulet: -1,
            hazelnut: -1,
            longhouse: -1
        },
        ksmStats: {},
        items
    };
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

test("builder leaves the damroll equipment cap at 27", function() {
    const scope = createBuilderScope();
    equipStats(scope, {
        dexterity: 90,
        equipment: {dam: 35},
        other: {dam: 5}
    });

    assert.equal(scope.getStatTotal("dam"), "61 (27)");
    assert.equal(scope.statRestrictions.dam.length, 1);
    assert.equal(scope.statRestrictions.dam[0].restriction, "fromItems");
    assert.equal(scope.statRestrictions.dam[0].amount, 35);
    assert.equal(scope.statRestrictions.dam[0].limit, 27);
});
