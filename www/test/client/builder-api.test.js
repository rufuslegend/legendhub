"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const Module = require("node:module");
const {GraphQLObjectType, GraphQLSchema, parse, validate} = require("graphql");

function loadItemApi() {
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (request === "sync-rpc")
            return function() { return function() { return [
                {COLUMN_NAME: "Id", DATA_TYPE: "int", IS_NULLABLE: "NO"},
                {COLUMN_NAME: "Name", DATA_TYPE: "varchar", IS_NULLABLE: "NO"},
                {COLUMN_NAME: "Slot", DATA_TYPE: "int", IS_NULLABLE: "NO"},
                {COLUMN_NAME: "Strength", DATA_TYPE: "int", IS_NULLABLE: "YES"},
                {COLUMN_NAME: "AlignmentRestriction", DATA_TYPE: "varchar", IS_NULLABLE: "YES"},
                {COLUMN_NAME: "StrengthCap", DATA_TYPE: "int", IS_NULLABLE: "YES"}
            ]; }; };
        return originalLoad.call(this, request, parent, isMain);
    };
    try { return require("../../src/routes/api/items.js"); }
    finally { Module._load = originalLoad; }
}

async function loadBuilderApi() {
    return import("../../client/features/builder/builder-api.js");
}

// Catches the Builder sending the ItemAll definition without spreading it, which GraphQL rejects as an unused fragment and which drops faux/cap fields.
test("Builder item-slot and id hydration queries validate against the production Item schema", async function() {
    const {createItemsBySlotQuery, createItemsInIdsQuery} = await loadBuilderApi();
    const itemApi = loadItemApi();
    const queryType = new GraphQLObjectType({name: "Query", fields: {
        getItemsBySlotId: itemApi.queryFields.getItemsBySlotId,
        getItemsInIds: itemApi.queryFields.getItemsInIds
    }});
    const schema = new GraphQLSchema({query: queryType});

    for (const query of [createItemsBySlotQuery(itemApi.fragment), createItemsInIdsQuery(itemApi.fragment)]) {
        const errors = validate(schema, parse(query));
        assert.deepEqual(errors, []);
        assert.match(query, /\.\.\. ItemAll/);
    }
});

// Catches reloads that retain opaque item ids instead of restoring the saved item,
// faux-object fields, lock/slot state, and the derived rune-charm display values.
test("Builder hydration restores saved items and rune charms without changing their encoded state", async function() {
    const {hydrateBuilderVariant} = await loadBuilderApi();
    const variant = {
        runeCharms: {charm1: "BHKAA"},
        items: [
            {id: 41, slot: 14, locked: true},
            {id: 0, slot: 1, locked: false},
            {id: 0, slot: 1, locked: false},
            {id: -5, slot: 2, locked: false},
            {id: 99, slot: 15, locked: false}
        ]
    };
    const hydrated = hydrateBuilderVariant(variant, [{
        id: 41, name: "Axe of the fox", slot: 14, strengthCap: 3,
        alignmentRestriction: "good", fauxObject: 1
    }]);

    assert.deepEqual(hydrated.items[0], {
        id: 41, name: "Axe of the fox", slot: 14, locked: true, strengthCap: 3,
        alignmentRestriction: "good", fauxObject: 1
    });
    assert.equal(hydrated.items[3].name, "Runecharm (Uruz/Eihwaz/Gebo)");
    assert.equal(hydrated.items[3].strength, 1);
    assert.equal(hydrated.items[3].hit, 2);
    assert.equal(hydrated.items[3].hp, 10);
    assert.equal(hydrated.items[4].name, "DELETED");
    assert.equal(hydrated.items[4].slot, 15);
});
