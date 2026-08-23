"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

async function loadReducer() {
    return import("../../client/features/builder/builder-reducer.js");
}

// Catches initial state that omits a Builder-owned field or creates shared mutable defaults between variants.
test("builder initial state owns list, equipment, search, dialog, and request state", async function() {
    const {createDefaultVariant, createInitialBuilderState} = await loadReducer();
    const first = createDefaultVariant("Original");
    const second = createDefaultVariant("Other");
    first.items[0].id = 99;

    assert.equal(first.items.length, 35);
    assert.equal(second.items[0].id, 0);
    assert.deepEqual(createInitialBuilderState(), {
        allLists: [],
        selectedListIndex: 0,
        selectedListVariantIndex: 0,
        selectedList: null,
        statInfo: [],
        defaultStatInfo: [],
        itemsBySlot: Array.from({length: 22}, () => []),
        filteredItems: [],
        currentItem: null,
        currentItemIndex: null,
        currentPage: 1,
        totalPages: 0,
        itemsPerPage: 20,
        searchString: "",
        sortStat: "",
        sortDir: "",
        wieldSlotFilter: 0,
        itemRestrictions: [],
        statRestrictions: {},
        isRuneCrafting: false,
        charmSelectors: ["A", "A", "A", "A", "A"],
        importModel: null,
        exportModel: null,
        textInputModalModel: null,
        confirmMessage: "",
        confirmAction: null,
        loadingModal: false,
        requestStatus: "idle",
        requestError: null,
        exceptionEncountered: false,
        clientSideDataSize: 0
    });
});

// Catches selection transitions that mutate the prior state or leave selectedList detached from its canonical variant.
test("builder reducer selects characters and variants from canonical list state", async function() {
    const {builderReducer, createDefaultVariant, createInitialBuilderState} = await loadReducer();
    const tank = createDefaultVariant("Tank");
    const caster = createDefaultVariant("Caster");
    const initial = {...createInitialBuilderState(), allLists: [{name: "Hero", variants: [tank, caster]}]};
    const selected = builderReducer(initial, {type: "variant/select", listIndex: 0, variantIndex: 1});

    assert.notEqual(selected, initial);
    assert.equal(selected.selectedList, caster);
    assert.equal(selected.selectedListIndex, 0);
    assert.equal(selected.selectedListVariantIndex, 1);
    assert.equal(initial.selectedList, null);
});

// Catches the 244-point transition retaining quest selections that the live Builder clears.
test("builder stat transition clears quest selections at the 244-point base profile", async function() {
    const {builderReducer, createDefaultVariant, createInitialBuilderState} = await loadReducer();
    const variant = createDefaultVariant("Original");
    Object.assign(variant.baseStats, {
        strength: 44, mind: 40, dexterity: 40,
        constitution: 40, perception: 40, spirit: 40,
        longhouse: 2, amulet: 1, hazelnut: 5
    });
    const state = {...createInitialBuilderState(), allLists: [{name: "Hero", variants: [variant]}], selectedList: variant};
    const next = builderReducer(state, {type: "stat/change", section: "baseStats", stat: "strength", value: 44});

    assert.equal(next.selectedList.baseStats.longhouse, -1);
    assert.equal(next.selectedList.baseStats.amulet, -1);
    assert.equal(next.selectedList.baseStats.hazelnut, -1);
    assert.equal(state.selectedList.baseStats.longhouse, 2);
});

// Catches clearing equipment that removes locked items or leaves stale runecharm encodings behind.
test("builder clear transition preserves locked items and resets unlocked runecharm slots", async function() {
    const {builderReducer, createDefaultVariant, createInitialBuilderState} = await loadReducer();
    const variant = createDefaultVariant("Original");
    variant.items[0] = {id: 10, slot: 0, name: "Locked", locked: true};
    variant.items[3] = {id: -5, slot: 2, name: "Runecharm", locked: false};
    variant.runeCharms.charm1 = "BCDEF";
    const state = {...createInitialBuilderState(), allLists: [{name: "Hero", variants: [variant]}], selectedList: variant};
    const next = builderReducer(state, {type: "items/clear-unlocked"});

    assert.equal(next.selectedList.items[0].id, 10);
    assert.equal(next.selectedList.items[3].id, 0);
    assert.equal(next.selectedList.runeCharms.charm1, "AAAAA");
    assert.equal(state.selectedList.items[3].id, -5);
});

// Catches pagination and sorting transitions that escape deployed bounds or discard the active sort field.
test("builder reducer bounds pages and toggles the active search sort", async function() {
    const {builderReducer, createInitialBuilderState} = await loadReducer();
    let state = {...createInitialBuilderState(), totalPages: 3};
    state = builderReducer(state, {type: "page/change", page: 7});
    assert.equal(state.currentPage, 3);
    state = builderReducer(state, {type: "search/sort", stat: "name"});
    assert.deepEqual([state.sortStat, state.sortDir], ["name", "-"]);
    state = builderReducer(state, {type: "search/sort", stat: "name"});
    assert.deepEqual([state.sortStat, state.sortDir], ["name", "+"]);
});
