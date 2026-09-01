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

// Catches any of the Builder's three item-name surfaces bypassing the shared
// preview trigger: equipped gear, the current comparison, or picker results.
test("Builder marks every real item name as a hover-preview trigger", async function() {
    const rendered = await renderLockedPicker();

    assert.equal((rendered.match(/data-item-preview-id="54"/g) || []).length, 2,
        "equipped and current-item names must both preview");
    assert.equal((rendered.match(/data-item-preview-id="41"/g) || []).length, 1,
        "picker result names must preview");
    assert.equal((rendered.match(/data-item-preview-id="0"/g) || []).length, 0,
        "empty item rows must not preview");
});

// Catches the Hold picker inferring one role from a multi-role candidate instead
// of trusting the role selected by the row that opened the picker.
test("Hold picker keeps multi-role candidates without a hand-role filter", async function() {
    const {createServer} = await import("vite");
    const vite = await createServer({
        appType: "custom",
        root,
        server: {hmr: false, middlewareMode: true, ws: false}
    });
    try {
        const {default: EquipmentPanel} = await vite.ssrLoadModule(
            "/client/features/builder/EquipmentPanel.jsx");
        const currentItem = {id: 0, name: "-", slot: 15};
        const candidate = {id: 41, name: "Versatile blade", slot: 15, slots: [14, 15]};
        const itemsBySlot = [];
        itemsBySlot[15] = [currentItem, candidate];
        const state = {
            charmSelectors: [], currentItem, currentItemIndex: 0, currentPage: 1,
            isRuneCrafting: false, itemsBySlot, itemsPerPage: 20, searchString: "",
            selectedList: {items: [currentItem]}, sortDir: "-", sortStat: "",
            statInfo: []
        };
        const rendered = renderToStaticMarkup(React.createElement(EquipmentPanel, {
            onAction() {}, onClose() {}, onOpen() {}, onPick() {}, onToggleLocks() {},
            restrictions: [[]], state, statRestrictions: {}, totals: {}
        }));

        assert.match(rendered, /Versatile blade/);
        assert.doesNotMatch(rendered, /Slot Filter|wield-slot-filter|realSlot/);
    }
    finally {
        await vite.close();
    }
});

// Catches full-capacity empty hand rows opening, occupied legacy rows becoming
// inaccessible, or picker choices ignoring replacement-adjusted hand usage.
test("Builder hand controls expose and enforce three-hand capacity", async function() {
    const {createServer} = await import("vite");
    const vite = await createServer({
        appType: "custom",
        root,
        server: {hmr: false, middlewareMode: true, ws: false}
    });
    try {
        const {default: EquipmentPanel} = await vite.ssrLoadModule(
            "/client/features/builder/EquipmentPanel.jsx");
        const items = [
            {id: 1, name: "Buckler", slot: 10, strength: 0},
            {id: 2, name: "Sword", slot: 14, strength: 0},
            {id: 3, name: "Torch", slot: 15, twoHanded: true, strength: 0},
            {id: 0, name: "-", slot: 15, strength: 0}
        ];
        const itemsBySlot = [];
        itemsBySlot[15] = [
            {id: 0, name: "-", slot: 15, strength: 0},
            {id: 4, name: "Great blade", slot: 15, twoHanded: true, strength: 4},
            {id: 5, name: "Dagger", slot: 15, strength: 1}
        ];
        const state = {
            charmSelectors: [], currentItem: items[2], currentItemIndex: 2,
            currentPage: 1, isRuneCrafting: false, itemsBySlot, itemsPerPage: 20,
            searchString: "", selectedList: {items}, sortDir: "-", sortStat: "",
            statInfo: [
                {display: "Strength", short: "Str", showColumn: true, type: "int", var: "strength"}
            ]
        };
        const rendered = renderToStaticMarkup(React.createElement(EquipmentPanel, {
            onAction() {}, onClose() {}, onOpen() {}, onPick() {}, onToggleLocks() {},
            restrictions: items.map(() => []), state, statRestrictions: {strength: []},
            totals: {strength: 0}
        }));

        assert.match(rendered,
            /id="builder-equipment-hand-status-3"[^>]*>All three hands are already in use\.<\/span>/);
        assert.match(rendered,
            /aria-label="Choose empty item by Strength"[^>]*disabled=""[^>]*aria-describedby="builder-equipment-hand-status-3"/);
        assert.doesNotMatch(rendered, /aria-label="Choose (?:Buckler|Sword|Torch) by Strength"[^>]*disabled/);
        assert.match(rendered,
            /id="builder-picker-hand-status"[^>]*>This item would use more than your character&#x27;s three hands\.<\/p>/);
        const pickerMarkup = rendered.slice(rendered.indexOf("builder-picker-results"));
        assert.match(pickerMarkup,
            /disabled="" aria-describedby="builder-picker-hand-status"[^>]*>Great blade<\/button>/);
        assert.doesNotMatch(pickerMarkup, /disabled=""[^>]*>(?:-|Dagger)<\/button>/);

        const lockedItems = items.map((item, index) =>
            index === 2 ? {...item, locked: true} : item);
        const lockedState = {
            ...state,
            currentItem: lockedItems[2],
            selectedList: {items: lockedItems}
        };
        const lockedRendered = renderToStaticMarkup(React.createElement(EquipmentPanel, {
            onAction() {}, onClose() {}, onOpen() {}, onPick() {}, onToggleLocks() {},
            restrictions: lockedItems.map(() => []), state: lockedState,
            statRestrictions: {strength: []}, totals: {strength: 0}
        }));
        const lockedPickerMarkup = lockedRendered.slice(
            lockedRendered.indexOf("builder-picker-results"));
        assert.match(lockedPickerMarkup,
            /aria-describedby="builder-picker-lock-status builder-picker-hand-status"[^>]*>Great blade<\/button>/);
    }
    finally {
        await vite.close();
    }
});
