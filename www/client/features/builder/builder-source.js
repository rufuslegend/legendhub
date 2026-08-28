const ACCOUNT_LOAD_ERROR = "Builder account data could not be loaded.";

function accountLoadError() {
    return new Error(ACCOUNT_LOAD_ERROR);
}

function isProfile(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
        typeof value.name === "string" && value.name.trim() &&
        Array.isArray(value.variants) && value.variants.length > 0 &&
        value.variants.every(variant => Boolean(variant) && typeof variant === "object" &&
            !Array.isArray(variant) && typeof variant.name === "string" && variant.name.trim());
}

function decodeAccountProfile(profile, decode) {
    try {
        const decoded = decode(profile.payload);
        if (!Array.isArray(decoded) || decoded.length !== 1 || !isProfile(decoded[0]))
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

    const accountState = await loadAccount();
    return {
        mode: "account",
        profiles: accountState.profiles.map(profile => decodeAccountProfile(profile, decode)),
        preferences: parseAccountPreferences(accountState.preferences),
        anonymousSnapshot,
        accountState
    };
}
