"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {parseObservation} = require("../src/equipment-importer/contract");
const {createEquipmentRepository} = require("../src/equipment-importer/repository");

function parsedFixture() {
    return parseObservation(fs.readFileSync(path.join(__dirname, "..", "test-fixtures",
        "equipment-spool", "valid.json")));
}

function fakePool(options = {}) {
    const calls = [];
    const state = {began: 0, committed: 0, rolledBack: 0, released: 0};
    const connection = {
        beginTransaction(callback) {
            state.began += 1;
            callback(options.beginError || null);
        },
        query(sql, values, callback) {
            if (typeof values === "function") {
                callback = values;
                values = [];
            }
            calls.push({sql, values});
            if (options.failOn && sql.includes(options.failOn))
                return callback(new Error("fixture query failure"));
            if (sql.includes("FROM EquipmentSubmissions"))
                return callback(null, options.submissions || []);
            if (sql.includes("FROM OfficialItemVariants"))
                return callback(null, options.variants || []);
            if (sql.includes("FROM ItemStatInfo")) {
                return callback(null, options.metadata || [
                    {Var: "strength", NetStat: "1.00"},
                    {Var: "constitution", NetStat: "1.00"},
                    {Var: "perception", NetStat: "1.00"},
                    {Var: "spirit", NetStat: "1.00"}
                ]);
            }
            if (sql.startsWith("INSERT INTO Items"))
                return callback(null, {insertId: options.insertId || 701});
            return callback(null, {affectedRows: 1, insertId: 1});
        },
        commit(callback) {
            state.committed += 1;
            callback(options.commitError || null);
        },
        rollback(callback) {
            state.rolledBack += 1;
            callback(options.rollbackError || null);
        },
        release() {
            state.released += 1;
        }
    };
    return {
        calls,
        state,
        pool: {
            getConnection(callback) {
                callback(options.connectionError || null, connection);
            }
        }
    };
}

test("new variant inserts one official item and both provenance records", async () => {
    const fixture = fakePool();
    const parsed = parsedFixture();
    const receivedAt = new Date("2026-08-31T22:24:00Z");

    const result = await createEquipmentRepository(fixture.pool).ingest(parsed, receivedAt);

    assert.deepEqual(result, {status: "created", itemId: 701});
    assert.deepEqual(fixture.state,
        {began: 1, committed: 1, rolledBack: 0, released: 1});
    const itemInsert = fixture.calls.find(call => call.sql.startsWith("INSERT INTO Items"));
    const [columns, values] = itemInsert.values;
    assert.equal(values[columns.indexOf("Official")], 1);
    assert.equal(values[columns.indexOf("NetStat")], 5);
    assert.equal(values[columns.indexOf("ModifiedOn")], receivedAt);
    assert.equal(fixture.calls.filter(call => call.sql.includes("INSERT INTO OfficialItemVariants")).length, 1);
    assert.equal(fixture.calls.filter(call => call.sql.includes("INSERT INTO EquipmentSubmissions")).length, 1);
    assert.equal(fixture.calls.some(call => /FROM Items\b/.test(call.sql)), false);
});

test("a distinct submission with the same fingerprint reuses the official variant", async () => {
    const fixture = fakePool({variants: [{ItemId: 88}]});
    const result = await createEquipmentRepository(fixture.pool)
        .ingest(parsedFixture(), new Date("2026-08-31T22:25:00Z"));

    assert.deepEqual(result, {status: "duplicate", itemId: 88});
    assert.equal(fixture.calls.some(call => call.sql.startsWith("INSERT INTO Items")), false);
    assert.equal(fixture.calls.some(call =>
        call.sql.includes("ObservationCount = ObservationCount + 1")), true);
    assert.equal(fixture.calls.some(call => call.sql.includes("INSERT INTO EquipmentSubmissions")), true);
    assert.equal(fixture.state.committed, 1);
});

test("an identical submission replay creates nothing and does not increment observations", async () => {
    const parsed = parsedFixture();
    const fixture = fakePool({submissions: [{PayloadHash: parsed.payloadHash, ItemId: 88}]});

    const result = await createEquipmentRepository(fixture.pool)
        .ingest(parsed, new Date("2026-08-31T22:26:00Z"));

    assert.deepEqual(result, {status: "replay", itemId: 88});
    assert.equal(fixture.calls.length, 1);
    assert.equal(fixture.state.committed, 1);
    assert.equal(fixture.state.rolledBack, 0);
});

test("a reused submission identity with different content rolls back as a collision", async () => {
    const parsed = parsedFixture();
    const fixture = fakePool({
        submissions: [{PayloadHash: Buffer.alloc(32, 7), ItemId: 88}]
    });

    await assert.rejects(
        createEquipmentRepository(fixture.pool)
            .ingest(parsed, new Date("2026-08-31T22:27:00Z")),
        error => error.code === "submission_id_collision"
    );
    assert.equal(fixture.state.committed, 0);
    assert.equal(fixture.state.rolledBack, 1);
    assert.equal(fixture.state.released, 1);
});

test("a database failure rolls back and always releases the acquired connection", async () => {
    const fixture = fakePool({failOn: "INSERT INTO EquipmentSubmissions"});
    await assert.rejects(
        createEquipmentRepository(fixture.pool)
            .ingest(parsedFixture(), new Date("2026-08-31T22:28:00Z")),
        /fixture query failure/
    );
    assert.deepEqual(fixture.state,
        {began: 1, committed: 0, rolledBack: 1, released: 1});
});
