let express = require("express");
let router = express.Router();
let apiUtils = require("./api/utils");
let auth = require("./api/auth");

const BUILDER_QUOTA_BYTES = 10 * 1024 * 1024;

function disabledBuilderStorage() {
    return {
        enabled: false,
        profiles: [],
        usedBytes: 0,
        quotaBytes: 0,
        storageGeneration: 0
    };
}

function builderStorageViewModel(user, state) {
    const enabled = Boolean(
        user?.emailVerified && user?.canUseAccountStorage && state
    );
    if (!enabled)
        return disabledBuilderStorage();

    const profiles = Array.isArray(state.profiles)
        ? state.profiles.flatMap(function(profile) {
            if (!profile || typeof profile.id !== "string" ||
                typeof profile.name !== "string" ||
                !Number.isSafeInteger(profile.revision) || profile.revision < 1 ||
                typeof profile.updatedOn !== "string") {
                return [];
            }
            return [{
                id: profile.id,
                name: profile.name,
                revision: profile.revision,
                updatedOn: profile.updatedOn
            }];
        })
        : [];
    return {
        enabled: true,
        profiles,
        usedBytes: Number.isSafeInteger(state.usedBytes) && state.usedBytes >= 0
            ? state.usedBytes
            : 0,
        quotaBytes: state.quotaBytes === BUILDER_QUOTA_BYTES
            ? state.quotaBytes
            : BUILDER_QUOTA_BYTES,
        storageGeneration: Number.isSafeInteger(state.storageGeneration) &&
            state.storageGeneration > 0
            ? state.storageGeneration
            : 1
    };
}

router.get(["/", "/index.html"], async function(req, res, next) {
    if (!res.locals.user)
        return res.redirect(`/login.html?returnUrl=${encodeURIComponent(res.locals.url.path)}`);

    const includeBuilderStorage = Boolean(
        res.locals.user.emailVerified && res.locals.user.canUseAccountStorage
    );
    let query = `
    query AccountSettings(
        $authToken: String!
        $includeBuilderStorage: Boolean!
    ) {
        getNotificationSettings(authToken: $authToken) {
            itemAdded
            itemUpdated
            mobAdded
            mobUpdated
            questAdded
            questUpdated
            wikiPageAdded
            wikiPageUpdated
            changelogAdded
        }
        getAccountEmailStatus(authToken: $authToken) {
            email
            verified
            pendingEmail
            canUseAccountStorage
        }
        getBuilderAccountState(authToken: $authToken)
            @include(if: $includeBuilderStorage) {
            profiles {
                id
                name
                revision
                updatedOn
            }
            usedBytes
            quotaBytes
            storageGeneration
        }
    }
    `;
    try {
        var data = await apiUtils.postAsync(query, undefined, {
            authToken: req.cookies.loginToken,
            includeBuilderStorage
        });
    }
    catch(e) {
        return next(e);
    }

    let vm = {
        notificationSettings: data.getNotificationSettings,
        emailStatus: data.getAccountEmailStatus,
        builderStorage: builderStorageViewModel(
            res.locals.user,
            data.getBuilderAccountState
        )
    };
    res.render("account/index", {title: "Account", vm});
});

module.exports = router;
