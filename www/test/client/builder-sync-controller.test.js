"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

async function loadController() {
    return import("../../client/features/builder/builder-sync-controller.js");
}

function createClock() {
    let now = 0;
    let nextId = 1;
    const jobs = new Map();
    const delays = [];

    function schedule(callback, delay) {
        const id = nextId++;
        delays.push(delay);
        jobs.set(id, {id, at: now + delay, callback});
        return id;
    }

    function cancel(id) {
        jobs.delete(id);
    }

    function tick(milliseconds) {
        const end = now + milliseconds;
        while (true) {
            const next = [...jobs.values()]
                .filter(job => job.at <= end)
                .sort((left, right) => left.at - right.at || left.id - right.id)[0];
            if (!next)
                break;
            jobs.delete(next.id);
            now = next.at;
            next.callback();
        }
        now = end;
    }

    async function settle() {
        for (let index = 0; index < 8; index += 1)
            await Promise.resolve();
    }

    async function runAll(limit = 50) {
        for (let count = 0; jobs.size && count < limit; count += 1) {
            const next = [...jobs.values()].sort((left, right) => left.at - right.at || left.id - right.id)[0];
            tick(next.at - now);
            await settle();
        }
        assert.ok(jobs.size === 0, "fake clock exhausted its run limit");
    }

    return {schedule, cancel, tick, settle, runAll, delays, pending: () => jobs.size};
}

function snapshot(overrides = {}) {
    return {
        id: "profile-1",
        name: "Hero",
        payload: "6*Hero~Original~first*",
        revision: 4,
        storageGeneration: 2,
        fingerprint: "first",
        ...overrides
    };
}

function networkError() {
    return new TypeError("private network diagnostic");
}

function applicationError(code, message = "private application diagnostic") {
    const error = new Error(message);
    error.name = "GraphQLRequestError";
    error.errors = [{message, code}];
    return error;
}

function authorizationError() {
    const error = new Error("Authorization required.");
    error.name = "GraphQLRequestError";
    error.errors = [];
    return error;
}

// Production break caught: using a leading-edge timer or failing to cancel the
// first timer saves twice, or saves before 750 ms after the final edit.
test("multiple edits save once 750 ms after the last edit", async function() {
    const {createBuilderSyncController} = await loadController();
    const clock = createClock();
    const saves = [];
    const controller = createBuilderSyncController({
        saveProfile: async value => {
            saves.push(value);
            return {status: "saved", profile: {...value, revision: value.revision + 1, updatedOn: "2026-08-28T12:00:00.000Z"}};
        },
        deleteProfile: async () => ({status: "deleted"}),
        schedule: clock.schedule,
        cancel: clock.cancel,
        onResult() {},
        onStatus() {}
    });
    const first = snapshot();
    const second = snapshot({payload: "6*Hero~Original~second*", fingerprint: "second"});

    controller.queue(first);
    clock.tick(500);
    controller.queue(second);
    clock.tick(749);
    await clock.settle();
    assert.equal(saves.length, 0);
    clock.tick(1);
    await clock.settle();

    assert.deepEqual(saves, [second]);
});

// Production break caught: retrying validation/application failures, using an
// unbounded exponential schedule, or losing the edited snapshot during retry.
test("network retries are bounded to 30 seconds and validation never retries", async function() {
    const {createBuilderSyncController} = await loadController();
    const clock = createClock();
    const calls = [];
    let outcomes = [networkError(), networkError(), {status: "saved", profile: {
        ...snapshot(), revision: 5, updatedOn: "2026-08-28T12:00:00.000Z"
    }}];
    const controller = createBuilderSyncController({
        saveProfile: async value => {
            calls.push(value);
            const outcome = outcomes.shift();
            if (outcome instanceof Error)
                throw outcome;
            return outcome;
        },
        deleteProfile: async () => ({status: "deleted"}),
        schedule: clock.schedule,
        cancel: clock.cancel,
        onResult() {},
        onStatus() {}
    });

    controller.queue(snapshot());
    await clock.runAll();
    assert.equal(calls.length, 3);
    assert.deepEqual(clock.delays, [750, 1000, 2000]);

    outcomes = [applicationError(400)];
    controller.queue(snapshot({payload: "6*Hero~Original~invalid*", fingerprint: "invalid", revision: 5}));
    await clock.runAll();
    assert.equal(calls.length, 4);
    assert.deepEqual(clock.delays, [750, 1000, 2000, 750]);

    outcomes = [authorizationError()];
    controller.queue(snapshot({payload: "6*Hero~Original~auth*", fingerprint: "auth", revision: 5}));
    await clock.runAll();
    assert.equal(calls.length, 5);
    assert.deepEqual(clock.delays, [750, 1000, 2000, 750, 750]);

    const boundedClock = createClock();
    let boundedCalls = 0;
    const bounded = createBuilderSyncController({
        saveProfile: async () => {
            boundedCalls += 1;
            throw networkError();
        },
        deleteProfile: async () => ({status: "deleted"}),
        schedule: boundedClock.schedule,
        cancel: boundedClock.cancel,
        onResult() {},
        onStatus() {}
    });
    bounded.queue(snapshot());
    await boundedClock.runAll();
    assert.equal(boundedCalls, 6);
    assert.deepEqual(boundedClock.delays, [750, 1000, 2000, 4000, 8000, 15000]);
});

// Production break caught: one failed profile owning a global queue blocks a
// second profile, or a later edit is discarded when an earlier request ends.
test("profiles queue independently and an in-flight save preserves the newest edit", async function() {
    const {createBuilderSyncController} = await loadController();
    const clock = createClock();
    const calls = [];
    const results = [];
    let releaseHero;
    const firstHero = new Promise(resolve => { releaseHero = resolve; });
    const controller = createBuilderSyncController({
        saveProfile: async value => {
            calls.push(value);
            if (value.id === "profile-1" && value.fingerprint === "first")
                return firstHero;
            return {status: "saved", profile: {
                ...value,
                id: value.id || "created-id",
                revision: value.revision + 1,
                updatedOn: "2026-08-28T12:00:00.000Z"
            }};
        },
        deleteProfile: async () => ({status: "deleted"}),
        schedule: clock.schedule,
        cancel: clock.cancel,
        onResult: value => results.push(value),
        onStatus() {}
    });
    const scout = snapshot({id: "profile-2", name: "Scout", fingerprint: "scout", payload: "6*Scout~Original~scout*"});
    const newestHero = snapshot({fingerprint: "newest", payload: "6*Hero~Original~newest*"});

    controller.queue(snapshot());
    controller.queue(scout);
    clock.tick(750);
    await clock.settle();
    assert.deepEqual(calls.map(value => value.name), ["Hero", "Scout"]);
    assert.equal(results.length, 1);

    controller.queue(newestHero);
    clock.tick(750);
    releaseHero({status: "saved", profile: {
        ...snapshot(), revision: 5, updatedOn: "2026-08-28T12:00:00.000Z"
    }});
    await clock.settle();

    assert.equal(calls.length, 3);
    assert.equal(calls[2].fingerprint, "newest");
    assert.equal(calls[2].revision, 5);
});

// Production break caught: a newer edit whose debounce expires while an older
// request is in flight is stranded if the older request later fails.
test("a stale in-flight failure immediately continues with the debounced newest edit", async function() {
    const {createBuilderSyncController} = await loadController();
    const clock = createClock();
    const calls = [];
    let rejectFirst;
    const firstRequest = new Promise((_resolve, reject) => { rejectFirst = reject; });
    const controller = createBuilderSyncController({
        saveProfile: async value => {
            calls.push(value);
            if (value.fingerprint === "first")
                return firstRequest;
            return {status: "saved", profile: {
                ...value,
                revision: value.revision + 1,
                updatedOn: "2026-08-28T12:00:00.000Z"
            }};
        },
        deleteProfile: async () => ({status: "deleted"}),
        schedule: clock.schedule,
        cancel: clock.cancel,
        onResult() {},
        onStatus() {}
    });

    controller.queue(snapshot());
    clock.tick(750);
    await clock.settle();
    controller.queue(snapshot({fingerprint: "newest", payload: "6*Hero~Original~newest*"}));
    clock.tick(750);
    await clock.settle();
    assert.equal(calls.length, 1);

    rejectFirst(networkError());
    await clock.settle();

    assert.equal(calls.length, 2);
    assert.equal(calls[1].fingerprint, "newest");
    assert.equal(clock.pending(), 0);
});

// Production break caught: a resolved conflict is retried as a network error,
// raw diagnostics cross the callback, or later ordinary status clears recovery.
test("conflicts are committed once and retain a persistent recovery status", async function() {
    const {createBuilderSyncController} = await loadController();
    const clock = createClock();
    const statuses = [];
    const results = [];
    const current = {...snapshot(), revision: 5, updatedOn: "2026-08-28T12:00:00.000Z"};
    const conflict = snapshot({id: "conflict-id", name: "Hero Conflict", revision: 1, fingerprint: "conflict"});
    const controller = createBuilderSyncController({
        saveProfile: async () => ({status: "conflict", profile: current, conflictProfile: conflict}),
        deleteProfile: async () => ({status: "deleted"}),
        schedule: clock.schedule,
        cancel: clock.cancel,
        onResult: value => results.push(value),
        onStatus: value => statuses.push(value)
    });

    controller.queue(snapshot());
    await clock.runAll();
    assert.equal(results.length, 1);
    assert.equal(results[0].type, "conflict");
    assert.equal(statuses.at(-1).status, "conflict");

    controller.queue(snapshot({id: "profile-2", name: "Scout", fingerprint: "scout"}));
    await clock.runAll();
    assert.equal(statuses.at(-1).status, "conflict");
});

// Production break caught: generation rejection leaves other timers alive or
// a completion from a disposed account session mutates the next session.
test("generation change cancels every queue and dispose ignores stale completions", async function() {
    const {createBuilderSyncController} = await loadController();
    const clock = createClock();
    const statuses = [];
    const results = [];
    let calls = 0;
    const controller = createBuilderSyncController({
        saveProfile: async value => {
            calls += 1;
            if (value.id === "profile-1")
                throw applicationError(409, "Account storage changed. Reload before saving.");
            return {status: "saved", profile: {...value, revision: 5, updatedOn: "2026-08-28T12:00:00.000Z"}};
        },
        deleteProfile: async () => ({status: "deleted"}),
        schedule: clock.schedule,
        cancel: clock.cancel,
        onResult: value => results.push(value),
        onStatus: value => statuses.push(value)
    });
    controller.queue(snapshot());
    clock.tick(1);
    controller.queue(snapshot({id: "profile-2", name: "Scout", fingerprint: "scout"}));
    await clock.runAll();

    assert.equal(calls, 1);
    assert.equal(results.at(-1).type, "generation-changed");
    assert.equal(statuses.at(-1).status, "generation-changed");
    controller.queue(snapshot({id: "profile-3", name: "Mage", fingerprint: "mage"}));
    assert.equal(clock.pending(), 0);

    const staleClock = createClock();
    const staleResults = [];
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const staleController = createBuilderSyncController({
        saveProfile: async () => pending,
        deleteProfile: async () => ({status: "deleted"}),
        schedule: staleClock.schedule,
        cancel: staleClock.cancel,
        onResult: value => staleResults.push(value),
        onStatus() {}
    });
    staleController.queue(snapshot());
    staleClock.tick(750);
    await staleClock.settle();
    staleController.dispose();
    release({status: "saved", profile: {...snapshot(), revision: 5, updatedOn: "2026-08-28T12:00:00.000Z"}});
    await staleClock.settle();
    assert.deepEqual(staleResults, []);
});

// Production break caught: confirmed deletion waits for the debounce window,
// sends an unsaved placeholder, or removes local state before server success.
test("confirmed saved-profile deletion starts immediately and reports only committed deletion", async function() {
    const {createBuilderSyncController} = await loadController();
    const clock = createClock();
    const deletes = [];
    const results = [];
    const controller = createBuilderSyncController({
        saveProfile: async value => ({status: "saved", profile: value}),
        deleteProfile: async value => {
            deletes.push(value);
            return {status: "deleted", profile: {...value, revision: value.revision + 1}};
        },
        schedule: clock.schedule,
        cancel: clock.cancel,
        onResult: value => results.push(value),
        onStatus() {}
    });

    controller.remove(snapshot());
    await clock.settle();
    assert.equal(clock.delays.length, 0);
    assert.deepEqual(deletes, [snapshot()]);
    assert.equal(results.at(-1).type, "deleted");

    controller.remove(snapshot({id: null, revision: 0, name: "Unsaved", queueKey: "local-1"}));
    await clock.settle();
    assert.equal(deletes.length, 1);
});

// Production break caught: deleting an unsaved row while its create is in
// flight leaves a permanent Saving state when that create fails.
test("a failed in-flight create settles after its unsaved row was deleted", async function() {
    const {createBuilderSyncController} = await loadController();
    const clock = createClock();
    const statuses = [];
    let rejectCreate;
    const pendingCreate = new Promise((_resolve, reject) => { rejectCreate = reject; });
    const unsaved = snapshot({id: null, revision: 0, queueKey: "local-1"});
    const controller = createBuilderSyncController({
        saveProfile: async () => pendingCreate,
        deleteProfile: async () => {
            assert.fail("a create that never committed must not be deleted from the server");
        },
        schedule: clock.schedule,
        cancel: clock.cancel,
        onResult() {},
        onStatus: value => statuses.push(value)
    });

    controller.queue(unsaved);
    clock.tick(750);
    await clock.settle();
    controller.remove(unsaved);
    rejectCreate(networkError());
    await clock.settle();

    assert.equal(clock.pending(), 0);
    assert.equal(statuses.at(-1).status, "saved");
});

// Production break caught: flush leaves a debounce timer behind or resolves
// before the queued server write has committed.
test("flush commits every debounced profile immediately", async function() {
    const {createBuilderSyncController} = await loadController();
    const clock = createClock();
    const saves = [];
    const controller = createBuilderSyncController({
        saveProfile: async value => {
            saves.push(value.id);
            return {status: "saved", profile: {
                ...value, revision: value.revision + 1,
                updatedOn: "2026-08-28T12:00:00.000Z"
            }};
        },
        deleteProfile: async () => ({status: "deleted"}),
        schedule: clock.schedule,
        cancel: clock.cancel,
        onResult() {},
        onStatus() {}
    });
    controller.queue(snapshot());
    controller.queue(snapshot({id: "profile-2", name: "Scout", fingerprint: "scout"}));

    await controller.flush();

    assert.deepEqual(saves, ["profile-1", "profile-2"]);
    assert.equal(clock.pending(), 0);
});
