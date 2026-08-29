"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

async function loadStore() {
    return import("../../client/lib/account-preferences-store.js");
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise(function(resolvePromise, rejectPromise) {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return {promise, reject, resolve};
}

function fakeClock() {
    let now = 0;
    let sequence = 0;
    const tasks = [];
    return {
        schedule(callback, delay) {
            const task = {callback, cancelled: false, due: now + delay, sequence: sequence++};
            tasks.push(task);
            return function cancel() { task.cancelled = true; };
        },
        tick(milliseconds) {
            now += milliseconds;
            const ready = tasks
                .filter(task => !task.cancelled && task.due <= now)
                .sort((left, right) => left.due - right.due || left.sequence - right.sequence);
            for (const task of ready) {
                task.cancelled = true;
                task.callback();
            }
        }
    };
}

const initialDocument = {
    version: 1,
    theme: "glass-blue",
    itemsPerPage: 20,
    itemColumns: ["Name"],
    builderColumns: {"profile-a": ["Rent"]},
    selectedProfileId: "profile-a",
    selectedVariant: "Original"
};

function savedResult(document, revision = 2, storageGeneration = 3) {
    return {
        status: "saved",
        preferences: JSON.stringify(document),
        preferenceRevision: revision,
        preferencesUpdatedOn: "2026-08-28T20:00:00.000Z",
        storageGeneration,
        usedBytes: 100,
        quotaBytes: 10_485_760
    };
}

// Catches page patches being saved independently instead of one complete,
// canonical preference document after the shared 750 ms trailing debounce.
test("preference store merges page patches and saves one canonical document", async function() {
    const {createAccountPreferencesStore} = await loadStore();
    const clock = fakeClock();
    const saved = [];
    const store = createAccountPreferencesStore({
        initialState: {
            enabled: true,
            payload: initialDocument,
            revision: 1,
            storageGeneration: 3
        },
        schedule: clock.schedule,
        save: async function(request) {
            saved.push(request);
            return savedResult(request.document);
        }
    });

    store.patch({theme: "dark"});
    store.patch({itemsPerPage: 50, selectedProfileId: "profile-a"});
    clock.tick(749);
    assert.equal(saved.length, 0);
    clock.tick(1);
    await store.flush();

    assert.equal(saved.length, 1);
    assert.deepEqual(saved[0], {
        document: {
            version: 1,
            theme: "dark",
            itemsPerPage: 50,
            itemColumns: ["Name"],
            builderColumns: {"profile-a": ["Rent"]},
            selectedProfileId: "profile-a",
            selectedVariant: "Original"
        },
        revision: 1,
        storageGeneration: 3
    });
});

// Catches an older in-flight completion rolling back a newer local patch or
// allowing two preference writes to race each other.
test("preference saves serialize and stale completions retain the latest patch", async function() {
    const {createAccountPreferencesStore} = await loadStore();
    const clock = fakeClock();
    const first = deferred();
    const second = deferred();
    const calls = [];
    const store = createAccountPreferencesStore({
        initialState: {enabled: true, payload: initialDocument, revision: 1, storageGeneration: 3},
        schedule: clock.schedule,
        save: function(request) {
            calls.push(request);
            return calls.length === 1 ? first.promise : second.promise;
        }
    });

    store.patch({theme: "dark"});
    clock.tick(750);
    assert.equal(calls.length, 1);
    store.patch({theme: "solarized-dark", itemsPerPage: 100});
    clock.tick(750);
    assert.equal(calls.length, 1);

    first.resolve(savedResult(calls[0].document, 2, 3));
    await first.promise;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 2);
    assert.equal(calls[1].document.theme, "solarized-dark");
    assert.equal(calls[1].document.itemsPerPage, 100);
    assert.equal(store.get().document.theme, "solarized-dark");

    second.resolve(savedResult(calls[1].document, 3, 3));
    await store.flush();
    assert.equal(store.get().revision, 3);
    assert.equal(store.get().status, "saved");
});

// Catches a page accepting a stale completion after the Builder account API
// supplied a fresher document, source, revision, or storage generation.
test("authoritative replacement invalidates timers and stale save completions", async function() {
    const {createAccountPreferencesStore} = await loadStore();
    const clock = fakeClock();
    const inFlight = deferred();
    const calls = [];
    const store = createAccountPreferencesStore({
        initialState: {enabled: true, payload: initialDocument, revision: 1, storageGeneration: 3},
        schedule: clock.schedule,
        save: function(request) { calls.push(request); return inFlight.promise; }
    });

    store.patch({theme: "dark"});
    clock.tick(750);
    assert.equal(calls.length, 1);
    store.replace({
        enabled: true,
        payload: {...initialDocument, theme: "high-contrast", itemsPerPage: 200},
        revision: 9,
        storageGeneration: 4
    });
    inFlight.resolve(savedResult(calls[0].document, 2, 3));
    await inFlight.promise;
    await store.flush();

    assert.equal(store.get().document.theme, "high-contrast");
    assert.equal(store.get().document.itemsPerPage, 200);
    assert.equal(store.get().revision, 9);
    assert.equal(store.get().storageGeneration, 4);
    assert.equal(calls.length, 1);
});

// Catches authoritative replacement starting a new write while the superseded
// bootstrap write is still physically in flight.
test("authoritative replacement preserves preference write serialization", async function() {
    const {createAccountPreferencesStore} = await loadStore();
    const clock = fakeClock();
    const first = deferred();
    const second = deferred();
    const calls = [];
    const store = createAccountPreferencesStore({
        initialState: {enabled: true, payload: initialDocument, revision: 1, storageGeneration: 3},
        schedule: clock.schedule,
        save: function(request) {
            calls.push(request);
            return calls.length === 1 ? first.promise : second.promise;
        }
    });

    store.patch({theme: "dark"});
    clock.tick(750);
    store.replace({
        enabled: true,
        payload: {...initialDocument, theme: "high-contrast"},
        revision: 9,
        storageGeneration: 4
    });
    store.patch({theme: "solarized-dark"});
    clock.tick(750);
    assert.equal(calls.length, 1);

    first.resolve(savedResult(calls[0].document, 2, 3));
    await first.promise;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 2);
    assert.equal(calls[1].document.theme, "solarized-dark");
    assert.equal(calls[1].revision, 9);
    assert.equal(calls[1].storageGeneration, 4);

    second.resolve(savedResult(calls[1].document, 10, 4));
    await store.flush();
    assert.equal(store.get().revision, 10);
    assert.equal(store.get().status, "saved");
});

// Catches a delayed Builder account-state response replacing a preference
// mutation that already committed at a newer revision on the same generation.
test("runtime replacement rejects an older same-generation account snapshot", async function() {
    const {createAccountPreferencesStore} = await loadStore();
    const clock = fakeClock();
    const store = createAccountPreferencesStore({
        initialState: {enabled: true, payload: initialDocument, revision: 5, storageGeneration: 3},
        schedule: clock.schedule,
        save: async request => savedResult(request.document, 6, 3)
    });

    store.patch({theme: "dark"});
    clock.tick(750);
    await store.flush();
    assert.equal(store.get().revision, 6);

    assert.equal(store.replace({
        enabled: true,
        payload: {...initialDocument, theme: "light"},
        revision: 5,
        storageGeneration: 3
    }), false);
    assert.equal(store.get().revision, 6);
    assert.equal(store.get().document.theme, "dark");
});

// Catches device-only, identity, storage, payload, and unknown fields entering
// either the canonical in-memory document or the authenticated save request.
test("preference patches discard private and unknown fields", async function() {
    const {createAccountPreferencesStore} = await loadStore();
    const clock = fakeClock();
    const calls = [];
    const store = createAccountPreferencesStore({
        initialState: {enabled: true, payload: initialDocument, revision: 1, storageGeneration: 3},
        schedule: clock.schedule,
        save: async request => { calls.push(request); return savedResult(request.document); }
    });

    store.patch({
        theme: "dark",
        cookieConsent: "private-consent",
        loginToken: "private-token",
        timezone: "private-timezone",
        email: "private@example.test",
        memberId: 73,
        storageNamespace: "private-namespace",
        profiles: [{payload: "private-payload"}],
        unknown: "private-unknown"
    });
    clock.tick(750);
    await store.flush();

    assert.deepEqual(Object.keys(store.get().document), [
        "version", "theme", "itemsPerPage", "itemColumns", "builderColumns",
        "selectedProfileId", "selectedVariant"
    ]);
    const serialized = JSON.stringify(calls);
    for (const privateValue of [
        "private-consent", "private-token", "private-timezone",
        "private@example.test", "private-namespace", "private-payload", "private-unknown"
    ])
        assert.equal(serialized.includes(privateValue), false);
});

// Catches a generation/conflict failure exposing a raw server diagnostic,
// reporting Saved, or mutating the last known account document.
test("preference failures remain independent, safe, and truthful", async function() {
    const {createAccountPreferencesStore} = await loadStore();
    const clock = fakeClock();
    const statuses = [];
    const store = createAccountPreferencesStore({
        initialState: {enabled: true, payload: initialDocument, revision: 4, storageGeneration: 3},
        schedule: clock.schedule,
        onStatus: status => statuses.push(status),
        save: async function() {
            const error = new Error("private database generation diagnostic");
            error.status = 409;
            throw error;
        }
    });

    store.patch({theme: "dark"});
    clock.tick(750);
    await store.flush();

    assert.equal(store.get().document.theme, "dark");
    assert.equal(store.get().revision, 4);
    assert.equal(store.get().storageGeneration, 3);
    assert.equal(store.get().status, "problem");
    assert.equal(JSON.stringify(statuses).includes("private database generation diagnostic"), false);
    assert.equal(statuses.at(-1).status, "problem");
});

// Catches logout/unmount leaving a timer or accepting an in-flight save result.
test("dispose cancels pending work and invalidates in-flight completions", async function() {
    const {createAccountPreferencesStore} = await loadStore();
    const clock = fakeClock();
    const calls = [];
    const store = createAccountPreferencesStore({
        initialState: {enabled: true, payload: initialDocument, revision: 1, storageGeneration: 3},
        schedule: clock.schedule,
        save: async request => { calls.push(request); return savedResult(request.document); }
    });

    store.patch({theme: "dark"});
    store.dispose();
    clock.tick(750);
    await store.flush();

    assert.equal(calls.length, 0);
    assert.equal(store.patch({theme: "light"}), false);
});

// Catches malformed bootstrap metadata being repaired into an enabled account
// store instead of failing closed until a fresh authenticated state arrives.
test("preference bootstrap fails closed on invalid revision or generation", async function() {
    const {createAccountPreferencesStore, readAccountPreferenceContext} = await loadStore();
    const bootstrapDocument = {
        querySelector() {
            return {textContent: JSON.stringify({
                enabled: true,
                payload: initialDocument,
                revision: 0,
                storageGeneration: "private-invalid-generation"
            })};
        }
    };

    assert.deepEqual(readAccountPreferenceContext(bootstrapDocument), {
        enabled: false,
        payload: null,
        revision: 0,
        storageGeneration: 0
    });

    for (const payload of [
        {...initialDocument, itemColumns: "Name-"},
        {...initialDocument, builderColumns: {"profile-a": "Rent-"}}
    ]) {
        assert.equal(createAccountPreferencesStore({
            initialState: {enabled: true, payload, revision: 1, storageGeneration: 1}
        }).get().enabled, false);
    }
});
