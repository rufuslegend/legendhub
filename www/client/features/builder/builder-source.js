export const BUILDER_ACCOUNT_LOAD_ERROR = "Builder account data could not be loaded.";
const SUPPORTED_PAYLOAD_VERSIONS = new Set([1, 2, 3, 4, 5, 6]);

function accountLoadError() {
    return new Error(BUILDER_ACCOUNT_LOAD_ERROR);
}

function isProfile(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
        typeof value.name === "string" && value.name.trim() &&
        Array.isArray(value.variants) && value.variants.length > 0 &&
        value.variants.every(variant => Boolean(variant) && typeof variant === "object" &&
            !Array.isArray(variant) && typeof variant.name === "string" && variant.name.trim());
}

function isNonEmptyString(value) {
    return typeof value === "string" && Boolean(value.trim());
}

function isPositiveInteger(value) {
    return Number.isInteger(value) && value > 0;
}

function isNonNegativeNumber(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isUpdatedOn(value) {
    return isNonEmptyString(value) && Number.isFinite(Date.parse(value));
}

function isAccountProfile(profile) {
    return Boolean(profile) && typeof profile === "object" && !Array.isArray(profile) &&
        isNonEmptyString(profile.id) && isNonEmptyString(profile.name) &&
        isNonEmptyString(profile.payload) && SUPPORTED_PAYLOAD_VERSIONS.has(profile.payloadVersion) &&
        isPositiveInteger(profile.revision) && isUpdatedOn(profile.updatedOn);
}

function isAccountState(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
        Array.isArray(value.profiles) && value.profiles.every(isAccountProfile) &&
        typeof value.preferences === "string" && isPositiveInteger(value.preferenceRevision) &&
        isUpdatedOn(value.preferencesUpdatedOn) &&
        isPositiveInteger(value.storageGeneration) && isNonNegativeNumber(value.usedBytes) &&
        isNonNegativeNumber(value.quotaBytes);
}

function decodeAccountProfile(profile, decode) {
    try {
        const decoded = decode(profile.payload);
        if (!Array.isArray(decoded) || decoded.length !== 1 || !isProfile(decoded[0]) ||
            decoded[0].name !== profile.name)
            throw accountLoadError();
        return {
            ...decoded[0],
            account: {
                id: profile.id,
                revision: profile.revision,
                updatedOn: profile.updatedOn
            }
        };
    }
    catch {
        throw accountLoadError();
    }
}

function parseAccountPreferences(preferences) {
    try {
        const parsed = JSON.parse(preferences);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
            throw accountLoadError();
        return parsed;
    }
    catch {
        throw accountLoadError();
    }
}

export async function loadBuilderSource({accountContext, loadAccount, readAnonymous, decode}) {
    const anonymousSnapshot = readAnonymous();
    if (!accountContext.canUseAccountStorage) {
        return {
            mode: "anonymous",
            profiles: decode(anonymousSnapshot.encodedLists),
            preferences: anonymousSnapshot,
            anonymousSnapshot,
            accountState: null
        };
    }

    try {
        const accountState = await loadAccount();
        if (!isAccountState(accountState))
            throw accountLoadError();
        const preferences = parseAccountPreferences(accountState.preferences);
        return {
            mode: "account",
            profiles: accountState.profiles.map(profile => decodeAccountProfile(profile, decode)),
            preferences,
            anonymousSnapshot,
            accountState
        };
    }
    catch {
        throw accountLoadError();
    }
}
