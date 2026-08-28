"use strict";

const crypto = require("node:crypto");
const {query} = require("./database");
const {DEFAULT_PREFERENCES} = require("./builder-preferences");

const PROFILE_COLUMNS = `
    PublicId, Name, Payload, PayloadVersion, PayloadBytes, Revision,
    CreatedOn, UpdatedOn, DeletedOn`;
const DEFAULT_PREFERENCES_JSON = JSON.stringify(DEFAULT_PREFERENCES);

function nameHash(name) {
    return crypto.createHash("sha256").update(name, "utf8").digest();
}

function numberValue(value) {
    return Number(value);
}

function parseStoredJson(value, kind) {
    if (value !== null && typeof value === "object")
        return value;
    try {
        return JSON.parse(value);
    }
    catch {
        throw new Error(`Stored ${kind} data is invalid.`);
    }
}

function emptyDocument(value) {
    return value && typeof value === "object" && !Array.isArray(value) &&
        Object.keys(value).length === 0;
}

function profileFromRow(row) {
    if (!row)
        return null;
    return {
        id: row.PublicId,
        name: row.Name,
        payload: row.Payload,
        payloadVersion: row.PayloadVersion === null ? null : numberValue(row.PayloadVersion),
        payloadBytes: numberValue(row.PayloadBytes),
        revision: numberValue(row.Revision),
        createdOn: row.CreatedOn,
        updatedOn: row.UpdatedOn,
        deletedOn: row.DeletedOn
    };
}

function createBuilderProfileRepository({pool}) {
    if (!pool)
        throw new TypeError("A database pool is required.");

    return {
        async list(memberId, {executor = pool} = {}) {
            const rows = await query(executor, `
                SELECT ${PROFILE_COLUMNS}
                FROM BuilderProfiles
                WHERE MemberId = ? AND DeletedOn IS NULL
                ORDER BY UpdatedOn, Id`, [memberId]);
            return rows.map(profileFromRow);
        },

        async findByPublicIdForUpdate(memberId, publicId, {executor = pool} = {}) {
            const rows = await query(executor, `
                SELECT ${PROFILE_COLUMNS}
                FROM BuilderProfiles
                WHERE MemberId = ? AND PublicId = ?
                FOR UPDATE`, [memberId, publicId]);
            return profileFromRow(rows[0]);
        },

        async insert(profile, {executor = pool} = {}) {
            const result = await query(executor, `
                INSERT INTO BuilderProfiles
                    (PublicId, MemberId, Name, ActiveNameHash, Payload,
                     PayloadVersion, PayloadBytes, Revision, CreatedOn, UpdatedOn, DeletedOn)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`, [
                profile.id,
                profile.memberId,
                profile.name,
                nameHash(profile.name),
                profile.payload,
                profile.payloadVersion,
                profile.payloadBytes,
                profile.revision,
                profile.createdOn,
                profile.updatedOn
            ]);
            return result.insertId;
        },

        async update(memberId, publicId, profile, {
            executor = pool,
            expectedRevision
        } = {}) {
            const result = await query(executor, `
                UPDATE BuilderProfiles
                SET Name = ?, ActiveNameHash = ?, Payload = ?, PayloadVersion = ?,
                    PayloadBytes = ?, Revision = ?, UpdatedOn = ?
                WHERE MemberId = ? AND PublicId = ? AND Revision = ?
                    AND DeletedOn IS NULL`, [
                profile.name,
                nameHash(profile.name),
                profile.payload,
                profile.payloadVersion,
                profile.payloadBytes,
                profile.revision,
                profile.updatedOn,
                memberId,
                publicId,
                expectedRevision
            ]);
            return numberValue(result.affectedRows);
        },

        async markDeleted(memberId, publicId, {
            expectedRevision,
            deletedOn
        }, {executor = pool} = {}) {
            const result = await query(executor, `
                UPDATE BuilderProfiles
                SET Payload = NULL, PayloadVersion = NULL, PayloadBytes = 0,
                    ActiveNameHash = NULL, DeletedOn = ?, UpdatedOn = ?,
                    Revision = Revision + 1
                WHERE MemberId = ? AND PublicId = ? AND Revision = ?
                    AND DeletedOn IS NULL`, [
                deletedOn,
                deletedOn,
                memberId,
                publicId,
                expectedRevision
            ]);
            return numberValue(result.affectedRows);
        },

        async usedBytes(memberId, {executor = pool} = {}) {
            const rows = await query(executor, `
                SELECT COALESCE(SUM(PayloadBytes), 0) AS UsedBytes
                FROM BuilderProfiles
                WHERE MemberId = ? AND DeletedOn IS NULL`, [memberId]);
            return numberValue(rows[0]?.UsedBytes || 0);
        },

        async readPreferencesForUpdate(memberId, {executor = pool} = {}) {
            await query(executor, `
                INSERT IGNORE INTO AccountPreferences
                    (MemberId, DocumentVersion, Payload, Revision, StorageGeneration, UpdatedOn)
                VALUES (?, 1, ?, 1, 1, NOW())`, [memberId, DEFAULT_PREFERENCES_JSON]);
            const rows = await query(executor, `
                SELECT DocumentVersion, Payload, Revision, StorageGeneration, UpdatedOn
                FROM AccountPreferences
                WHERE MemberId = ?
                FOR UPDATE`, [memberId]);
            if (!rows[0])
                return null;
            let documentVersion = numberValue(rows[0].DocumentVersion);
            let payload = parseStoredJson(rows[0].Payload, "preference");
            if (emptyDocument(payload)) {
                await query(executor, `
                    UPDATE AccountPreferences
                    SET DocumentVersion = 1, Payload = ?
                    WHERE MemberId = ?`, [DEFAULT_PREFERENCES_JSON, memberId]);
                documentVersion = 1;
                payload = JSON.parse(DEFAULT_PREFERENCES_JSON);
            }
            return {
                documentVersion,
                payload,
                revision: numberValue(rows[0].Revision),
                storageGeneration: numberValue(rows[0].StorageGeneration),
                updatedOn: rows[0].UpdatedOn
            };
        },

        async writePreferences(memberId, preferences, {executor = pool} = {}) {
            const result = await query(executor, `
                INSERT INTO AccountPreferences
                    (MemberId, DocumentVersion, Payload, Revision, StorageGeneration, UpdatedOn)
                VALUES (?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    DocumentVersion = VALUES(DocumentVersion),
                    Payload = VALUES(Payload), Revision = VALUES(Revision),
                    StorageGeneration = VALUES(StorageGeneration),
                    UpdatedOn = VALUES(UpdatedOn)`, [
                memberId,
                preferences.documentVersion,
                JSON.stringify(preferences.payload),
                preferences.revision,
                preferences.storageGeneration,
                preferences.updatedOn
            ]);
            return numberValue(result.affectedRows);
        },

        async readImportReceipt(memberId, idempotencyKey, {executor = pool} = {}) {
            const rows = await query(executor, `
                SELECT ResultPayload, CreatedOn
                FROM BuilderImportReceipts
                WHERE MemberId = ? AND IdempotencyKey = ?
                FOR UPDATE`, [memberId, idempotencyKey]);
            if (!rows[0])
                return null;
            return {
                result: parseStoredJson(rows[0].ResultPayload, "import receipt"),
                createdOn: rows[0].CreatedOn
            };
        },

        async writeImportReceipt(memberId, idempotencyKey, result, createdOn, {
            executor = pool
        } = {}) {
            const write = await query(executor, `
                INSERT INTO BuilderImportReceipts
                    (MemberId, IdempotencyKey, ResultPayload, CreatedOn)
                VALUES (?, ?, ?, ?)`, [
                memberId,
                idempotencyKey,
                JSON.stringify(result),
                createdOn
            ]);
            return write.insertId;
        }
    };
}

module.exports = {createBuilderProfileRepository};
