import {useEffect, useReducer, useRef, useState} from "react";
import {
    EDITABLE_NOTIFICATION_FIELDS,
    requestEmailChange,
    resendVerification,
    updateNotificationSettings,
    updatePassword
} from "./account-api.js";
import {accountReducer, createInitialAccountState} from "./account-reducer.js";
import BuilderStorageManager from "./BuilderStorageManager.jsx";
import {getPageAccountPreferencesStore} from "../../lib/account-preferences-store.js";

const notificationLabels = {
    itemAdded: "Item Added",
    itemUpdated: "Item Updated",
    mobAdded: "Mob Added",
    mobUpdated: "Mob Updated",
    questAdded: "Quest Added",
    questUpdated: "Quest Updated",
    wikiPageAdded: "Wiki Page Added",
    wikiPageUpdated: "Wiki Page Updated"
};

const passwordErrors = {
    mismatch: "New passwords do not match.",
    "invalid-current-password": "Current password is invalid.",
    network: "Password could not be saved. Try again."
};

const emailErrors = {
    "invalid-current-password": "Current password is invalid.",
    network: "Email settings could not be saved. Try again."
};

function isRateLimitError(error) {
    return Number(error?.code) === 429 || error?.errors?.some(function(entry) {
        return Number(entry?.code) === 429;
    });
}

function useEditorFocus(status, error) {
    const triggerRef = useRef(null);
    const firstFieldRef = useRef(null);
    const pendingRef = useRef(null);
    const errorRef = useRef(null);
    const previousStatus = useRef(status);
    const previousError = useRef(error);

    useEffect(function() {
        if (error && error !== previousError.current)
            errorRef.current?.focus();
        else if (status === "viewing" && previousStatus.current !== "viewing")
            triggerRef.current?.focus();
        else if (status === "editing" && previousStatus.current === "viewing")
            firstFieldRef.current?.focus();
        else if (["saving", "resending"].includes(status) &&
            previousStatus.current !== status)
            pendingRef.current?.focus();

        previousStatus.current = status;
        previousError.current = error;
    }, [status, error]);

    return {triggerRef, firstFieldRef, pendingRef, errorRef};
}

function EmailEditor({editor, dispatch}) {
    const editing = editor.status === "editing" || editor.status === "saving";
    const saving = editor.status === "saving";
    const resending = editor.status === "resending";
    const busy = saving || resending;
    const coolingDown = editor.resendCooldownSeconds > 0;
    const canResend = Boolean(editor.pendingEmail || (editor.email && !editor.verified));
    const focus = useEditorFocus(editor.status, editor.error);

    useEffect(function() {
        if (!coolingDown)
            return undefined;
        const timeout = setTimeout(function() {
            dispatch({type: "email/resend-cooldown-tick"});
        }, 1000);
        return function() { clearTimeout(timeout); };
    }, [coolingDown, editor.resendCooldownSeconds, dispatch]);

    async function save(event) {
        event.preventDefault();
        if (saving)
            return;

        dispatch({type: "email/save-requested"});
        try {
            const result = await requestEmailChange(editor);
            dispatch(result.success ? {
                type: "email/save-succeeded",
                pendingEmail: result.pendingEmail
            } : {type: "email/invalid-current-password"});
        }
        catch (_error) {
            dispatch({type: "email/save-failed"});
        }
    }

    async function resend() {
        if (resending || coolingDown)
            return;

        dispatch({type: "email/resend-requested"});
        try {
            await resendVerification();
            dispatch({type: "email/resend-succeeded"});
        }
        catch (error) {
            dispatch({
                type: isRateLimitError(error)
                    ? "email/resend-rate-limited"
                    : "email/resend-failed"
            });
        }
    }

    return (
        <section className="row py-3 border-bottom border-primary" aria-labelledby="email-heading">
            <div className={editing ? "col-12 col-lg-4" : "col-4 col-lg-4"}>
                <h2 className="h4" id="email-heading">Email</h2>
            </div>
            <div className={editing ? "col-12 col-lg-8" : "col-8 col-lg-8"}>
                {!editing && (
                    <div className="row align-items-start">
                        <div className="col-12 col-md-6 mb-2">
                            <p className={editor.pendingEmail ? "mb-1" : "mb-0"}>
                                <strong>Current:</strong>{" "}
                                {editor.email || "No email address added"}
                                {editor.email && ` (${editor.verified ? "verified" : "not verified"})`}
                            </p>
                            {editor.pendingEmail && (
                                <p className="mb-0">
                                    <strong>Pending:</strong> {editor.pendingEmail}
                                </p>
                            )}
                        </div>
                        <div className="col-12 col-md-6">
                            <div className="mb-2">
                                <button
                                    ref={focus.triggerRef}
                                    type="button"
                                    className="btn btn-default btn-block"
                                    aria-label={editor.email ? "Change email address" : "Add email address"}
                                    disabled={busy}
                                    onClick={() => dispatch({type: "email/edit"})}
                                >
                                    {editor.email ? "Change" : "Add"}
                                </button>
                            </div>
                            {canResend && (
                                <div className="mb-2">
                                    <button
                                        type="button"
                                        className="btn btn-outline-primary btn-block"
                                        aria-label={resending
                                            ? "Resending email verification"
                                            : coolingDown
                                                ? `Resend email verification in ${editor.resendCooldownSeconds} seconds`
                                                : "Resend email verification"}
                                        disabled={busy || coolingDown}
                                        onClick={resend}
                                    >
                                        {resending
                                            ? "Resending…"
                                            : coolingDown
                                                ? `Resend in ${editor.resendCooldownSeconds}s`
                                                : "Resend verification"}
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                )}
                {editing && (
                    <form onSubmit={save}>
                        <div className="form-group">
                            <label htmlFor="emailInput">Email address</label>
                            <input
                                ref={focus.firstFieldRef}
                                type="email"
                                className="form-control"
                                id="emailInput"
                                autoComplete="email"
                                value={editor.draftEmail}
                                disabled={saving}
                                required
                                onChange={(event) => dispatch({
                                    type: "email/change",
                                    field: "email",
                                    value: event.target.value
                                })}
                            />
                        </div>
                        <div className="form-group">
                            <label htmlFor="emailPasswordInput">Current Password</label>
                            <input
                                type="password"
                                className="form-control"
                                id="emailPasswordInput"
                                autoComplete="current-password"
                                value={editor.password}
                                disabled={saving}
                                required
                                aria-describedby={editor.error ? "email-error" : undefined}
                                onChange={(event) => dispatch({
                                    type: "email/change",
                                    field: "password",
                                    value: event.target.value
                                })}
                            />
                        </div>
                        <div className="row">
                            <div className="col-12 col-md-6">
                                <button
                                    type="submit"
                                    className="btn btn-primary btn-block"
                                    aria-label={saving ? "Saving email address" : "Save email address"}
                                    disabled={saving}
                                >
                                    {saving ? "Saving…" : "Save"}
                                </button>
                            </div>
                            <div className="col-12 col-md-6">
                                <button
                                    type="button"
                                    className="btn btn-link btn-block"
                                    aria-label="Cancel email changes"
                                    disabled={saving}
                                    onClick={() => dispatch({type: "email/cancel"})}
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </form>
                )}
                {editor.error && (
                    <p
                        ref={focus.errorRef}
                        className="text-danger mt-2"
                        id="email-error"
                        role="alert"
                        aria-live="assertive"
                        tabIndex="-1"
                    >
                        {emailErrors[editor.error]}
                    </p>
                )}
                {busy && (
                    <p
                        ref={focus.pendingRef}
                        className="text-info mt-2"
                        role="status"
                        aria-live="polite"
                        aria-label={resending
                            ? "Resending email verification"
                            : "Saving email address"}
                        tabIndex="-1"
                    >
                        {resending ? "Resending email verification…" : "Saving email address…"}
                    </p>
                )}
                {editor.announcement === "verification-sent" && (
                    <p className="text-success mt-2" role="status" aria-live="polite">
                        {editor.pendingEmail
                            ? "Verification email sent. The pending address remains inactive until verified."
                            : "Verification email sent. Your current address remains unverified until you use the link."}
                    </p>
                )}
                {coolingDown && (
                    <p
                        className="text-info mt-2"
                        role="status"
                        aria-live="polite"
                        aria-atomic="true"
                    >
                        {editor.announcement === "resend-rate-limited" &&
                            "The resend limit was reached. "}
                        You can resend verification in {editor.resendCooldownSeconds} seconds.
                    </p>
                )}
            </div>
        </section>
    );
}

function NotificationEditor({editor, dispatch}) {
    const editing = editor.status !== "viewing";
    const saving = editor.status === "saving";
    const focus = useEditorFocus(editor.status, editor.error);

    async function save(event) {
        event.preventDefault();
        if (saving)
            return;
        dispatch({type: "notification/save-requested"});
        try {
            await updateNotificationSettings(editor.draft);
            dispatch({type: "notification/save-succeeded"});
        }
        catch (_error) {
            dispatch({type: "notification/save-failed"});
        }
    }

    return (
        <section className="row py-3 border-bottom border-primary" aria-labelledby="notifications-heading">
            <div className={editing ? "col-12 col-lg-4" : "col-4 col-lg-4"}>
                <h2 className="h4" id="notifications-heading">Notifications</h2>
            </div>
            <div className={editing ? "col-12 col-lg-8" : "offset-4 col-4"}>
                {!editing && (
                    <button
                        ref={focus.triggerRef}
                        type="button"
                        className="btn btn-default btn-block"
                        aria-label="Edit notification settings"
                        onClick={() => dispatch({type: "notification/edit"})}
                    >
                        Edit
                    </button>
                )}
                {editing && (
                    <form onSubmit={save}>
                        <div className="row">
                            {EDITABLE_NOTIFICATION_FIELDS.map(function(field) {
                                return (
                                    <div className="col-12 col-md-6 mb-3" key={field}>
                                        <div className="input-group">
                                            <div className="input-group-prepend">
                                                <label className="input-group-text" htmlFor={`${field}Input`}>
                                                    {notificationLabels[field]}
                                                </label>
                                            </div>
                                            <select
                                                ref={field === EDITABLE_NOTIFICATION_FIELDS[0]
                                                    ? focus.firstFieldRef
                                                    : undefined}
                                                className="custom-select"
                                                id={`${field}Input`}
                                                value={String(editor.draft[field])}
                                                disabled={saving}
                                                onChange={(event) => dispatch({
                                                    type: "notification/change",
                                                    field,
                                                    value: event.target.value === "true"
                                                })}
                                            >
                                                <option value="false">Off</option>
                                                <option value="true">On</option>
                                            </select>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        {editor.error === "network" && (
                            <p
                                ref={focus.errorRef}
                                className="text-danger"
                                role="alert"
                                aria-live="assertive"
                                tabIndex="-1"
                            >
                                Notification settings could not be saved. Try again.
                            </p>
                        )}
                        {saving && (
                            <p
                                ref={focus.pendingRef}
                                className="text-info"
                                role="status"
                                aria-label="Saving notification settings"
                                tabIndex="-1"
                            >
                                Saving notification settings…
                            </p>
                        )}
                        <div className="row">
                            <div className="col-12 col-md-6">
                                <button
                                    type="submit"
                                    className="btn btn-primary btn-block"
                                    aria-label={saving
                                        ? "Saving notification settings"
                                        : "Save notification settings"}
                                    disabled={saving}
                                >
                                    {saving ? "Saving…" : "Save"}
                                </button>
                            </div>
                            <div className="col-12 col-md-6">
                                <button
                                    type="button"
                                    className="btn btn-link btn-block"
                                    aria-label="Cancel notification changes"
                                    disabled={saving}
                                    onClick={() => dispatch({type: "notification/cancel"})}
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </form>
                )}
            </div>
        </section>
    );
}

function PreferencesEditor({store}) {
    const [preferences, setPreferences] = useState(() => store?.get?.() || null);

    useEffect(function() {
        if (!store)
            return undefined;
        setPreferences(store.get());
        return store.subscribe(setPreferences);
    }, [store]);

    const enabled = preferences?.enabled === true;
    const document = preferences?.document || {
        itemPreviews: true,
        hideEquipmentZeros: false
    };
    function change(field, event) {
        store?.patch?.({[field]: event.target.value === "true"});
    }

    return (
        <section className="row py-3 border-bottom border-primary" aria-labelledby="preferences-heading">
            <div className="col-12 col-lg-4">
                <h2 className="h4" id="preferences-heading">Preferences</h2>
            </div>
            <div className="col-12 col-lg-8">
                <div className="row">
                    <div className="col-12 col-md-6 mb-3">
                        <div className="input-group">
                            <div className="input-group-prepend">
                                <label className="input-group-text" htmlFor="itemPreviewsInput">
                                    Pop-up stat windows
                                </label>
                            </div>
                            <select
                                className="custom-select"
                                id="itemPreviewsInput"
                                value={String(document.itemPreviews)}
                                disabled={!enabled}
                                onChange={(event) => change("itemPreviews", event)}
                            >
                                <option value="false">Off</option>
                                <option value="true">On</option>
                            </select>
                        </div>
                    </div>
                    <div className="col-12 col-md-6 mb-3">
                        <div className="input-group">
                            <div className="input-group-prepend">
                                <label className="input-group-text" htmlFor="hideEquipmentZerosInput">
                                    Hide zeros in equipment tables
                                </label>
                            </div>
                            <select
                                className="custom-select"
                                id="hideEquipmentZerosInput"
                                value={String(document.hideEquipmentZeros)}
                                disabled={!enabled}
                                onChange={(event) => change("hideEquipmentZeros", event)}
                            >
                                <option value="false">Off</option>
                                <option value="true">On</option>
                            </select>
                        </div>
                    </div>
                </div>
                {!enabled && (
                    <p className="text-muted mb-0">
                        {preferences?.account === true
                            ? "Account preferences are temporarily unavailable."
                            : "Verify your email address to save account preferences."}
                    </p>
                )}
            </div>
        </section>
    );
}

function PasswordEditor({editor, dispatch}) {
    const editing = editor.status !== "viewing";
    const saving = editor.status === "saving";
    const focus = useEditorFocus(editor.status, editor.error);

    async function save(event) {
        event.preventDefault();
        if (saving)
            return;

        dispatch({type: "password/save-requested"});
        if (editor.newPassword !== editor.confirmPassword)
            return;

        try {
            const result = await updatePassword(editor);
            dispatch({
                type: result.success
                    ? "password/save-succeeded"
                    : "password/invalid-current-password"
            });
        }
        catch (_error) {
            dispatch({type: "password/save-failed"});
        }
    }

    function change(field, event) {
        dispatch({type: "password/change", field, value: event.target.value});
    }

    return (
        <section className="row py-3" aria-labelledby="password-heading">
            <div className={editing ? "col-12 col-lg-4" : "col-4 col-lg-4"}>
                <h2 className="h4" id="password-heading">Password</h2>
            </div>
            <div className={editing ? "col-12 col-lg-8" : "offset-4 col-4"}>
                {!editing && (
                    <button
                        ref={focus.triggerRef}
                        type="button"
                        className="btn btn-default btn-block"
                        aria-label="Change password"
                        onClick={() => dispatch({type: "password/edit"})}
                    >
                        Change
                    </button>
                )}
                {editing && (
                    <form onSubmit={save}>
                        <div className="row justify-content-end">
                            <div className="col-12 col-md-6">
                                <div className="form-group">
                                    <label htmlFor="oldPasswordInput">Current Password</label>
                                    <input
                                        ref={focus.firstFieldRef}
                                        type="password"
                                        className="form-control"
                                        id="oldPasswordInput"
                                        autoComplete="current-password"
                                        value={editor.oldPassword}
                                        disabled={saving}
                                        required
                                        onChange={(event) => change("oldPassword", event)}
                                    />
                                </div>
                                <div className="form-group">
                                    <label htmlFor="newPasswordInput">New Password</label>
                                    <input
                                        type="password"
                                        className="form-control"
                                        id="newPasswordInput"
                                        autoComplete="new-password"
                                        value={editor.newPassword}
                                        disabled={saving}
                                        required
                                        onChange={(event) => change("newPassword", event)}
                                    />
                                </div>
                                <div className="form-group">
                                    <label htmlFor="confirmPasswordInput">Confirm Password</label>
                                    <input
                                        type="password"
                                        className="form-control"
                                        id="confirmPasswordInput"
                                        autoComplete="new-password"
                                        value={editor.confirmPassword}
                                        disabled={saving}
                                        required
                                        aria-describedby={editor.error ? "password-error" : undefined}
                                        onChange={(event) => change("confirmPassword", event)}
                                    />
                                </div>
                            </div>
                        </div>
                        {editor.error && (
                            <p
                                ref={focus.errorRef}
                                className="text-danger"
                                id="password-error"
                                role="alert"
                                aria-live="assertive"
                                tabIndex="-1"
                            >
                                {passwordErrors[editor.error]}
                            </p>
                        )}
                        {saving && (
                            <p
                                ref={focus.pendingRef}
                                className="text-info"
                                role="status"
                                aria-label="Saving password"
                                tabIndex="-1"
                            >
                                Saving password…
                            </p>
                        )}
                        <div className="row">
                            <div className="col-12 col-md-6">
                                <button
                                    type="submit"
                                    className="btn btn-primary btn-block"
                                    aria-label={saving ? "Saving password" : "Save password"}
                                    disabled={saving}
                                >
                                    {saving ? "Saving…" : "Save"}
                                </button>
                            </div>
                            <div className="col-12 col-md-6">
                                <button
                                    type="button"
                                    className="btn btn-link btn-block"
                                    aria-label="Cancel password changes"
                                    disabled={saving}
                                    onClick={() => dispatch({type: "password/cancel"})}
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </form>
                )}
            </div>
        </section>
    );
}

export default function AccountSettings({
    notificationSettings,
    emailStatus,
    builderStorage
}) {
    const preferenceStoreRef = useRef(getPageAccountPreferencesStore());
    const [state, dispatch] = useReducer(
        accountReducer,
        {notificationSettings, emailStatus, builderStorage},
        initial => createInitialAccountState(
            initial.notificationSettings,
            initial.emailStatus,
            initial.builderStorage
        )
    );

    return (
        <main className="container">
            <div className="row text-center">
                <div className="col-12">
                    <h1>Account Settings</h1>
                </div>
            </div>
            <EmailEditor editor={state.emailEditor} dispatch={dispatch} />
            <BuilderStorageManager storage={state.builderStorage} dispatch={dispatch} />
            <PreferencesEditor store={preferenceStoreRef.current} />
            <NotificationEditor editor={state.notificationEditor} dispatch={dispatch} />
            <PasswordEditor editor={state.passwordEditor} dispatch={dispatch} />
        </main>
    );
}
