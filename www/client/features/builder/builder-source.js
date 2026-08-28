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
        profiles: accountState.profiles.map(profile => ({
            ...decode(profile.payload)[0],
            account: {
                id: profile.id,
                revision: profile.revision,
                updatedOn: profile.updatedOn
            }
        })),
        preferences: JSON.parse(accountState.preferences),
        anonymousSnapshot,
        accountState
    };
}
