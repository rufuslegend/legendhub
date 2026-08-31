"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const migration = require("../src/routes/api/migrations/11");

function createQuery(responses = {}) {
    const calls = [];
    const query = async function(operation, sql) {
        calls.push({operation, sql});
        if (Object.hasOwn(responses, operation))
            return typeof responses[operation] === "function"
                ? responses[operation](operation, sql)
                : responses[operation];
        return [];
    };
    return {calls, query};
}

test("migration 11 declares recoverable non-transactional DDL", () => {
    assert.equal(migration.mode, "non-transactional");
});

test("migration 11 adds official storage, widens legacy text, and rebuilds audit", async () => {
    const {calls, query} = createQuery({
        "read Items columns": [
            {COLUMN_NAME: "Id"}, {COLUMN_NAME: "Name"}, {COLUMN_NAME: "Casts"},
            {COLUMN_NAME: "Official"}, {COLUMN_NAME: "Deleted"}
        ],
        "read Items_AuditTrail columns": [
            {COLUMN_NAME: "Id"}, {COLUMN_NAME: "ItemId"}, {COLUMN_NAME: "Name"},
            {COLUMN_NAME: "Casts"}, {COLUMN_NAME: "Official"}, {COLUMN_NAME: "Deleted"}
        ]
    });

    await migration.up({query});

    const sql = calls.map(call => call.sql).join("\n");
    assert.match(sql, /ALTER TABLE Items ADD COLUMN Official TINYINT NOT NULL DEFAULT 0/);
    assert.match(sql, /ALTER TABLE Items_AuditTrail ADD COLUMN Official TINYINT NOT NULL DEFAULT 0/);
    assert.match(sql, /ALTER TABLE Items MODIFY COLUMN Name VARCHAR\(255\) CHARACTER SET utf8mb4/);
    assert.match(sql, /ALTER TABLE Items_AuditTrail MODIFY COLUMN Name VARCHAR\(255\) CHARACTER SET utf8mb4/);
    assert.match(sql, /ALTER TABLE Items MODIFY COLUMN Casts MEDIUMTEXT CHARACTER SET utf8mb4/);
    assert.match(sql, /CREATE TABLE OfficialItemVariants/);
    assert.match(sql, /UNIQUE KEY UX_OfficialItemVariants_Identity \(Server, Vnum, ItemFingerprint\)/);
    assert.match(sql, /CREATE TABLE EquipmentSubmissions/);
    assert.match(sql, /UNIQUE KEY UX_EquipmentSubmissions_Identity \(Server, SubmissionId\)/);
    assert.match(sql, /INSERT INTO ItemStatInfo/);
    assert.match(sql, /'official'/);
    assert.match(sql, /OLD\.`Official`/);
});

test("migration 11 leaves completed schema steps alone", async () => {
    const complete = migration.__test.completeInspectionResponses();
    const {calls, query} = createQuery(complete);

    await migration.up({query});

    const mutating = calls.filter(call => /^(ALTER|CREATE|INSERT|UPDATE|DROP)/.test(call.sql.trim()));
    assert.deepEqual(mutating, []);
    assert.equal(await migration.verify({query}), true);
});

test("migration 11 verify rejects malformed provenance tables or stale audit trigger", async () => {
    const missingColumn = migration.__test.completeInspectionResponses();
    missingColumn["inspect EquipmentSubmissions columns"] =
        missingColumn["inspect EquipmentSubmissions columns"].slice(1);
    assert.equal(await migration.verify({query: createQuery(missingColumn).query}), false);

    const staleTrigger = migration.__test.completeInspectionResponses();
    staleTrigger["inspect Items_BEFORE_UPDATE"] = [{ACTION_STATEMENT: "OLD.`Deleted`"}];
    assert.equal(await migration.verify({query: createQuery(staleTrigger).query}), false);
});
