"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

async function loadSource() {
    return import("../../client/features/builder/builder-source.js");
}

const anonymousSnapshot = {
    encodedLists: "6*anonymous", selectedList: "Local!Original", itemsPerPage: 20, columns: null
};
const decodedAccountProfiles = [{name: "Account Hero", variants: [{name: "Original"}]}];
const accountState = {
    profiles: [{
        id: "account-profile", name: "Account Hero", payload: "6*account",
        payloadVersion: 6, revision: 4, updatedOn: "2026-08-26T12:00:00.000Z"
    }],
    preferences: "{\"theme\":\"dark\"}", preferenceRevision: 3,
    storageGeneration: 2, usedBytes: 32, quotaBytes: 10485760
};

// Catches verified account mode accidentally surfacing browser-local profiles
// while retaining the local snapshot needed for an explicit later migration.
test("verified source loads account profiles without returning anonymous profiles", async function() {
    const {loadBuilderSource} = await loadSource();
    const result = await loadBuilderSource({
        accountContext: {canUseAccountStorage: true},
        loadAccount: async () => accountState,
        readAnonymous: () => anonymousSnapshot,
        decode: payload => payload === "6*account" ? decodedAccountProfiles : [{name: "Local Hero"}]
    });

    assert.equal(result.mode, "account");
    assert.deepEqual(result.profiles, [{
        ...decodedAccountProfiles[0],
        account: {id: "account-profile", revision: 4, updatedOn: "2026-08-26T12:00:00.000Z"}
    }]);
    assert.deepEqual(result.preferences, {theme: "dark"});
    assert.equal(result.anonymousSnapshot, anonymousSnapshot);
    assert.equal(result.accountState, accountState);
});

// Catches anonymous and unverified startup contacting the account API at all.
test("anonymous source never calls the account API", async function() {
    const {loadBuilderSource} = await loadSource();
    let calls = 0;
    const result = await loadBuilderSource({
        accountContext: {canUseAccountStorage: false},
        loadAccount: async () => { calls++; },
        readAnonymous: () => anonymousSnapshot,
        decode: payload => {
            assert.equal(payload, anonymousSnapshot.encodedLists);
            return [{name: "Local Hero"}];
        }
    });

    assert.equal(result.mode, "anonymous");
    assert.equal(calls, 0);
    assert.deepEqual(result.profiles, [{name: "Local Hero"}]);
    assert.equal(result.preferences, anonymousSnapshot);
    assert.equal(result.anonymousSnapshot, anonymousSnapshot);
    assert.equal(result.accountState, null);
});
