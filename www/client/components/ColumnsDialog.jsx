import {useEffect, useRef} from "react";
import {categoryStacks} from "../features/items/item-search-reducer.js";

function useDialog(open, dialogRef, triggerRef, onClose) {
    useEffect(function() {
        if (!open)
            return undefined;
        const bodyHadModalOpen = document.body.classList.contains("modal-open");
        document.body.classList.add("modal-open");
        const previousInert = new Map();
        let child = dialogRef.current;
        while (child?.parentElement) {
            const parent = child.parentElement;
            for (const sibling of parent.children) {
                if (sibling !== child && !previousInert.has(sibling)) {
                    previousInert.set(sibling, sibling.getAttribute("inert"));
                    sibling.setAttribute("inert", "");
                }
            }
            if (parent === document.body)
                break;
            child = parent;
        }
        function onKeyDown(event) {
            if (event.key === "Escape") {
                event.preventDefault();
                onClose();
                return;
            }
            if (event.key !== "Tab")
                return;
            const focusable = Array.from(dialogRef.current?.querySelectorAll("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])") || []).filter(element => !element.hidden);
            if (!focusable.length)
                return;
            const first = focusable[0];
            const last = focusable.at(-1);
            if (event.shiftKey && (document.activeElement === first || !dialogRef.current.contains(document.activeElement))) {
                event.preventDefault();
                last.focus();
            }
            else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current.contains(document.activeElement))) {
                event.preventDefault();
                first.focus();
            }
        }
        window.addEventListener("keydown", onKeyDown);
        dialogRef.current?.focus();
        return function() {
            window.removeEventListener("keydown", onKeyDown);
            for (const [element, inert] of previousInert) {
                if (inert == null)
                    element.removeAttribute("inert");
                else
                    element.setAttribute("inert", inert);
            }
            if (!bodyHadModalOpen)
                document.body.classList.remove("modal-open");
            setTimeout(function() { triggerRef.current?.focus(); });
        };
    }, [open, onClose, dialogRef, triggerRef]);
}

export default function ColumnsDialog({categories, onClose, onReset, onToggle, open, requiredColumns = [], selectedColumns, triggerRef}) {
    const dialogRef = useRef(null);
    useDialog(open, dialogRef, triggerRef, onClose);
    if (!open)
        return null;
    return <div ref={dialogRef} id="columnsModal" className="modal d-block show" tabIndex="-1" role="dialog" aria-modal="true" aria-labelledby="columnsModalLabel">
        <div className="modal-dialog modal-xl" role="document"><div className="modal-content">
            <div className="modal-header"><h2 className="modal-title h5" id="columnsModalLabel">Select visible columns</h2><button type="button" className="close" aria-label="Close" onClick={onClose}><span aria-hidden="true">&times;</span></button></div>
            <div className="modal-body">
                <div className="columns-picker-toolbar"><p className="columns-picker-toolbar-copy text-body">Select columns to show and hide from the following:</p><button type="button" className="columns-picker-reset btn btn-primary btn-sm" onClick={onReset}>Reset to defaults</button></div>
                <div className="columns-picker-grid">{categoryStacks(categories).map((stack, index) => <div className="columns-picker-stack" key={index}>{stack.map(category => <section className="columns-picker-category list-group-item" key={category.name}><h6 className="columns-picker-category-title">{category.name}</h6><div className="list-group list-group-flush">{category.getItemStatInfo.map(stat => {
                    const required = requiredColumns.includes(stat.short);
                    const selected = required || selectedColumns.includes(stat.short);
                    return <button key={stat.short} type="button" className="columns-picker-option list-group-item list-group-item-action list-group-item-light" disabled={required} aria-label={required ? `${stat.display} is always shown` : undefined} aria-pressed={selected} onClick={required ? undefined : () => onToggle(stat.short)}><span className="d-flex align-items-center justify-content-between"><span>{stat.display}</span>{selected ? <svg className="columns-picker-visibility-icon text-success ml-2" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"><path d="M10 12a2 2 0 1 0 4 0a2 2 0 0 0-4 0" /><path d="M21 12q-3.6 6-9 6t-9-6q3.6-6 9-6t9 6" /></g></svg> : <svg className="columns-picker-visibility-icon text-danger ml-2" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 9q-3.6 4-9 4T3 9m0 6l2.5-3.8M21 14.976L18.508 11.2M9 17l.5-4m5.5 4l-.5-4" /></svg>}</span></button>;
                })}</div></section>)}</div>)}</div>
            </div>
        </div></div>
    </div>;
}
