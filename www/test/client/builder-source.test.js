"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

async function loadSource() {
    return import("../../client/features/builder/builder-source.js");
}

const anonymousSnapshot = {
    encodedLists: "7*anonymous", selectedList: "Local!Original", itemsPerPage: 20, columns: null
};
const decodedAccountProfiles = [{name: "Account Hero", variants: [{name: "Original"}]}];
const accountState = {
    profiles: [{
        id: "account-profile", name: "Account Hero", payload: "7*account",
        payloadVersion: 7, revision: 4, updatedOn: "2026-08-26T12:00:00.000Z"
    }],
    preferences: "{\"theme\":\"dark\"}", preferenceRevision: 3,
    preferencesUpdatedOn: "2026-08-26T12:00:00.000Z",
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
        decode: payload => payload === "7*account" ? decodedAccountProfiles : [{name: "Local Hero"}]
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
        ["decoder throws", () => { throw new Error("7*private-corrupt-payload"); }],
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

// Catches malformed preferences reaching profile decoding before the complete
// account envelope is accepted, which could activate or process bad state.
test("verified source validates preferences before decoding profiles", async function() {
    const {loadBuilderSource} = await loadSource();
    let decodeCalls = 0;
    await assert.rejects(loadBuilderSource({
        accountContext: {canUseAccountStorage: true},
        loadAccount: async () => ({...accountState, preferences: "{"}),
        readAnonymous: () => anonymousSnapshot,
        decode: () => { decodeCalls++; return decodedAccountProfiles; }
    }), error => accountFailure(error, "{"));
    assert.equal(decodeCalls, 0);
});

function accountFailure(error, privateValue) {
    assert.equal(error.message, "Builder account data could not be loaded.");
    assert.equal(error.message.includes(privateValue), false);
    return true;
}

function accountStateWith(change) {
    const profile = {...accountState.profiles[0]};
    const state = {...accountState, profiles: [profile]};
    change(state, profile);
    return state;
}

// Catches account API responses being trusted before the source selector has
// established the minimum Plan 2 state envelope and row metadata contract.
test("verified source rejects malformed account state envelopes before decoding", async function(t) {
    const {loadBuilderSource} = await loadSource();
    const cases = [
        ["null state", null],
        ["array state", []],
        ["empty object", {}],
        ["non-array profiles", {...accountState, profiles: {}}],
        ["non-string preferences", {...accountState, preferences: {theme: "dark"}}],
        ["negative usage", {...accountState, usedBytes: -1}],
        ["negative quota", {...accountState, quotaBytes: -1}],
        ["missing preferences updated time", accountStateWith(state => {
            delete state.preferencesUpdatedOn;
        })],
        ["empty preferences updated time", {...accountState, preferencesUpdatedOn: ""}],
        ["invalid preferences updated time", {...accountState, preferencesUpdatedOn: "not-a-date"}],
        ["zero preference revision", {...accountState, preferenceRevision: 0}],
        ["zero storage generation", {...accountState, storageGeneration: 0}]
    ];

    for (const [label, invalidState] of cases) {
        await t.test(label, async function() {
            let decodeCalls = 0;
            await assert.rejects(loadBuilderSource({
                accountContext: {canUseAccountStorage: true},
                loadAccount: async () => invalidState,
                readAnonymous: () => anonymousSnapshot,
                decode: () => { decodeCalls++; return decodedAccountProfiles; }
            }), error => accountFailure(error, "private-envelope"));
            assert.equal(decodeCalls, 0);
        });
    }
});

// Catches partial, stale, or unsupported profile metadata being attached to a
// decoded character, including a row name that disagrees with its payload.
test("verified source rejects malformed profile metadata and decoded name mismatches", async function(t) {
    const {loadBuilderSource} = await loadSource();
    const cases = [
        ["missing id", state => { delete state.profiles[0].id; }],
        ["empty id", state => { state.profiles[0].id = ""; }],
        ["missing name", state => { delete state.profiles[0].name; }],
        ["empty name", state => { state.profiles[0].name = ""; }],
        ["missing payload", state => { delete state.profiles[0].payload; }],
        ["empty payload", state => { state.profiles[0].payload = ""; }],
        ["missing payload version", state => { delete state.profiles[0].payloadVersion; }],
        ["unsupported payload version", state => { state.profiles[0].payloadVersion = 99; }],
        ["missing revision", state => { delete state.profiles[0].revision; }],
        ["zero revision", state => { state.profiles[0].revision = 0; }],
        ["missing updated time", state => { delete state.profiles[0].updatedOn; }],
        ["invalid updated time", state => { state.profiles[0].updatedOn = "not-a-date"; }]
    ];

    for (const [label, change] of cases) {
        await t.test(label, async function() {
            const invalidState = accountStateWith(change);
            let decodeCalls = 0;
            await assert.rejects(loadBuilderSource({
                accountContext: {canUseAccountStorage: true},
                loadAccount: async () => invalidState,
                readAnonymous: () => anonymousSnapshot,
                decode: () => { decodeCalls++; return decodedAccountProfiles; }
            }), error => accountFailure(error, "private-profile"));
            assert.equal(decodeCalls, 0);
        });
    }

    await assert.rejects(loadBuilderSource({
        accountContext: {canUseAccountStorage: true},
        loadAccount: async () => accountState,
        readAnonymous: () => anonymousSnapshot,
        decode: () => [{name: "Other Hero", variants: [{name: "Original"}]}]
    }), error => accountFailure(error, "Other Hero"));
});

// Catches GraphQL/load transport failures leaking diagnostics through account
// startup instead of leaving the anonymous snapshot retained but inactive.
test("verified source normalizes account loader failures", async function() {
    const {loadBuilderSource} = await loadSource();
    await assert.rejects(loadBuilderSource({
        accountContext: {canUseAccountStorage: true},
        loadAccount: async () => { throw new Error("private loader diagnostic"); },
        readAnonymous: () => anonymousSnapshot,
        decode: () => decodedAccountProfiles
    }), error => accountFailure(error, "private loader diagnostic"));
});
