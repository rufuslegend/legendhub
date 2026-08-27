let mysql = require("./mysql-connection");
let gql = require("graphql");
let apiUtils = require("./utils");
let auth = require("./auth")
let {createAccountEmailService} = require("./account-email-service");
let {createAccountRateLimiter} = require("./account-rate-limit");
let {createMailer, readMailConfig} = require("../../mail");

function runtimeMailer() {
    return createMailer({config: readMailConfig(process.env)});
}

let accountEmailService = createAccountEmailService({
    pool: mysql,
    mailer: {
        sendVerification: message => runtimeMailer().sendVerification(message),
        sendEmailChanged: message => runtimeMailer().sendEmailChanged(message),
        sendEmailChangeNotice: message => runtimeMailer().sendEmailChangeNotice(message)
    },
    rateLimiter: createAccountRateLimiter({pool: mysql})
});

class NotificationSetting {
    constructor(sqlResult) {
        this.id = sqlResult.Id;
        this.memberId = sqlResult.MemberId;
        this.itemAdded = sqlResult.ItemAdded;
        this.itemUpdated = sqlResult.ItemUpdated;
        this.mobAdded = sqlResult.MobAdded;
        this.mobUpdated = sqlResult.MobUpdated;
        this.questAdded = sqlResult.QuestAdded;
        this.questUpdated = sqlResult.QuestUpdated;
        this.wikiPageAdded = sqlResult.WikiPageAdded;
        this.wikiPageUpdated = sqlResult.WikiPageUpdated;
        this.changelogAdded = sqlResult.ChangelogAdded;
    }
}

let getNotificationSettings = function(req, authToken) {
    return new Promise(function(resolve, reject) {
        auth.utils.authQuery(req, authToken, false).then(
            response => {
                mysql.query("SELECT Id, MemberId, ItemAdded, ItemUpdated, MobAdded, MobUpdated, QuestAdded, QuestUpdated, WikiPageAdded, WikiPageUpdated, ChangelogAdded FROM NotificationSettings WHERE MemberId = ?",
                    [response.memberId],
                    function(error, results, fields) {
                        if (error) {
                            return reject(new gql.GraphQLError(error.sqlMessage));
                        }

                        if (results.length > 0) {
                            resolve(new NotificationSetting(results[0]));
                        }
                        else {
                            reject(apiUtils.NotFoundError("Notification settings not found for user."));
                        }
                    });
            }
        ).catch(error => reject(error));
    });
};

let updateNotificationSettings = function(
    req, authToken, itemAdded, itemUpdated,
    mobAdded, mobUpdated, questAdded, questUpdated,
    wikiPageAdded, wikiPageUpdated) {
    return new Promise(function(resolve, reject) {
        auth.utils.authMutation(req, authToken, false).then(
            response => {
                let sql = `
                UPDATE NotificationSettings
                SET ItemAdded = ?
                    ,ItemUpdated = ?
                    ,MobAdded = ?
                    ,MobUpdated = ?
                    ,QuestAdded = ?
                    ,QuestUpdated = ?
                    ,WikiPageAdded = ?
                    ,WikiPageUpdated = ?
                WHERE MemberId = ?
                `;
                mysql.query(sql,
                    [
                        itemAdded,
                        itemUpdated,
                        mobAdded,
                        mobUpdated,
                        questAdded,
                        questUpdated,
                        wikiPageAdded,
                        wikiPageUpdated,
                        response.memberId
                    ],
                    function(error, results, fields) {
                        if (error) {
                            return reject(new gql.GraphQLError(error.sqlMessage));
                        }

                        resolve({token: response.token, expires: response.expires});
                    });
            }
        ).catch(error => reject(error));
    });
};

let updatePassword = function(req, authToken, currentPassword, newPassword) {
    return auth.utils.changePassword(
        req,
        authToken,
        currentPassword,
        newPassword
    );
};

let getAccountEmailStatus = async function(req, authToken) {
    const authResult = await auth.utils.authQuery(req, authToken, false);
    return accountEmailService.getAccountEmailStatus(authResult);
};

let requestEmailChange = async function(req, authToken, currentPassword, email) {
    const authResult = await auth.utils.authQuery(req, authToken, false);
    const result = await accountEmailService.requestEmailChange({
        auth: authResult,
        currentPassword,
        email,
        ipHash: authResult.ip
    });
    return {
        ...result,
        tokenRenewal: {token: authResult.token, expires: authResult.expires}
    };
};

let resendVerification = async function(req, authToken) {
    const authResult = await auth.utils.authQuery(req, authToken, false);
    const result = await accountEmailService.resendVerification({
        auth: authResult,
        ipHash: authResult.ip
    });
    return {
        ...result,
        tokenRenewal: {token: authResult.token, expires: authResult.expires}
    };
};

let updatePasswordType = new gql.GraphQLObjectType({
    name: "UpdatePassword",
    fields: () => ({
        success: {type: new gql.GraphQLNonNull(gql.GraphQLBoolean)},
        tokenRenewal: {type: new gql.GraphQLNonNull(auth.types.tokenRenewalType)}
    })
});

let notificationSettingType = new gql.GraphQLObjectType({
    name: "NotificationSetting",
    fields: () => ({
        id: {type: new gql.GraphQLNonNull(gql.GraphQLInt)},
        memberId: {type: new gql.GraphQLNonNull(gql.GraphQLInt)},
        itemAdded: {type: new gql.GraphQLNonNull(gql.GraphQLBoolean)},
        itemUpdated: {type: new gql.GraphQLNonNull(gql.GraphQLBoolean)},
        mobAdded: {type: new gql.GraphQLNonNull(gql.GraphQLBoolean)},
        mobUpdated: {type: new gql.GraphQLNonNull(gql.GraphQLBoolean)},
        questAdded: {type: new gql.GraphQLNonNull(gql.GraphQLBoolean)},
        questUpdated: {type: new gql.GraphQLNonNull(gql.GraphQLBoolean)},
        wikiPageAdded: {type: new gql.GraphQLNonNull(gql.GraphQLBoolean)},
        wikiPageUpdated: {type: new gql.GraphQLNonNull(gql.GraphQLBoolean)},
        changelogAdded: {type: new gql.GraphQLNonNull(gql.GraphQLBoolean)}
    })
});

let accountEmailStatusType = new gql.GraphQLObjectType({
    name: "AccountEmailStatus",
    fields: () => ({
        email: {type: gql.GraphQLString},
        verified: {type: new gql.GraphQLNonNull(gql.GraphQLBoolean)},
        pendingEmail: {type: gql.GraphQLString},
        canUseAccountStorage: {type: new gql.GraphQLNonNull(gql.GraphQLBoolean)}
    })
});

let accountEmailChangeType = new gql.GraphQLObjectType({
    name: "AccountEmailChange",
    fields: () => ({
        success: {type: new gql.GraphQLNonNull(gql.GraphQLBoolean)},
        pendingEmail: {type: gql.GraphQLString},
        tokenRenewal: {type: new gql.GraphQLNonNull(auth.types.tokenRenewalType)}
    })
});

let resendVerificationType = new gql.GraphQLObjectType({
    name: "ResendVerification",
    fields: () => ({
        accepted: {type: new gql.GraphQLNonNull(gql.GraphQLBoolean)},
        tokenRenewal: {type: new gql.GraphQLNonNull(auth.types.tokenRenewalType)}
    })
});

let qFields = {
    getNotificationSettings: {
        type: notificationSettingType,
        args: {
            authToken: {type: new gql.GraphQLNonNull(gql.GraphQLString)}
        },
        resolve: function(_, {authToken}, req) {
            return getNotificationSettings(req, authToken);
        }
    },
    getAccountEmailStatus: {
        type: new gql.GraphQLNonNull(accountEmailStatusType),
        args: {
            authToken: {type: new gql.GraphQLNonNull(gql.GraphQLString)}
        },
        resolve: function(_, {authToken}, req) {
            return getAccountEmailStatus(req, authToken);
        }
    }
};

let mFields = {
    updateNotificationSettings: {
        type: new gql.GraphQLNonNull(auth.types.tokenRenewalType),
        args: {
            authToken: {type: new gql.GraphQLNonNull(gql.GraphQLString)},
            itemAdded: {type: new gql.GraphQLNonNull(gql.GraphQLBoolean)},
            itemUpdated: {type: new gql.GraphQLNonNull(gql.GraphQLBoolean)},
            mobAdded: {type: new gql.GraphQLNonNull(gql.GraphQLBoolean)},
            mobUpdated: {type: new gql.GraphQLNonNull(gql.GraphQLBoolean)},
            questAdded: {type: new gql.GraphQLNonNull(gql.GraphQLBoolean)},
            questUpdated: {type: new gql.GraphQLNonNull(gql.GraphQLBoolean)},
            wikiPageAdded: {type: new gql.GraphQLNonNull(gql.GraphQLBoolean)},
            wikiPageUpdated: {type: new gql.GraphQLNonNull(gql.GraphQLBoolean)}
        },
        resolve: function(_, {
            authToken,
            itemAdded,
            itemUpdated,
            mobAdded,
            mobUpdated,
            questAdded,
            questUpdated,
            wikiPageAdded,
            wikiPageUpdated
        }, req) {
            return updateNotificationSettings(
                req,
                authToken,
                itemAdded,
                itemUpdated,
                mobAdded,
                mobUpdated,
                questAdded,
                questUpdated,
                wikiPageAdded,
                wikiPageUpdated
            );
        }
    },
    updatePassword: {
        type: new gql.GraphQLNonNull(updatePasswordType),
        args: {
            authToken: {type: new gql.GraphQLNonNull(gql.GraphQLString)},
            currentPassword: {type: new gql.GraphQLNonNull(gql.GraphQLString)},
            newPassword: {type: new gql.GraphQLNonNull(gql.GraphQLString)}
        },
        resolve: function(_, {
            authToken,
            currentPassword,
            newPassword
        }, req) {
            return updatePassword(
                req,
                authToken,
                currentPassword,
                newPassword
            );
        }
    },
    requestEmailChange: {
        type: new gql.GraphQLNonNull(accountEmailChangeType),
        args: {
            authToken: {type: new gql.GraphQLNonNull(gql.GraphQLString)},
            currentPassword: {type: new gql.GraphQLNonNull(gql.GraphQLString)},
            email: {type: new gql.GraphQLNonNull(gql.GraphQLString)}
        },
        resolve: function(_, {authToken, currentPassword, email}, req) {
            return requestEmailChange(req, authToken, currentPassword, email);
        }
    },
    resendVerification: {
        type: new gql.GraphQLNonNull(resendVerificationType),
        args: {
            authToken: {type: new gql.GraphQLNonNull(gql.GraphQLString)}
        },
        resolve: function(_, {authToken}, req) {
            return resendVerification(req, authToken);
        }
    }
};

module.exports.queryFields = qFields;
module.exports.mutationFields = mFields;
module.exports.accountEmailService = accountEmailService;
