"use strict";

function requireProfiles(value) {
    if (!Array.isArray(value))
        throw new TypeError("Import profiles must be arrays.");
}

function nextLocalName(name, activeNames) {
    let candidate = `${name} Local`;
    let suffix = 2;
    while (activeNames.has(candidate)) {
        candidate = `${name} Local ${suffix}`;
        suffix += 1;
    }
    return candidate;
}

function canonicalSourceKey(profile) {
    return JSON.stringify([profile.name, profile.payload]);
}

function classifyImport({localProfiles, accountProfiles} = {}) {
    requireProfiles(localProfiles);
    requireProfiles(accountProfiles);
    const active = accountProfiles.slice();
    const activeNames = new Set(active.map(profile => profile.name));
    const canonicalSources = new Map(accountProfiles.map(profile => [
        canonicalSourceKey(profile), profile
    ]));
    const actions = [];

    for (const profile of localProfiles) {
        const sourceKey = canonicalSourceKey(profile);
        if (canonicalSources.has(sourceKey)) {
            actions.push({
                type: "deduplicate",
                profile,
                accountProfile: canonicalSources.get(sourceKey)
            });
            continue;
        }
        const sameName = active.find(account => account.name === profile.name);
        if (!sameName) {
            actions.push({type: "copy", profile});
            active.push(profile);
            activeNames.add(profile.name);
            canonicalSources.set(sourceKey, profile);
            continue;
        }
        const to = nextLocalName(profile.name, activeNames);
        actions.push({type: "rename", profile, from: profile.name, to});
        active.push({...profile, name: to});
        activeNames.add(to);
        canonicalSources.set(sourceKey, profile);
    }
    return actions;
}

module.exports = {classifyImport};
