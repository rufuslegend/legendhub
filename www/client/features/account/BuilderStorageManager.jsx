import {useEffect, useRef} from "react";
import {BuilderModal} from "../builder/ImportExportDialog.jsx";
import {
    deleteAllAccountBuilderData,
    exportAccountBuilderData
} from "./account-api.js";
import {formatBuilderStorageUsage} from "./account-reducer.js";

const EXPORT_ERROR = "Builder data could not be exported. Try again.";
const DELETE_ERROR =
    "Deletion could not be confirmed. Reload this page and check your synced Builder data before trying again.";

function exportFilename(date = new Date()) {
    return `legendhub-builder-${date.toISOString().slice(0, 10)}.txt`;
}

function downloadPayload(payload) {
    if (typeof payload !== "string" || !/^\d+\*/.test(payload))
        throw new Error("Invalid Builder export response.");

    const blob = new Blob([payload], {type: "text/plain;charset=utf-8"});
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    try {
        anchor.href = objectUrl;
        anchor.download = exportFilename();
        anchor.hidden = true;
        document.body.appendChild(anchor);
        anchor.click();
    }
    finally {
        anchor.remove();
        URL.revokeObjectURL(objectUrl);
    }
}

function DeleteAllDialog({storage, dispatch, requestPendingRef}) {
    const errorRef = useRef(null);
    const deleting = storage.deleteStatus === "deleting";

    useEffect(function() {
        if (storage.deleteError)
            errorRef.current?.focus();
    }, [storage.deleteError]);

    async function confirmDelete() {
        if (requestPendingRef.current)
            return;
        requestPendingRef.current = true;
        dispatch({type: "storage/delete-requested"});
        try {
            const result = await deleteAllAccountBuilderData({
                storageGeneration: storage.storageGeneration
            });
            dispatch({type: "storage/delete-succeeded", result});
        }
        catch (_error) {
            dispatch({type: "storage/delete-failed"});
        }
        finally {
            requestPendingRef.current = false;
        }
    }

    return (
        <BuilderModal
            label="Delete all synced Builder data"
            onClose={() => dispatch({type: "storage/dialog-closed"})}
            closeDisabled={deleting}
            initialFocus="#builder-storage-delete-cancel"
        >
            <div className="modal-body">
                <p>
                    This permanently deletes every Builder profile synchronized
                    to your account. Data saved anonymously in this browser is
                    not changed.
                </p>
                <p><strong>This action cannot be undone.</strong></p>
                {storage.deleteError && (
                    <>
                        <p
                            ref={errorRef}
                            className="text-danger"
                            role="alert"
                            tabIndex="-1"
                        >
                            {DELETE_ERROR}
                        </p>
                        <button
                            type="button"
                            className="btn btn-primary mb-3"
                            onClick={() => window.location.reload()}
                        >
                            Reload and check synced data
                        </button>
                    </>
                )}
                {deleting && (
                    <p role="status" aria-live="polite">
                        Permanently deleting synced Builder data…
                    </p>
                )}
                <div className="d-flex flex-wrap">
                    <button
                        type="button"
                        className="btn btn-danger mr-2 mb-2"
                        aria-label={deleting
                            ? "Permanently deleting synced Builder data"
                            : "Permanently delete synced Builder data"}
                        disabled={deleting}
                        onClick={confirmDelete}
                    >
                        {deleting ? "Deleting…" : "Permanently delete"}
                    </button>
                    <button
                        id="builder-storage-delete-cancel"
                        type="button"
                        className="btn btn-secondary mb-2"
                        disabled={deleting}
                        onClick={() => dispatch({type: "storage/dialog-closed"})}
                    >
                        Cancel deletion
                    </button>
                </div>
            </div>
        </BuilderModal>
    );
}

export default function BuilderStorageManager({storage, dispatch}) {
    const exportErrorRef = useRef(null);
    const exportPendingRef = useRef(false);
    const deletePendingRef = useRef(false);
    const exporting = storage.exportStatus === "exporting";

    useEffect(function() {
        if (storage.exportError)
            exportErrorRef.current?.focus();
    }, [storage.exportError]);

    if (!storage.enabled)
        return null;

    async function exportAll() {
        if (exportPendingRef.current)
            return;
        exportPendingRef.current = true;
        dispatch({type: "storage/export-requested"});
        let payload;
        try {
            payload = await exportAccountBuilderData();
            downloadPayload(payload);
            dispatch({type: "storage/export-succeeded"});
        }
        catch (_error) {
            dispatch({type: "storage/export-failed"});
        }
        finally {
            payload = null;
            exportPendingRef.current = false;
        }
    }

    const profileCount = storage.profiles.length;
    return (
        <section
            className="row py-3 border-bottom border-primary"
            aria-labelledby="builder-storage-heading"
        >
            <div className="col-12 col-lg-4">
                <h2 className="h4" id="builder-storage-heading">Builder storage</h2>
            </div>
            <div className="col-12 col-lg-8">
                <p className="mb-1">
                    {formatBuilderStorageUsage(storage.usedBytes)}
                </p>
                <p className="mb-1">
                    {profileCount} synced Builder {profileCount === 1 ? "profile" : "profiles"}
                </p>
                <p className="small mb-3">Storage version: {storage.storageGeneration}</p>
                <div className="row">
                    <div className="col-12 col-md-6 mb-2">
                        <button
                            type="button"
                            className="btn btn-primary btn-block"
                            disabled={exporting}
                            onClick={exportAll}
                        >
                            {exporting ? "Exporting…" : "Export all Builder data"}
                        </button>
                    </div>
                    <div className="col-12 col-md-6 mb-2">
                        <button
                            type="button"
                            className="btn btn-outline-danger btn-block"
                            onClick={() => dispatch({type: "storage/dialog-opened"})}
                        >
                            Delete all synced Builder data
                        </button>
                    </div>
                </div>
                {exporting && (
                    <p role="status" aria-live="polite">Preparing a fresh Builder export…</p>
                )}
                {storage.exportError && (
                    <p
                        ref={exportErrorRef}
                        className="text-danger"
                        role="alert"
                        tabIndex="-1"
                    >
                        {EXPORT_ERROR}
                    </p>
                )}
                {storage.announcement === "exported" && (
                    <p role="status" aria-live="polite">
                        Builder data export downloaded.
                    </p>
                )}
                {storage.announcement === "deleted" && (
                    <p role="status" aria-live="polite">
                        All synced Builder data was deleted.
                    </p>
                )}
            </div>
            {storage.deleteDialogOpen && (
                <DeleteAllDialog
                    storage={storage}
                    dispatch={dispatch}
                    requestPendingRef={deletePendingRef}
                />
            )}
        </section>
    );
}
