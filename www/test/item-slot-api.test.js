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
    {COLUMN_NAME: "Holdable", DATA_TYPE: "tinyint", IS_NULLABLE: "NO"},
    {COLUMN_NAME: "Official", DATA_TYPE: "tinyint", IS_NULLABLE: "NO"}
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
                    authMutation: async function() {
                        return {
                            expires: "2030-01-01T00:00:00.000Z",
                            ip: "192.0.2.7",
                            permissions: {
                                hasPermission: function() { return true; }
                            },
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
        validate(schema, parse("query { getItemById(id: 7) { id slot slots official } }")),
        []
    );
    assert.match(itemApi.fragment, /\bslot\b/);
    assert.match(itemApi.fragment, /\bslots\b/);
    assert.doesNotMatch(itemApi.fragment, /slotMask/i);
});

test("official status is readable but cannot be supplied to community item mutations", function() {
    const itemApi = loadItemApi();
    assert.match(itemApi.fragment, /\bofficial\b/);
    assert.equal(Object.hasOwn(itemApi.mutationFields.insertItem.args, "official"), false);
    assert.equal(Object.hasOwn(itemApi.mutationFields.updateItem.args, "official"), false);
});

// Catches the public Items resolver passing expression syntax through the
// legacy Name LIKE parameter instead of applying the compiled stat predicate.
test("Items resolver applies a parameterized name and stat search before paging", async function() {
    const statements = [];
    const metadata = [
        {Var: "name", Display: "Name", Short: "Name", Type: "string", FilterString: "<> ''"},
        {Var: "strength", Display: "Strength", Short: "Str", Type: "int", FilterString: "<> 0"}
    ];
    const itemApi = loadItemApi({
        query(sql, values, callback) {
            if (typeof values === "function") {
                callback = values;
                values = [];
            }
            statements.push({sql, values});
            if (sql.includes("FROM ItemStatInfo")) {
                callback(null, metadata);
                return;
            }
            callback(null, []);
        }
    });

    await itemApi.queryFields.getItems.resolve(null, {
        searchString: "sword, strength >= 5",
        filterString: null,
        sortBy: null,
        sortAsc: true,
        page: 1,
        rows: 20
    });

    assert.equal(statements.length, 2);
    assert.match(statements[1].sql,
        /WHERE Deleted = 0 AND \(\? = '' OR Name LIKE \?\) AND \(Strength >= \?\)/);
    assert.deepEqual(statements[1].values, ["sword", "%sword%", 5]);
});

// Catches official item attribution disappearing, selecting a later duplicate
// submission, or becoming dependent on nondeterministic database row order.
test("official items expose the earliest submitting character", async function() {
    const statements = [];
    const itemApi = loadItemApi({
        query(sql, values, callback) {
            statements.push({sql, values});
            if (sql.includes("FROM EquipmentSubmissions")) {
                callback(null, [{SubmittedByCharacter: "Rufus"}]);
                return;
            }
            assert.fail(`Unexpected SQL: ${sql}`);
        }
    });
    const item = new itemApi.classes.Item({
        Id: 83, Name: "Official shield", Slot: 10,
        SlotMask: 1024, Holdable: 1, Official: 1
    });

    assert.equal(itemApi.types.itemType.getFields().submittedBy?.type,
        graphql.GraphQLString);
    assert.equal(await item.submittedBy(), "Rufus");
    assert.deepEqual(statements[0].values, [83]);
    assert.match(statements[0].sql,
        /ORDER BY ReceivedOn ASC, Id ASC\s+LIMIT 1/);
});

// Catches community item pages consulting importer provenance or accidentally
// displaying a submission credit that belongs only to game-owned records.
test("community items have no importer attribution", async function() {
    let queryCount = 0;
    const itemApi = loadItemApi({
        query(_sql, _values, callback) {
            queryCount += 1;
            callback(null, [{SubmittedByCharacter: "Wrong credit"}]);
        }
    });
    const item = new itemApi.classes.Item({
        Id: 84, Name: "Community shield", Slot: 10,
        SlotMask: 1024, Holdable: 1, Official: 0
    });

    assert.equal(await item.submittedBy(), null);
    assert.equal(queryCount, 0);
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

// Catches authenticated editors changing a game-owned row while leaving its
// source fingerprint pointing at data that no longer matches the item.
test("official item updates are forbidden before any write", async function() {
    const {api, statements} = createUpdateApi(
        {Id: 83, Slot: 10, SlotMask: 1024, Holdable: true, Official: 1}
    );

    await assert.rejects(
        api.mutationFields.updateItem.resolve(
            null,
            {authToken: "update-token", id: 83, name: "Player rewrite"},
            {}
        ),
        error => error.extensions?.code === 403
    );
    assert.equal(
        statements.some(statement => statement.sql.startsWith("UPDATE Items SET")),
        false
    );
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

// Catches history restore bypassing the same protection as the normal editor.
test("official item history cannot be reverted", async function() {
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
                    Id: 901, ItemId: 83, Name: "Official history", Slot: 10,
                    SlotMask: 1024, Holdable: true, Official: 1
                }]);
            }
            if (sql.startsWith("UPDATE Items SET"))
                return callback(null, {affectedRows: 1});
            assert.fail(`Unexpected SQL: ${sql}`);
        }
    });

    await assert.rejects(
        api.mutationFields.revertItem.resolve(
            null,
            {authToken: "revert-token", historyId: 901},
            {}
        ),
        error => error.extensions?.code === 403
    );
    assert.equal(
        statements.some(statement => statement.sql.startsWith("UPDATE Items SET")),
        false
    );
});

// Catches delete permission being treated as permission to remove game-owned
// data. A future trusted-editor policy can replace this unconditional rule.
test("official items cannot be deleted even with item delete permission", async function() {
    const statements = [];
    const api = loadItemApi({
        query(sql, values, callback) {
            if (typeof values === "function") {
                callback = values;
                values = [];
            }
            statements.push({sql, values});
            if (sql.includes("FROM Items WHERE Id = ?"))
                return callback(null, [{Official: 1}]);
            if (sql.startsWith("UPDATE Items SET Deleted"))
                return callback(null, {affectedRows: 1});
            assert.fail(`Unexpected SQL: ${sql}`);
        }
    });

    await assert.rejects(
        api.mutationFields.deleteItem.resolve(
            null,
            {authToken: "delete-token", id: 83},
            {}
        ),
        error => error.extensions?.code === 403
    );
    assert.equal(
        statements.some(statement => statement.sql.startsWith("UPDATE Items SET Deleted")),
        false
    );
});

// Catches the protection being checked in one query but omitted from the
// actual write, which could turn a later trusted-editor race into a deletion.
test("community item deletion keeps the official guard on the write", async function() {
    const statements = [];
    const api = loadItemApi({
        query(sql, values, callback) {
            if (typeof values === "function") {
                callback = values;
                values = [];
            }
            statements.push({sql, values});
            if (sql.includes("FROM Items WHERE Id = ?"))
                return callback(null, [{Official: 0}]);
            if (sql.startsWith("UPDATE Items SET Deleted"))
                return callback(null, {affectedRows: 1});
            assert.fail(`Unexpected SQL: ${sql}`);
        }
    });

    await api.mutationFields.deleteItem.resolve(
        null,
        {authToken: "delete-token", id: 84},
        {}
    );

    const update = statements.find(statement =>
        statement.sql.startsWith("UPDATE Items SET Deleted"));
    assert.match(update.sql, /WHERE Id = \? AND Official = 0/);
    assert.deepEqual(update.values, [84]);
});

// Catches a row becoming protected between the read and guarded write while a
// future trusted-editor mechanism is operating.
test("item deletion fails closed when the guarded write changes no row", async function() {
    const api = loadItemApi({
        query(sql, values, callback) {
            if (typeof values === "function")
                callback = values;
            if (sql.includes("FROM Items WHERE Id = ?"))
                return callback(null, [{Official: 0}]);
            if (sql.startsWith("UPDATE Items SET Deleted"))
                return callback(null, {affectedRows: 0});
            assert.fail(`Unexpected SQL: ${sql}`);
        }
    });

    await assert.rejects(
        api.mutationFields.deleteItem.resolve(
            null,
            {authToken: "delete-token", id: 85},
            {}
        ),
        error => error.extensions?.code === 403
    );
});
