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

async function renderItemSearch(results, selectedColumns = ["Slot"], {
    preferences = null,
    statInfo = null
} = {}) {
    const {createServer} = await import("vite");
    const vite = await createServer({
        appType: "custom",
        root,
        server: {hmr: false, middlewareMode: true, ws: false}
    });
    try {
        const storeModule = await vite.ssrLoadModule(
            "/client/lib/account-preferences-store.js");
        storeModule.setPageAccountPreferencesStore(preferences
            ? storeModule.createAccountPreferencesStore({
                initialState: {
                    enabled: true,
                    payload: {
                        version: 1,
                        theme: "dark",
                        itemsPerPage: 20,
                        itemPreviews: true,
                        hideEquipmentZeros: false,
                        itemColumns: selectedColumns,
                        builderColumns: {},
                        selectedProfileId: null,
                        selectedVariant: null,
                        ...preferences
                    },
                    revision: 1,
                    storageGeneration: 1
                }
            })
            : null);
        const {default: ItemSearch} = await vite.ssrLoadModule(
            "/client/features/items/ItemSearch.jsx");
        const slots = Array(16).fill("");
        slots[2] = "Neck";
        slots[15] = "Hold";
        return renderToStaticMarkup(React.createElement(ItemSearch, {
            constants: {selectShortOptions: {slot: slots}},
            results,
            selectedColumns,
            statInfo: statInfo || [
                {display: "Name", short: "Name", showColumnDefault: true, type: "string", var: "name"},
                {display: "Slot", short: "Slot", showColumnDefault: true, type: "select", var: "slot"}
            ]
        }));
    }
    finally {
        await vite.close();
    }
}

// Catches the result table reducing a multi-capability item to its scalar sort
// key, hiding an eligibility that players need to see before opening details.
test("Item Search renders every slot capability in the Slot column", async function() {
    const markup = await renderItemSearch([
        {id: 17, name: "Neck-held focus", slot: 2, slots: [2, 15]}
    ]);

    assert.match(markup, /<th[^>]*>.*Slot/);
    assert.match(markup, /<td[^>]*><span>Neck, Hold<\/span><\/td>/);
});

// Catches the account switches affecting non-equipment content, removing the
// ordinary details link, hiding Rent, or leaving zero-valued stats visible.
test("Item Search honors equipment preview and zero-display preferences", async function() {
    const markup = await renderItemSearch([{
        id: 17,
        name: "Plain sword",
        strength: 0,
        weight: "0.00",
        rent: 0,
        unique: 0
    }], ["Name", "Str", "Weight", "Rent", "Unique"], {
        preferences: {itemPreviews: false, hideEquipmentZeros: true},
        statInfo: [
            {display: "Name", short: "Name", showColumnDefault: true, type: "string", var: "name"},
            {display: "Strength", short: "Str", showColumnDefault: true, type: "int", var: "strength"},
            {display: "Weight", short: "Weight", showColumnDefault: true, type: "decimal", var: "weight"},
            {display: "Rent", short: "Rent", showColumnDefault: true, type: "int", var: "rent"},
            {display: "Unique", short: "Unique", showColumnDefault: true, type: "bool", var: "unique"}
        ]
    });

    assert.doesNotMatch(markup, /item-preview-trigger/);
    assert.match(markup, /href="\/items\/details\.html\?id=17"[^>]*>Plain sword<\/a>/);
    assert.match(markup, /<td class="text-center"><span><\/span><\/td><td class="text-center"><span><\/span><\/td><td class="text-center"><span>0<\/span><\/td>/);
    assert.match(markup, /aria-label="no"/);
});

// Catches the Item Search Slot header or values falling back to ordinary table
// sizing and consuming spare horizontal room.
test("Item Search marks the Slot column for compact sizing", async function() {
    const markup = await renderItemSearch([
        {id: 17, name: "Neck-held focus", slot: 2, slots: [2, 15]}
    ]);

    assert.match(markup, /<th[^>]*class="[^"]*\bitem-slot-column\b[^"]*"[^>]*>.*Slot/s);
    assert.match(markup,
        /<td[^>]*class="[^"]*\bitem-slot-column\b[^"]*"[^>]*><span>Neck, Hold<\/span><\/td>/);
});

// Catches item names in the main search remaining ordinary links that cannot
// participate in the shared delayed-preview behavior.
test("Item Search marks item names as hover-preview triggers", async function() {
    const markup = await renderItemSearch([
        {id: 17, name: "Neck-held focus", slot: 2, slots: [2, 15]}
    ], ["Name"]);

    assert.match(markup,
        /class="item-preview-trigger"[^>]*data-item-preview-id="17"[^>]*>.*href="\/items\/details\.html\?id=17"[^>]*>Neck-held focus<\/a>/);
});

// Catches the Items result list reverting to per-row striping instead of
// exposing the approved three-plain, three-shaded Glass theme rhythm.
test("Item Search marks alternating three-row bands and their boundaries", async function() {
    const markup = await renderItemSearch(Array.from({length: 7}, function(_, index) {
        return {id: index + 1, name: `Item ${index + 1}`, slot: 2};
    }), ["Name"]);
    const tbody = markup.match(/<tbody>(.*?)<\/tbody>/s)?.[1] || "";
    const rows = Array.from(tbody.matchAll(/<tr([^>]*)>/g), match => match[1]);

    assert.match(markup, /<table class="[^"]*\bglass-banded-table\b[^"]*"/);
    assert.deepEqual(rows.map(attributes => hasClass(attributes, "glass-table-band")),
        [false, false, false, true, true, true, false]);
    assert.deepEqual(rows.map(attributes => hasClass(attributes, "glass-table-band-start")),
        [false, false, false, true, false, false, true]);
});

// Catches paging/search refreshes retaining only a scalar slot after the
// reducer accepts a live result that includes every capability.
test("Item Search keeps every slot after a paginated result refresh", async function() {
    const {createInitialItemSearchState, itemSearchReducer} = await import(
        "../client/features/items/item-search-reducer.js");
    let state = createInitialItemSearchState({
        constants: {selectShortOptions: {slot: ["", "", "Neck", "", "", "", "", "", "", "", "", "", "", "", "", "Hold"]}},
        results: [], selectedColumns: ["Slot"],
        statInfo: [{display: "Slot", short: "Slot", showColumnDefault: true, type: "select", var: "slot"}]
    });
    const criteria = {...state.criteria, page: 2};
    state = itemSearchReducer(state, {type: "search/requested", requestId: 1, criteria});
    state = itemSearchReducer(state, {
        type: "search/succeeded", requestId: 1, moreResults: false,
        results: [{id: 18, name: "Paged focus", slot: 2, slots: [2, 15]}]
    });

    assert.equal(state.criteria.page, 2);
    const markup = await renderItemSearch(state.results);
    assert.match(markup, /<td[^>]*><span>Neck, Hold<\/span><\/td>/);
});
