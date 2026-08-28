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

// Catches corrupted account rows being partially activated, or decoder details
// and payload text escaping into the player-visible startup failure.
test("verified source fails closed when any account profile cannot decode to one valid profile", async function(t) {
    const {loadBuilderSource} = await loadSource();
    const cases = [
        ["decoder throws", () => { throw new Error("6*private-corrupt-payload"); }],
        ["decoder returns no profiles", () => []],
        ["decoder returns multiple profiles", () => [{name: "Hero", variants: []}, {name: "Other", variants: []}]],
        ["decoder returns a malformed profile", () => [{}]],
        ["decoder returns an empty character or malformed variant", () => [{
            name: "", variants: [{name: ""}]
        }]]
    ];

    for (const [label, decode] of cases) {
        await t.test(label, async function() {
            await assert.rejects(loadBuilderSource({
                accountContext: {canUseAccountStorage: true},
                loadAccount: async () => accountState,
                readAnonymous: () => anonymousSnapshot,
                decode
            }), function(error) {
                assert.equal(error.message, "Builder account data could not be loaded.");
                assert.equal(error.message.includes("private-corrupt-payload"), false);
                return true;
            });
        });
    }
});

// Catches malformed server preferences being exposed as parser diagnostics or
// silently replaced with browser-local preferences in verified account mode.
test("verified source rejects malformed account preferences without anonymous fallback", async function(t) {
    const {loadBuilderSource} = await loadSource();
    const cases = ["{", "null", "[]", "\"dark\"", "42"];

    for (const preferences of cases) {
        await t.test(preferences, async function() {
            await assert.rejects(loadBuilderSource({
                accountContext: {canUseAccountStorage: true},
                loadAccount: async () => ({...accountState, preferences}),
                readAnonymous: () => anonymousSnapshot,
                decode: () => decodedAccountProfiles
            }), function(error) {
                assert.equal(error.message, "Builder account data could not be loaded.");
                assert.equal(error.message.includes(preferences), false);
                return true;
            });
        });
    }
});
