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
            announcement: null
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
        announcement: "verification-sent"
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

// Catches resend double-submit state getting stuck or failing to expose a
// live-region announcement after the request finishes.
test("email resend moves through pending, success, and network error states", async function() {
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
    assert.equal(state.emailEditor.password, "");
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
