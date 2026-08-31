"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {resolveItemFilters} = require("../src/routes/api/item-filters");

const deployedFilterMetadata = [
    {Var: "isLight", Type: "bool", FilterString: "= 1"},
    {Var: "slot", Type: "select", FilterString: "= {0}"},
    {Var: "name", Type: "string", FilterString: "<> ''"},
    {Var: "strength", Type: "int", FilterString: "<> 0"},
    {Var: "weight", Type: "decimal", FilterString: "> 0"}
];

test("item filters preserve deployed metadata clauses and parameterize select values", function() {
    assert.deepEqual(
        resolveItemFilters("isLight,slot_3,name,strength,weight", deployedFilterMetadata),
        {
            clause: " AND (IsLight = 1) AND ((SlotMask & ?) <> 0) AND (Name <> '')" +
                " AND (Strength <> 0) AND (Weight > 0)",
            values: [8]
        }
    );
});

test("item filters ignore malformed tokens and unsafe metadata without emitting request text", function() {
    const metadata = deployedFilterMetadata.concat([
        {Var: "bad-column;DROP", Type: "bool", FilterString: "= 1"},
        {Var: "casts", Type: "string", FilterString: "= '' OR 1 = 1"},
        {Var: "weaponType", Type: "select", FilterString: "= {0} OR 1 = 1"}
    ]);

    const resolved = resolveItemFilters(
        ",slot_3 OR 1=1,slot_1_2,slot_22,isLight_extra,unknown_7," +
            "bad-column;DROP,casts,weaponType_2",
        metadata
    );

    assert.deepEqual(resolved, {clause: "", values: []});
    assert.doesNotMatch(resolved.clause, /DROP|OR 1|3 OR/);
});
