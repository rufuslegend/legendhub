"use strict";

const crypto = require("crypto");
const {query, withTransaction} = require("./database");
const {TooManyRequestsError} = require("./utils");

const LIMITS = Object.freeze({minimumMs: 60_000, identityPerHour: 5, ipPerHour: 20});
const DAY_MS = 24 * 60 * 60 * 1000;

const SELECT_WITHIN_MINUTE = `
    SELECT COUNT(*) AS Count
    FROM AccountActionAttempts
    WHERE Purpose = ? AND IdentityHash = ?
        AND CreatedOn >= DATE_SUB(?, INTERVAL 1 MINUTE)
    FOR UPDATE`;
const SELECT_IDENTITY_HOUR = `
    SELECT COUNT(*) AS Count
    FROM AccountActionAttempts
    WHERE Purpose = ? AND IdentityHash = ?
        AND CreatedOn >= DATE_SUB(?, INTERVAL 1 HOUR)
    FOR UPDATE`;
const SELECT_IP_HOUR = `
    SELECT COUNT(*) AS Count
    FROM AccountActionAttempts
    WHERE Purpose = ? AND RequestIPHash = ?
        AND CreatedOn >= DATE_SUB(?, INTERVAL 1 HOUR)
    FOR UPDATE`;
const INSERT_ATTEMPT = `
    INSERT INTO AccountActionAttempts (Purpose, IdentityHash, RequestIPHash, CreatedOn)
    VALUES (?, ?, ?, ?)`;
const DELETE_OLD_ATTEMPTS = "DELETE FROM AccountActionAttempts WHERE CreatedOn < ?";

function createAccountRateLimiter({pool, clock = () => new Date()}) {
    return {recordAndCheck};

    async function recordAndCheck({purpose, identity, ipHash}) {
        const identityHash = crypto.createHash("sha256").update(identity).digest("hex");
        const now = clock();
        return withTransaction(pool, async function(connection) {
            const counts = await readCountsForUpdate(connection, purpose, identityHash, ipHash, now);
            if (counts.withinMinute ||
                counts.identityHour >= LIMITS.identityPerHour ||
                counts.ipHour >= LIMITS.ipPerHour) {
                throw new TooManyRequestsError("Try again later.");
            }

            await query(connection, INSERT_ATTEMPT, [purpose, identityHash, ipHash, now]);
            await query(connection, DELETE_OLD_ATTEMPTS, [new Date(now.getTime() - DAY_MS)]);
        });
    }
}

async function readCountsForUpdate(connection, purpose, identityHash, ipHash, now) {
    const [withinMinute, identityHour, ipHour] = await Promise.all([
        query(connection, SELECT_WITHIN_MINUTE, [purpose, identityHash, now]),
        query(connection, SELECT_IDENTITY_HOUR, [purpose, identityHash, now]),
        query(connection, SELECT_IP_HOUR, [purpose, ipHash, now])
    ]);
    return {
        withinMinute: Number(withinMinute[0].Count),
        identityHour: Number(identityHour[0].Count),
        ipHour: Number(ipHour[0].Count)
    };
}

module.exports = {createAccountRateLimiter, LIMITS};
