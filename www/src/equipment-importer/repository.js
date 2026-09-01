"use strict";

const {EquipmentImportError} = require("./errors");
const {mapOfficialItem} = require("./item-mapper");

function acquire(pool) {
    return new Promise(function(resolve, reject) {
        pool.getConnection(function(error, connection) {
            if (error)
                reject(error);
            else
                resolve(connection);
        });
    });
}

function invoke(connection, method) {
    return new Promise(function(resolve, reject) {
        connection[method](function(error) {
            if (error)
                reject(error);
            else
                resolve();
        });
    });
}

function query(connection, sql, values = []) {
    return new Promise(function(resolve, reject) {
        connection.query(sql, values, function(error, results) {
            if (error)
                reject(error);
            else
                resolve(results);
        });
    });
}

function sameHash(left, right) {
    return Buffer.isBuffer(left) && Buffer.isBuffer(right) && left.equals(right);
}

function calculateNetStat(mapping, metadata) {
    let netStat = 0;
    for (const row of metadata) {
        const divisor = Number(row.NetStat);
        if (!Number.isFinite(divisor) || divisor === 0)
            continue;
        const value = Number(mapping.valueByVar[row.Var]);
        if (!Number.isFinite(value))
            throw new Error(`Official item mapping is missing net-stat field '${row.Var}'.`);
        netStat += value / divisor;
    }
    return netStat;
}

function normalizedAttribution(value) {
    return value.trim().normalize("NFC");
}

function createEquipmentRepository(pool) {
    if (!pool || typeof pool.getConnection !== "function")
        throw new TypeError("An equipment repository requires a MySQL pool.");

    return {
        async ingest(parsed, receivedAt = new Date()) {
            if (!(receivedAt instanceof Date) || Number.isNaN(receivedAt.getTime()))
                throw new TypeError("Equipment receipt time must be a valid Date.");
            const connection = await acquire(pool);
            let transactionStarted = false;
            try {
                await invoke(connection, "beginTransaction");
                transactionStarted = true;

                const server = parsed.document.source.server;
                const submission = parsed.document.submission;
                const prior = await query(connection, `
                    SELECT PayloadHash, ItemId
                    FROM EquipmentSubmissions
                    WHERE Server = ? AND SubmissionId = ?
                    FOR UPDATE
                `, [server, submission.id]);
                if (prior.length > 0) {
                    if (!sameHash(prior[0].PayloadHash, parsed.payloadHash)) {
                        throw new EquipmentImportError(
                            "submission_id_collision",
                            "The submission identity was already used for different content."
                        );
                    }
                    await invoke(connection, "commit");
                    transactionStarted = false;
                    return {status: "replay", itemId: prior[0].ItemId};
                }

                const variants = await query(connection, `
                    SELECT ItemId
                    FROM OfficialItemVariants
                    WHERE Server = ? AND Vnum = ? AND ItemFingerprint = ?
                    FOR UPDATE
                `, [server, parsed.normalizedItem.vnum, parsed.itemFingerprint]);

                let itemId;
                let status;
                if (variants.length > 0) {
                    itemId = variants[0].ItemId;
                    status = "duplicate";
                    await query(connection, `
                        UPDATE OfficialItemVariants
                        SET LastSeenOn = ?, ObservationCount = ObservationCount + 1
                        WHERE Server = ? AND Vnum = ? AND ItemFingerprint = ?
                    `, [receivedAt, server, parsed.normalizedItem.vnum,
                        parsed.itemFingerprint]);
                }
                else {
                    const mapping = mapOfficialItem(parsed.normalizedItem, server);
                    const metadata = await query(connection, `
                        SELECT Var, NetStat FROM ItemStatInfo
                        WHERE NetStat IS NOT NULL AND NetStat <> 0
                    `);
                    mapping.columns.push("NetStat", "ModifiedOn");
                    mapping.values.push(calculateNetStat(mapping, metadata), receivedAt);
                    const inserted = await query(connection,
                        "INSERT INTO Items (??) VALUES (?)",
                        [mapping.columns, mapping.values]);
                    itemId = inserted.insertId;
                    status = "created";
                    await query(connection, `
                        INSERT INTO OfficialItemVariants
                            (ItemId, Server, Vnum, ItemFingerprint, FirstSeenOn,
                                LastSeenOn, ObservationCount)
                        VALUES (?, ?, ?, ?, ?, ?, 1)
                    `, [itemId, server, parsed.normalizedItem.vnum,
                        parsed.itemFingerprint, receivedAt, receivedAt]);
                }

                const accountId = Object.hasOwn(submission.submitted_by, "account_id")
                    ? normalizedAttribution(submission.submitted_by.account_id)
                    : null;
                await query(connection, `
                    INSERT INTO EquipmentSubmissions
                        (Server, SubmissionId, PayloadHash, CanonicalPayload,
                            SourceTimestamp, ReceivedOn, SubmittedByCharacter,
                            SubmittedByAccountId, ItemId)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `, [
                    server,
                    submission.id,
                    parsed.payloadHash,
                    parsed.canonicalPayload,
                    parsed.sourceTimestamp,
                    receivedAt,
                    normalizedAttribution(submission.submitted_by.character),
                    accountId,
                    itemId
                ]);

                await invoke(connection, "commit");
                transactionStarted = false;
                return {status, itemId};
            }
            catch (error) {
                if (transactionStarted) {
                    try {
                        await invoke(connection, "rollback");
                    }
                    catch (rollbackError) {
                        error.rollbackError = rollbackError;
                    }
                }
                throw error;
            }
            finally {
                connection.release();
            }
        }
    };
}

module.exports = {calculateNetStat, createEquipmentRepository};
