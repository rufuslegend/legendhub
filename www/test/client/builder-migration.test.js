"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {webcrypto} = require("node:crypto");

async function loadMigration() {
    return import("../../client/features/builder/builder-migration.js");
}

const hero = "Hero~Tank~0U0U0U0U0U0U000000___0000000000000000000f__________________________________";
const scout = "Scout~Original~0X0X0X0X0X0X000000___0000000000000000000f__________________________________";
const snapshot = {
    encodedLists: `6*${hero}*${scout}*`,
    selectedList: "Hero!Tank",
    itemsPerPage: 50,
    columns: "Name-Str-",
    cookieConsent: true,
    loginToken: "private-login-token",
    timezone: "America/Chicago",
    futureDeviceValue: "private-unknown"
};

// Catches hashing raw persistence state, device-only values, or a non-SHA-256
// algorithm instead of the canonical list and syncable preference document.
test("anonymous fingerprint hashes only canonical lists and syncable preferences with SHA-256", async function() {
    const {fingerprintAnonymousData} = await loadMigration();
    let algorithm;
    let input;
    const crypto = {
        subtle: {
            async digest(value, bytes) {
                algorithm = value;
                input = new TextDecoder().decode(bytes);
                return Uint8Array.from({length: 32}, (_value, index) => index).buffer;
            }
        }
    };

    const fingerprint = await fingerprintAnonymousData(snapshot, crypto);

    assert.equal(algorithm, "SHA-256");
    assert.equal(input, JSON.stringify({
        encodedLists: snapshot.encodedLists,
        preferences: {
            version: 1,
            itemsPerPage: 50,
            itemColumns: [],
            builderColumns: {"local-1": ["Name", "Str"]},
            selectedProfileId: "local-1",
            selectedVariant: "Tank"
        }
    }));
    assert.equal(fingerprint, "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
    assert.equal(input.includes("private-login-token"), false);
    assert.equal(input.includes("America/Chicago"), false);
    assert.equal(input.includes("private-unknown"), false);
});

// Catches acknowledgement keys widening from the opaque namespace or storing
// account/profile data in the key name.
test("migration acknowledgement key is scoped only by opaque storage namespace", async function() {
    const {migrationAcknowledgementKey} = await loadMigration();
    assert.equal(
        migrationAcknowledgementKey("0123456789abcdef0123456789abcdef"),
        "legendhub-builder-import:0123456789abcdef0123456789abcdef"
    );
});

// Catches unchanged acknowledged anonymous data being offered on every login,
// while still allowing a changed syncable value to produce a new offer.
test("unchanged acknowledged anonymous data is not offered twice", async function() {
    const {fingerprintAnonymousData, shouldOfferMigration} = await loadMigration();
    const fingerprint = await fingerprintAnonymousData(snapshot, webcrypto);
    const changedSnapshot = {...snapshot, itemsPerPage: 100};
    const changedFingerprint = await fingerprintAnonymousData(changedSnapshot, webcrypto);

    assert.equal(shouldOfferMigration({snapshot, fingerprint, acknowledgedFingerprint: fingerprint}), false);
    assert.equal(shouldOfferMigration({snapshot: changedSnapshot, fingerprint: changedFingerprint, acknowledgedFingerprint: fingerprint}), true);
    assert.notEqual(changedFingerprint, fingerprint);
});

// Catches empty, corrupt, or not-yet-fingerprinted anonymous sources producing
// a migration offer that cannot be safely copied.
test("migration offer requires a nonempty valid anonymous list and a completed fingerprint", async function() {
    const {shouldOfferMigration} = await loadMigration();
    assert.equal(shouldOfferMigration({snapshot: {...snapshot, encodedLists: null}, fingerprint: "a", acknowledgedFingerprint: null}), false);
    assert.equal(shouldOfferMigration({snapshot: {...snapshot, encodedLists: "6*broken"}, fingerprint: "a", acknowledgedFingerprint: null}), false);
    assert.equal(shouldOfferMigration({snapshot, fingerprint: "", acknowledgedFingerprint: null}), false);
});

// Catches migration collapsing all local characters into one payload, omitting
// the atomic batch key, or sending device-only/unknown preference state.
test("migration request creates per-profile payloads and strips device-only values", async function() {
    const {buildImportRequest} = await loadMigration();
    const request = buildImportRequest({snapshot, preferencesChoice: "browser", storageGeneration: 3});

    assert.deepEqual(request.profiles, [
        {id: "local-1", name: "Hero", payload: `6*${hero}*`},
        {id: "local-2", name: "Scout", payload: `6*${scout}*`}
    ]);
    assert.deepEqual(request.preferences, {
        version: 1,
        itemsPerPage: 50,
        itemColumns: [],
        builderColumns: {"local-1": ["Name", "Str"]},
        selectedProfileId: "local-1",
        selectedVariant: "Tank"
    });
    assert.equal(request.replacePreferences, true);
    assert.equal(request.storageGeneration, 3);
    assert.match(request.idempotencyKey, /^[\x21-\x7e]{1,64}$/);
    assert.equal(Object.hasOwn(request.preferences, "cookieConsent"), false);
    assert.equal(Object.hasOwn(request.preferences, "loginToken"), false);
    assert.equal(Object.hasOwn(request.preferences, "timezone"), false);
    assert.equal(Object.hasOwn(request.preferences, "futureDeviceValue"), false);
});

// Catches choosing account preferences while still overwriting them with the
// browser document, or accidentally reusing a key for a distinct attempt.
test("account preference choice omits browser preferences and each new attempt gets one opaque key", async function() {
    const {buildImportRequest} = await loadMigration();
    const first = buildImportRequest({snapshot, preferencesChoice: "account", storageGeneration: 3});
    const second = buildImportRequest({snapshot, preferencesChoice: "account", storageGeneration: 3});

    assert.equal(first.preferences, null);
    assert.equal(first.replacePreferences, false);
    assert.notEqual(first.idempotencyKey, second.idempotencyKey);
});

// Catches an existing account preference document being overwritten by
// default while preserving the browser-first default for truly absent state.
test("preference choice defaults to browser only when account preferences are absent", async function() {
    const {defaultMigrationPreferencesChoice} = await loadMigration();
    assert.equal(defaultMigrationPreferencesChoice(null), "browser");
    assert.equal(defaultMigrationPreferencesChoice({}), "browser");
    assert.equal(defaultMigrationPreferencesChoice({version: 1, theme: "dark"}), "account");
});

// Catches raw server result/error text reaching the accessible result report.
test("migration result keeps safe outcome fields and replaces rejected diagnostics", async function() {
    const {normalizeMigrationResult} = await loadMigration();
    const privatePayload = "6*private-builder-payload";
    const result = normalizeMigrationResult(JSON.stringify({
        copied: ["Scout"],
        renamed: [{from: "Hero", to: "Hero Local"}],
        deduplicated: ["Same"],
        rejected: [{name: "Broken", reason: `decoder rejected ${privatePayload}`}],
        preferencesImported: true,
        ignored: privatePayload
    }));

    assert.deepEqual(result, {
        copied: ["Scout"],
        renamed: [{from: "Hero", to: "Hero Local"}],
        deduplicated: ["Same"],
        rejected: [{name: "Broken", reason: "Could not be copied."}],
        preferencesImported: true
    });
    assert.equal(JSON.stringify(result).includes(privatePayload), false);
});

// Catches JavaScript regex coercion accepting missing names as the literal
// strings "undefined" or "null" in a player-visible migration report.
test("migration result rejects missing or non-string display names", async function() {
    const {normalizeMigrationResult} = await loadMigration();
    const base = {
        copied: [], renamed: [], deduplicated: [], rejected: [],
        preferencesImported: false
    };
    assert.throws(
        () => normalizeMigrationResult({...base, renamed: [{to: "Hero Local"}]}),
        /Builder migration result is invalid\./
    );
    assert.throws(
        () => normalizeMigrationResult({...base, rejected: [{name: null}]}),
        /Builder migration result is invalid\./
    );
});
