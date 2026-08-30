import {useEffect, useRef} from "react";
import {BuilderModal} from "./ImportExportDialog.jsx";

function ResultList({heading, values, render = value => value}) {
    return <section className="mt-3"><h3 className="h6">{heading} ({values.length})</h3>{values.length
        ? <ul className="mb-0">{values.map((value, index) => <li key={`${heading}-${index}`}>{render(value)}</li>)}</ul>
        : <p className="mb-0">None.</p>}</section>;
}

function profileCount(count) {
    return `${count} ${count === 1 ? "profile" : "profiles"}`;
}

export function BuilderMigrationOffer({migration, onOpen}) {
    if (["idle", "dismissed"].includes(migration.status))
        return null;
    const succeeded = migration.status === "succeeded";
    return <section className="card mb-3" role="region" aria-label="Local Builder data">
        <div className="card-header">
            <h2 className="h5 mb-0">Local Builder data</h2>
        </div>
        <div className="card-body d-flex align-items-start">
            <span className="text-warning h3 mb-0 mr-3" aria-hidden="true">⚠</span>
            <div className="flex-grow-1">
                <p>{succeeded
                    ? "Your copy is complete. The original profiles remain saved in this browser."
                    : `${profileCount(migration.profiles.length)} saved in this browser can be copied to your account. The browser copies will be retained.`}</p>
                <button type="button" className="btn btn-primary" onClick={onOpen}>
                    {succeeded ? "View copy results" : "Review local Builder data"}
                </button>
            </div>
        </div>
    </section>;
}

function MigrationResults({result, onClose}) {
    return <div className="modal-body">
        <p role="status" aria-live="polite" tabIndex="-1" id="builder-migration-result">
            Local Builder data was copied to your account. The original data remains saved in this browser.
        </p>
        <div className="border rounded px-3 pb-3" role="region" aria-label="Profile copy results"
            tabIndex="0" style={{maxHeight: "20rem", overflowY: "auto"}}>
            <ResultList heading="Copied" values={result.copied} />
            <ResultList heading="Renamed" values={result.renamed} render={entry => `${entry.from} → ${entry.to}`} />
            <ResultList heading="Deduplicated" values={result.deduplicated} />
            <ResultList heading="Rejected" values={result.rejected} render={entry => `${entry.name} — ${entry.reason}`} />
        </div>
        <p className="mt-3 mb-0">{result.preferencesImported
            ? "This browser's Builder preferences are now saved to your account."
            : "Your existing account Builder preferences were retained."}</p>
        {result.acknowledgementWarning && <p role="status" className="text-warning mt-3 mb-0">
            The copy completed, but this browser could not remember it. You may be asked to copy this local data again.
        </p>}
        <button type="button" className="btn btn-primary mt-3" onClick={onClose}>Close results</button>
    </div>;
}

export default function BuilderMigrationDialog({migration, onClose, onCopy}) {
    const statusRef = useRef(null);
    useEffect(function() {
        if (["pending", "error", "succeeded"].includes(migration.status))
            statusRef.current?.focus();
    }, [migration.status]);

    if (!migration.open)
        return null;
    if (migration.status === "succeeded") {
        return <BuilderModal key="migration-results" label="Copy local Builder data" onClose={onClose} initialFocus="#builder-migration-result">
            <MigrationResults result={{
                ...migration.result,
                acknowledgementWarning: migration.acknowledgementWarning
            }} onClose={onClose} />
        </BuilderModal>;
    }

    const pending = migration.status === "pending";
    return <BuilderModal key="migration-form" label="Copy local Builder data" onClose={onClose} closeDisabled={pending} initialFocus="#builder-migration-copy">
        <div className="modal-body" aria-describedby="builder-migration-retention">
            <p id="builder-migration-retention">
                Copying adds {profileCount(migration.profiles.length)} to your account. It never deletes or changes the originals saved in this browser.
            </p>
            <section className="border rounded p-2 mb-3" role="region"
                aria-label={`${migration.profiles.length} local Builder ${migration.profiles.length === 1 ? "profile" : "profiles"}`}
                tabIndex="0" style={{maxHeight: "18rem", overflowY: "auto"}}>
                <ul className="mb-0">{migration.profiles.map(name => <li key={name}>{name}</li>)}</ul>
            </section>
            {pending && <p ref={statusRef} role="status" aria-live="polite" tabIndex="-1">Copying local Builder data…</p>}
            {migration.error && <p ref={statusRef} role="alert" tabIndex="-1" className="text-danger">{migration.error}</p>}
            <div className="mt-3 d-flex flex-wrap">
                <button id="builder-migration-copy" type="button" className="btn btn-primary mr-2 mb-2" disabled={pending} onClick={onCopy}>
                    {pending ? "Copying…" : "Copy all to my account"}
                </button>
                <button type="button" className="btn btn-secondary mb-2" disabled={pending} onClick={onClose}>Not now</button>
            </div>
        </div>
    </BuilderModal>;
}
