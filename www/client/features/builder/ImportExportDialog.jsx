import {useEffect, useRef} from "react";

export function BuilderModal({children, label, onClose}) {
    const ref = useRef(null);
    const triggerRef = useRef(null);
    useEffect(function() {
        triggerRef.current = document.activeElement;
        ref.current?.focus();
        function keydown(event) { if (event.key === "Escape") onClose(); }
        window.addEventListener("keydown", keydown);
        return () => { window.removeEventListener("keydown", keydown); triggerRef.current?.focus(); };
    }, [onClose]);
    return <div ref={ref} className="modal d-block" role="dialog" aria-modal="true" aria-label={label} tabIndex="-1"><div className="modal-dialog modal-lg" role="document"><div className="modal-content"><div className="modal-header"><h2 className="modal-title h5">{label}</h2><button type="button" className="close" aria-label="Close" onClick={onClose}><span aria-hidden="true">×</span></button></div>{children}</div></div></div>;
}

export default function ImportExportDialog({mode, value, onChange, onClose, onSubmit}) {
    const exportMode = mode === "export";
    return <BuilderModal label={exportMode ? "Export Lists" : "Import Lists"} onClose={onClose}><div className="modal-body">{exportMode ? <><h3 className="h5">All Lists</h3><input id="allListsExport" className="form-control" readOnly value={value.allLists} /><h3 className="h5 mt-3">Current List (w/ all variants): {value.characterName}</h3><input className="form-control" readOnly value={value.curList} /><h3 className="h5 mt-3">Current List Variant: {value.variantName}</h3><input className="form-control" readOnly value={value.curVariant} /></> : <><label htmlFor="builder-import">Builder list import string</label><input id="builder-import" className="form-control" value={value.input} onChange={event => onChange(event.target.value)} /><p className="mt-3">{value.message}</p>{value.lists.filter(list => list.exists).length > 0 && <table className="table table-sm"><thead><tr><th>Character</th><th>Variant</th><th>Overwrite?</th></tr></thead><tbody>{value.lists.filter(list => list.exists).map((list, index) => <tr key={`${list.name}-${list.variants[0].name}`}><td>{list.name}</td><td>{list.variants[0].name}</td><td><input aria-label={`Overwrite ${list.name} ${list.variants[0].name}`} type="checkbox" checked={list.overwrite} onChange={event => onChange(value.input, index, event.target.checked)} /></td></tr>)}</tbody></table>}<button className="btn btn-primary float-right" type="button" disabled={value.loading} onClick={onSubmit}>Import</button></>}</div></BuilderModal>;
}
