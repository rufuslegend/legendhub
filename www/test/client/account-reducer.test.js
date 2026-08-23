"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

async function loadReducer() {
    return import("../../client/features/account/account-reducer.js");
}

const notificationSettings = {
    itemAdded: true,
    itemUpdated: false,
    mobAdded: true,
    mobUpdated: false,
    questAdded: true,
    questUpdated: false,
    wikiPageAdded: true,
    wikiPageUpdated: false,
    changelogAdded: true
};

test("initial state loads every route-provided notification setting", async function() {
    const {createInitialAccountState} = await loadReducer();

    assert.deepEqual(createInitialAccountState(notificationSettings), {
        notificationEditor: {
            status: "viewing",
            saved: notificationSettings,
            draft: notificationSettings,
            error: null
        },
        passwordEditor: {
            status: "viewing",
            oldPassword: "",
            newPassword: "",
            confirmPassword: "",
            error: null
        }
    });
});

test("notification editing tracks dirty values and cancel restores the saved snapshot", async function() {
    const {accountReducer, createInitialAccountState} = await loadReducer();
    let state = createInitialAccountState(notificationSettings);

    state = accountReducer(state, {type: "notification/edit"});
    state = accountReducer(state, {
        type: "notification/change",
        field: "itemUpdated",
        value: true
    });

    assert.equal(state.notificationEditor.status, "editing");
    assert.equal(state.notificationEditor.saved.itemUpdated, false);
    assert.equal(state.notificationEditor.draft.itemUpdated, true);
    assert.equal(state.notificationEditor.draft.changelogAdded, true);

    state = accountReducer(state, {type: "notification/cancel"});

    assert.equal(state.notificationEditor.status, "viewing");
    assert.deepEqual(state.notificationEditor.draft, notificationSettings);
});

test("notification saves move through pending, success, and network error states", async function() {
    const {accountReducer, createInitialAccountState} = await loadReducer();
    let state = createInitialAccountState(notificationSettings);
    state = accountReducer(state, {type: "notification/edit"});
    state = accountReducer(state, {
        type: "notification/change",
        field: "wikiPageUpdated",
        value: true
    });

    state = accountReducer(state, {type: "notification/save-requested"});
    assert.equal(state.notificationEditor.status, "saving");
    assert.equal(state.notificationEditor.error, null);

    state = accountReducer(state, {type: "notification/save-failed"});
    assert.equal(state.notificationEditor.status, "editing");
    assert.equal(state.notificationEditor.error, "network");
    assert.equal(state.notificationEditor.draft.wikiPageUpdated, true);

    state = accountReducer(state, {type: "notification/save-requested"});
    state = accountReducer(state, {type: "notification/save-succeeded"});
    assert.equal(state.notificationEditor.status, "viewing");
    assert.equal(state.notificationEditor.error, null);
    assert.equal(state.notificationEditor.saved.wikiPageUpdated, true);
    assert.equal(state.notificationEditor.saved.changelogAdded, true);
});

test("password save rejects mismatched values before entering the pending state", async function() {
    const {accountReducer, createInitialAccountState} = await loadReducer();
    let state = createInitialAccountState(notificationSettings);
    state = accountReducer(state, {type: "password/edit"});
    state = accountReducer(state, {
        type: "password/change",
        field: "oldPassword",
        value: "current-secret"
    });
    state = accountReducer(state, {
        type: "password/change",
        field: "newPassword",
        value: "new-secret"
    });
    state = accountReducer(state, {
        type: "password/change",
        field: "confirmPassword",
        value: "different-secret"
    });

    state = accountReducer(state, {type: "password/save-requested"});

    assert.equal(state.passwordEditor.status, "editing");
    assert.equal(state.passwordEditor.error, "mismatch");
});

test("password save reports invalid-current-password and network errors", async function() {
    const {accountReducer, createInitialAccountState} = await loadReducer();
    let state = createInitialAccountState(notificationSettings);
    state = accountReducer(state, {type: "password/edit"});
    for (const [field, value] of [
        ["oldPassword", "current-secret"],
        ["newPassword", "new-secret"],
        ["confirmPassword", "new-secret"]
    ]) {
        state = accountReducer(state, {type: "password/change", field, value});
    }

    state = accountReducer(state, {type: "password/save-requested"});
    assert.equal(state.passwordEditor.status, "saving");

    state = accountReducer(state, {type: "password/invalid-current-password"});
    assert.equal(state.passwordEditor.status, "editing");
    assert.equal(state.passwordEditor.error, "invalid-current-password");

    state = accountReducer(state, {type: "password/save-requested"});
    state = accountReducer(state, {type: "password/save-failed"});
    assert.equal(state.passwordEditor.status, "editing");
    assert.equal(state.passwordEditor.error, "network");
});

test("successful password saves and cancel clear all password values", async function() {
    const {accountReducer, createInitialAccountState} = await loadReducer();
    let state = createInitialAccountState(notificationSettings);
    state = accountReducer(state, {type: "password/edit"});
    for (const [field, value] of [
        ["oldPassword", "current-secret"],
        ["newPassword", "new-secret"],
        ["confirmPassword", "new-secret"]
    ]) {
        state = accountReducer(state, {type: "password/change", field, value});
    }
    state = accountReducer(state, {type: "password/save-requested"});
    state = accountReducer(state, {type: "password/save-succeeded"});

    assert.deepEqual(state.passwordEditor, {
        status: "viewing",
        oldPassword: "",
        newPassword: "",
        confirmPassword: "",
        error: null
    });

    state = accountReducer(state, {type: "password/edit"});
    state = accountReducer(state, {
        type: "password/change",
        field: "oldPassword",
        value: "discard-me"
    });
    state = accountReducer(state, {type: "password/cancel"});

    assert.deepEqual(state.passwordEditor, {
        status: "viewing",
        oldPassword: "",
        newPassword: "",
        confirmPassword: "",
        error: null
    });
});
