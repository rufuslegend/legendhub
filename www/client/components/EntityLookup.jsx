import {useEffect, useRef, useState} from "react";

export default function EntityLookup({
    addHref,
    addLabel,
    buttonLabel,
    description,
    getResultLabel,
    lookup,
    modalId,
    onSelect,
    searchLabel,
    searchPlaceholder,
    title
}) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [results, setResults] = useState([]);
    const [status, setStatus] = useState("idle");
    const abortRef = useRef(null);
    const inputRef = useRef(null);
    const requestId = useRef(0);
    const triggerRef = useRef(null);

    useEffect(function() {
        if (!open)
            return undefined;
        function closeOnEscape(event) {
            if (event.key === "Escape")
                close();
        }
        window.addEventListener("keydown", closeOnEscape);
        inputRef.current?.focus();
        return function() {
            window.removeEventListener("keydown", closeOnEscape);
            abortRef.current?.abort();
        };
    }, [open]);

    function close() {
        abortRef.current?.abort();
        setOpen(false);
        setStatus("idle");
        setTimeout(function() { triggerRef.current?.focus(); });
    }

    function openDialog() {
        setResults([]);
        setStatus("idle");
        setOpen(true);
    }

    async function search() {
        abortRef.current?.abort();
        const controller = new AbortController();
        const currentRequestId = requestId.current + 1;
        requestId.current = currentRequestId;
        abortRef.current = controller;
        setStatus("searching");
        setResults([]);
        try {
            const nextResults = await lookup(query, controller.signal);
            if (currentRequestId !== requestId.current || controller.signal.aborted)
                return;
            setResults(nextResults);
            setStatus("results");
        }
        catch (error) {
            if (error?.name === "AbortError" || currentRequestId !== requestId.current)
                return;
            setStatus("error");
        }
    }

    function select(result) {
        onSelect(result);
        close();
    }

    return (
        <>
            <button
                ref={triggerRef}
                className="btn btn-outline-secondary col-12 text-truncate"
                type="button"
                aria-haspopup="dialog"
                aria-expanded={open}
                onClick={openDialog}
            >
                {buttonLabel}
            </button>
            {open && (
                <div className="modal d-block" id={modalId} role="dialog" aria-modal="true" aria-labelledby={`${modalId}-title`}>
                    <div className="modal-dialog" role="document">
                        <div className="modal-content">
                            <div className="modal-header">
                                <h2 className="modal-title h5" id={`${modalId}-title`}>{title}</h2>
                                <button type="button" className="close" aria-label="Close" onClick={close}>
                                    <span aria-hidden="true">&times;</span>
                                </button>
                            </div>
                            <div className="modal-body">
                                <p className="text-info">{description}</p>
                                <div className="mb-3">
                                    <div className="input-group">
                                        <div className="input-group-prepend">
                                            <span className="input-group-text" aria-hidden="true"><i className="fas fa-search" /></span>
                                        </div>
                                        <input
                                            ref={inputRef}
                                            className="form-control"
                                            type="text"
                                            value={query}
                                            placeholder={searchPlaceholder}
                                            aria-label={searchLabel}
                                            onChange={event => setQuery(event.target.value)}
                                            onKeyDown={event => {
                                                if (event.key === "Enter") {
                                                    event.preventDefault();
                                                    search();
                                                }
                                            }}
                                        />
                                        <div className="input-group-append">
                                            <button type="button" className="btn btn-primary" disabled={status === "searching"} onClick={search}>
                                                {status === "searching" ? "Searching…" : "Search"}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                                {status === "error" && <p role="alert" className="text-danger">Search could not be completed. Try again.</p>}
                                {status === "results" && results.length === 0 && <p role="status">No matches found.</p>}
                                {results.length > 0 && (
                                    <div className="mb-3">
                                        <div className="table-responsive col-12">
                                            <div className="list-group">
                                                {results.map(result => (
                                                    <button
                                                        key={result.id}
                                                        type="button"
                                                        className="list-group-item list-group-item-secondary list-group-item-action"
                                                        onClick={() => select(result)}
                                                    >
                                                        {getResultLabel(result)}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                )}
                                <a className="btn btn-outline-success btn-block" href={addHref} target="_blank" rel="noreferrer">{addLabel}</a>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
