"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

async function loadReducer() {
    return import("../../client/features/account/account-reducer.js");
}

async function loadAccountApi() {
    return import("../../client/features/account/account-api.js");
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

const emailStatus = {
    email: "old@example.com",
    verified: true,
    pendingEmail: null,
    canUseAccountStorage: true
};

test("initial state loads every route-provided notification setting", async function() {
    const {createInitialAccountState} = await loadReducer();

    assert.deepEqual(createInitialAccountState(notificationSettings, emailStatus), {
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
        },
        emailEditor: {
            status: "viewing",
            email: "old@example.com",
            draftEmail: "old@example.com",
            verified: true,
            pendingEmail: null,
            canUseAccountStorage: true,
            password: "",
            error: null,
            announcement: null,
            resendCooldownSeconds: 0
        },
        builderStorage: {
            enabled: false,
            profiles: [],
            usedBytes: 0,
            quotaBytes: 0,
            storageGeneration: 0,
            exportStatus: "idle",
            exportError: null,
            deleteDialogOpen: false,
            deleteStatus: "idle",
            deleteError: null,
            announcement: null
        }
    });
});

// Catches the destructive trigger itself starting a request, losing the
// server snapshot while merely opening the dialog, or allowing dialog closure
// while the confirmed request is pending.
test("Builder delete-all stays separate until confirmation and cannot close while pending", async function() {
    const {accountReducer, createInitialAccountState} = await loadReducer();
    const profiles = [{
        id: "profile-1",
        name: "Hero",
        revision: 4,
        updatedOn: "2026-08-28T00:00:00.000Z"
    }];
    let state = createInitialAccountState(notificationSettings, emailStatus, {
        enabled: true,
        profiles,
        usedBytes: 2048,
        quotaBytes: 10_485_760,
        storageGeneration: 7
    });

    state = accountReducer(state, {type: "storage/dialog-opened"});
    assert.equal(state.builderStorage.deleteDialogOpen, true);
    assert.equal(state.builderStorage.deleteStatus, "idle");
    assert.deepEqual(state.builderStorage.profiles, profiles);

    state = accountReducer(state, {type: "storage/delete-requested"});
    assert.equal(state.builderStorage.deleteStatus, "deleting");
    assert.equal(state.builderStorage.deleteDialogOpen, true);
    const pending = state;
    assert.equal(accountReducer(state, {type: "storage/dialog-closed"}), pending);
    assert.equal(accountReducer(state, {type: "storage/delete-requested"}), pending);
});

// Catches a lost response or malformed success clearing the UI optimistically,
// claiming no deletion occurred, or surfacing private diagnostics. A failure is
// ambiguous until the account state is loaded again.
test("Builder delete ambiguity retains the snapshot and requires a reload check", async function() {
    const {accountReducer, createInitialAccountState} = await loadReducer();
    const initialStorage = {
        enabled: true,
        profiles: [{
            id: "profile-1",
            name: "Hero",
            revision: 4,
            updatedOn: "2026-08-28T00:00:00.000Z"
        }],
        usedBytes: 2048,
        quotaBytes: 10_485_760,
        storageGeneration: 7
    };
    let state = createInitialAccountState(
        notificationSettings, emailStatus, initialStorage
    );
    state = accountReducer(state, {type: "storage/dialog-opened"});
    state = accountReducer(state, {type: "storage/delete-requested"});
    state = accountReducer(state, {
        type: "storage/delete-failed",
        error: "private database diagnostic 7*secret-payload*"
    });

    assert.deepEqual({
        profiles: state.builderStorage.profiles,
        usedBytes: state.builderStorage.usedBytes,
        quotaBytes: state.builderStorage.quotaBytes,
        storageGeneration: state.builderStorage.storageGeneration
    }, {
        profiles: initialStorage.profiles,
        usedBytes: initialStorage.usedBytes,
        quotaBytes: initialStorage.quotaBytes,
        storageGeneration: initialStorage.storageGeneration
    });
    assert.equal(state.builderStorage.deleteDialogOpen, true);
    assert.equal(state.builderStorage.deleteStatus, "idle");
    assert.equal(state.builderStorage.deleteError, "delete-unconfirmed");
    assert.equal(JSON.stringify(state).includes("private database diagnostic"), false);

    state = accountReducer({
        ...state,
        builderStorage: {...state.builderStorage, deleteStatus: "deleting"}
    }, {
        type: "storage/delete-succeeded",
        result: {status: "deleted"}
    });
    assert.equal(state.builderStorage.deleteError, "delete-unconfirmed");
    assert.deepEqual(state.builderStorage.profiles, initialStorage.profiles);
});

// Catches successful deletion retaining account rows, accepting a stale or
// malformed generation, or dropping the server-owned fixed quota.
test("Builder delete success clears account rows and adopts only a newer generation", async function() {
    const {accountReducer, createInitialAccountState} = await loadReducer();
    let state = createInitialAccountState(notificationSettings, emailStatus, {
        enabled: true,
        profiles: [{
            id: "profile-1",
            name: "Hero",
            revision: 4,
            updatedOn: "2026-08-28T00:00:00.000Z"
        }],
        usedBytes: 2048,
        quotaBytes: 10_485_760,
        storageGeneration: 7
    });
    state = accountReducer(state, {type: "storage/dialog-opened"});
    state = accountReducer(state, {type: "storage/delete-requested"});

    const staleResult = accountReducer(state, {
        type: "storage/delete-succeeded",
        result: {
            status: "deleted",
            storageGeneration: 7,
            usedBytes: 0,
            quotaBytes: 10_485_760
        }
    });
    assert.equal(staleResult.builderStorage.deleteError, "delete-unconfirmed");
    assert.equal(staleResult.builderStorage.profiles.length, 1);

    state = accountReducer(state, {
        type: "storage/delete-succeeded",
        result: {
            status: "deleted",
            storageGeneration: 8,
            usedBytes: 0,
            quotaBytes: 10_485_760
        }
    });
    assert.deepEqual(state.builderStorage.profiles, []);
    assert.equal(state.builderStorage.usedBytes, 0);
    assert.equal(state.builderStorage.quotaBytes, 10_485_760);
    assert.equal(state.builderStorage.storageGeneration, 8);
    assert.equal(state.builderStorage.deleteDialogOpen, false);
    assert.equal(state.builderStorage.announcement, "deleted");
});

// Catches export failure mutating account rows/generation, opening deletion,
// or preventing a later separately confirmed delete from being offered.
test("Builder export failure remains isolated from destructive state", async function() {
    const {accountReducer, createInitialAccountState} = await loadReducer();
    const profiles = [{
        id: "profile-1",
        name: "Hero",
        revision: 4,
        updatedOn: "2026-08-28T00:00:00.000Z"
    }];
    let state = createInitialAccountState(notificationSettings, emailStatus, {
        enabled: true,
        profiles,
        usedBytes: 2048,
        quotaBytes: 10_485_760,
        storageGeneration: 7
    });
    state = accountReducer(state, {type: "storage/export-requested"});
    assert.equal(state.builderStorage.exportStatus, "exporting");
    state = accountReducer(state, {
        type: "storage/export-failed",
        error: "private export payload 7*secret*"
    });

    assert.equal(state.builderStorage.exportError, "export-failed");
    assert.equal(state.builderStorage.deleteDialogOpen, false);
    assert.deepEqual(state.builderStorage.profiles, profiles);
    assert.equal(state.builderStorage.storageGeneration, 7);
    assert.equal(JSON.stringify(state).includes("private export payload"), false);

    state = accountReducer(state, {type: "storage/dialog-opened"});
    assert.equal(state.builderStorage.deleteDialogOpen, true);
    assert.equal(state.builderStorage.deleteStatus, "idle");
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

// Catches a completed email request leaving the current password in React
// state or leaving the editor open after the pending address is accepted.
test("email editor clears the password after success and returns to viewing", async function() {
    const {accountReducer, createInitialAccountState} = await loadReducer();
    let state = createInitialAccountState(notificationSettings, emailStatus);
    state = accountReducer(state, {type: "email/edit"});
    state = accountReducer(state, {
        type: "email/change",
        field: "email",
        value: "new@example.com"
    });
    state = accountReducer(state, {
        type: "email/change",
        field: "password",
        value: "secret"
    });
    state = accountReducer(state, {type: "email/save-requested"});
    state = accountReducer(state, {
        type: "email/save-succeeded",
        pendingEmail: "new@example.com"
    });

    assert.deepEqual(state.emailEditor, {
        status: "viewing",
        email: "old@example.com",
        draftEmail: "new@example.com",
        verified: true,
        pendingEmail: "new@example.com",
        canUseAccountStorage: true,
        password: "",
        error: null,
        announcement: "verification-sent",
        resendCooldownSeconds: 0
    });
});

// Catches failed requests retaining a sensitive password while showing the
// password error or a retryable network failure.
test("email editor clears the password after every failed request", async function() {
    const {accountReducer, createInitialAccountState} = await loadReducer();

    for (const failureType of ["email/invalid-current-password", "email/save-failed"]) {
        let state = createInitialAccountState(notificationSettings, emailStatus);
        state = accountReducer(state, {type: "email/edit"});
        state = accountReducer(state, {
            type: "email/change",
            field: "password",
            value: "discard-me"
        });
        state = accountReducer(state, {type: "email/save-requested"});
        state = accountReducer(state, {type: failureType});

        assert.equal(state.emailEditor.status, "editing");
        assert.equal(state.emailEditor.password, "");
        assert.equal(state.emailEditor.error,
            failureType === "email/save-failed" ? "network" : "invalid-current-password");
    }
});

// Catches resend double-submit state getting stuck, success/rate-limit
// responses leaving immediate repeats enabled, or the countdown failing to
// unlock after sixty client-side ticks.
test("email resend applies a sixty-second success and rate-limit cooldown", async function() {
    const {accountReducer, createInitialAccountState} = await loadReducer();
    let state = createInitialAccountState(notificationSettings, {
        ...emailStatus,
        pendingEmail: "new@example.com"
    });

    state = accountReducer(state, {type: "email/resend-requested"});
    assert.equal(state.emailEditor.status, "resending");
    assert.equal(state.emailEditor.announcement, null);

    state = accountReducer(state, {type: "email/resend-failed"});
    assert.equal(state.emailEditor.status, "viewing");
    assert.equal(state.emailEditor.error, "network");

    state = accountReducer(state, {type: "email/resend-requested"});
    state = accountReducer(state, {type: "email/resend-succeeded"});
    assert.equal(state.emailEditor.status, "viewing");
    assert.equal(state.emailEditor.error, null);
    assert.equal(state.emailEditor.announcement, "verification-sent");
    assert.equal(state.emailEditor.resendCooldownSeconds, 60);
    assert.equal(state.emailEditor.password, "");

    const coolingDown = state;
    assert.equal(accountReducer(state, {type: "email/resend-requested"}), coolingDown,
        "a cooldown must suppress an immediate resend");
    state = accountReducer(state, {type: "email/resend-cooldown-tick"});
    assert.equal(state.emailEditor.resendCooldownSeconds, 59);

    state = createInitialAccountState(notificationSettings, {
        ...emailStatus,
        pendingEmail: "new@example.com"
    });
    state = accountReducer(state, {type: "email/resend-requested"});
    state = accountReducer(state, {type: "email/resend-rate-limited"});
    assert.equal(state.emailEditor.status, "viewing");
    assert.equal(state.emailEditor.error, null);
    assert.equal(state.emailEditor.announcement, "resend-rate-limited");
    assert.equal(state.emailEditor.resendCooldownSeconds, 60);

    for (let remaining = 59; remaining >= 0; remaining -= 1)
        state = accountReducer(state, {type: "email/resend-cooldown-tick"});
    assert.equal(state.emailEditor.resendCooldownSeconds, 0);
    state = accountReducer(state, {type: "email/resend-requested"});
    assert.equal(state.emailEditor.status, "resending");
});

// Catches the browser adapter dropping the current password, failing to use
// the authenticated mutation, or omitting resend's token renewal persistence.
test("account email API sends authenticated change and resend mutations", async function(t) {
    const requests = [];
    t.mock.method(globalThis, "fetch", async function(_url, options) {
        const body = JSON.parse(options.body);
        requests.push(body);
        if (body.query.includes("RequestEmailChange")) {
            return {
                status: 200,
                async json() {
                    return {data: {requestEmailChange: {
                        success: true,
                        pendingEmail: "new@example.com",
                        tokenRenewal: {token: "renewed-change", expires: null}
                    }}};
                }
            };
        }
        return {
            status: 200,
            async json() {
                return {data: {resendVerification: {
                    accepted: true,
                    tokenRenewal: {token: "renewed-resend", expires: null}
                }}};
            }
        };
    });
    const document = {cookie: "loginToken=account-token"};
    const {requestEmailChange, resendVerification} = await loadAccountApi();

    assert.deepEqual(await requestEmailChange({
        email: "new@example.com",
        password: "current-secret"
    }, document), {
        success: true,
        pendingEmail: "new@example.com",
        tokenRenewal: {token: "renewed-change", expires: null}
    });
    document.cookie = "loginToken=account-token";
    assert.deepEqual(await resendVerification(document), {
        accepted: true,
        tokenRenewal: {token: "renewed-resend", expires: null}
    });

    assert.deepEqual(requests.map(request => request.variables), [{
        authToken: "account-token",
        currentPassword: "current-secret",
        email: "new@example.com"
    }, {authToken: "account-token"}]);
    assert.match(requests[0].query, /requestEmailChange/);
    assert.match(requests[1].query, /resendVerification/);
    assert.equal(document.cookie,
        "loginToken=renewed-resend; Path=/; SameSite=Lax; Secure");
});
