"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

async function loadPersistence() {
    return import("../../client/features/builder/builder-persistence.js");
}

// Catches storage reads that bypass consent or prefer obsolete list keys over the current cln payload.
test("builder persistence gates reads on consent and preserves storage fallback order", async function() {
    const {readBuilderPersistence} = await loadPersistence();
    const storage = {cln: "7*Current", cl2: "Old two", cl1: "Old one", cl: "Oldest", scl: "Hero!Tank"};

    assert.deepEqual(readBuilderPersistence({cookies: {}, storage}), {
        encodedLists: null,
        selectedList: null,
        theme: null,
        itemsPerPage: 20,
        itemColumns: null,
        builderColumns: {}
    });
    assert.deepEqual(readBuilderPersistence({
        cookies: {
            "cookie-consent": "yes",
            theme: "dark",
            ipp: "50",
            sc2: "Slot-Name-",
            "sc-Hero": "Rent-",
            "sc-Scout": "Name-Str-",
            scl1: "Cookie!Original"
        },
        storage,
        characterName: "Hero"
    }), {
        encodedLists: "7*Current",
        selectedList: "Hero!Tank",
        theme: "dark",
        itemsPerPage: 50,
        itemColumns: "Slot-Name-",
        builderColumns: {Hero: "Rent-", Scout: "Name-Str-"}
    });
});

// Catches any legacy key bypassing its required decoder-version prefix or being skipped when newer keys are absent.
test("builder persistence reads each deployed list-key fallback in order", async function() {
    const {readBuilderPersistence} = await loadPersistence();
    const cases = [
        [{cln: "7*Current", cl2: "Two", cl1: "One", cl: "Legacy"}, "7*Current"],
        [{cl2: "Two", cl1: "One", cl: "Legacy"}, "2*Two"],
        [{cl1: "One", cl: "Legacy"}, "1*One"],
        [{cl: "Legacy"}, "Legacy"],
        [{}, null]
    ];

    for (const [storage, expected] of cases) {
        assert.equal(readBuilderPersistence({
            cookies: {"cookie-consent": "yes"}, storage
        }).encodedLists, expected);
    }
});

// Catches character column lookup that ignores its scoped cookie or loses deployed default-column behavior.
test("builder persistence keeps Item Search and scoped Builder columns distinct", async function() {
    const {applySelectedColumns, readBuilderPersistence} = await loadPersistence();
    const statInfo = [
        {var: "slot", short: "Slot", showColumnDefault: true},
        {var: "name", short: "Name", showColumnDefault: true},
        {var: "rent", short: "Rent", showColumnDefault: false}
    ];
    const preference = readBuilderPersistence({
        cookies: {"cookie-consent": "yes", "sc-Hero": "Rent-", sc2: "Name-"},
        storage: {},
        characterName: "Hero"
    });

    assert.equal(preference.itemColumns, "Name-");
    assert.deepEqual(preference.builderColumns, {Hero: "Rent-"});
    assert.deepEqual(applySelectedColumns(preference.builderColumns.Hero, statInfo).map(stat => stat.showColumn), [false, true, true]);
    assert.deepEqual(applySelectedColumns(["Name"], statInfo).map(stat => stat.showColumn), [false, true, false]);
    assert.deepEqual(applySelectedColumns(null, statInfo).map(stat => stat.showColumn), [true, true, false]);
    assert.equal(statInfo[0].showColumn, undefined);
});

// Catches a fresh account's empty shared Item Search preference being treated
// as an explicit request to hide every default Builder column.
test("fresh account Builder uses metadata defaults until that profile saves columns", async function() {
    const {accountPreferenceColumns} = await loadPersistence();
    const statInfo = [
        {short: "Slot", showColumnDefault: true},
        {short: "Name", showColumnDefault: true},
        {short: "Str", showColumnDefault: true},
        {short: "Min", showColumnDefault: true},
        {short: "Dex", showColumnDefault: true},
        {short: "Con", showColumnDefault: true},
        {short: "Per", showColumnDefault: true},
        {short: "Spi", showColumnDefault: true},
        {short: "Ac", showColumnDefault: true},
        {short: "Align", showColumnDefault: true},
        {short: "Rent", showColumnDefault: true},
        {short: "Hp", showColumnDefault: false}
    ];
    const character = {name: "Hero", account: {id: "profile-a"}};
    const visibleColumns = document => accountPreferenceColumns(document, character, statInfo)
        .filter(stat => stat.showColumn)
        .map(stat => stat.short);

    assert.deepEqual(visibleColumns({itemColumns: [], builderColumns: {}}), [
        "Slot", "Name", "Str", "Min", "Dex", "Con", "Per", "Spi", "Ac", "Align", "Rent"
    ]);
    assert.deepEqual(visibleColumns({
        itemColumns: [],
        builderColumns: {"profile-a": []}
    }), ["Name"]);
});

// Catches writes that change key names, omit secure cookie options, or fail to request the deployed twenty-year expiry.
test("builder persistence plan preserves current keys and exact cookie options", async function() {
    const {createBuilderPersistencePlan} = await loadPersistence();
    const writtenAt = new Date("2026-08-23T14:15:16.000Z");
    const plan = createBuilderPersistencePlan({
        hasConsent: true,
        exceptionEncountered: false,
        encodedLists: "7*Encoded*",
        selectedCharacter: "Hero",
        selectedVariant: "Tank",
        itemsPerPage: 50,
        selectedColumns: ["Slot", "Name"]
    }, writtenAt);

    assert.deepEqual(plan.storage, {cln: "7*Encoded*", scl: "Hero!Tank"});
    assert.deepEqual(plan.removeCookies, ["cl1", "scl1"]);
    assert.deepEqual(plan.cookies.map(cookie => [cookie.name, cookie.value]), [
        ["ipp", "50"], ["sc-Hero", "Slot-Name-"]
    ]);
    for (const cookie of plan.cookies) {
        assert.deepEqual(cookie.options, {
            path: "/", samesite: "lax", secure: true,
            expires: new Date("2046-08-23T14:15:16.000Z")
        });
    }
});

// Catches a correct persistence plan being applied to the wrong browser APIs or leaving migrated cookies behind.
test("builder persistence applies storage, cookie writes, and legacy removals", async function() {
    const {applyBuilderPersistencePlan} = await loadPersistence();
    const calls = [];
    const plan = {
        storage: {cln: "7*Encoded*", scl: "Hero!Tank"},
        cookies: [{name: "ipp", value: "50", options: {path: "/"}}],
        removeCookies: ["cl1", "scl1"]
    };
    applyBuilderPersistencePlan(plan, {
        storage: {setItem: (key, value) => calls.push(["storage", key, value])},
        cookies: {
            put: (name, value, options) => calls.push(["put", name, value, options]),
            get: name => name === "cl1" ? "present" : null,
            remove: name => calls.push(["remove", name])
        }
    });

    assert.deepEqual(calls, [
        ["storage", "cln", "7*Encoded*"],
        ["storage", "scl", "Hero!Tank"],
        ["put", "ipp", "50", {path: "/"}],
        ["remove", "cl1"]
    ]);
});

// Catches exception or denied-consent paths that overwrite the user's recoverable local data.
test("builder persistence refuses writes without consent or after an exception", async function() {
    const {createBuilderPersistencePlan} = await loadPersistence();
    const input = {
        hasConsent: false,
        exceptionEncountered: false,
        encodedLists: "7*Encoded*",
        selectedCharacter: "Hero",
        selectedVariant: "Original",
        itemsPerPage: 20,
        selectedColumns: []
    };
    assert.equal(createBuilderPersistencePlan(input), null);
    assert.equal(createBuilderPersistencePlan({...input, hasConsent: true, exceptionEncountered: true}), null);
});

// Catches verified account profiles or preferences leaking into the anonymous
// localStorage and consent-cookie persistence path.
test("account mode never creates an anonymous persistence plan", async function() {
    const {createBuilderPersistencePlan} = await loadPersistence();
    const input = {
        hasConsent: true,
        exceptionEncountered: false,
        encodedLists: "7*AccountPayload*",
        selectedCharacter: "Account Hero",
        selectedVariant: "Original",
        itemsPerPage: 50,
        selectedColumns: ["Slot", "Name"],
        storageMode: "account"
    };

    assert.equal(createBuilderPersistencePlan(input), null);
});

// Catches Builder account preferences using character names instead of stable
// profile IDs, dropping other profiles' columns, or omitting paging/selection.
test("builder account preference patch uses stable profile identity", async function() {
    const {createBuilderAccountPreferencePatch} = await loadPersistence();
    const document = {
        version: 1,
        theme: "dark",
        itemsPerPage: 20,
        itemColumns: ["Name"],
        builderColumns: {"profile-b": ["Str"]},
        selectedProfileId: "profile-b",
        selectedVariant: "Other"
    };

    assert.deepEqual(createBuilderAccountPreferencePatch({
        document,
        character: {name: "Renamed Hero", account: {id: "profile-a", revision: 5}},
        variant: {name: "Tank"},
        itemsPerPage: 50,
        selectedColumns: ["Name", "Rent"]
    }), {
        itemsPerPage: 50,
        builderColumns: {"profile-b": ["Str"], "profile-a": ["Name", "Rent"]},
        selectedProfileId: "profile-a",
        selectedVariant: "Tank"
    });
});

// Catches a reducer-driven profile deletion/conflict carrying the deleted
// profile's visible columns into the newly selected stable account profile.
test("account profile identity changes load the new profile columns before patching", async function() {
    const {
        accountPreferenceColumns,
        createBuilderAccountPreferencePatch
    } = await loadPersistence();
    const statInfo = [
        {short: "Name", showColumnDefault: true},
        {short: "Rent", showColumnDefault: false}
    ];
    const document = {
        itemColumns: [],
        builderColumns: {
            "deleted-profile": ["Rent"],
            "fallback-profile": ["Name"]
        }
    };
    const fallback = {name: "Scout", account: {id: "fallback-profile"}};
    const visible = accountPreferenceColumns(document, fallback, statInfo);

    assert.deepEqual(visible.map(stat => stat.showColumn), [true, false]);
    assert.deepEqual(createBuilderAccountPreferencePatch({
        document,
        character: fallback,
        variant: {name: "Original"},
        itemsPerPage: 20,
        selectedColumns: visible.filter(stat => stat.showColumn).map(stat => stat.short)
    }).builderColumns, {
        "deleted-profile": ["Rent"],
        "fallback-profile": ["Name"]
    });
});

// Catches the account separation guard changing even one anonymous key, value,
// removal, or cookie option when the caller supplies the explicit mode.
test("explicit anonymous mode remains byte-compatible with the deployed plan", async function() {
    const {createBuilderPersistencePlan} = await loadPersistence();
    const writtenAt = new Date("2026-08-23T14:15:16.000Z");
    const input = {
        hasConsent: true,
        exceptionEncountered: false,
        encodedLists: "7*Encoded*",
        selectedCharacter: "Hero",
        selectedVariant: "Tank",
        itemsPerPage: 50,
        selectedColumns: ["Slot", "Name"]
    };

    assert.deepEqual(
        createBuilderPersistencePlan({...input, storageMode: "anonymous"}, writtenAt),
        createBuilderPersistencePlan(input, writtenAt)
    );
});

// Catches storage-size display drift from the existing UTF-16 byte estimate and 10 MB label contract.
test("builder persistence calculates and formats client storage size", async function() {
    const {calculateStorageSize, formatStorageSize} = await loadPersistence();
    assert.equal(calculateStorageSize({cln: "1234", scl: "Hero"}), 28);
    assert.equal(formatStorageSize(2048), "Storage Size: 2.00KB/10MB 0.00%");
    assert.equal(formatStorageSize(0), "");
});
