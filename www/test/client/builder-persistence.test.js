"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

async function loadPersistence() {
    return import("../../client/features/builder/builder-persistence.js");
}

// Catches storage reads that bypass consent or prefer obsolete list keys over the current cln payload.
test("builder persistence gates reads on consent and preserves storage fallback order", async function() {
    const {readBuilderPersistence} = await loadPersistence();
    const storage = {cln: "6*Current", cl2: "Old two", cl1: "Old one", cl: "Oldest", scl: "Hero!Tank"};

    assert.deepEqual(readBuilderPersistence({cookies: {}, storage}), {
        encodedLists: null, selectedList: null, itemsPerPage: 20, columns: null
    });
    assert.deepEqual(readBuilderPersistence({
        cookies: {"cookie-consent": "yes", ipp: "50", sc2: "Slot-Name-", scl1: "Cookie!Original"},
        storage,
        characterName: "Hero"
    }), {
        encodedLists: "6*Current",
        selectedList: "Hero!Tank",
        itemsPerPage: 50,
        columns: "Slot-Name-"
    });
});

// Catches any legacy key bypassing its required decoder-version prefix or being skipped when newer keys are absent.
test("builder persistence reads each deployed list-key fallback in order", async function() {
    const {readBuilderPersistence} = await loadPersistence();
    const cases = [
        [{cln: "6*Current", cl2: "Two", cl1: "One", cl: "Legacy"}, "6*Current"],
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
test("builder persistence applies scoped and fallback selected columns", async function() {
    const {applySelectedColumns, readBuilderPersistence} = await loadPersistence();
    const statInfo = [
        {short: "Slot", showColumnDefault: true},
        {short: "Name", showColumnDefault: true},
        {short: "Rent", showColumnDefault: false}
    ];
    const preference = readBuilderPersistence({
        cookies: {"cookie-consent": "yes", "sc-Hero": "Rent-", sc2: "Name-"},
        storage: {},
        characterName: "Hero"
    });

    assert.deepEqual(applySelectedColumns(preference.columns, statInfo).map(stat => stat.showColumn), [false, false, true]);
    assert.deepEqual(applySelectedColumns(null, statInfo).map(stat => stat.showColumn), [true, true, false]);
    assert.equal(statInfo[0].showColumn, undefined);
});

// Catches writes that change key names, omit secure cookie options, or fail to request the deployed twenty-year expiry.
test("builder persistence plan preserves current keys and exact cookie options", async function() {
    const {createBuilderPersistencePlan} = await loadPersistence();
    const writtenAt = new Date("2026-08-23T14:15:16.000Z");
    const plan = createBuilderPersistencePlan({
        hasConsent: true,
        exceptionEncountered: false,
        encodedLists: "6*Encoded*",
        selectedCharacter: "Hero",
        selectedVariant: "Tank",
        itemsPerPage: 50,
        selectedColumns: ["Slot", "Name"]
    }, writtenAt);

    assert.deepEqual(plan.storage, {cln: "6*Encoded*", scl: "Hero!Tank"});
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
        storage: {cln: "6*Encoded*", scl: "Hero!Tank"},
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
        ["storage", "cln", "6*Encoded*"],
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
        encodedLists: "6*Encoded*",
        selectedCharacter: "Hero",
        selectedVariant: "Original",
        itemsPerPage: 20,
        selectedColumns: []
    };
    assert.equal(createBuilderPersistencePlan(input), null);
    assert.equal(createBuilderPersistencePlan({...input, hasConsent: true, exceptionEncountered: true}), null);
});

// Catches storage-size display drift from the existing UTF-16 byte estimate and 10 MB label contract.
test("builder persistence calculates and formats client storage size", async function() {
    const {calculateStorageSize, formatStorageSize} = await loadPersistence();
    assert.equal(calculateStorageSize({cln: "1234", scl: "Hero"}), 28);
    assert.equal(formatStorageSize(2048), "Storage Size: 2.00KB/10MB 0.00%");
    assert.equal(formatStorageSize(0), "");
});
