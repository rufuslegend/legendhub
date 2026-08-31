"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const Module = require("node:module");
const {GraphQLObjectType, GraphQLSchema, parse, validate} = require("graphql");
const itemApiPath = require.resolve("../../src/routes/api/items.js");

function loadItemApi(mysql) {
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (mysql && parent?.filename === itemApiPath && request === "./mysql-connection")
            return mysql;
        if (request === "sync-rpc")
            return function() { return function() { return [
                {COLUMN_NAME: "Id", DATA_TYPE: "int", IS_NULLABLE: "NO"},
                {COLUMN_NAME: "Name", DATA_TYPE: "varchar", IS_NULLABLE: "NO"},
                {COLUMN_NAME: "Slot", DATA_TYPE: "int", IS_NULLABLE: "NO"},
                {COLUMN_NAME: "SlotMask", DATA_TYPE: "int", IS_NULLABLE: "NO"},
                {COLUMN_NAME: "Strength", DATA_TYPE: "int", IS_NULLABLE: "YES"},
                {COLUMN_NAME: "AlignmentRestriction", DATA_TYPE: "varchar", IS_NULLABLE: "YES"},
                {COLUMN_NAME: "StrengthCap", DATA_TYPE: "int", IS_NULLABLE: "YES"},
                {COLUMN_NAME: "Weight", DATA_TYPE: "decimal", IS_NULLABLE: "YES"},
                {COLUMN_NAME: "UniqueWear", DATA_TYPE: "tinyint", IS_NULLABLE: "YES"},
                {COLUMN_NAME: "IsLimited", DATA_TYPE: "tinyint", IS_NULLABLE: "YES"},
                {COLUMN_NAME: "TwoHanded", DATA_TYPE: "tinyint", IS_NULLABLE: "YES"},
                {COLUMN_NAME: "FauxObject", DATA_TYPE: "tinyint", IS_NULLABLE: "YES"}
            ]; }; };
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        delete require.cache[itemApiPath];
        return require(itemApiPath);
    }
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
            {id: 41, slot: 15, locked: true},
            {id: 0, slot: 1, locked: false},
            {id: 0, slot: 1, locked: false},
            {id: -5, slot: 2, locked: false},
            {id: 99, slot: 15, locked: false}
        ]
    };
    const hydrated = hydrateBuilderVariant(variant, [{
        id: 41, name: "Axe of the fox", slot: 14, slots: [14, 15], strengthCap: 3,
        alignmentRestriction: "good", fauxObject: 1
    }]);

    assert.deepEqual(hydrated.items[0], {
        id: 41, name: "Axe of the fox", slot: 15, slots: [14, 15], locked: true, strengthCap: 3,
        alignmentRestriction: "good", fauxObject: 1
    });
    assert.deepEqual(hydrated.items[0].slots, [14, 15]);
    assert.equal(hydrated.items[0].slot, 15);
    assert.equal(hydrated.items[3].name, "Runecharm (Uruz/Eihwaz/Gebo)");
    assert.equal(hydrated.items[3].strength, 1);
    assert.equal(hydrated.items[3].hit, 2);
    assert.equal(hydrated.items[3].hp, 10);
    assert.equal(hydrated.items[4].name, "DELETED");
    assert.equal(hydrated.items[4].slot, 15);
});

// Catches an all-missing hydration lookup becoming a GraphQL error instead of
// allowing the Builder to render each persisted id as DELETED.
test("production item hydration resolves an empty list when every id is missing", async function() {
    const itemApi = loadItemApi({
        query(_sql, values, callback) {
            assert.deepEqual(values, [[404, 405]]);
            callback(null, []);
        }
    });

    const result = await itemApi.queryFields.getItemsInIds.resolve(null, {ids: [404, 405]});

    assert.deepEqual(result, []);
});

// Catches Builder retrieval falling back to scalar Slot/Holdable inference
// instead of querying the authoritative capability mask.
test("Builder item retrieval uses one validated slot-mask membership predicate", async function() {
    const statements = [];
    const itemApi = loadItemApi({
        query(sql, values, callback) {
            statements.push({sql, values});
            callback(null, []);
        }
    });

    assert.deepEqual(
        await itemApi.queryFields.getItemsBySlotId.resolve(null, {slotId: 14}),
        []
    );
    assert.equal(statements.length, 1);
    assert.match(
        statements[0].sql,
        /FROM Items WHERE \(SlotMask & \?\) <> 0 AND Deleted = 0 ORDER BY Name ASC$/
    );
    assert.doesNotMatch(statements[0].sql, /Holdable|\bOR\b|WHERE Slot =/);
    assert.deepEqual(statements[0].values, [16384]);
});

// Catches malformed or unsupported Builder slot identifiers reaching MySQL.
test("Builder item retrieval rejects slot IDs outside the supported range", async function() {
    let queryCount = 0;
    const itemApi = loadItemApi({
        query() { queryCount += 1; }
    });

    for (const slotId of [-1, 22, 1.5]) {
        await assert.rejects(
            Promise.resolve().then(() =>
                itemApi.queryFields.getItemsBySlotId.resolve(null, {slotId})
            ),
            error => error.extensions?.code === 400
        );
    }
    assert.equal(queryCount, 0);
});
