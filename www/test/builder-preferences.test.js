"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
    DEFAULT_PREFERENCES,
    validatePreferences
} = require("../src/routes/api/builder-preferences");

const CANONICAL_DEFAULT_PREFERENCES = {
    version: 1,
    theme: "dark",
    itemsPerPage: 20,
    itemPreviews: true,
    hideEquipmentZeros: false,
    itemColumns: [],
    builderColumns: {},
    selectedProfileId: null,
    selectedVariant: null
};

// Catches repository/service consumers inventing partial fresh-state objects
// instead of sharing the complete versioned preference contract.
test("preferences export one complete canonical default document", function() {
    assert.deepEqual(DEFAULT_PREFERENCES, CANONICAL_DEFAULT_PREFERENCES);
    assert.deepEqual(validatePreferences({}), CANONICAL_DEFAULT_PREFERENCES);
});

// Catches device-only or unknown fields crossing the account-storage boundary,
// or valid version-1 settings being rewritten into a non-canonical shape.
test("preferences whitelist syncable fields", function() {
    assert.deepEqual(validatePreferences(JSON.stringify({
        version: 1,
        theme: "dark",
        itemsPerPage: 50,
        itemPreviews: false,
        hideEquipmentZeros: true,
        itemColumns: ["Name"],
        builderColumns: {id: ["Slot"]},
        selectedProfileId: "id",
        selectedVariant: "Tank",
        cookieConsent: true,
        loginToken: "secret",
        timezone: 300,
        futureDeviceField: "not-syncable"
    })), {
        version: 1,
        theme: "dark",
        itemsPerPage: 50,
        itemPreviews: false,
        hideEquipmentZeros: true,
        itemColumns: ["Name"],
        builderColumns: {id: ["Slot"]},
        selectedProfileId: "id",
        selectedVariant: "Tank"
    });
});

// Catches accepting a stylesheet path, an unsupported Builder page size, an
// empty/unknown stat column, or a malformed per-profile column map.
test("preferences reject invalid values in known syncable fields", function() {
    const cases = [
        {version: 2},
        {theme: "../../private"},
        {itemsPerPage: 25},
        {itemPreviews: "false"},
        {hideEquipmentZeros: 1},
        {itemColumns: [""]},
        {itemColumns: ["Not a current column"]},
        {builderColumns: []},
        {builderColumns: {id: ["Not a current column"]}},
        {selectedProfileId: ""},
        {selectedVariant: ""}
    ];

    for (const payload of cases)
        assert.throws(() => validatePreferences(payload), /preference/i);
});

// Catches stale profile IDs retaining per-character columns or a selected
// profile after that profile has been deleted from account storage.
test("preferences retain builder settings only for active profile IDs", function() {
    const result = validatePreferences({
        builderColumns: {
            active: ["Name", "Name", "Slot"],
            deleted: ["Rent"]
        },
        selectedProfileId: "deleted",
        selectedVariant: "Tank"
    }, {activeProfileIds: new Set(["active"])});

    assert.deepEqual(result, {
        version: 1,
        theme: "dark",
        itemsPerPage: 20,
        itemPreviews: true,
        hideEquipmentZeros: false,
        itemColumns: [],
        builderColumns: {active: ["Name", "Slot"]},
        selectedProfileId: null,
        selectedVariant: null
    });
});

// Catches parse diagnostics echoing an untrusted preference document through
// the API-facing validation error.
test("preference validation errors do not echo submitted documents", function() {
    const privateValue = "raw-private-preference-value";
    assert.throws(
        () => validatePreferences(`{"theme":"${privateValue}"`),
        error => error.extensions.code === 400 && !error.message.includes(privateValue)
    );
});

// Catches the synchronized allowlist drifting from the current ItemStatInfo.Short
// values, while retaining a one-way migration for documents written with the
// retired server aliases.
test("preferences store current item metadata names and canonicalize legacy aliases", function() {
    const representativeMetadata = [
        {Short: "Shot Acc"},
        {Short: "Bonus Acc"},
        {Short: "Ac"},
        {Short: "Hp"}
    ];
    const currentNames = representativeMetadata.map(stat => stat.Short);

    assert.deepEqual(validatePreferences({
        itemColumns: currentNames,
        builderColumns: {profile: [
            "Accu", "AccuBonus", "AC", "HP", "Shot Acc", "Bonus Acc", "Ac", "Hp"
        ]}
    }), {
        version: 1,
        theme: "dark",
        itemsPerPage: 20,
        itemPreviews: true,
        hideEquipmentZeros: false,
        itemColumns: ["Shot Acc", "Bonus Acc", "Ac", "Hp"],
        builderColumns: {profile: ["Shot Acc", "Bonus Acc", "Ac", "Hp"]},
        selectedProfileId: null,
        selectedVariant: null
    });
});
