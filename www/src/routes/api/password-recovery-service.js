"use strict";

const crypto = require("crypto");
const gql = require("graphql");
const {
    createActionToken,
    hashValidator,
    parseActionToken
} = require("./account-action-token");
const {query, withTransaction} = require("./database");
const passwords = require("./php-password");
const {BadRequestError} = require("./utils");

const RESET_LIFETIME_MS = 60 * 60 * 1000;
const TOKEN_RETENTION_MS = 24 * 60 * 60 * 1000;
const ACCEPTED_RESULT = Object.freeze({accepted: true});
const INVALID_RESET_MESSAGE = "This password reset link is invalid or expired.";

const SELECT_RECOVERY_MEMBER = `
    SELECT Id, Username, Email, NormalizedEmail, EmailVerifiedOn
    FROM Members
    WHERE Banned = 0 AND (
        Username = ? OR
        (NormalizedEmail = ? AND EmailVerifiedOn IS NOT NULL)
    )
    ORDER BY CASE WHEN Username = ? THEN 0 ELSE 1 END
    LIMIT 1
    FOR UPDATE`;
const DELETE_OLD_TOKENS = `
    DELETE FROM AccountActionTokens
    WHERE (ConsumedOn IS NOT NULL AND ConsumedOn < ?) OR ExpiresOn < ?`;
const INVALIDATE_RESET_TOKENS = `
    UPDATE AccountActionTokens
    SET ConsumedOn = ?
    WHERE MemberId = ? AND Purpose = ? AND ConsumedOn IS NULL`;
const INSERT_RESET_TOKEN = `
    INSERT INTO AccountActionTokens
        (MemberId, Purpose, Selector, HashedValidator,
         RequestIPHash, CreatedOn, ExpiresOn)
    VALUES (?, ?, ?, ?, ?, ?, ?)`;
const SELECT_RESET_TOKEN = `
    SELECT T.Id, T.MemberId, T.HashedValidator, T.ExpiresOn, T.ConsumedOn,
        M.Username, M.Email, M.EmailVerifiedOn
    FROM AccountActionTokens T
    JOIN Members M ON M.Id = T.MemberId
    WHERE T.Selector = ? AND T.Purpose = 'password-reset'
    FOR UPDATE`;
const UPDATE_PASSWORD = "UPDATE Members SET Password = ?, PendingEmail = NULL, " +
    "PendingNormalizedEmail = NULL WHERE Id = ?";
const DELETE_MEMBER_SESSIONS = "DELETE FROM AuthTokens WHERE MemberId = ?";
const CONSUME_MEMBER_ACTION_TOKENS = `
    UPDATE AccountActionTokens SET ConsumedOn = ?
    WHERE MemberId = ? AND ConsumedOn IS NULL`;

class InvalidResetTokenError extends Error {}

function createPasswordRecoveryService({
    pool,
    mailer,
    rateLimiter,
    clock = () => new Date(),
    randomBytes = crypto.randomBytes
}) {
    return {requestRecovery, resetPassword};

    async function requestRecovery({identity, ipHash}) {
        const normalizedIdentity = normalizeRecoveryIdentity(identity);

        try {
            await rateLimiter.recordAndCheck({
                purpose: "password-reset",
                identity: normalizedIdentity.normalized,
                ipHash
            });
        }
        catch {
            return {...ACCEPTED_RESULT};
        }

        const now = clock();
        let delivery;
        try {
            await withTransaction(pool, async function(connection) {
                const members = await query(connection, SELECT_RECOVERY_MEMBER, [
                    normalizedIdentity.raw,
                    normalizedIdentity.normalized,
                    normalizedIdentity.raw
                ]);
                const member = members[0];
                if (!member || !member.Email || !member.EmailVerifiedOn)
                    return;

                const resetToken = createActionToken({
                    randomBytes,
                    now,
                    lifetimeMs: RESET_LIFETIME_MS
                });
                await cleanupActionTokens(connection, now);
                await query(connection, INVALIDATE_RESET_TOKENS, [
                    now,
                    member.Id,
                    "password-reset"
                ]);
                await query(connection, INSERT_RESET_TOKEN, [
                    member.Id,
                    "password-reset",
                    resetToken.selector,
                    resetToken.hashedValidator,
                    ipHash,
                    now,
                    resetToken.expiresOn
                ]);
                delivery = {
                    to: member.Email,
                    username: member.Username,
                    token: resetToken.token
                };
            });
        }
        catch {
            return {...ACCEPTED_RESULT};
        }

        if (delivery)
            schedulePasswordResetDelivery(mailer, delivery);
        return {...ACCEPTED_RESULT};
    }

    async function resetPassword({token, newPassword}) {
        validateNewPassword(newPassword);
        if (typeof token !== "string" ||
            !/^[0-9a-f]{12}-[0-9a-f]{48}$/.test(token)) {
            throw invalidResetError();
        }

        const parsedToken = parseActionToken(token);
        const passwordHash = passwords.hash(newPassword);
        const now = clock();
        let outcome;
        try {
            outcome = await withTransaction(pool, async function(connection) {
                await cleanupActionTokens(connection, now);
                const tokens = await query(connection, SELECT_RESET_TOKEN, [
                    parsedToken.selector
                ]);
                const storedToken = tokens[0];
                if (!isUsableResetToken(storedToken, parsedToken.validator, now))
                    return {invalid: true};

                const passwordUpdate = await query(connection, UPDATE_PASSWORD, [
                    passwordHash,
                    storedToken.MemberId
                ]);
                if (Number(passwordUpdate.affectedRows) !== 1)
                    throw new Error("Member password update failed");

                await query(connection, DELETE_MEMBER_SESSIONS, [storedToken.MemberId]);
                const consumption = await query(connection, CONSUME_MEMBER_ACTION_TOKENS, [
                    now,
                    storedToken.MemberId
                ]);
                if (Number(consumption.affectedRows) < 1)
                    throw new InvalidResetTokenError();

                return {notice: {
                    to: storedToken.Email,
                    username: storedToken.Username
                }};
            });
        }
        catch (error) {
            if (error instanceof InvalidResetTokenError)
                throw invalidResetError();
            throw new gql.GraphQLError("Password reset failed.");
        }

        if (outcome.invalid)
            throw invalidResetError();

        try {
            await mailer.sendPasswordChanged(outcome.notice);
        }
        catch {
            // Password and session invalidation are already committed.
        }
        return {success: true};
    }
}

function normalizeRecoveryIdentity(identity) {
    const raw = typeof identity === "string" ? identity : "";
    if (!raw || Buffer.byteLength(raw, "utf8") > 254 ||
        /[\u0000-\u001f\u007f]/.test(raw)) {
        throw new BadRequestError("Enter a username or email address.");
    }
    return {raw, normalized: raw.trim().toLowerCase()};
}

function validateNewPassword(password) {
    if (typeof password !== "string" || password.length < 8)
        throw new gql.GraphQLError("Password must be larger than 8 characters.");
}

function invalidResetError() {
    return new gql.GraphQLError(INVALID_RESET_MESSAGE);
}

function isUsableResetToken(storedToken, validator, now) {
    if (!storedToken || storedToken.ConsumedOn ||
        new Date(storedToken.ExpiresOn).getTime() <= now.getTime() ||
        typeof storedToken.HashedValidator !== "string" ||
        !/^[0-9a-f]{64}$/.test(storedToken.HashedValidator)) {
        return false;
    }

    const suppliedHash = Buffer.from(hashValidator(validator), "hex");
    const storedHash = Buffer.from(storedToken.HashedValidator, "hex");
    return suppliedHash.length === storedHash.length &&
        crypto.timingSafeEqual(suppliedHash, storedHash);
}

async function cleanupActionTokens(connection, now) {
    const retentionCutoff = new Date(now.getTime() - TOKEN_RETENTION_MS);
    await query(connection, DELETE_OLD_TOKENS, [
        retentionCutoff,
        retentionCutoff
    ]);
}

function schedulePasswordResetDelivery(mailer, delivery) {
    void Promise.resolve()
        .then(() => mailer.sendPasswordReset(delivery))
        .catch(function() {
            // Delivery is best effort after commit. The handled rejection stays
            // out of request timing, public responses, and process diagnostics.
        });
}

module.exports = {createPasswordRecoveryService};
