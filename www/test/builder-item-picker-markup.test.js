"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const {renderToStaticMarkup} = require("react-dom/server");

const root = path.resolve(__dirname, "..");

function hasClass(attributes, className) {
    const classes = attributes.match(/\bclass="([^"]*)"/)?.[1].split(/\s+/) || [];
    return classes.includes(className);
}

async function renderLockedPicker(searchString = "", {
    candidateCount = 2,
    selectedCount = 1,
    equipmentPreferences = {itemPreviews: true, hideEquipmentZeros: false},
    statInfo = [
        {display: "Name", short: "Name", showColumn: true, type: "string", var: "name"},
        {display: "Strength", short: "Str", showColumn: true, type: "int", var: "strength"}
    ],
    totals = {strength: 100}
} = {}) {
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
            strength: 0,
            weight: "0.00",
            rent: 0,
            unique: 0
        };
        const candidates = [
            {id: 0, name: "-", slot: 0, strength: 0, weight: "0.00", rent: 0, unique: 0},
            {id: 41, name: "Brass lantern", slot: 0, strength: 2, weight: "1.50", rent: 0, unique: 0}
        ];
        while (candidates.length < candidateCount) {
            const id = 40 + candidates.length;
            candidates.push({id, name: `Candidate ${candidates.length + 1}`, slot: 0, strength: 1, rent: 0, unique: 0});
        }
        const selectedItems = [currentItem];
        while (selectedItems.length < selectedCount) {
            const id = 100 + selectedItems.length;
            selectedItems.push({id, name: `Equipped ${selectedItems.length + 1}`, slot: 0, strength: 1, rent: 0, unique: 0});
        }
        const itemsBySlot = [];
        itemsBySlot[0] = candidates;
        const state = {
            charmSelectors: [],
            currentItem,
            currentPage: 1,
            isRuneCrafting: false,
            itemsBySlot,
            itemsPerPage: 20,
            searchString,
            selectedList: {items: selectedItems},
            sortDir: "-",
            sortStat: "",
            statInfo,
        };
        return renderToStaticMarkup(React.createElement(EquipmentPanel, {
            equipmentPreferences,
            onAction() {},
            onClose() {},
            onOpen() {},
            onPick() {},
            onToggleLocks() {},
            restrictions: selectedItems.map(() => []),
            state,
            statRestrictions: {strength: []},
            totals
        }));
    }
    finally {
        await vite.close();
    }
}

// Catches Builder ignoring either account preference, hiding Rent zeroes, or
// removing ordinary details links along with hover previews.
test("Builder honors equipment preview and zero-display preferences", async function() {
    const rendered = await renderLockedPicker("", {
        equipmentPreferences: {itemPreviews: false, hideEquipmentZeros: true},
        statInfo: [
            {display: "Name", short: "Name", showColumn: true, type: "string", var: "name"},
            {display: "Strength", short: "Str", showColumn: true, type: "int", var: "strength"},
            {display: "Weight", short: "Weight", showColumn: true, type: "decimal", var: "weight"},
            {display: "Rent", short: "Rent", showColumn: true, type: "int", var: "rent"},
            {display: "Unique", short: "Unique", showColumn: true, type: "bool", var: "unique"}
        ],
        totals: {strength: 0, weight: "0.00", rent: 0, unique: ""}
    });

    assert.doesNotMatch(rendered, /item-preview-trigger/);
    assert.match(rendered, /href="\/items\/details\.html\?id=54"/);
    assert.match(rendered, /<span><\/span><\/button><\/td><td class="p-0"><button[^>]*><span><\/span><\/button><\/td><td class="p-0"><button[^>]*><span>0<\/span>/);
    assert.match(rendered, /aria-label="no"/);
    assert.doesNotMatch(rendered, />0<\/span><\/button><\/td><td class="p-0"><button[^>]*><span>0<\/span>/);
});

test("locked Builder item picker renders the approved comparison workflow", async function() {
    const rendered = await renderLockedPicker();
    const searchIndex = rendered.indexOf('id="itemChoiceSearch"');
    const comparisonIndex = rendered.indexOf("Current Item and Stats");

    assert.match(rendered, /class="modal-dialog modal-xl modal-dialog-scrollable"/);
    assert.ok(searchIndex > -1 && comparisonIndex > -1 && searchIndex < comparisonIndex,
        "search must precede the current-item comparison");
    assert.match(rendered, /<th[^>]*>Total<\/th><td[^>]*>100<\/td>/);
    assert.match(rendered,
        /class="table table-striped table-bordered table-hover table-sm mt-3 builder-picker-results glass-banded-table"/);
    assert.equal((rendered.match(/class="fas fa-sort(?:\s|\")/g) || []).length, 2);
    assert.match(rendered,
        /This slot is locked\. Unlock the current item to choose a replacement\./);
    assert.equal((rendered.match(/class="builder-picker-result-disabled"/g) || []).length, 2);
});

// Catches either Builder Slot column returning to ordinary table sizing, which
// lets it absorb space better used by item names and stats.
test("Builder marks every Slot column for compact sizing", async function() {
    const rendered = await renderLockedPicker();
    const slotHeaders = Array.from(rendered.matchAll(/<th([^>]*)>Slot<\/th>/g),
        match => match[1]);
    const slotCells = Array.from(rendered.matchAll(
        /<td([^>]*)>(?:<span[^>]*>)?Light(?:<\/span>)?<\/td>/g), match => match[1]);

    assert.equal(slotHeaders.length, 3,
        "equipment header, equipment footer, and current-item table must render Slot headers");
    assert.ok(slotHeaders.every(attributes => /\bitem-slot-column\b/.test(attributes)));
    assert.equal(slotCells.length, 2,
        "equipped and current-item rows must both render the Light slot");
    assert.ok(slotCells.every(attributes => /\bitem-slot-column\b/.test(attributes)));
});

// Catches any Builder Lock header or cell returning to ordinary table sizing,
// which lets a one-icon control absorb space better used by names and stats.
test("Builder marks every Lock column for compact sizing", async function() {
    const rendered = await renderLockedPicker();
    const lockHeaders = Array.from(rendered.matchAll(/<th([^>]*)>Lock<\/th>/g),
        match => match[1]);

    assert.equal(lockHeaders.length, 3,
        "equipment header, equipment footer, and current-item table must render Lock headers");
    assert.ok(lockHeaders.every(attributes => /\bitem-lock-column\b/.test(attributes)));
    assert.equal((rendered.match(/\bitem-lock-column\b/g) || []).length, 8,
        "every Lock header and body cell must use compact sizing");
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

function tableBodyRows(markup, tableClass) {
    const tableStart = markup.indexOf(tableClass);
    const tableEnd = markup.indexOf("</table>", tableStart);
    const table = markup.slice(tableStart, tableEnd);
    const tbody = table.match(/<tbody>(.*?)<\/tbody>/s)?.[1] || "";
    return Array.from(tbody.matchAll(/<tr([^>]*)>/g), match => match[1]);
}

// Catches either Builder equipment surface losing the row markers that let
// Glass themes group data without changing the other themes.
test("Builder equipment and Choose Item mark three-row bands and boundaries", async function() {
    const rendered = await renderLockedPicker("", {
        candidateCount: 7,
        selectedCount: 7
    });
    const equipmentRows = tableBodyRows(rendered, "builder-equipment-table").slice(1);
    const pickerRows = tableBodyRows(rendered, "builder-picker-results");
    const expected = [false, false, false, true, true, true, false];
    const expectedBoundaries = [false, false, false, true, false, false, true];

    assert.match(rendered,
        /<table class="[^"]*\bbuilder-equipment-table\b[^"]*\bglass-banded-table\b[^"]*"/);
    assert.match(rendered,
        /<table class="[^"]*\bbuilder-picker-results\b[^"]*\bglass-banded-table\b[^"]*"/);
    assert.deepEqual(equipmentRows.map(attributes => hasClass(attributes, "glass-table-band")),
        expected);
    assert.deepEqual(pickerRows.map(attributes => hasClass(attributes, "glass-table-band")),
        expected);
    assert.deepEqual(equipmentRows.map(attributes =>
        hasClass(attributes, "glass-table-band-start")), expectedBoundaries);
    assert.deepEqual(pickerRows.map(attributes =>
        hasClass(attributes, "glass-table-band-start")), expectedBoundaries);
});

// Catches the query grammar becoming invisible again or malformed input being
// announced without an accessible relationship to the search field.
test("Builder item picker explains boolean search and exposes query errors", async function() {
    const rendered = await renderLockedPicker("strength >> 5");

    assert.match(rendered,
        /id="itemChoiceSearch"[^>]*aria-invalid="true"[^>]*aria-describedby="builder-picker-query-help builder-picker-query-error"/);
    assert.match(rendered,
        /id="builder-picker-query-help"[^>]*>Try: sword, \(strength &gt; 15 and mind &lt; 10\) or \(dexterity &gt; 10 and spirit &lt; 5\)<\/small>/);
    assert.match(rendered,
        /id="builder-picker-query-error"[^>]*role="alert"[^>]*>Search query: Expected a number/);
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
