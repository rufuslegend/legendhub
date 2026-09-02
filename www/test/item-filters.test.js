"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
    resolveItemFilters,
    resolveItemSearch
} = require("../src/routes/api/item-filters");

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

const searchMetadata = [
    {Var: "name", Display: "Name", Short: "Name", Type: "string"},
    {Var: "strength", Display: "Strength", Short: "Str", Type: "int"},
    {Var: "mind", Display: "Mind", Short: "Min", Type: "int"},
    {Var: "dexterity", Display: "Dexterity", Short: "Dex", Type: "int"},
    {Var: "spirit", Display: "Spirit", Short: "Spi", Type: "int"},
    {Var: "ac", Display: "Armor Class", Short: "AC", Type: "int"},
    {Var: "hit", Display: "Hit Roll", Short: "HR", Type: "int"},
    {Var: "rent", Display: "Rent", Short: "Rent", Type: "decimal"},
    {Var: "twoHanded", Display: "Two Handed", Short: "2H", Type: "bool"}
];

// Catches the main Items search treating the complete expression as literal
// name text or losing boolean grouping while producing its SQL predicate.
test("item search compiles Builder-style name and stat expressions", function() {
    assert.deepEqual(resolveItemSearch(
        "sword, (strength >= 15 and mind < 10) or (dexterity > 10 and spirit < 5)",
        searchMetadata
    ), {
        name: "sword",
        clause: " AND (((Strength >= ?) AND (Mind < ?)) OR " +
            "((Dexterity > ?) AND (Spirit < ?)))",
        values: [15, 10, 10, 5]
    });
});

// Catches aliases, signed decimals, and comma-as-AND drifting from the
// already player-facing Choose Item query language.
test("item search resolves stat aliases and parameterizes every number", function() {
    const resolved = resolveItemSearch(
        "Armor Class <= -10, HR >= 2 and ReNt = 3.5",
        searchMetadata
    );

    assert.deepEqual(resolved, {
        name: "",
        clause: " AND (((Ac <= ?) AND (Hit >= ?)) AND (Rent = ?))",
        values: [-10, 2, 3.5]
    });
    assert.doesNotMatch(resolved.clause, /-10|3\.5/);
});

// Catches ordinary names containing boolean words being interpreted as
// expressions when they contain no comparison operator.
test("item search preserves ordinary name searches", function() {
    assert.deepEqual(resolveItemSearch("fire and ice", searchMetadata), {
        name: "fire and ice",
        clause: "",
        values: []
    });
});

// Catches malformed or unknown query tokens being ignored, partially
// executed, or copied into SQL.
test("item search rejects malformed and unknown stat expressions", function() {
    assert.throws(
        () => resolveItemSearch("strength >> 5", searchMetadata),
        error => error?.constructor?.name === "ItemSearchSyntaxError" &&
            /Expected a number after "strength >"\./.test(error.message)
    );
    assert.throws(
        () => resolveItemSearch("luck >= 5", searchMetadata),
        /Unknown numeric item stat "luck"\./
    );
    assert.throws(
        () => resolveItemSearch("name = 5", searchMetadata),
        /Unknown numeric item stat "name"\./
    );
});

// Catches a digit-leading deployed alias being tokenized as the number 2 and
// never reaching stat lookup.
test("item search accepts the deployed 2H numeric stat alias", function() {
    assert.deepEqual(resolveItemSearch("2H = 1", searchMetadata), {
        name: "",
        clause: " AND (TwoHanded = ?)",
        values: [1]
    });
});

// Catches hostile nesting exhausting the JavaScript stack or oversized and
// non-finite values escaping the parser as database errors.
test("item search bounds public expressions and rejects numeric overflow", function() {
    const nested = `${"(".repeat(33)}strength = 1${")".repeat(33)}`;
    assert.throws(
        () => resolveItemSearch(nested, searchMetadata),
        /Item search grouping is too deeply nested\./
    );
    assert.throws(
        () => resolveItemSearch(`strength = ${"9".repeat(400)}`, searchMetadata),
        /Item search number is too large\./
    );
    assert.throws(
        () => resolveItemSearch(`${"s".repeat(1001)}, strength = 1`, searchMetadata),
        /Item search query is too long\./
    );
    assert.throws(
        () => resolveItemSearch(`${"Str=1,".repeat(70)}Str=1`, searchMetadata),
        /Item search expression is too complex\./
    );
});
