"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const {renderToStaticMarkup} = require("react-dom/server");

const root = path.resolve(__dirname, "..");

// Catches the shared column chooser allowing the required Name column to be
// hidden or presenting it with the closed-eye state.
test("column chooser keeps Name visibly selected and disables its toggle", async function() {
    const {createServer} = await import("vite");
    const vite = await createServer({
        appType: "custom",
        root,
        server: {hmr: false, middlewareMode: true, ws: false}
    });
    try {
        const {default: ColumnsDialog} = await vite.ssrLoadModule(
            "/client/components/ColumnsDialog.jsx");
        const markup = renderToStaticMarkup(React.createElement(ColumnsDialog, {
            categories: [{
                name: "Basic",
                getItemStatInfo: [
                    {display: "Name", short: "Name", var: "name"},
                    {display: "Slot", short: "Slot", var: "slot"}
                ]
            }],
            onClose() {},
            onReset() {},
            onToggle() {},
            open: true,
            requiredColumns: ["Name"],
            selectedColumns: ["Slot"],
            triggerRef: {current: null}
        }));

        assert.match(markup, /<button[^>]*disabled=""[^>]*aria-label="Name is always shown"[^>]*aria-pressed="true"[^>]*>.*?Name.*?text-success/s);
        assert.match(markup, /<button[^>]*aria-pressed="true"[^>]*>.*?Slot/s);
    }
    finally {
        await vite.close();
    }
});
