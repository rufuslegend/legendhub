import {useEffect, useRef, useState} from "react";

function focusableElements(element) {
    return Array.from(element?.querySelectorAll("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])") || []).filter(entry => !entry.hidden);
}

export function BuilderModal({children, label, onClose, initialFocus}) {
    const ref = useRef(null);
    const triggerRef = useRef(null);
    const closeRef = useRef(onClose);
    closeRef.current = onClose;

    useEffect(function() {
        triggerRef.current = document.activeElement;
        const modal = ref.current;
        const focusInitial = function() {
            const initial = initialFocus && modal?.querySelector(initialFocus);
            (initial || modal)?.focus();
        };
        focusInitial();
        const siblings = Array.from(document.body.children).filter(element => !element.contains(modal));
        const hidden = siblings.map(element => ({element, inert: element.inert, ariaHidden: element.getAttribute("aria-hidden")}));
        for (const {element} of hidden) { element.inert = true; element.setAttribute("aria-hidden", "true"); }
        function keydown(event) {
            if (event.key === "Escape") { event.preventDefault(); closeRef.current(); return; }
            if (event.key !== "Tab") return;
            const focusable = focusableElements(modal);
            if (!focusable.length) { event.preventDefault(); modal?.focus(); return; }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
        window.addEventListener("keydown", keydown);
        return () => {
            window.removeEventListener("keydown", keydown);
            for (const entry of hidden) {
                entry.element.inert = entry.inert;
                if (entry.ariaHidden == null) entry.element.removeAttribute("aria-hidden");
                else entry.element.setAttribute("aria-hidden", entry.ariaHidden);
            }
            triggerRef.current?.focus();
        };
    }, []);
    return <div ref={ref} className="modal d-block" role="dialog" aria-modal="true" aria-label={label} tabIndex="-1"><div className="modal-dialog modal-lg" role="document"><div className="modal-content"><div className="modal-header"><h2 className="modal-title h5">{label}</h2><button type="button" className="close" aria-label="Close" onClick={() => closeRef.current()}><span aria-hidden="true">×</span></button></div>{children}</div></div></div>;
}

function CopyField({id, label, value, onCopied}) {
    async function copy() {
        try {
            if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
            else { const input = document.getElementById(id); input?.select(); document.execCommand("copy"); }
            onCopied(label);
        }
        catch (_error) { onCopied("Copy failed. Select the text and copy it manually."); }
    }
    return <><h3 className="h5 mt-3">{label}</h3><div className="input-group"><input id={id} className="form-control" readOnly value={value} /><div className="input-group-append"><button className="btn btn-primary" type="button" onClick={copy}>Copy</button></div></div></>;
}

export default function ImportExportDialog({mode, value, onChange, onClose, onSubmit}) {
    const exportMode = mode === "export";
    const [copyMessage, setCopyMessage] = useState("");
    return <BuilderModal label={exportMode ? "Export Lists" : "Import Lists"} onClose={onClose} initialFocus={exportMode ? "#allListsExport" : "#builder-import"}><div className="modal-body">{exportMode ? <><CopyField id="allListsExport" label="All Lists" value={value.allLists} onCopied={setCopyMessage} /><CopyField id="curListExport" label={`Current List (w/ all variants): ${value.characterName}`} value={value.curList} onCopied={setCopyMessage} /><CopyField id="curVariantExport" label={`Current List Variant: ${value.variantName}`} value={value.curVariant} onCopied={setCopyMessage} />{copyMessage && <p role="status" className="text-success mb-0">{copyMessage === "All Lists" || copyMessage.startsWith("Current") ? `${copyMessage} copied.` : copyMessage}</p>}</> : <><label htmlFor="builder-import">Builder list import string</label><input id="builder-import" className="form-control" value={value.input} onChange={event => onChange(event.target.value)} />{value.message && <p role="alert" className="mt-3 text-danger">{value.message}</p>}{value.lists.filter(list => list.exists).length > 0 && <table className="table table-sm"><thead><tr><th>Character</th><th>Variant</th><th>Overwrite?</th></tr></thead><tbody>{value.lists.filter(list => list.exists).map((list, index) => <tr key={`${list.name}-${list.variants[0].name}`}><td>{list.name}</td><td>{list.variants[0].name}</td><td><input aria-label={`Overwrite ${list.name} ${list.variants[0].name}`} type="checkbox" checked={list.overwrite} onChange={event => onChange(value.input, index, event.target.checked)} /></td></tr>)}</tbody></table>}<button className="btn btn-primary float-right" type="button" disabled={value.loading} onClick={onSubmit}>{value.loading ? "Importing…" : "Import"}</button></>}</div></BuilderModal>;
}
