import {useEffect, useReducer, useRef} from "react";
import {
    EDITABLE_NOTIFICATION_FIELDS,
    updateNotificationSettings,
    updatePassword
} from "./account-api.js";
import {accountReducer, createInitialAccountState} from "./account-reducer.js";

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

function useEditorFocus(status, error) {
    const triggerRef = useRef(null);
    const firstFieldRef = useRef(null);
    const pendingRef = useRef(null);
    const errorRef = useRef(null);
    const previousStatus = useRef(status);
    const previousError = useRef(error);

    useEffect(function() {
        if (status === "viewing" && previousStatus.current !== "viewing")
            triggerRef.current?.focus();
        else if (status === "editing" && previousStatus.current === "viewing")
            firstFieldRef.current?.focus();
        else if (status === "saving" && previousStatus.current !== "saving")
            pendingRef.current?.focus();
        else if (error && error !== previousError.current)
            errorRef.current?.focus();

        previousStatus.current = status;
        previousError.current = error;
    }, [status, error]);

    return {triggerRef, firstFieldRef, pendingRef, errorRef};
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

export default function AccountSettings({notificationSettings}) {
    const [state, dispatch] = useReducer(
        accountReducer,
        notificationSettings,
        createInitialAccountState
    );

    return (
        <main className="container">
            <div className="row text-center">
                <div className="col-12">
                    <h1>Account Settings</h1>
                </div>
            </div>
            <NotificationEditor editor={state.notificationEditor} dispatch={dispatch} />
            <PasswordEditor editor={state.passwordEditor} dispatch={dispatch} />
        </main>
    );
}
