"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const Module = require("node:module");
const graphql = require("graphql");
const {GraphQLObjectType, GraphQLSchema, parse, validate} = graphql;

const itemApiPath = require.resolve("../src/routes/api/items.js");

const itemColumns = [
    {COLUMN_NAME: "Id", DATA_TYPE: "int", IS_NULLABLE: "NO"},
    {COLUMN_NAME: "Name", DATA_TYPE: "varchar", IS_NULLABLE: "NO"},
    {COLUMN_NAME: "Slot", DATA_TYPE: "int", IS_NULLABLE: "NO"},
    {COLUMN_NAME: "SlotMask", DATA_TYPE: "int", IS_NULLABLE: "NO"},
    {COLUMN_NAME: "Holdable", DATA_TYPE: "tinyint", IS_NULLABLE: "NO"}
];

const itemStatInfo = [
    {Var: "slot", DefaultValue: "0", Type: "select", NetStat: 0},
    {Var: "holdable", DefaultValue: "0", Type: "bool", NetStat: 0}
];

function loadItemApi(mysql = {query() {}}, authResponse = {}, columns = itemColumns) {
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (parent?.filename === itemApiPath && request === "./mysql-connection")
            return mysql;
        if (parent?.filename === itemApiPath && request === "./auth") {
            return {
                types: {
                    idMutationResponseType: graphql.GraphQLString,
                    tokenRenewalType: graphql.GraphQLString
                },
                utils: {
                    authToken: async function() {
                        return {
                            expires: "2030-01-01T00:00:00.000Z",
                            token: "renewed-token",
                            username: "Slot Editor",
                            ...authResponse
                        };
                    },
                    getIPFromRequest: function() { return "192.0.2.7"; }
                }
            };
        }
        if (request === "sync-rpc")
            return function() { return function() { return columns; }; };
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        delete require.cache[itemApiPath];
        return require(itemApiPath);
    }
    finally {
        Module._load = originalLoad;
    }
}

// Catches SlotMask leaking through generic schema generation or the computed
// capability list disappearing while the compatible primary slot remains.
test("Item exposes computed slots without exposing its physical slot mask", function() {
    const itemApi = loadItemApi();
    const queryType = new GraphQLObjectType({name: "Query", fields: {
        getItemById: itemApi.queryFields.getItemById
    }});
    const schema = new GraphQLSchema({query: queryType});

    assert.deepEqual(
        validate(schema, parse("query { getItemById(id: 7) { id slot slots } }")),
        []
    );
    assert.match(itemApi.fragment, /\bslot\b/);
    assert.match(itemApi.fragment, /\bslots\b/);
    assert.doesNotMatch(itemApi.fragment, /slotMask/i);
});

function valueForColumn(values, column) {
    for (let index = 0; index < values.length - 1; index += 2) {
        if (values[index] === column)
            return values[index + 1];
    }
    return undefined;
}

function createInsertApi() {
    const statements = [];
    const api = loadItemApi({
        query(sql, values, callback) {
            if (typeof values === "function") {
                callback = values;
                values = [];
            }
            statements.push({sql, values});
            if (sql.startsWith("SELECT Var"))
                return callback(null, itemStatInfo);
            if (sql.startsWith("INSERT INTO Items"))
                return callback(null, {insertId: 701});
            assert.fail(`Unexpected SQL: ${sql}`);
        }
    });
    return {api, statements};
}

// Catches authoritative arrays being reduced to one scalar capability or
// preserving the caller's array order as the primary slot on insert.
test("item insert writes an authoritative slot mask and canonical primary", async function() {
    const {api, statements} = createInsertApi();

    await api.mutationFields.insertItem.resolve(
        null,
        {authToken: "insert-token", name: "Dual item", slots: [15, 2]},
        {}
    );

    const insert = statements.find(statement => statement.sql.startsWith("INSERT INTO Items"));
    const [columns, values] = insert.values;
    assert.equal(columns.filter(column => column === "Slot").length, 1);
    assert.equal(columns.filter(column => column === "SlotMask").length, 1);
    assert.equal(values[columns.indexOf("Slot")], 2);
    assert.equal(values[columns.indexOf("SlotMask")], 32772);
});

// Catches the legacy create path dropping the historical Holdable/Wield
// compatibility rule when no authoritative slots array is supplied.
test("legacy item insert derives the holdable wield capability mask", async function() {
    const {api, statements} = createInsertApi();

    await api.mutationFields.insertItem.resolve(
        null,
        {authToken: "insert-token", name: "Legacy item", slot: 14, holdable: true},
        {}
    );

    const insert = statements.find(statement => statement.sql.startsWith("INSERT INTO Items"));
    const [columns, values] = insert.values;
    assert.equal(values[columns.indexOf("Slot")], 14);
    assert.equal(values[columns.indexOf("SlotMask")], 49152);
});

function createUpdateApi(currentItem) {
    const statements = [];
    const api = loadItemApi({
        query(sql, values, callback) {
            if (typeof values === "function") {
                callback = values;
                values = [];
            }
            statements.push({sql, values});
            if (sql.startsWith("SELECT Var"))
                return callback(null, itemStatInfo);
            if (sql.includes("FROM Items WHERE Id = ?"))
                return callback(null, [currentItem]);
            if (sql.startsWith("UPDATE Items SET"))
                return callback(null, {affectedRows: 1});
            assert.fail(`Unexpected SQL: ${sql}`);
        }
    });
    return {api, statements};
}

async function updateSlots(currentItem, args) {
    const {api, statements} = createUpdateApi(currentItem);
    await api.mutationFields.updateItem.resolve(
        null,
        {authToken: "update-token", id: currentItem.Id, ...args},
        {}
    );
    return statements;
}

// Catches array updates unnecessarily replacing a still-valid primary slot.
test("item update retains a current primary present in authoritative slots", async function() {
    const statements = await updateSlots(
        {Id: 77, Slot: 15, SlotMask: 49152, Holdable: true},
        {slots: [2, 15]}
    );
    const update = statements.find(statement => statement.sql.startsWith("UPDATE Items SET"));
    assert.equal(valueForColumn(update.values, "Slot"), 15);
    assert.equal(valueForColumn(update.values, "SlotMask"), 32772);
});

// Catches removal of the primary capability leaving a stale scalar slot.
test("item update falls back canonically when authoritative slots remove the primary", async function() {
    const statements = await updateSlots(
        {Id: 78, Slot: 15, SlotMask: 49152, Holdable: true},
        {slots: [2]}
    );
    const update = statements.find(statement => statement.sql.startsWith("UPDATE Items SET"));
    assert.equal(valueForColumn(update.values, "Slot"), 2);
    assert.equal(valueForColumn(update.values, "SlotMask"), 4);
});

// Catches unrelated edits reconstructing or narrowing a stored capability mask.
test("item update preserves the current slot mask when slots are omitted", async function() {
    const statements = await updateSlots(
        {Id: 79, Slot: 14, SlotMask: 49152, Holdable: false},
        {name: "Renamed"}
    );
    const update = statements.find(statement => statement.sql.startsWith("UPDATE Items SET"));
    assert.equal(valueForColumn(update.values, "Slot"), 14);
    assert.equal(valueForColumn(update.values, "SlotMask"), 49152);
});

// Catches legacy scalar updates adding capabilities that were not explicitly
// stored in the current authoritative mask.
test("legacy scalar update rejects a primary absent from the current mask", async function() {
    const {api, statements} = createUpdateApi(
        {Id: 80, Slot: 14, SlotMask: 49152, Holdable: true}
    );

    await assert.rejects(
        api.mutationFields.updateItem.resolve(
            null,
            {authToken: "update-token", id: 80, slot: 10},
            {}
        ),
        error => error.extensions?.code === 400 && /^Slots: /.test(error.message)
    );
    assert.equal(statements.some(statement => statement.sql.startsWith("UPDATE Items SET")), false);
});

// Catches invalid arrays reaching a write or being silently normalized.
test("item update rejects invalid authoritative slot arrays before writing", async function() {
    for (const slots of [[], [22], [21, 2]]) {
        const {api, statements} = createUpdateApi(
            {Id: 81, Slot: 2, SlotMask: 4, Holdable: false}
        );
        await assert.rejects(
            api.mutationFields.updateItem.resolve(
                null,
                {authToken: "update-token", id: 81, slots},
                {}
            ),
            error => error.extensions?.code === 400 && /^Slots: /.test(error.message)
        );
        assert.equal(
            statements.some(statement => statement.sql.startsWith("UPDATE Items SET")),
            false
        );
    }
});

// Catches revert rebuilding capabilities from current Holdable behavior instead
// of restoring the exact audited SlotMask value.
test("item revert restores the historical primary and mask exactly", async function() {
    const statements = [];
    const api = loadItemApi({
        query(sql, values, callback) {
            if (typeof values === "function") {
                callback = values;
                values = [];
            }
            statements.push({sql, values});
            if (sql.startsWith("SELECT Var"))
                return callback(null, itemStatInfo);
            if (sql.includes("FROM Items_AuditTrail WHERE Id = ?")) {
                return callback(null, [{
                    Id: 900, ItemId: 82, Name: "Historic", Slot: 14,
                    SlotMask: 16384, Holdable: true
                }]);
            }
            if (sql.startsWith("UPDATE Items SET"))
                return callback(null, {affectedRows: 1});
            assert.fail(`Unexpected SQL: ${sql}`);
        }
    });

    await api.mutationFields.revertItem.resolve(
        null,
        {authToken: "revert-token", historyId: 900},
        {}
    );

    const update = statements.find(statement => statement.sql.startsWith("UPDATE Items SET"));
    assert.equal(valueForColumn(update.values, "Slot"), 14);
    assert.equal(valueForColumn(update.values, "SlotMask"), 16384);
});

// Catches migrated MEDIUMTEXT item fields inheriting the preceding Boolean
// GraphQL type and making item-list serialization fail for string values.
test("Item serializes mediumtext columns as strings", function() {
    const columns = [
        {COLUMN_NAME: "Id", DATA_TYPE: "int", IS_NULLABLE: "NO"},
        {COLUMN_NAME: "Bonded", DATA_TYPE: "tinyint", IS_NULLABLE: "YES"},
        {COLUMN_NAME: "Casts", DATA_TYPE: "mediumtext", IS_NULLABLE: "YES"}
    ];
    const api = loadItemApi(undefined, {}, columns);
    const castsType = api.types.itemType.getFields().casts.type;

    assert.equal(castsType.serialize("heal"), "heal");
});
