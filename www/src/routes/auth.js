let express = require("express");
let authApi = require("./api/auth");
let apiUtils = require("./api/utils");
let {validatePreferences} = require("./api/builder-preferences");
let url = require("url");

const DISABLED_ACCOUNT_PREFERENCE_CONTEXT = Object.freeze({
    enabled: false,
    payload: null,
    revision: 0,
    storageGeneration: 0
});

function disabledAccountPreferenceContext() {
    return {...DISABLED_ACCOUNT_PREFERENCE_CONTEXT};
}

function createAccountPreferenceContext(state) {
    if (!state || typeof state !== "object" || Array.isArray(state) ||
        typeof state.preferences !== "string" ||
        !Number.isSafeInteger(state.preferenceRevision) || state.preferenceRevision < 1 ||
        !Number.isSafeInteger(state.storageGeneration) || state.storageGeneration < 1) {
        return disabledAccountPreferenceContext();
    }
    try {
        return {
            enabled: true,
            payload: validatePreferences(state.preferences),
            revision: state.preferenceRevision,
            storageGeneration: state.storageGeneration
        };
    }
    catch {
        return disabledAccountPreferenceContext();
    }
}

var initializeLocals = function(req, res, next) {
    res.locals.url = url.parse(req.url, true);
    res.locals.version = process.env.npm_package_version;
    res.locals.cookies = req.cookies;
    res.locals.accountPreferenceContext = disabledAccountPreferenceContext();

    res.locals.displayDateTime = function(date) {
        let offset = res.locals.cookies.tzoffset;
        if (offset) {
            let displayDate = new Date(date);
            offset -= displayDate.getTimezoneOffset();
            displayDate.setMinutes(displayDate.getMinutes() + offset*(-1));
            return displayDate.toISOString().slice(0, 16).replace("T", " ");
        }
        else {
            return new Date(date).toISOString().slice(0, 16).replace("T", " ") + " UTC";
        }
    };

    res.locals.displayDate = function(date) {
        let offset = res.locals.cookies.tzoffset;
        if (offset) {
            let displayDate = new Date(date);
            offset -= displayDate.getTimezoneOffset();
            displayDate.setMinutes(displayDate.getMinutes() + offset*(-1));
            return displayDate.toISOString().slice(0, 10);
        }
        else {
            return new Date(date).toISOString().slice(0, 10) + " UTC";
        }
    };

    next();
};

var authFunc = async function(req, res, next) {
    if (!res.locals.accountPreferenceContext)
        res.locals.accountPreferenceContext = disabledAccountPreferenceContext();
    if (req.cookies.loginToken) {
        try {
            res.locals.user = await authApi.utils.authToken(req.cookies.loginToken, authApi.utils.getIPFromRequest(req), false, true);
            const canUseAccountStorage = Boolean(
                res.locals.user.email && res.locals.user.emailVerified
            );
            res.locals.user.emailVerified = canUseAccountStorage;
            res.locals.user.canUseAccountStorage = canUseAccountStorage;

            if (canUseAccountStorage) {
                try {
                    const preferenceQuery = `
                    query AccountPreferenceBootstrap($authToken: String!) {
                        getBuilderAccountState(authToken: $authToken) {
                            preferences
                            preferenceRevision
                            storageGeneration
                        }
                    }
                    `;
                    const preferenceResponse = await apiUtils.postAsync(
                        preferenceQuery,
                        undefined,
                        {authToken: req.cookies.loginToken}
                    );
                    res.locals.accountPreferenceContext = createAccountPreferenceContext(
                        preferenceResponse.getBuilderAccountState
                    );
                }
                catch {
                    // Account preference bootstrap is optional. The Builder's
                    // authenticated state request remains the runtime authority.
                }
            }
        }
        catch (e) {
            if (e.message === "Invalid token") {
                res.clearCookie("loginToken");
                delete res.locals.cookies.loginToken;
                return next();
            }
            else {
                return next(e);
            }
        }

        try {
            res.locals.permissions = await authApi.utils.getPermissions(res.locals.user.memberId);
        }
        catch (e) {}

        try {
            let query = `
            query UnreadNotifications($authToken: String!, $read: Boolean!) {
                getNotifications(authToken: $authToken, read: $read) {
                    moreResults
                    results {
                        actorName
                        count
                        createdOn
                        id
                        link
                        objectId
                        objectName
                        objectPage
                        objectType
                        read
                        verb
                    }
                }
            }
            `;
            let response = await apiUtils.postAsync(query, undefined, {
                authToken: req.cookies.loginToken,
                read: false
            });
            res.locals.user.moreNotifications = response.getNotifications.moreResults;
            res.locals.user.notifications = response.getNotifications.results;
        }
        catch (e) {
            return next(e);
        }

        next();
    }
    else {
        next();
    }
};

module.exports = authFunc;
module.exports.initializeLocals = initializeLocals;
module.exports.createAccountPreferenceContext = createAccountPreferenceContext;
