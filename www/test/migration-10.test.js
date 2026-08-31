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

const COMPLETE_TRIGGER = `
    INSERT INTO Items_AuditTrail (\`ItemId\`, \`SlotMask\`) VALUES (OLD.\`Id\`, OLD.\`SlotMask\`);
    INSERT INTO NotificationQueue (ActorId, ObjectId, ObjectType, ObjectPage, ObjectName, Verb, CreatedOn)
    SELECT M.Id, OLD.Id, 'item', 'items', OLD.Name, 'updated', NOW()
    FROM Members M WHERE Username = NEW.ModifiedBy;
`;

function createQuery({
    existingColumns = false,
    column = {COLUMN_TYPE: "int(10) unsigned", IS_NULLABLE: "NO"},
    trigger = []
} = {}) {
    const calls = [];
    const query = async function(operation, sql) {
        calls.push({operation, sql});
        if (operation === "inspect Items.SlotMask" ||
            operation === "inspect Items_AuditTrail.SlotMask") {
            return existingColumns
                ? [column]
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
    assert.match(
        sqlByOperation.get("create Items_BEFORE_UPDATE"),
        /INSERT INTO NotificationQueue \(ActorId, ObjectId, ObjectType, ObjectPage, ObjectName, Verb, CreatedOn\)/
    );
    assert.match(
        sqlByOperation.get("create Items_BEFORE_UPDATE"),
        /SELECT M\.Id, OLD\.Id, 'item', 'items', OLD\.Name, 'updated', NOW\(\)/
    );
    assert.doesNotMatch([...sqlByOperation.values()].join("\n"), /DELETE FROM Items|GROUP BY Name/);
});

test("migration 10 accepts MySQL 5.7 unsigned display widths without changing completed columns", async function() {
    const {calls, query} = createQuery({
        existingColumns: true,
        trigger: [{ACTION_STATEMENT: COMPLETE_TRIGGER}]
    });

    await migration.up({query});

    assert.equal(calls.some((call) => /ADD COLUMN/.test(call.sql)), false);
    assert.equal(calls.some((call) => /MODIFY COLUMN/.test(call.sql)), false);
    assert.equal(calls.some((call) => call.operation === "create Items_BEFORE_UPDATE"), false);
    assert.equal(await migration.verify({query}), true);
});

test("migration 10 restores a missing trigger without re-adding completed columns", async function() {
    const {calls, query} = createQuery({existingColumns: true});

    await migration.up({query});

    assert.equal(calls.some((call) => /ADD COLUMN/.test(call.sql)), false);
    assert.equal(calls.some((call) => call.operation === "create Items_BEFORE_UPDATE"), true);
});

test("migration 10 rejects signed or wrong integer slot mask columns", async function(t) {
    for (const column of [
        {COLUMN_TYPE: "int(10)", IS_NULLABLE: "NO"},
        {COLUMN_TYPE: "bigint(20) unsigned", IS_NULLABLE: "NO"}
    ]) {
        await t.test(column.COLUMN_TYPE, async function() {
            const {query} = createQuery({
                existingColumns: true,
                column,
                trigger: [{ACTION_STATEMENT: COMPLETE_TRIGGER}]
            });

            assert.equal(await migration.verify({query}), false);
        });
    }
});

test("migration 10 verifies both audit and notification trigger behavior", async function() {
    const {query} = createQuery({
        existingColumns: true,
        column: {COLUMN_TYPE: "int unsigned", IS_NULLABLE: "NO"},
        trigger: [{ACTION_STATEMENT: "INSERT INTO Items_AuditTrail VALUES (OLD.`SlotMask`)"}]
    });

    assert.equal(await migration.verify({query}), false);
});
