"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const {renderToStaticMarkup} = require("react-dom/server");

const root = path.resolve(__dirname, "..");

async function renderLockedPicker() {
    const {createServer} = await import("vite");
    const vite = await createServer({
        appType: "custom",
        root,
        server: {hmr: false, middlewareMode: true, ws: false}
    });
    try {
        const {default: EquipmentPanel} = await vite.ssrLoadModule(
            "/client/features/builder/EquipmentPanel.jsx");
        const currentItem = {
            id: 54,
            locked: true,
            name: "Limited light",
            slot: 0,
            strength: 0
        };
        const itemsBySlot = [];
        itemsBySlot[0] = [
            {id: 0, name: "-", slot: 0, strength: 0},
            {id: 41, name: "Brass lantern", slot: 0, strength: 2}
        ];
        const state = {
            charmSelectors: [],
            currentItem,
            currentPage: 1,
            isRuneCrafting: false,
            itemsBySlot,
            itemsPerPage: 20,
            searchString: "",
            selectedList: {items: [currentItem]},
            sortDir: "-",
            sortStat: "",
            statInfo: [
                {display: "Name", short: "Name", showColumn: true, type: "string", var: "name"},
                {display: "Strength", short: "Str", showColumn: true, type: "int", var: "strength"}
            ],
            wieldSlotFilter: 0
        };
        return renderToStaticMarkup(React.createElement(EquipmentPanel, {
            onAction() {},
            onClose() {},
            onOpen() {},
            onPick() {},
            onToggleLocks() {},
            restrictions: [[]],
            state,
            statRestrictions: {strength: []},
            totals: {strength: 100}
        }));
    }
    finally {
        await vite.close();
    }
}

test("locked Builder item picker renders the approved comparison workflow", async function() {
    const rendered = await renderLockedPicker();
    const searchIndex = rendered.indexOf('id="itemChoiceSearch"');
    const comparisonIndex = rendered.indexOf("Current Item and Stats");

    assert.match(rendered, /class="modal-dialog modal-xl modal-dialog-scrollable"/);
    assert.ok(searchIndex > -1 && comparisonIndex > -1 && searchIndex < comparisonIndex,
        "search must precede the current-item comparison");
    assert.match(rendered, /<th[^>]*>Total<\/th><td[^>]*>100<\/td>/);
    assert.match(rendered,
        /class="table table-striped table-bordered table-hover table-sm mt-3 builder-picker-results"/);
    assert.equal((rendered.match(/class="fas fa-sort(?:\s|\")/g) || []).length, 2);
    assert.match(rendered,
        /This slot is locked\. Unlock the current item to choose a replacement\./);
    assert.equal((rendered.match(/class="builder-picker-result-disabled"/g) || []).length, 2);
});
