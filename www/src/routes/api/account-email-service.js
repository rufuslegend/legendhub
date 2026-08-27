"use strict";

const crypto = require("crypto");
const gql = require("graphql");
const {
    createActionToken,
    hashValidator,
    parseActionToken
} = require("./account-action-token");
const {query, withTransaction} = require("./database");
const {normalizeEmail} = require("./email-address");
const passwords = require("./php-password");
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
const SELECT_OTHER_EMAIL_CLAIM = `
    SELECT Id FROM Members
    WHERE (NormalizedEmail = ? OR PendingNormalizedEmail = ?) AND Id <> ?
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
const SELECT_MEMBER_FOR_EMAIL_CHANGE = `
    SELECT Id, Username, Password, Email, NormalizedEmail, EmailVerifiedOn,
        PendingEmail, PendingNormalizedEmail
    FROM Members
    WHERE Id = ?
    FOR UPDATE`;
const SELECT_MEMBER_FOR_VERIFICATION = `
    SELECT Id, Username, Email, NormalizedEmail, EmailVerifiedOn,
        PendingEmail, PendingNormalizedEmail
    FROM Members
    WHERE Id = ?
    FOR UPDATE`;
const UPDATE_PENDING_EMAIL = `
    UPDATE Members
    SET PendingEmail = ?, PendingNormalizedEmail = ?
    WHERE Id = ?`;
const INVALIDATE_PURPOSE_TOKENS = `
    UPDATE AccountActionTokens
    SET ConsumedOn = ?
    WHERE MemberId = ? AND Purpose = ? AND ConsumedOn IS NULL`;
const INVALIDATE_EMAIL_TOKENS = `
    UPDATE AccountActionTokens
    SET ConsumedOn = ?
    WHERE MemberId = ?
        AND Purpose IN ('verify-email', 'change-email')
        AND ConsumedOn IS NULL`;
const SELECT_VERIFICATION_TOKEN = `
    SELECT Id, MemberId, Purpose, HashedValidator, PendingEmail,
        PendingNormalizedEmail, ExpiresOn, ConsumedOn
    FROM AccountActionTokens
    WHERE Selector = ?
        AND Purpose IN ('verify-email', 'change-email')
    FOR UPDATE`;
const PROMOTE_PENDING_EMAIL = `
    UPDATE Members
    SET Email = ?, NormalizedEmail = ?, EmailVerifiedOn = ?,
        PendingEmail = NULL, PendingNormalizedEmail = NULL
    WHERE Id = ?`;
const VERIFY_ACTIVE_EMAIL = `
    UPDATE Members SET EmailVerifiedOn = ? WHERE Id = ?`;

const INVALID_VERIFICATION_RESULT = Object.freeze({
    success: false,
    message: "This verification link is invalid or has expired."
});

class InvalidCurrentPasswordError extends Error {}

function createAccountEmailService({
    pool,
    mailer,
    rateLimiter,
    clock = () => new Date(),
    randomBytes = crypto.randomBytes
}) {
    return {
        getAccountEmailStatus,
        register,
        requestEmailChange,
        resendVerification,
        verifyEmailToken
    };

    function getAccountEmailStatus(auth) {
        const email = typeof auth?.email === "string" ? auth.email : null;
        const verified = Boolean(email && auth?.emailVerified);
        return {
            email,
            verified,
            pendingEmail: typeof auth?.pendingEmail === "string" ? auth.pendingEmail : null,
            canUseAccountStorage: verified
        };
    }

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

                    await cleanupActionTokens(connection, now);
                    await insertVerificationToken(connection, {
                        memberId,
                        purpose: "verify-email",
                        verification,
                        pendingEmail: null,
                        pendingNormalizedEmail: null,
                        ipHash,
                        now
                    });
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

    async function requestEmailChange({auth, currentPassword, email, ipHash}) {
        if (!auth?.memberId || typeof currentPassword !== "string")
            return {success: false, pendingEmail: auth?.pendingEmail || null};

        const address = normalizeEmail(email);
        const now = clock();
        let verification;

        try {
            await rateLimiter.recordAndCheck({
                purpose: "change-email",
                identity: address.normalized,
                ipHash
            });
            await withNormalizedEmailLock(pool, address.normalized, async function(transactionPool) {
                await withTransaction(transactionPool, async function(connection) {
                    const members = await query(connection, SELECT_MEMBER_FOR_EMAIL_CHANGE, [
                        auth.memberId
                    ]);
                    const member = members[0];
                    if (!member || !passwords.verify(currentPassword, member.Password))
                        throw new InvalidCurrentPasswordError();

                    const existing = await query(connection, SELECT_OTHER_EMAIL_CLAIM, [
                        address.normalized,
                        address.normalized,
                        auth.memberId
                    ]);
                    if (existing.length > 0)
                        throw new ConflictError("Email address unavailable.");

                    verification = createActionToken({
                        randomBytes,
                        now,
                        lifetimeMs: VERIFICATION_LIFETIME_MS
                    });
                    await query(connection, UPDATE_PENDING_EMAIL, [
                        address.display,
                        address.normalized,
                        auth.memberId
                    ]);
                    await cleanupActionTokens(connection, now);
                    await query(connection, INVALIDATE_EMAIL_TOKENS, [now, auth.memberId]);
                    await insertVerificationToken(connection, {
                        memberId: auth.memberId,
                        purpose: "change-email",
                        verification,
                        pendingEmail: address.display,
                        pendingNormalizedEmail: address.normalized,
                        ipHash,
                        now
                    });
                });
            });
        }
        catch (error) {
            if (error instanceof InvalidCurrentPasswordError) {
                return {success: false, pendingEmail: auth.pendingEmail || null};
            }
            if (error instanceof BadRequestError || error instanceof ConflictError ||
                error?.extensions?.code === 429) {
                throw error;
            }
            throw new gql.GraphQLError("Account email update failed.");
        }

        try {
            await mailer.sendEmailChanged({
                to: address.display,
                username: auth.username,
                token: verification.token
            });
        }
        catch {
            // The pending claim and resendable token are already committed.
        }

        return {success: true, pendingEmail: address.display};
    }

    async function resendVerification({auth, ipHash}) {
        if (!auth?.memberId)
            return {accepted: true};

        const now = clock();
        let delivery;
        let verification;

        try {
            await withTransaction(pool, async function(connection) {
                const members = await query(connection, SELECT_MEMBER_FOR_VERIFICATION, [
                    auth.memberId
                ]);
                const member = members[0];
                if (!member)
                    return;

                if (member.PendingEmail) {
                    const pendingAddress = normalizeEmail(member.PendingEmail);
                    delivery = {
                        purpose: "change-email",
                        address: pendingAddress,
                        pendingEmail: pendingAddress.display,
                        pendingNormalizedEmail: pendingAddress.normalized
                    };
                }
                else if (member.Email && !member.EmailVerifiedOn) {
                    const activeAddress = normalizeEmail(member.Email);
                    delivery = {
                        purpose: "verify-email",
                        address: activeAddress,
                        pendingEmail: null,
                        pendingNormalizedEmail: null
                    };
                }
                else {
                    return;
                }

                await rateLimiter.recordAndCheck({
                    purpose: delivery.purpose,
                    identity: delivery.address.normalized,
                    ipHash,
                    connection
                });
                verification = createActionToken({
                    randomBytes,
                    now,
                    lifetimeMs: VERIFICATION_LIFETIME_MS
                });
                await cleanupActionTokens(connection, now);
                await query(connection, INVALIDATE_PURPOSE_TOKENS, [
                    now,
                    auth.memberId,
                    delivery.purpose
                ]);
                await insertVerificationToken(connection, {
                    memberId: auth.memberId,
                    purpose: delivery.purpose,
                    verification,
                    pendingEmail: delivery.pendingEmail,
                    pendingNormalizedEmail: delivery.pendingNormalizedEmail,
                    ipHash,
                    now
                });
            });
        }
        catch (error) {
            if (error?.extensions?.code === 429)
                throw error;
            throw new gql.GraphQLError("Verification could not be resent.");
        }

        if (!delivery)
            return {accepted: true};

        try {
            const message = {
                to: delivery.address.display,
                username: auth.username,
                token: verification.token
            };
            if (delivery.purpose === "change-email")
                await mailer.sendEmailChanged(message);
            else
                await mailer.sendVerification(message);
        }
        catch {
            // The replacement token remains committed for a later resend.
        }
        return {accepted: true};
    }

    async function verifyEmailToken(token) {
        if (typeof token !== "string" ||
            !/^[0-9a-f]{12}-[0-9a-f]{48}$/.test(token)) {
            return {...INVALID_VERIFICATION_RESULT};
        }

        const parsed = parseActionToken(token);
        const now = clock();
        let outcome;
        try {
            outcome = await withTransaction(pool, async function(connection) {
                await cleanupActionTokens(connection, now);
                const tokens = await query(connection, SELECT_VERIFICATION_TOKEN, [
                    parsed.selector
                ]);
                const storedToken = tokens[0];
                if (!isUsableVerificationToken(storedToken, parsed.validator, now))
                    return {result: {...INVALID_VERIFICATION_RESULT}};

                const members = await query(connection, SELECT_MEMBER_FOR_VERIFICATION, [
                    storedToken.MemberId
                ]);
                const member = members[0];
                if (!member)
                    return {result: {...INVALID_VERIFICATION_RESULT}};

                let notice = null;
                if (storedToken.Purpose === "change-email") {
                    if (!storedToken.PendingEmail || !storedToken.PendingNormalizedEmail ||
                        member.PendingNormalizedEmail !== storedToken.PendingNormalizedEmail) {
                        return {result: {...INVALID_VERIFICATION_RESULT}};
                    }

                    await query(connection, PROMOTE_PENDING_EMAIL, [
                        storedToken.PendingEmail,
                        storedToken.PendingNormalizedEmail,
                        now,
                        member.Id
                    ]);
                    if (member.EmailVerifiedOn && member.Email &&
                        member.NormalizedEmail !== storedToken.PendingNormalizedEmail) {
                        notice = {
                            to: member.Email,
                            username: member.Username
                        };
                    }
                }
                else if (storedToken.Purpose === "verify-email") {
                    if (!member.Email || member.PendingEmail)
                        return {result: {...INVALID_VERIFICATION_RESULT}};
                    await query(connection, VERIFY_ACTIVE_EMAIL, [now, member.Id]);
                }
                else {
                    return {result: {...INVALID_VERIFICATION_RESULT}};
                }

                await query(connection, INVALIDATE_EMAIL_TOKENS, [now, member.Id]);
                return {
                    result: {
                        success: true,
                        message: "Your email address has been verified."
                    },
                    notice
                };
            });
        }
        catch {
            throw new gql.GraphQLError("Email verification failed.");
        }

        if (outcome.notice) {
            try {
                await mailer.sendEmailChangeNotice(outcome.notice);
            }
            catch {
                // Verification is committed; notification delivery is best effort.
            }
        }
        return outcome.result;
    }

    async function cleanupActionTokens(connection, now) {
        const retentionCutoff = new Date(now.getTime() - TOKEN_RETENTION_MS);
        await query(connection, DELETE_OLD_TOKENS, [
            retentionCutoff,
            retentionCutoff
        ]);
    }

    function insertVerificationToken(connection, {
        memberId,
        purpose,
        verification,
        pendingEmail,
        pendingNormalizedEmail,
        ipHash,
        now
    }) {
        return query(connection, INSERT_VERIFICATION_TOKEN, [
            memberId,
            purpose,
            verification.selector,
            verification.hashedValidator,
            pendingEmail,
            pendingNormalizedEmail,
            ipHash,
            now,
            verification.expiresOn
        ]);
    }
}

function isUsableVerificationToken(storedToken, validator, now) {
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
