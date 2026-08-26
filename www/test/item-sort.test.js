"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {resolveItemSort} = require("../src/routes/api/item-sort");

const metadata = [
    {Var: "Name"},
    {Var: "ModifiedOn"},
    {Var: "Slot"}
];

test("item sorting accepts metadata fields case-insensitively", function() {
    assert.equal(resolveItemSort("slot", false, metadata), "Slot");
    assert.equal(resolveItemSort("NAME", false, metadata), "Name");
});

test("item sorting uses a request-local safe default for missing and invalid fields", function() {
    assert.equal(resolveItemSort(null, true, metadata), "ModifiedOn");
    assert.equal(resolveItemSort(null, false, metadata), "Name");
    assert.equal(resolveItemSort("not-a-column", true, metadata), "ModifiedOn");
    assert.equal(resolveItemSort("not-a-column", false, metadata), "Name");
    assert.equal(resolveItemSort("slot", false, []), "Name");
});
