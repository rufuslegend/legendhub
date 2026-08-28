import {useEffect, useRef} from "react";
import {BuilderModal} from "./ImportExportDialog.jsx";

function ResultList({heading, values, render = value => value}) {
    return <section className="mt-3"><h3 className="h6">{heading}</h3>{values.length
        ? <ul className="mb-0">{values.map((value, index) => <li key={`${heading}-${index}`}>{render(value)}</li>)}</ul>
        : <p className="mb-0">None.</p>}</section>;
}

export function BuilderMigrationOffer({migration, onOpen}) {
    if (migration.status === "idle")
        return null;
    const succeeded = migration.status === "succeeded";
    return <section className="alert alert-info" role="region" aria-label="Local Builder data">
        <h2 className="h5">Local Builder data</h2>
        <p>{succeeded
            ? "Your copy is complete. The original profiles remain saved in this browser."
            : "Profiles saved in this browser can be copied to your account. The browser copies will be retained."}</p>
        {!succeeded && <ul>{migration.profiles.map(name => <li key={name}>{name}</li>)}</ul>}
        <button type="button" className="btn btn-primary" onClick={onOpen}>
            {succeeded ? "View copy results" : "Review local Builder data"}
        </button>
    </section>;
}

function MigrationResults({result, onClose}) {
    return <div className="modal-body">
        <p role="status" aria-live="polite" tabIndex="-1" id="builder-migration-result">
            Local Builder data was copied to your account. The original data remains saved in this browser.
        </p>
        <ResultList heading="Copied" values={result.copied} />
        <ResultList heading="Renamed" values={result.renamed} render={entry => `${entry.from} → ${entry.to}`} />
        <ResultList heading="Deduplicated" values={result.deduplicated} />
        <ResultList heading="Rejected" values={result.rejected} render={entry => `${entry.name} — ${entry.reason}`} />
        <p className="mt-3 mb-0">{result.preferencesImported
            ? "This browser's Builder preferences were copied to the account."
            : "Your account preferences were kept."}</p>
        <button type="button" className="btn btn-primary mt-3" onClick={onClose}>Close results</button>
    </div>;
}

export default function BuilderMigrationDialog({migration, onClose, onCopy, onPreferenceChange}) {
    const statusRef = useRef(null);
    useEffect(function() {
        if (["pending", "error", "succeeded"].includes(migration.status))
            statusRef.current?.focus();
    }, [migration.status]);

    if (!migration.open)
        return null;
    if (migration.status === "succeeded") {
        return <BuilderModal key="migration-results" label="Copy local Builder data" onClose={onClose} initialFocus="#builder-migration-result">
            <MigrationResults result={migration.result} onClose={onClose} />
        </BuilderModal>;
    }

    const pending = migration.status === "pending";
    return <BuilderModal key="migration-form" label="Copy local Builder data" onClose={pending ? function() {} : onClose} initialFocus="#builder-migration-copy">
        <div className="modal-body" aria-describedby="builder-migration-retention">
            <p id="builder-migration-retention">
                Copying adds these profiles to your account. It never deletes or changes the originals saved in this browser.
            </p>
            <ul>{migration.profiles.map(name => <li key={name}>{name}</li>)}</ul>
            <fieldset disabled={pending}>
                <legend className="h6">Builder preferences</legend>
                <div className="form-check">
                    <input className="form-check-input" id="migration-preferences-account" type="radio" name="migration-preferences" value="account" checked={migration.preferencesChoice === "account"} onChange={event => onPreferenceChange(event.target.value)} />
                    <label className="form-check-label" htmlFor="migration-preferences-account">Keep my account preferences</label>
                </div>
                <div className="form-check">
                    <input className="form-check-input" id="migration-preferences-browser" type="radio" name="migration-preferences" value="browser" checked={migration.preferencesChoice === "browser"} onChange={event => onPreferenceChange(event.target.value)} />
                    <label className="form-check-label" htmlFor="migration-preferences-browser">Use this browser's preferences</label>
                </div>
            </fieldset>
            <p className="small mt-2">Only Builder display, selection, and paging preferences are copyable. Login, consent, timezone, and other device-only values stay in this browser.</p>
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
