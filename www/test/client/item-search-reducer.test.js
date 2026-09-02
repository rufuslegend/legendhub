"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

async function loadSearch() {
    return import("../../client/features/items/item-search-reducer.js");
}

async function loadApi() {
    return import("../../client/features/items/item-search-api.js");
}

async function loadCookie() {
    return import("../../client/features/items/item-search-cookie.js");
}

const metadata = {
    categories: [{name: "Basic", getItemStatInfo: [{display: "Name", short: "Name", var: "name", type: "string", showColumnDefault: true}]}],
    constants: {selectShortOptions: {slot: ["Light"]}},
    statInfo: [
        {display: "Name", short: "Name", var: "name", type: "string", showColumnDefault: true},
        {display: "Slot", short: "Slot", var: "slot", type: "select", showColumnDefault: false}
    ]
};

function initial(overrides = {}) {
    return {
        query: {search: "ember", filters: "slot_3", sortBy: "name", sortAsc: "true", page: "2"},
        results: [{id: 10, name: "Ember blade", slot: 3}],
        moreResults: true,
        selectedColumns: ["Name"],
        ...metadata,
        ...overrides
    };
}

// Catches initial state that drops server metadata, query criteria, or initial table results.
test("item search snapshots server metadata, criteria, and result state", async function() {
    const {createInitialItemSearchState} = await loadSearch();
    const state = createInitialItemSearchState(initial());

    assert.deepEqual(state.criteria, {
        search: "ember", filters: {slot: ["3"]}, sortBy: "name", sortAsc: true, page: 2
    });
    assert.deepEqual(state.metadata, metadata);
    assert.deepEqual(state.results, [{id: 10, name: "Ember blade", slot: 3}]);
    assert.deepEqual(state.selectedColumns, ["Name"]);
    assert.equal(state.status, "idle");
});

// Catches synchronized account Item Search columns losing to the device's
// anonymous cookie-backed props during client initialization.
test("item search prefers enabled account columns without changing anonymous initialization", async function() {
    const {createInitialItemSearchState} = await loadSearch();
    const account = createInitialItemSearchState(initial({
        selectedColumns: ["Name"],
        accountPreferences: {
            account: true,
            enabled: true,
            document: {
                version: 1,
                theme: "dark",
                itemsPerPage: 50,
                itemColumns: ["Slot"],
                builderColumns: {},
                selectedProfileId: null,
                selectedVariant: null
            }
        }
    }));
    const anonymous = createInitialItemSearchState(initial({
        selectedColumns: ["Name"],
        accountPreferences: {account: false, enabled: false, document: null}
    }));

    assert.deepEqual(account.selectedColumns, ["Slot", "Name"]);
    assert.deepEqual(anonymous.selectedColumns, ["Name"]);
});

// Catches a verified-but-unavailable preference bootstrap falling through to
// the anonymous sc2-backed server props instead of safe account defaults.
test("item search keeps unavailable verified accounts off anonymous columns", async function() {
    const {createInitialItemSearchState} = await loadSearch();
    const state = createInitialItemSearchState(initial({
        selectedColumns: ["Name"],
        accountPreferences: {
            account: true,
            enabled: false,
            document: {itemColumns: []}
        }
    }));

    assert.deepEqual(state.selectedColumns, ["Name"]);
});

// Catches stale preferences or reducer actions hiding the identifying column
// from the public Items table.
test("item search always keeps Name selected", async function() {
    const {createInitialItemSearchState, itemSearchReducer} = await loadSearch();
    let state = createInitialItemSearchState(initial({selectedColumns: ["Slot"]}));

    assert.deepEqual(state.selectedColumns, ["Slot", "Name"]);
    state = itemSearchReducer(state, {type: "column/toggle", short: "Name"});
    assert.deepEqual(state.selectedColumns, ["Slot", "Name"]);
});

// Catches a filter toggle that mutates unrelated criteria or fails to mark unapplied filters.
test("item search toggles category filters and marks them pending", async function() {
    const {createInitialItemSearchState, itemSearchReducer} = await loadSearch();
    let state = createInitialItemSearchState(initial());
    state = itemSearchReducer(state, {type: "filter/toggle", field: "name"});
    assert.deepEqual(state.nextCriteria.filters, {slot: ["3"], name: []});
    assert.equal(state.filtersDirty, true);
    state = itemSearchReducer(state, {type: "filter/toggle", field: "slot"});
    assert.deepEqual(state.nextCriteria.filters, {name: []});
});

// Catches sorting or pagination that discards active search and filter criteria.
test("item search derives sortable and paginated criteria from the canonical query", async function() {
    const {createInitialItemSearchState, itemSearchReducer} = await loadSearch();
    let state = createInitialItemSearchState(initial());
    state = itemSearchReducer(state, {type: "sort/change", sortBy: "slot"});
    assert.deepEqual(state.nextCriteria, {
        search: "ember", filters: {slot: ["3"]}, sortBy: "slot", sortAsc: false, page: 1
    });
    state = itemSearchReducer(state, {type: "search/requested", requestId: 1, criteria: state.nextCriteria});
    state = itemSearchReducer(state, {type: "page/change", page: 3});
    assert.deepEqual(state.nextCriteria, {
        search: "ember", filters: {slot: ["3"]}, sortBy: "slot", sortAsc: false, page: 3
    });
});

// Catches a changed default-column rule or reset action that does not restore the visible defaults.
test("item search uses metadata defaults and restores them on column reset", async function() {
    const {createInitialItemSearchState, itemSearchReducer} = await loadSearch();
    let state = createInitialItemSearchState(initial({selectedColumns: ["Slot"]}));
    state = itemSearchReducer(state, {type: "column/reset"});
    assert.deepEqual(state.selectedColumns, ["Name"]);
    state = itemSearchReducer(state, {type: "column/toggle", short: "Slot"});
    assert.deepEqual(state.selectedColumns, ["Name", "Slot"]);
});

// Catches reset that retains URL filters or leaves the “search again” warning visible.
test("item search resets filters without changing the submitted result criteria", async function() {
    const {createInitialItemSearchState, itemSearchReducer} = await loadSearch();
    let state = createInitialItemSearchState(initial());
    state = itemSearchReducer(state, {type: "filter/reset"});
    assert.deepEqual(state.nextCriteria.filters, {});
    assert.equal(state.filtersDirty, true);
});

// Catches a request race where an older success overwrites newer results or pending status.
test("item search keeps pending state and ignores stale responses", async function() {
    const {createInitialItemSearchState, itemSearchReducer} = await loadSearch();
    let state = createInitialItemSearchState(initial());
    state = itemSearchReducer(state, {type: "search/requested", requestId: 1, criteria: {...state.criteria, search: "old"}});
    state = itemSearchReducer(state, {type: "search/requested", requestId: 2, criteria: {...state.criteria, search: "new"}});
    assert.equal(state.status, "pending");
    state = itemSearchReducer(state, {type: "search/succeeded", requestId: 1, results: [{id: 11, name: "Old"}], moreResults: false});
    assert.equal(state.status, "pending");
    assert.equal(state.results[0].name, "Ember blade");
    state = itemSearchReducer(state, {type: "search/succeeded", requestId: 2, results: [{id: 12, name: "New"}], moreResults: false});
    assert.equal(state.status, "idle");
    assert.equal(state.results[0].name, "New");
});

// Catches failed current requests that leave a spinner running, and stale failures that erase current results.
test("item search reports only the current request failure", async function() {
    const {createInitialItemSearchState, itemSearchReducer} = await loadSearch();
    let state = createInitialItemSearchState(initial());
    state = itemSearchReducer(state, {type: "search/requested", requestId: 1, criteria: state.criteria});
    state = itemSearchReducer(state, {type: "search/failed", requestId: 1, error: "Request failed"});
    assert.equal(state.status, "error");
    assert.equal(state.error, "Request failed");
    state = itemSearchReducer(state, {type: "search/requested", requestId: 2, criteria: state.criteria});
    state = itemSearchReducer(state, {type: "search/failed", requestId: 1, error: "Stale"});
    assert.equal(state.status, "pending");
    assert.equal(state.error, null);
});

// Catches a changed cookie format or a search URL that omits active filters, sort, or page.
test("item search preserves the existing cookie and canonical query-string formats", async function() {
    const {columnsCookie, searchUrl} = await loadSearch();
    assert.equal(columnsCookie(["Name", "Slot"]), "Name-Slot");
    assert.equal(searchUrl({
        search: "ember blade", filters: {slot: ["3"], isLight: []}, sortBy: "name", sortAsc: true, page: 2
    }), "/items/index.html?filters=slot_3,isLight&search=ember+blade&sortBy=name&sortAsc=true&page=2");
});

// Catches a Columns toggle/reset preference that requests a one-, ten-, or nineteen-year expiry instead of the deployed twenty-year contract.
test("item search Columns preference serialization requests exactly twenty calendar years", async function() {
    const {columnsPreferenceCookie} = await loadCookie();
    const writtenAt = new Date("2026-08-23T14:15:16.000Z");
    assert.equal(
        columnsPreferenceCookie(["Name", "Slot"], writtenAt),
        "sc2=Name-Slot; Path=/; SameSite=Lax; Secure; Expires=Thu, 23 Aug 2046 14:15:16 GMT"
    );
});

// Catches pagination that turns the server's absent-search recent-items mode into an empty named search.
test("item search preserves absent search through initial state and canonical URLs", async function() {
    const {createInitialItemSearchState, searchUrl} = await loadSearch();
    const state = createInitialItemSearchState(initial({query: {page: "2"}}));
    assert.equal(state.criteria.search, null);
    assert.equal(searchUrl(state.criteria), "/items/index.html?page=2");
});

// Catches a client search that interpolates player text into GraphQL source instead of variables.
test("item search sends criteria as GraphQL variables and returns page results", async function() {
    const {loadItems} = await loadApi();
    const originalFetch = globalThis.fetch;
    let request;
    globalThis.fetch = async function(url, options) {
        request = {url, options};
        return {status: 200, json: async () => ({data: {getItems: {items: [{id: 12, name: "Quoted item"}], moreResults: false}}})};
    };
    try {
        const result = await loadItems({
            search: 'quoted "item"', filters: {slot: ["3"]}, sortBy: "name", sortAsc: true, page: 2
        }, metadata.statInfo);
        const body = JSON.parse(request.options.body);
        assert.equal(request.url, "/api");
        assert.equal(body.query.includes('quoted "item"'), false);
        assert.deepEqual(body.variables, {
            searchString: 'quoted "item"', filterString: "slot_3", sortBy: "name", sortAsc: true, page: 2, rows: 20
        });
        assert.deepEqual(result, {items: [{id: 12, name: "Quoted item"}], moreResults: false});
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});

// Catches safe parser diagnostics being replaced by an unhelpful generic
// message, or private non-input failures being exposed to the page.
test("item search exposes only safe query-syntax errors", async function() {
    const {itemSearchErrorMessage} = await loadApi();

    assert.equal(itemSearchErrorMessage({
        errors: [{code: 400, message: 'Unknown numeric item stat "luck".'}]
    }), 'Unknown numeric item stat "luck".');
    assert.equal(itemSearchErrorMessage({
        errors: [{code: 500, message: "private database failure"}]
    }), "Search could not be completed. Try again.");
});

// Catches live result queries selecting only the legacy sortable slot and
// dropping secondary capabilities before the refreshed table can render them.
test("item search requests computed slots without exposing slot masks", async function() {
    const {loadItems} = await loadApi();
    const originalFetch = globalThis.fetch;
    let request;
    globalThis.fetch = async function(url, options) {
        request = {url, options};
        return {status: 200, json: async () => ({data: {getItems: {items: [], moreResults: false}}})};
    };
    try {
        await loadItems({
            search: null, filters: {}, sortBy: "slot", sortAsc: false, page: 2
        }, metadata.statInfo);
        const body = JSON.parse(request.options.body);
        assert.match(body.query, /items\s*\{\s*id name slot slots\s*\}/);
        assert.doesNotMatch(body.query, /slotMask/);
    }
    finally {
        globalThis.fetch = originalFetch;
    }
});
