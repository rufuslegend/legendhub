"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const {
    createBuilderProfileRepository
} = require("../src/routes/api/builder-profile-repository");

function createExecutor(respond) {
    const calls = [];
    return {
        calls,
        query(sql, values, callback) {
            calls.push({sql, values});
            try {
                callback(null, respond(sql, values));
            }
            catch (error) {
                callback(error);
            }
        }
    };
}

const NOW = new Date("2026-08-27T12:00:00.000Z");

// Catches profile reads omitting the authenticated member predicate or
// accidentally returning tombstones in the active Builder list.
test("profile reads are member-scoped and list only active rows", async function() {
    const executor = createExecutor(function(sql) {
        if (sql.includes("FROM BuilderProfiles") && sql.includes("FOR UPDATE")) {
            return [{
                PublicId: "profile-id",
                Name: "Hero",
                Payload: null,
                PayloadVersion: null,
                PayloadBytes: 0,
                Revision: 4,
                CreatedOn: NOW,
                UpdatedOn: NOW,
                DeletedOn: NOW
            }];
        }
        return [{
            PublicId: "active-id",
            Name: "Hero",
            Payload: "canonical-payload",
            PayloadVersion: 7,
            PayloadBytes: 17,
            Revision: 3,
            CreatedOn: NOW,
            UpdatedOn: NOW,
            DeletedOn: null
        }];
    });
    const repository = createBuilderProfileRepository({pool: executor});

    const profiles = await repository.list(73);
    const tombstone = await repository.findByPublicIdForUpdate(
        73, "profile-id", {executor}
    );

    assert.deepEqual(profiles, [{
        id: "active-id",
        name: "Hero",
        payload: "canonical-payload",
        payloadVersion: 7,
        payloadBytes: 17,
        revision: 3,
        createdOn: NOW,
        updatedOn: NOW,
        deletedOn: null
    }]);
    assert.equal(tombstone.id, "profile-id");
    assert.equal(tombstone.deletedOn, NOW);
    assert.match(executor.calls[0].sql, /MemberId\s*=\s*\?/i);
    assert.match(executor.calls[0].sql, /DeletedOn\s+IS\s+NULL/i);
    assert.deepEqual(executor.calls[0].values, [73]);
    assert.match(executor.calls[1].sql, /FOR UPDATE/i);
    assert.deepEqual(executor.calls[1].values, [73, "profile-id"]);
});

// Catches locale/case folding or storing a caller-provided name key instead
// of SHA-256 over the exact UTF-8 bytes used by the unique active-name index.
test("insert and update hash the exact case-sensitive UTF-8 name", async function() {
    const executor = createExecutor(() => ({affectedRows: 1, insertId: 9}));
    const repository = createBuilderProfileRepository({pool: executor});
    const base = {
        memberId: 73,
        id: "profile-id",
        name: "Héro",
        payload: "canonical-payload",
        payloadVersion: 7,
        payloadBytes: 17,
        revision: 1,
        createdOn: NOW,
        updatedOn: NOW
    };

    await repository.insert(base, {executor});
    await repository.update(73, "profile-id", {
        ...base,
        name: "héro",
        revision: 2
    }, {executor, expectedRevision: 1});

    const exactUpper = crypto.createHash("sha256").update("Héro", "utf8").digest();
    const exactLower = crypto.createHash("sha256").update("héro", "utf8").digest();
    assert.deepEqual(executor.calls[0].values[3], exactUpper);
    assert.deepEqual(executor.calls[1].values[1], exactLower);
    assert.notDeepEqual(exactUpper, exactLower);
    assert.equal(executor.calls.every(({sql}) => !sql.includes("Héro") && !sql.includes("héro")), true);
});

// Catches a soft delete retaining quota bytes, payload contents, or the
// active-name hash, any of which would violate tombstone/name-reuse behavior.
test("markDeleted atomically clears payload storage and advances the exact revision", async function() {
    const executor = createExecutor(() => ({affectedRows: 1}));
    const repository = createBuilderProfileRepository({pool: executor});

    const result = await repository.markDeleted(73, "profile-id", {
        expectedRevision: 4,
        deletedOn: NOW
    }, {executor});

    assert.equal(result, 1);
    const call = executor.calls[0];
    assert.match(call.sql, /Payload\s*=\s*NULL/i);
    assert.match(call.sql, /PayloadVersion\s*=\s*NULL/i);
    assert.match(call.sql, /PayloadBytes\s*=\s*0/i);
    assert.match(call.sql, /ActiveNameHash\s*=\s*NULL/i);
    assert.match(call.sql, /DeletedOn\s*=\s*\?/i);
    assert.match(call.sql, /Revision\s*=\s*Revision\s*\+\s*1/i);
    assert.match(call.sql, /Revision\s*=\s*\?/i);
    assert.deepEqual(call.values, [NOW, NOW, 73, "profile-id", 4]);
});

// Catches quota queries counting tombstones, trusting stored client totals,
// or losing the exact integer result returned by MySQL.
test("usedBytes sums only active encoded payload bytes for one member", async function() {
    const executor = createExecutor(() => [{UsedBytes: "10485700"}]);
    const repository = createBuilderProfileRepository({pool: executor});

    assert.equal(await repository.usedBytes(73, {executor}), 10_485_700);
    assert.match(executor.calls[0].sql, /SUM\s*\(\s*PayloadBytes\s*\)/i);
    assert.match(executor.calls[0].sql, /DeletedOn\s+IS\s+NULL/i);
    assert.deepEqual(executor.calls[0].values, [73]);
});

// Catches Account settings selecting profile/preference payloads, acquiring a
// write lock, or issuing a second usage query instead of one safe projection.
test("account storage summary is one payload-free nonlocking projection", async function() {
    const executor = createExecutor(() => [{
        PublicId: "active-id",
        Name: "Hero",
        Revision: "3",
        UpdatedOn: NOW,
        StorageGeneration: "7",
        UsedBytes: "10485700"
    }]);
    const repository = createBuilderProfileRepository({pool: executor});

    const summary = await repository.readStorageSummary(73);

    assert.deepEqual(summary, {
        profiles: [{
            id: "active-id",
            name: "Hero",
            revision: 3,
            updatedOn: NOW
        }],
        profileCount: 1,
        storageGeneration: 7,
        usedBytes: 10_485_700
    });
    assert.equal(executor.calls.length, 1);
    const [{sql, values}] = executor.calls;
    assert.match(sql, /AccountPreferences/i);
    assert.match(sql, /BuilderProfiles/i);
    assert.match(sql, /PayloadBytes/i);
    assert.match(sql, /DeletedOn\s+IS\s+NULL/i);
    assert.doesNotMatch(sql, /(?:^|[\s,])Payload(?:[\s,]|$)/i);
    assert.doesNotMatch(sql, /\b(?:FOR\s+UPDATE|INSERT|UPDATE|DELETE)\b/i);
    assert.deepEqual(values, [73]);
});

test("account storage summary defaults safely when preferences are absent", async function() {
    const executor = createExecutor(() => []);
    const repository = createBuilderProfileRepository({pool: executor});

    assert.equal(await repository.readStorageSummary(73), null);
});

// Catches generation reads without a row lock, non-parameterized ownership,
// or JSON result documents leaking through as driver-specific strings.
test("preferences and import receipts are locked and scoped to their member", async function() {
    const executor = createExecutor(function(sql) {
        if (sql.includes("FROM AccountPreferences")) {
            return [{
                DocumentVersion: 1,
                Payload: '{"theme":"dark"}',
                Revision: "2",
                StorageGeneration: "3",
                UpdatedOn: NOW
            }];
        }
        if (sql.includes("FROM BuilderImportReceipts"))
            return [{ResultPayload: '{"copied":["Hero"]}', CreatedOn: NOW}];
        return {affectedRows: 1, insertId: 11};
    });
    const repository = createBuilderProfileRepository({pool: executor});

    const preferences = await repository.readPreferencesForUpdate(73, {executor});
    await repository.writePreferences(73, {
        documentVersion: 1,
        payload: {theme: "light"},
        revision: 3,
        storageGeneration: 4,
        updatedOn: NOW
    }, {executor});
    const receipt = await repository.readImportReceipt(73, "idem-key", {executor});
    await repository.writeImportReceipt(73, "idem-key", {copied: []}, NOW, {executor});

    assert.deepEqual(preferences, {
        documentVersion: 1,
        payload: {theme: "dark"},
        revision: 2,
        storageGeneration: 3,
        updatedOn: NOW
    });
    assert.deepEqual(receipt, {result: {copied: ["Hero"]}, createdOn: NOW});
    const preferenceRead = executor.calls.find(({sql}) => sql.includes("FROM AccountPreferences"));
    const receiptRead = executor.calls.find(({sql}) => sql.includes("FROM BuilderImportReceipts"));
    assert.match(preferenceRead.sql, /FOR UPDATE/i);
    assert.match(receiptRead.sql, /FOR UPDATE/i);
    assert.deepEqual(preferenceRead.values, [73]);
    assert.deepEqual(receiptRead.values, [73, "idem-key"]);
    assert.equal(executor.calls.every(({sql}) =>
        !sql.includes("idem-key") && !sql.includes("theme\":\"light")), true);
});

// Catches ordinary page bootstrap acquiring a write lock, initializing rows,
// or touching profile payload/quota tables to read three preference fields.
test("ordinary preference bootstrap is one member-scoped lock-free read", async function() {
    const executor = createExecutor(function(sql) {
        if (!sql.includes("FROM AccountPreferences"))
            throw new Error("Preference bootstrap touched an unrelated table.");
        return [{
            DocumentVersion: 1,
            Payload: '{"version":1,"theme":"dark"}',
            Revision: "7",
            StorageGeneration: "3",
            UpdatedOn: NOW
        }];
    });
    const repository = createBuilderProfileRepository({pool: executor});

    const preferences = await repository.readPreferences(73);

    assert.deepEqual(preferences, {
        documentVersion: 1,
        payload: {version: 1, theme: "dark"},
        revision: 7,
        storageGeneration: 3,
        updatedOn: NOW
    });
    assert.equal(executor.calls.length, 1);
    assert.match(executor.calls[0].sql, /FROM\s+AccountPreferences/i);
    assert.match(executor.calls[0].sql, /MemberId\s*=\s*\?/i);
    assert.doesNotMatch(executor.calls[0].sql, /FOR\s+UPDATE/i);
    assert.doesNotMatch(executor.calls[0].sql, /BuilderProfiles|PayloadBytes|SUM\s*\(/i);
    assert.deepEqual(executor.calls[0].values, [73]);
});

// Catches repository-side normalization or case folding defeating the binary
// SQL collation and making two opaque idempotency keys share one receipt.
test("import receipt keys preserve exact ASCII case at the repository boundary", async function() {
    const stored = new Map();
    const executor = createExecutor(function(sql, values) {
        if (sql.includes("INSERT INTO BuilderImportReceipts")) {
            stored.set(values[1], values[2]);
            return {insertId: stored.size};
        }
        if (sql.includes("FROM BuilderImportReceipts")) {
            const payload = stored.get(values[1]);
            return payload === undefined ? [] : [{ResultPayload: payload, CreatedOn: NOW}];
        }
        throw new Error("Unexpected receipt SQL.");
    });
    const repository = createBuilderProfileRepository({pool: executor});

    await repository.writeImportReceipt(73, "ImportKey", {copied: ["Upper"]}, NOW, {executor});
    await repository.writeImportReceipt(73, "importkey", {copied: ["Lower"]}, NOW, {executor});
    const upper = await repository.readImportReceipt(73, "ImportKey", {executor});
    const lower = await repository.readImportReceipt(73, "importkey", {executor});

    assert.deepEqual(upper.result, {copied: ["Upper"]});
    assert.deepEqual(lower.result, {copied: ["Lower"]});
    assert.deepEqual(executor.calls.map(call => call.values[1]), [
        "ImportKey", "importkey", "ImportKey", "importkey"
    ]);
});

// Catches delete-all retaining payload-bearing idempotency receipts or deleting
// another member's receipts outside the surrounding storage transaction.
test("import receipt cleanup is member-scoped and uses the supplied transaction", async function() {
    const executor = createExecutor(() => ({affectedRows: 3}));
    const repository = createBuilderProfileRepository({pool: executor});

    assert.equal(await repository.deleteImportReceipts(73, {executor}), 3);
    assert.equal(executor.calls.length, 1);
    assert.match(executor.calls[0].sql,
        /^\s*DELETE\s+FROM\s+BuilderImportReceipts/i);
    assert.match(executor.calls[0].sql, /WHERE\s+MemberId\s*=\s*\?/i);
    assert.deepEqual(executor.calls[0].values, [73]);
});
