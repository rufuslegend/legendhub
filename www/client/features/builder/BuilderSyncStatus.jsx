import {BUILDER_SYNC_MESSAGES} from "./builder-sync-controller.js";

export default function BuilderSyncStatus({mode, status, message, onExport, onReload}) {
    if (mode === "anonymous")
        return <span className="small text-muted text-nowrap">Saved in this browser</span>;
    if (mode !== "account")
        return null;

    const text = message || BUILDER_SYNC_MESSAGES[status] || BUILDER_SYNC_MESSAGES.saved;
    if (status === "conflict" || status === "generation-changed") {
        return <div className="small text-warning text-right" role="alert">
            <span>{text}</span>
            <div className="mt-1">
                <button type="button" className="btn btn-sm btn-outline-primary ml-2" onClick={onExport}>Export Builder data</button>
                <button type="button" className="btn btn-sm btn-outline-secondary ml-2" onClick={onReload}>Reload account data</button>
            </div>
        </div>;
    }

    return <div className={status === "problem" ? "small text-warning text-right" : "small text-muted text-nowrap"}
        role="status" aria-live="polite">
        <span>{text}</span>
        {status === "problem" && <button type="button" className="btn btn-sm btn-link ml-2" onClick={onExport}>Export Builder data</button>}
    </div>;
}
