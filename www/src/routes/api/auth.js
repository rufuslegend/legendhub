let mysql = require("./mysql-connection");
let gql = require("graphql");
let { GraphQLDateTime } = require("graphql-scalars");
let phpPass = require("./php-password");
let crypto = require("crypto");
let apiUtils = require("./utils");
let {createAccountEmailService} = require("./account-email-service");
let {createPasswordRecoveryService} = require("./password-recovery-service");
let {createAccountRateLimiter} = require("./account-rate-limit");
let {query, withTransaction} = require("./database");
let {createMailer, readMailConfig} = require("../../mail");

let accountEmailService = createAccountEmailService({
    pool: mysql,
    mailer: {
        sendVerification: function(message) {
            return createMailer({config: readMailConfig(process.env)})
                .sendVerification(message);
        }
    },
    rateLimiter: createAccountRateLimiter({pool: mysql})
});

let passwordRecoveryService = createPasswordRecoveryService({
    pool: mysql,
    mailer: {
        sendPasswordReset: function(message) {
            return createMailer({config: readMailConfig(process.env)})
                .sendPasswordReset(message);
        },
        sendPasswordChanged: function(message) {
            return createMailer({config: readMailConfig(process.env)})
                .sendPasswordChanged(message);
        }
    },
    rateLimiter: createAccountRateLimiter({pool: mysql})
});

let getIPFromRequest = function(request) {
    let ip = (request.headers['x-forwarded-for'] || "").split(",")[0];
    return crypto.createHash("sha1").update(ip).digest("hex");
}

class InvalidLoginError extends Error {}
class InvalidSessionTokenError extends Error {}

let authLogin = async function(identity, password, stayLoggedIn, ip) {
    if (apiUtils.isIPBlocked(ip))
        return new gql.GraphQLError("Too many failed attempts. Try again later.");
    if (typeof password !== "string")
        throw new gql.GraphQLError("Invalid username or password.");

    const trimmedIdentity = typeof identity === "string" ? identity.trim() : "";
    const emailIdentity = trimmedIdentity.includes("@");
    const lookup = emailIdentity
        ? `SELECT Id, Password, Banned FROM Members
            WHERE Username = ?
                OR (NormalizedEmail = ? AND EmailVerifiedOn IS NOT NULL)
            ORDER BY CASE WHEN Username = ? THEN 0 ELSE 1 END
            LIMIT 1
            FOR UPDATE`
        : `SELECT Id, Password, Banned FROM Members
            WHERE Username = ?
            FOR UPDATE`;
    const lookupValues = emailIdentity
        ? [trimmedIdentity, trimmedIdentity.toLowerCase(), trimmedIdentity]
        : [trimmedIdentity];

    try {
        return await withTransaction(mysql, async function(connection) {
            const results = await query(connection, lookup, lookupValues);
            const member = results.find(result =>
                !result.Banned && phpPass.verify(password, result.Password));
            if (!member)
                throw new InvalidLoginError();

            await query(connection,
                "UPDATE Members SET LastLoginDate = NOW(), LastLoginIP = ? WHERE Id = ?",
                [ip, member.Id]);

            const token = crypto.randomBytes(24).toString("hex");
            const selector = crypto.randomBytes(6).toString("hex");
            const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
            const futureDate = new Date();
            if (stayLoggedIn)
                futureDate.setDate(futureDate.getDate() + 30);
            else
                futureDate.setDate(futureDate.getDate() + 1);

            await query(connection,
                "INSERT INTO AuthTokens (Selector, HashedValidator, MemberId, StayLoggedIn, Expires) VALUES (?, ?, ?, ?, ?)",
                [selector, tokenHash, member.Id, stayLoggedIn, futureDate]);

            return {
                token: `${selector}-${token}`,
                expires: stayLoggedIn ? futureDate : null
            };
        });
    }
    catch (error) {
        if (error instanceof InvalidLoginError)
            apiUtils.trackLogin(ip);
        throw new gql.GraphQLError("Invalid username or password.");
    }
};

const SELECT_AUTH_TOKEN = `
    SELECT AT.Id, M.Id AS MemberId, M.Username,
        M.Email, M.EmailVerifiedOn, M.PendingEmail, M.StorageNamespace,
        AT.HashedValidator, AT.Expires, AT.StayLoggedIn, M.Banned
    FROM AuthTokens AT
    JOIN Members M ON M.Id = AT.MemberId
    WHERE M.Banned = 0 AND AT.Expires > NOW() AND
        AT.Selector = ?`;
const DISCOVER_AUTH_TOKEN_MEMBER = `
    SELECT AT.MemberId
    FROM AuthTokens AT
    JOIN Members M ON M.Id = AT.MemberId
    WHERE M.Banned = 0 AND AT.Expires > NOW() AND AT.Selector = ?
    LIMIT 1`;
const LOCK_AUTH_MEMBER = `
    SELECT Id FROM Members WHERE Id = ? AND Banned = 0 FOR UPDATE`;

let authToken = async function(token, ip, renew, shouldGetPermissions) {
    if (renew === undefined)
        renew = true;
    if (shouldGetPermissions === undefined)
        shouldGetPermissions = false;

    if (token == null || token == "undefined")
        throw new gql.GraphQLError("Invalid token");
    const tokenInfo = token.split("-");
    if (tokenInfo.length != 2)
        throw new gql.GraphQLError("Invalid token");

    let response;
    try {
        if (renew) {
            response = await withTransaction(mysql, async function(connection) {
                const discovered = await query(connection, DISCOVER_AUTH_TOKEN_MEMBER, [
                    tokenInfo[0]
                ]);
                if (!discovered[0])
                    throw new InvalidSessionTokenError();

                const members = await query(connection, LOCK_AUTH_MEMBER, [
                    discovered[0].MemberId
                ]);
                if (!members[0])
                    throw new InvalidSessionTokenError();

                return authenticateToken(connection, token, tokenInfo, ip, true);
            });
        }
        else {
            response = await authenticateToken(mysql, token, tokenInfo, ip, false);
        }
    }
    catch {
        throw new gql.GraphQLError("Invalid token");
    }

    if (shouldGetPermissions)
        response.permissions = await getPermissions(response.memberId);
    return response;
};

async function authenticateToken(executor, token, tokenInfo, ip, renew) {
    const results = await query(
        executor,
        renew ? `${SELECT_AUTH_TOKEN}\nFOR UPDATE` : SELECT_AUTH_TOKEN,
        [tokenInfo[0]]
    );
    const tokenHash = crypto.createHash("sha256").update(tokenInfo[1]).digest("hex");
    const storedToken = results.find(result =>
        tokenHash === result.HashedValidator);
    if (!storedToken)
        throw new InvalidSessionTokenError();

    if (renew) {
        await query(executor,
            "UPDATE Members SET LastLoginDate = NOW(), LastLoginIP = ? WHERE Id = ?",
            [ip, storedToken.MemberId]);
    }
    else {
        mysql.query(
            "UPDATE Members SET LastLoginDate = NOW(), LastLoginIP = ? WHERE Id = ?",
            [ip, storedToken.MemberId],
            function() {}
        );
    }

    const response = {
        memberId: storedToken.MemberId,
        username: storedToken.Username,
        email: storedToken.Email,
        emailVerified: Boolean(storedToken.EmailVerifiedOn),
        pendingEmail: storedToken.PendingEmail,
        storageNamespace: storedToken.StorageNamespace,
        ip
    };

    if (!renew) {
        response.token = token;
        response.expires = storedToken.StayLoggedIn ? storedToken.Expires : null;
        return response;
    }

    const newToken = crypto.randomBytes(24).toString("hex");
    const newSelector = crypto.randomBytes(6).toString("hex");
    const newTokenHash = crypto.createHash("sha256").update(newToken).digest("hex");
    let futureDate = storedToken.Expires;
    if (storedToken.StayLoggedIn) {
        futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + 30);
    }

    await query(executor,
        "INSERT INTO AuthTokens (Selector, HashedValidator, MemberId, StayLoggedIn, Expires) VALUES (?, ?, ?, ?, ?)",
        [
            newSelector,
            newTokenHash,
            storedToken.MemberId,
            storedToken.StayLoggedIn,
            futureDate
        ]);
    const deletion = await query(executor,
        "DELETE FROM AuthTokens WHERE Id = ?",
        [storedToken.Id]);
    if (Number(deletion.affectedRows) !== 1)
        throw new InvalidSessionTokenError();

    response.token = `${newSelector}-${newToken}`;
    response.expires = storedToken.StayLoggedIn ? futureDate : null;
    return response;
}

let authMutation = function(req, token, shouldGetPermissions) {
    return authApi(req, token, shouldGetPermissions, true);
};

let authQuery = function(req, token, shouldGetPermissions) {
    return authApi(req, token, shouldGetPermissions, false);
};

let authApi = function(req, token, shouldGetPermissions, renew) {
    return new Promise(function(resolve, reject) {
        let ip = getIPFromRequest(req);
        if (apiUtils.isIPBlocked(ip)) {
            reject(new apiUtils.TooManyRequestsError("Too many attempts. Try again later."));
        }
        else {
            authToken(token, ip, renew, shouldGetPermissions).then(
                function(response) {
                    resolve(response);
                }
            ).catch(
                function(reason) {
                    reject(new apiUtils.UnauthorizedError(reason));
                }
            )
        }
    });
};

let logout = function(token) {
    if (!token)
        return;

    let tokenInfo = token.split("-");
    mysql.query("DELETE FROM AuthTokens WHERE Selector = ?",
        [tokenInfo[0]],
        function(error, results, fields) {});
}

let getPermissions = function(memberId) {
    return new Promise(function(resolve, reject) {
        mysql.query(`SELECT P.Name, RPM.Create, RPM.Read, RPM.Update, RPM.Delete
            FROM MemberRoleMap MRM
            JOIN RolePermissionMap RPM ON RPM.RoleId = MRM.RoleId
            JOIN Permissions P on P.Id = RPM.PermissionId
            WHERE MRM.MemberId = ?`,
            [memberId],
            function(error, results, fields) {
                if (error) {
                    reject(new gql.GraphQLError("Unable to load permissions."));
                    return;
                }

                let permissionDict = {};
                for (let i = 0; i < results.length; ++i) {
                    permissionDict[results[i].Name] = {
                        create: results[i].Create,
                        read: results[i].Read,
                        update: results[i].Update,
                        delete: results[i].Delete
                    };
                }

                permissionDict.hasPermission = function(name, create, read, update, del) {
                    if (!this.hasOwnProperty(name))
                        return false;

                    if (create && !this[name].create)
                        return false;

                    if (read && !this[name].read)
                        return false;

                    if (update && !this[name].update)
                        return false;

                    if (del && !this[name]["delete"])
                        return false;

                    return true;
                }
                resolve(permissionDict);
            });
    });
};

let register = async function(username, email, password, recaptcha, ip) {
    if (apiUtils.isIPBlocked(ip))
        return new gql.GraphQLError("Too many attempts. Try again later.");

    let recaptchaResponse;
    try {
        recaptchaResponse = await verifyReCAPTCHA(recaptcha);
    }
    catch (e) {
        return new gql.GraphQLError("reCAPTCHA verification unavailable.");
    }

    if (!recaptchaResponse) {
        return new gql.GraphQLError("reCAPTCHA failed.");
    }

    if (typeof username !== "string" || !/^[A-Za-z0-9]+$/.test(username))
        return new gql.GraphQLError("Username may contain only letters and numbers.");
    if (username.toLowerCase() === "dataimport")
        return new gql.GraphQLError("Username taken.");
    if (username.length < 5 || username.length > 25)
        return new gql.GraphQLError("Username must be between 5 and 25 characters.");
    if (typeof password !== "string" || password.length < 8)
        return new gql.GraphQLError("Password must be larger than 8 characters.");

    const result = await accountEmailService.register({
        username,
        email,
        passwordHash: phpPass.hash(password),
        recaptchaVerified: true,
        ipHash: ip
    });
    apiUtils.trackRegister(ip);
    return result.registered;
};

let verifyReCAPTCHA = async function(recaptcha) {
    const response = await fetch("https://www.google.com/recaptcha/api/siteverify", {
        method: "POST",
        body: new URLSearchParams({
            secret: process.env.RECAPTCHA_SECRET,
            response: recaptcha
        })
    });
    const body = await response.json();
    return body.success;
};

let tokenRenewalType = new gql.GraphQLObjectType({
    name: "TokenRenewal",
    fields: () => ({
        token: { type: new gql.GraphQLNonNull(gql.GraphQLString) },
        expires: { type: GraphQLDateTime }
    })
});

let idMutationResponseType = new gql.GraphQLObjectType({
    name: "IdMutationResponse",
    fields: () => ({
        id: { type: new gql.GraphQLNonNull(gql.GraphQLInt)  },
        tokenRenewal: { type: new gql.GraphQLNonNull(tokenRenewalType) },
    })
});

let mFields = {
    authLogin: {
        type: new gql.GraphQLNonNull(tokenRenewalType),
        args: {
            identity: {type: gql.GraphQLString},
            username: {type: gql.GraphQLString},
            password: {type: gql.GraphQLString},
            stayLoggedIn: {type: gql.GraphQLBoolean}
        },
        resolve: function(_, {identity, username, password, stayLoggedIn}, req) {
            return authLogin(identity || username, password, stayLoggedIn, getIPFromRequest(req));
        }
    },
    register: {
        type: new gql.GraphQLNonNull(gql.GraphQLBoolean),
        args: {
            username: {type: gql.GraphQLString},
            email: {type: new gql.GraphQLNonNull(gql.GraphQLString)},
            password: {type: gql.GraphQLString},
            recaptcha: {type: gql.GraphQLString}
        },
        resolve: function(_, {username, email, password, recaptcha}, req) {
            return register(username, email, password, recaptcha, getIPFromRequest(req));
        }
    },
    requestPasswordRecovery: {
        type: new gql.GraphQLNonNull(gql.GraphQLBoolean),
        args: {
            identity: {type: new gql.GraphQLNonNull(gql.GraphQLString)}
        },
        resolve: async function(_, {identity}, req) {
            const result = await passwordRecoveryService.requestRecovery({
                identity,
                ipHash: getIPFromRequest(req)
            });
            return result.accepted;
        }
    },
    resetPassword: {
        type: new gql.GraphQLNonNull(gql.GraphQLBoolean),
        args: {
            token: {type: new gql.GraphQLNonNull(gql.GraphQLString)},
            newPassword: {type: new gql.GraphQLNonNull(gql.GraphQLString)}
        },
        resolve: async function(_, {token, newPassword}) {
            const result = await passwordRecoveryService.resetPassword({
                token,
                newPassword
            });
            return result.success;
        }
    }
};

module.exports.mutationFields = mFields;
module.exports.types = { tokenRenewalType, idMutationResponseType };
module.exports.utils = { getIPFromRequest, authLogin, authToken, authQuery, authMutation, logout, getPermissions };
module.exports.passwordRecoveryService = passwordRecoveryService;
