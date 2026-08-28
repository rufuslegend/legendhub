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
    theme: "dark",
    itemsPerPage: 50,
    itemColumns: "Slot-AC-HP-",
    builderColumns: {
        Hero: "Name-Str-",
        Scout: "Rent-Name-Name-"
    },
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
            theme: "dark",
            itemsPerPage: 50,
            itemColumns: ["Slot", "Ac", "Hp"],
            builderColumns: {
                "local-1": ["Name", "Str"],
                "local-2": ["Rent", "Name"]
            },
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

// Catches acknowledgement storage availability being treated as part of the
// already-committed server transaction.
test("acknowledgement writes are best effort and never expose storage failures", async function() {
    const {writeMigrationAcknowledgement} = await loadMigration();
    const fingerprint = "a".repeat(64);
    const written = [];
    assert.equal(writeMigrationAcknowledgement({
        storage: {setItem: (key, value) => written.push([key, value])},
        storageNamespace: "opaque-namespace",
        fingerprint
    }), true);
    assert.deepEqual(written, [[
        "legendhub-builder-import:opaque-namespace",
        fingerprint
    ]]);
    assert.equal(writeMigrationAcknowledgement({
        storage: {setItem() { throw new Error("private quota diagnostic"); }},
        storageNamespace: "opaque-namespace",
        fingerprint
    }), false);
    assert.equal(writeMigrationAcknowledgement({
        storage: {setItem() {}},
        storageNamespace: "opaque-namespace",
        fingerprint: "not-hex"
    }), false);
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

// Catches one malformed local row suppressing otherwise valid characters or
// leaking its contents into the request/result surface.
test("mixed anonymous rows keep valid profiles importable and label invalid rows by position", async function() {
    const {buildImportRequest, fingerprintAnonymousData, shouldOfferMigration} = await loadMigration();
    const privateMalformedRow = "private<malformed>payload";
    const mixedSnapshot = {
        ...snapshot,
        encodedLists: `6*${hero}*${privateMalformedRow}*${scout}*`
    };

    assert.equal(shouldOfferMigration({
        snapshot: mixedSnapshot,
        fingerprint: "changed",
        acknowledgedFingerprint: null
    }), true);
    const request = buildImportRequest({
        snapshot: mixedSnapshot,
        preferencesChoice: "browser",
        storageGeneration: 3
    });
    assert.deepEqual(request.profiles.map(({id, name}) => ({id, name})), [
        {id: "local-1", name: "Hero"},
        {id: "local-2", name: "Scout"}
    ]);
    assert.deepEqual(request.localRejected, [{
        name: "Local row 2",
        reason: "Could not be copied."
    }]);
    assert.equal(JSON.stringify(request).includes(privateMalformedRow), false);

    let fingerprintInput;
    await fingerprintAnonymousData(mixedSnapshot, {
        subtle: {async digest(_algorithm, bytes) {
            fingerprintInput = new TextDecoder().decode(bytes);
            return new Uint8Array(32).buffer;
        }}
    });
    assert.equal(JSON.parse(fingerprintInput).encodedLists, `6*${hero}*${scout}*`);
    assert.equal(fingerprintInput.includes(privateMalformedRow), false);
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
        theme: "dark",
        itemsPerPage: 50,
        itemColumns: ["Slot", "Ac", "Hp"],
        builderColumns: {
            "local-1": ["Name", "Str"],
            "local-2": ["Rent", "Name"]
        },
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

// Catches hostile or obsolete preference cookies reaching the fingerprint or
// server instead of being reduced to the shared canonical preference domain.
test("browser preference document defaults and filters unsupported cookie values", async function() {
    const {buildImportRequest} = await loadMigration();
    const request = buildImportRequest({
        snapshot: {
            ...snapshot,
            theme: "private-theme-path",
            itemsPerPage: 25,
            itemColumns: "private-column-Slot-AC-",
            builderColumns: {Hero: "private-column-HP-Accu-"}
        },
        preferencesChoice: "browser",
        storageGeneration: 3
    });

    assert.deepEqual(request.preferences, {
        version: 1,
        theme: "glass-blue",
        itemsPerPage: 20,
        itemColumns: ["Slot", "Ac"],
        builderColumns: {"local-1": ["Hp", "Shot Acc"]},
        selectedProfileId: "local-1",
        selectedVariant: "Tank"
    });
    assert.equal(JSON.stringify(request.preferences).includes("private"), false);
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
test("preference choice defaults to browser for a fresh canonical account and otherwise protects account choices", async function() {
    const {defaultMigrationPreferencesChoice} = await loadMigration();
    const canonicalDefault = {
        version: 1,
        theme: "glass-blue",
        itemsPerPage: 20,
        itemColumns: [],
        builderColumns: {},
        selectedProfileId: null,
        selectedVariant: null
    };
    assert.equal(defaultMigrationPreferencesChoice(null), "browser");
    assert.equal(defaultMigrationPreferencesChoice({}), "browser");
    assert.equal(defaultMigrationPreferencesChoice(canonicalDefault, 1), "browser");
    assert.equal(defaultMigrationPreferencesChoice(canonicalDefault, 2), "account");
    assert.equal(defaultMigrationPreferencesChoice({...canonicalDefault, theme: "dark"}, 1), "account");
    assert.equal(defaultMigrationPreferencesChoice({...canonicalDefault, customized: true}, 1), "account");
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
    assert.deepEqual(
        normalizeMigrationResult(
            {...base, rejected: [{name: null, reason: "private-server-diagnostic"}]},
            [{name: "Local row 2", reason: "Could not be copied."}]
        ).rejected,
        [
            {name: "Local row 2", reason: "Could not be copied."},
            {name: "Server rejection 1", reason: "Could not be copied."}
        ]
    );
});
