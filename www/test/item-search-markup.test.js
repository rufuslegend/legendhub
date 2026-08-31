"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const {renderToStaticMarkup} = require("react-dom/server");

const root = path.resolve(__dirname, "..");

async function renderItemSearch() {
    const {createServer} = await import("vite");
    const vite = await createServer({
        appType: "custom",
        root,
        server: {hmr: false, middlewareMode: true, ws: false}
    });
    try {
        const {default: ItemSearch} = await vite.ssrLoadModule(
            "/client/features/items/ItemSearch.jsx");
        const slots = Array(16).fill("");
        slots[2] = "Neck";
        slots[15] = "Hold";
        return renderToStaticMarkup(React.createElement(ItemSearch, {
            constants: {selectShortOptions: {slot: slots}},
            results: [{id: 17, name: "Neck-held focus", slot: 2, slots: [2, 15]}],
            selectedColumns: ["Slot"],
            statInfo: [{display: "Slot", short: "Slot", showColumnDefault: true, type: "select", var: "slot"}]
        }));
    }
    finally {
        await vite.close();
    }
}

// Catches the result table reducing a multi-capability item to its scalar sort
// key, hiding an eligibility that players need to see before opening details.
test("Item Search renders every slot capability in the Slot column", async function() {
    const markup = await renderItemSearch();

    assert.match(markup, /<th[^>]*>.*Slot/);
    assert.match(markup, /<td[^>]*><span>Neck, Hold<\/span><\/td>/);
});
