"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const migration = require("../src/routes/api/migrations/10");

const itemColumns = [
    {COLUMN_NAME: "Id"},
    {COLUMN_NAME: "Name"},
    {COLUMN_NAME: "Slot"},
    {COLUMN_NAME: "Holdable"},
    {COLUMN_NAME: "Deleted"},
    {COLUMN_NAME: "SlotMask"}
];

const auditColumns = [
    {COLUMN_NAME: "Id"},
    {COLUMN_NAME: "ItemId"},
    {COLUMN_NAME: "Name"},
    {COLUMN_NAME: "Slot"},
    {COLUMN_NAME: "Holdable"},
    {COLUMN_NAME: "Deleted"},
    {COLUMN_NAME: "SlotMask"}
];

function createQuery({existingColumns = false, trigger = []} = {}) {
    const calls = [];
    const query = async function(operation, sql) {
        calls.push({operation, sql});
        if (operation === "inspect Items.SlotMask" ||
            operation === "inspect Items_AuditTrail.SlotMask") {
            return existingColumns
                ? [{COLUMN_TYPE: "int unsigned", IS_NULLABLE: "NO"}]
                : [];
        }
        if (operation === "read Items columns")
            return itemColumns;
        if (operation === "read Items_AuditTrail columns")
            return auditColumns;
        if (operation === "inspect Items_BEFORE_UPDATE")
            return trigger;
        if (operation.startsWith("validate "))
            return [];
        return {affectedRows: 3};
    };
    return {calls, query};
}

test("migration 10 creates missing masks, backfills legacy rows, and rebuilds audit history", async function() {
    const {calls, query} = createQuery();

    await migration.up({query});

    const operations = calls.map((call) => call.operation);
    const sqlByOperation = new Map(calls.map((call) => [call.operation, call.sql]));
    assert.deepEqual(operations.slice(0, 4), [
        "inspect Items.SlotMask",
        "add Items.SlotMask",
        "inspect Items_AuditTrail.SlotMask",
        "add Items_AuditTrail.SlotMask"
    ]);
    assert.match(sqlByOperation.get("backfill Items.SlotMask"), /Slot = 14 AND Holdable = 1/);
    assert.match(sqlByOperation.get("create Items_BEFORE_UPDATE"), /OLD\.`SlotMask`/);
    assert.doesNotMatch([...sqlByOperation.values()].join("\n"), /DELETE FROM Items|GROUP BY Name/);
});

test("migration 10 resumes without re-adding completed columns and restores a missing trigger", async function() {
    const {calls, query} = createQuery({existingColumns: true});

    await migration.up({query});

    assert.equal(calls.some((call) => /ADD COLUMN/.test(call.sql)), false);
    assert.equal(calls.some((call) => call.operation === "create Items_BEFORE_UPDATE"), true);
});
