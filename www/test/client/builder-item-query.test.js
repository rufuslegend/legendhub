"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

async function loadQuery() {
    return import("../../client/features/builder/builder-item-query.js");
}

// Catches inclusive comparisons becoming strict, equality accepting a nearby
// value, or signed decimal values being truncated during query parsing.
test("builder item queries support inclusive, equality, and decimal comparisons", async function() {
    const {compileBuilderItemQuery} = await loadQuery();
    let matches;
    assert.doesNotThrow(function() {
        matches = compileBuilderItemQuery(
            "ac <= -10 and hit >= 2 and rent = 3.5",
            [
                {display: "Armor Class", short: "AC", var: "ac"},
                {display: "Hit Roll", short: "HR", var: "hit"},
                {display: "Rent", short: "Rent", var: "rent"}
            ]
        );
    });

    assert.equal(matches({ac: -10, hit: 2, rent: 3.5}), true);
    assert.equal(matches({ac: -9, hit: 2, rent: 3.5}), false);
    assert.equal(matches({ac: -10, hit: 1, rent: 3.5}), false);
    assert.equal(matches({ac: -10, hit: 2, rent: 3.6}), false);
});

// Catches malformed player input escaping into React render or hiding every
// candidate without explaining which part of the query is invalid.
test("invalid builder item queries report an error without filtering items", async function() {
    const {parseBuilderItemQuery} = await loadQuery();
    let result;
    assert.doesNotThrow(function() {
        result = parseBuilderItemQuery(
            "strength >> 5",
            [{display: "Strength", short: "Str", var: "strength"}]
        );
    });

    assert.match(result.error, /Expected a number/);
    assert.equal(result.matches({name: "Any item", strength: 0}), true);
});

// Catches OR binding more tightly than AND or parentheses failing to override
// the default precedence.
test("builder item queries honor boolean precedence and nested grouping", async function() {
    const {compileBuilderItemQuery} = await loadQuery();
    const stats = [
        {display: "Strength", short: "Str", var: "strength"},
        {display: "Mind", short: "Min", var: "mind"},
        {display: "Dexterity", short: "Dex", var: "dexterity"}
    ];
    const items = [
        {id: 1, name: "First", strength: 16, mind: 20, dexterity: 0},
        {id: 2, name: "Second", strength: 0, mind: 9, dexterity: 11},
        {id: 3, name: "Third", strength: 0, mind: 9, dexterity: 0}
    ];

    const defaultPrecedence = compileBuilderItemQuery(
        "strength > 15 or mind < 10 and dexterity > 10", stats);
    const grouped = compileBuilderItemQuery(
        "((strength > 15 or mind < 10) and dexterity > 10)", stats);

    assert.deepEqual(items.filter(defaultPrecedence).map(item => item.id), [1, 2]);
    assert.deepEqual(items.filter(grouped).map(item => item.id), [2]);
});

// Catches stat lookup becoming case-sensitive, dropping display/short aliases,
// or commas no longer acting as the documented AND shorthand.
test("builder item queries resolve every stat label and comma shorthand", async function() {
    const {compileBuilderItemQuery} = await loadQuery();
    const matches = compileBuilderItemQuery(
        "Armor Class <= -10, HR >= 2 and ReNt = 3.5",
        [
            {display: "Armor Class", short: "AC", var: "ac"},
            {display: "Hit Roll", short: "HR", var: "hit"},
            {display: "Rent", short: "Rent", var: "rent"}
        ]
    );

    assert.equal(matches({ac: -10, hit: 2, rent: 3.5}), true);
    assert.equal(matches({ac: -10, hit: 1, rent: 3.5}), false);
});

// Catches boolean keywords changing legacy plain-text searches when no stat
// comparison syntax is present.
test("ordinary item names containing boolean words remain name searches", async function() {
    const {compileBuilderItemQuery} = await loadQuery();
    const matches = compileBuilderItemQuery("fire and ice", []);

    assert.equal(matches({name: "A blade of Fire and Ice"}), true);
    assert.equal(matches({name: "A blade of fire"}), false);
});

// Catches diagnostics losing the distinction between an unknown stat and an
// unfinished parenthesized expression.
test("builder item queries identify unknown stats and unmatched parentheses", async function() {
    const {parseBuilderItemQuery} = await loadQuery();
    const stats = [{display: "Strength", short: "Str", var: "strength"}];

    assert.match(parseBuilderItemQuery("luck > 5", stats).error,
        /Unknown item stat "luck"/);
    assert.match(parseBuilderItemQuery("(strength > 5", stats).error,
        /Expected a closing parenthesis/);
});

// Catches the deployed Two Handed abbreviation diverging between Builder and
// the main Items grammar because its first character is numeric.
test("builder item queries accept the deployed 2H alias", async function() {
    const {compileBuilderItemQuery} = await loadQuery();
    const matches = compileBuilderItemQuery(
        "2H = 1",
        [{display: "Two Handed", short: "2H", var: "twoHanded"}]
    );

    assert.equal(matches({name: "Great sword", twoHanded: 1}), true);
    assert.equal(matches({name: "Short sword", twoHanded: 0}), false);
});
