import React, {useEffect, useRef, useState} from "react";
import {createPortal} from "react-dom";

export function createItemPreviewController({
    cancel = globalThis.clearTimeout,
    closeDelay = 100,
    delay = 2000,
    onClose,
    onOpen,
    schedule = globalThis.setTimeout
}) {
    const activeSources = new Set();
    let closeTimer = null;
    let open = false;
    let openTimer = null;

    function cancelTimer(timer) {
        if (timer !== null)
            cancel(timer);
    }

    function close() {
        cancelTimer(openTimer);
        cancelTimer(closeTimer);
        openTimer = null;
        closeTimer = null;
        open = false;
        onClose();
    }

    return {
        dismiss() {
            activeSources.clear();
            close();
        },
        dispose() {
            activeSources.clear();
            close();
        },
        enter(source) {
            activeSources.add(source);
            cancelTimer(closeTimer);
            closeTimer = null;
            if (open || openTimer !== null)
                return;
            openTimer = schedule(function() {
                openTimer = null;
                if (activeSources.size === 0)
                    return;
                open = true;
                onOpen();
            }, delay);
        },
        leave(source) {
            activeSources.delete(source);
            if (activeSources.size > 0)
                return;
            cancelTimer(openTimer);
            openTimer = null;
            if (!open)
                return;
            cancelTimer(closeTimer);
            closeTimer = schedule(close, closeDelay);
        }
    };
}

export default function ItemPreview({children, item}) {
    const [open, setOpen] = useState(false);
    const controllerRef = useRef(null);
    const portalTargetRef = useRef(null);
    if (controllerRef.current === null) {
        controllerRef.current = createItemPreviewController({
            onClose: () => setOpen(false),
            onOpen: () => setOpen(true)
        });
    }
    const controller = controllerRef.current;

    useEffect(function() {
        return () => controller.dispose();
    }, [controller]);

    useEffect(function() {
        controller.dismiss();
    }, [controller, item?.id]);

    useEffect(function() {
        if (!open)
            return undefined;
        function keydown(event) {
            if (event.key !== "Escape")
                return;
            event.preventDefault();
            event.stopImmediatePropagation();
            controller.dismiss();
        }
        globalThis.addEventListener("keydown", keydown, true);
        return () => globalThis.removeEventListener("keydown", keydown, true);
    }, [controller, open]);

    if (!(Number(item?.id) > 0))
        return <>{children}</>;

    function enterFromTrigger(event, source) {
        portalTargetRef.current = event.currentTarget.closest(
            '[role="dialog"][aria-modal="true"]') || document.body;
        controller.enter(source);
    }
    const portalTarget = typeof document === "undefined" ? null :
        portalTargetRef.current || document.body;
    const preview = open && portalTarget ? createPortal(
        <div
            aria-label={`Item preview: ${item.name}`}
            className="item-preview-popup"
            onBlur={() => controller.leave("popup-focus")}
            onFocus={() => controller.enter("popup-focus")}
            onPointerEnter={event => {
                if (event.pointerType !== "touch")
                    controller.enter("popup-pointer");
            }}
            onPointerLeave={event => {
                if (event.pointerType !== "touch")
                    controller.leave("popup-pointer");
            }}
            role="dialog"
        >
            <div className="item-preview-popup-header">
                <strong>{item.name}</strong>
                <button
                    aria-label="Close item preview"
                    className="close"
                    onClick={() => controller.dismiss()}
                    type="button"
                >
                    <span aria-hidden="true">&times;</span>
                </button>
            </div>
            <iframe
                src={`/items/details.html?id=${item.id}&preview=true`}
                title={`Item details for ${item.name}`}
            />
        </div>,
        portalTarget
    ) : null;

    return <>
        <span
            className="item-preview-trigger"
            data-item-preview-id={item.id}
            onBlur={() => controller.leave("trigger-focus")}
            onFocus={event => enterFromTrigger(event, "trigger-focus")}
            onPointerEnter={event => {
                if (event.pointerType !== "touch")
                    enterFromTrigger(event, "trigger-pointer");
            }}
            onPointerLeave={event => {
                if (event.pointerType !== "touch")
                    controller.leave("trigger-pointer");
            }}
        >
            {children}
        </span>
        {preview}
    </>;
}
