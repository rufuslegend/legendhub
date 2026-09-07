"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const migration = require("../src/routes/api/migrations/11");

function createQuery(responses = {}) {
    const calls = [];
    const query = async function(operation, sql, values = []) {
        calls.push({operation, sql, values});
        if (Object.hasOwn(responses, operation))
            return typeof responses[operation] === "function"
                ? responses[operation](operation, sql, values)
                : responses[operation];
        if (operation === "read session SQL mode")
            return [{SqlMode: "STRICT_TRANS_TABLES"}];
        if (operation === "inspect database engine")
            return [{VERSION: "5.7.44"}];
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

// Catches MariaDB reporting nullable COLUMN_DEFAULT values as the string NULL
// and SQL string defaults with their quotes still present.
test("migration 11 verifies MariaDB 12.3 column defaults", async () => {
    const complete = migration.__test.completeInspectionResponses();
    complete["inspect database engine"] = [{VERSION: "12.3.3-MariaDB"}];
    for (const [operation, rows] of Object.entries(complete)) {
        if (!operation.endsWith(" columns") && !operation.includes("."))
            continue;
        for (const row of rows) {
            if (row.COLUMN_DEFAULT === null && row.IS_NULLABLE === "YES")
                row.COLUMN_DEFAULT = "NULL";
        }
    }

    assert.equal(await migration.verify({query: createQuery(complete).query}), true);
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

test("migration 11 temporarily permits legacy zero dates and restores the session on failure", async () => {
    const ddlFailure = new Error("fixture DDL failure");
    const {calls, query} = createQuery({
        "read session SQL mode": [{SqlMode:
            "STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE"}],
        "modify Items_AuditTrail.Name": () => {
            throw ddlFailure;
        }
    });

    await assert.rejects(migration.up({query}), ddlFailure);

    const sessionChanges = calls.filter(call => call.operation.includes("session SQL mode"));
    assert.deepEqual(sessionChanges.map(call => call.operation), [
        "read session SQL mode",
        "permit legacy zero dates in session SQL mode",
        "restore session SQL mode"
    ]);
    assert.deepEqual(sessionChanges[1].values, ["STRICT_TRANS_TABLES"]);
    assert.deepEqual(sessionChanges[2].values,
        ["STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE"]);
});
