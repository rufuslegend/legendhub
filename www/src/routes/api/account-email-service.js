"use strict";

const crypto = require("crypto");
const gql = require("graphql");
const {createActionToken} = require("./account-action-token");
const {query, withTransaction} = require("./database");
const {normalizeEmail} = require("./email-address");
const {BadRequestError, ConflictError} = require("./utils");

const VERIFICATION_LIFETIME_MS = 24 * 60 * 60 * 1000;
const TOKEN_RETENTION_MS = 24 * 60 * 60 * 1000;
const ACQUIRE_EMAIL_LOCK =
    "SELECT GET_LOCK(SHA2(?, 256), 10) AS Acquired";
const RELEASE_EMAIL_LOCK =
    "SELECT RELEASE_LOCK(SHA2(?, 256)) AS Released";
const SELECT_EMAIL_CLAIM = `
    SELECT Id FROM Members
    WHERE NormalizedEmail = ? OR PendingNormalizedEmail = ?
    FOR UPDATE`;
const SELECT_BANNED_IP =
    "SELECT Id FROM BannedIPs WHERE Pattern = ? FOR UPDATE";
const SELECT_USERNAME =
    "SELECT Id FROM Members WHERE Username = ? FOR UPDATE";
const INSERT_MEMBER = `
    INSERT INTO Members
        (Username, Password, Email, NormalizedEmail, EmailVerifiedOn, StorageNamespace)
    VALUES (?, ?, ?, ?, ?, ?)`;
const INSERT_ROLE =
    "INSERT INTO MemberRoleMap (MemberId, RoleId) VALUES (?, ?)";
const INSERT_NOTIFICATIONS =
    "INSERT INTO NotificationSettings (MemberId) VALUES (?)";
const DELETE_OLD_TOKENS = `
    DELETE FROM AccountActionTokens
    WHERE (ConsumedOn IS NOT NULL AND ConsumedOn < ?) OR ExpiresOn < ?`;
const INSERT_VERIFICATION_TOKEN = `
    INSERT INTO AccountActionTokens
        (MemberId, Purpose, Selector, HashedValidator,
         PendingEmail, PendingNormalizedEmail, RequestIPHash, CreatedOn, ExpiresOn)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function createAccountEmailService({
    pool,
    mailer,
    rateLimiter,
    clock = () => new Date(),
    randomBytes = crypto.randomBytes
}) {
    return {register};

    async function register({
        username,
        email,
        passwordHash,
        recaptchaVerified,
        ipHash
    }) {
        if (!recaptchaVerified)
            throw new BadRequestError("reCAPTCHA failed.");

        const address = normalizeEmail(email);
        const now = clock();
        const verification = createActionToken({
            randomBytes,
            now,
            lifetimeMs: VERIFICATION_LIFETIME_MS
        });
        const storageNamespace = randomBytes(16).toString("hex");

        try {
            await rateLimiter.recordAndCheck({
                purpose: "verify-email",
                identity: address.normalized,
                ipHash
            });

            await withNormalizedEmailLock(pool, address.normalized, async function(transactionPool) {
                await withTransaction(transactionPool, async function(connection) {
                    const existing = await query(connection, SELECT_EMAIL_CLAIM, [
                        address.normalized,
                        address.normalized
                    ]);
                    if (existing.length > 0)
                        throw new ConflictError("Email address unavailable.");

                    const bannedIPs = await query(connection, SELECT_BANNED_IP, [ipHash]);
                    if (bannedIPs.length > 0)
                        throw new BadRequestError("Invalid username.");

                    const usernames = await query(connection, SELECT_USERNAME, [username]);
                    if (usernames.length > 0)
                        throw new ConflictError("Username taken.");

                    const member = await query(connection, INSERT_MEMBER, [
                        username,
                        passwordHash,
                        address.display,
                        address.normalized,
                        null,
                        storageNamespace
                    ]);
                    const memberId = member.insertId;

                    await query(connection, INSERT_ROLE, [memberId, 2]);
                    await query(connection, INSERT_NOTIFICATIONS, [memberId]);

                    const retentionCutoff = new Date(now.getTime() - TOKEN_RETENTION_MS);
                    await query(connection, DELETE_OLD_TOKENS, [
                        retentionCutoff,
                        retentionCutoff
                    ]);
                    await query(connection, INSERT_VERIFICATION_TOKEN, [
                        memberId,
                        "verify-email",
                        verification.selector,
                        verification.hashedValidator,
                        null,
                        null,
                        ipHash,
                        now,
                        verification.expiresOn
                    ]);
                });
            });
        }
        catch (error) {
            if (error instanceof BadRequestError || error instanceof ConflictError ||
                error?.extensions?.code === 429) {
                throw error;
            }
            throw new gql.GraphQLError("Registration failed.");
        }

        try {
            await mailer.sendVerification({
                to: address.display,
                username,
                token: verification.token
            });
        }
        catch {
            // The account and resendable token are already committed. Delivery
            // details stay private; the registration page provides resend guidance.
        }

        return {registered: true};
    }
}

async function withNormalizedEmailLock(pool, normalizedEmail, operation) {
    const connection = await getConnection(pool);
    let acquired = false;
    let destroyed = false;
    try {
        const lockResult = await query(connection, ACQUIRE_EMAIL_LOCK, [normalizedEmail]);
        acquired = Number(lockResult[0]?.Acquired) === 1;
        if (!acquired)
            throw new Error("Email claim lock unavailable");

        const transactionPool = {
            getConnection: function(callback) {
                callback(null, transactionConnection(connection));
            }
        };
        return await operation(transactionPool);
    }
    finally {
        if (acquired) {
            try {
                await query(connection, RELEASE_EMAIL_LOCK, [normalizedEmail]);
            }
            catch {
                if (typeof connection.destroy === "function") {
                    connection.destroy();
                    destroyed = true;
                }
            }
        }
        if (!destroyed)
            connection.release();
    }
}

function transactionConnection(connection) {
    return {
        query: connection.query.bind(connection),
        beginTransaction: connection.beginTransaction.bind(connection),
        commit: connection.commit.bind(connection),
        rollback: connection.rollback.bind(connection),
        release: function() {}
    };
}

function getConnection(pool) {
    return new Promise(function(resolve, reject) {
        pool.getConnection(function(error, connection) {
            if (error)
                reject(error);
            else
                resolve(connection);
        });
    });
}

module.exports = {createAccountEmailService};
