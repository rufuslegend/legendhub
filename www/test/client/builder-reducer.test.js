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

// Catches the React page's transient UI state leaking into a second owner instead of the Builder reducer.
test("builder reducer owns transient React dialog and request state", async function() {
    const {builderReducer, createInitialBuilderState} = await loadReducer();
    const initial = createInitialBuilderState();
    const next = builderReducer(initial, {
        type: "ui/patch",
        value: {currentDialog: "export", requestError: "Could not load items."}
    });

    assert.equal(next.currentDialog, "export");
    assert.equal(next.requestError, "Could not load items.");
    assert.equal(initial.currentDialog, undefined);
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

// Catches persisted characters losing the live Builder's case-insensitive display order when loaded.
test("builder reducer sorts loaded characters case-insensitively", async function() {
    const {builderReducer, createDefaultVariant, createInitialBuilderState} = await loadReducer();
    const lists = [
        {name: "zulu", variants: [createDefaultVariant("Original")]},
        {name: "Alpha", variants: [createDefaultVariant("Original")]}
    ];

    const next = builderReducer(createInitialBuilderState(), {type: "lists/load", lists});
    assert.deepEqual(next.allLists.map(list => list.name), ["Alpha", "zulu"]);
    assert.deepEqual(lists.map(list => list.name), ["zulu", "Alpha"]);
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

// Catches character and variant commands mutating prior state, losing sorted selection, or selecting the wrong primary.
test("builder reducer owns character and variant lifecycle transitions", async function() {
    const {builderReducer, createDefaultVariant, createInitialBuilderState} = await loadReducer();
    const original = createDefaultVariant("Original");
    let state = {
        ...createInitialBuilderState(),
        allLists: [{name: "Zulu", variants: [original]}],
        selectedList: original
    };

    state = builderReducer(state, {
        type: "character/add", name: "Alpha", variant: createDefaultVariant("Original")
    });
    assert.deepEqual(state.allLists.map(list => list.name), ["Alpha", "Zulu"]);
    assert.deepEqual([state.selectedListIndex, state.selectedListVariantIndex], [0, 0]);

    const copied = {...state.selectedList, name: "Original Copy"};
    state = builderReducer(state, {type: "variant/add", listIndex: 0, variant: copied});
    assert.equal(state.selectedList.name, "Original Copy");
    assert.equal(state.selectedListVariantIndex, 1);
    state = builderReducer(state, {type: "variant/make-primary"});
    assert.equal(state.allLists[0].variants[0].name, "Original Copy");
    assert.equal(state.selectedListVariantIndex, 0);

    state = builderReducer(state, {type: "character/rename", name: "Beta"});
    state = builderReducer(state, {type: "variant/rename", name: "Primary"});
    assert.equal(state.allLists[0].name, "Beta");
    assert.equal(state.selectedList.name, "Primary");

    state = builderReducer(state, {type: "variant/delete", fallbackVariant: createDefaultVariant("Original")});
    assert.equal(state.allLists[0].variants.length, 1);
    state = builderReducer(state, {type: "character/delete", fallbackVariant: createDefaultVariant("Original")});
    assert.equal(state.allLists[0].name, "Zulu");
    assert.equal(state.selectedList, state.allLists[0].variants[0]);
});

// Catches imports that overwrite the wrong variant, duplicate an existing variant, or mutate the prior collection.
test("builder reducer merges submitted import entries by character and variant name", async function() {
    const {builderReducer, createDefaultVariant, createInitialBuilderState} = await loadReducer();
    const original = createDefaultVariant("Original");
    const replacement = createDefaultVariant("Original");
    replacement.baseStats.strength = 44;
    const extra = createDefaultVariant("Caster");
    const ignored = createDefaultVariant("Ignored");
    const state = {
        ...createInitialBuilderState(),
        allLists: [{name: "Hero", variants: [original]}],
        selectedList: original
    };
    const next = builderReducer(state, {type: "lists/import", lists: [
        {name: "Hero", exists: true, overwrite: true, variants: [replacement]},
        {name: "Hero", exists: false, variants: [extra]},
        {name: "Other", exists: false, variants: [createDefaultVariant("Original")]},
        {name: "Skipped", exists: true, overwrite: false, variants: [ignored]}
    ]});

    assert.deepEqual(next.allLists.map(list => list.name), ["Hero", "Other"]);
    assert.deepEqual(next.allLists[0].variants.map(variant => variant.name), ["Original", "Caster"]);
    assert.equal(next.allLists[0].variants[0].baseStats.strength, 44);
    assert.equal(state.allLists[0].variants[0].baseStats.strength, 0);
});

// Catches item selection retaining stale rune text or mutating the canonical prior variant.
test("builder reducer selects equipment and clears a replaced runecharm encoding", async function() {
    const {builderReducer, createDefaultVariant, createInitialBuilderState} = await loadReducer();
    const variant = createDefaultVariant("Original");
    variant.items[3] = {id: -5, slot: 2, name: "Runecharm"};
    variant.runeCharms.charm1 = "BCDEF";
    const state = {...createInitialBuilderState(), allLists: [{name: "Hero", variants: [variant]}], selectedList: variant};
    const item = {id: 42, slot: 2, name: "Replacement"};
    const next = builderReducer(state, {type: "item/select", index: 3, item});

    assert.deepEqual(next.selectedList.items[3], item);
    assert.equal(next.selectedList.runeCharms.charm1, "AAAAA");
    assert.equal(state.selectedList.items[3].id, -5);
});

// Catches the picker unlock control changing only its current-row copy or only
// the canonical equipped item, which would leave choices permanently disabled.
test("builder reducer unlocks the current picker item in canonical state", async function() {
    const {builderReducer, createDefaultVariant, createInitialBuilderState} = await loadReducer();
    const variant = createDefaultVariant("Original");
    variant.items[0] = {id: 41, slot: 0, name: "Locked light", locked: true};
    let state = {...createInitialBuilderState(), allLists: [{name: "Hero", variants: [variant]}], selectedList: variant};
    state = builderReducer(state, {type: "search/open", item: variant.items[0], index: 0});
    state = builderReducer(state, {type: "search/toggle-lock"});

    assert.equal(state.selectedList.items[0].locked, false);
    assert.equal(state.currentItem.locked, false);
});

// Catches search state leaking between slots or filtering/sorting/paging with different deployed semantics.
test("builder reducer and selectors own item search transitions", async function() {
    const {builderReducer, createInitialBuilderState, selectFilteredItems, selectPagedItems} = await loadReducer();
    const items = [
        {id: 1, name: "Sword", slot: 14, realSlot: 14, strength: 3},
        {id: 2, name: "Axe", slot: 14, realSlot: 15, strength: 5},
        {id: 3, name: "Spear", slot: 14, realSlot: 14, strength: 7}
    ];
    let state = {
        ...createInitialBuilderState(), itemsBySlot: Array.from({length: 22}, () => []),
        statInfo: [{short: "Str", var: "strength"}], itemsPerPage: 1
    };
    state.itemsBySlot[14] = items;
    state = builderReducer(state, {type: "search/open", item: items[0], index: 0});
    state = builderReducer(state, {type: "search/text", value: "str>3"});
    state = builderReducer(state, {type: "search/wield", value: 1});
    state = {...state, filteredItems: items};
    state = builderReducer(state, {type: "search/sort", stat: "strength"});

    assert.deepEqual(selectFilteredItems(state).map(item => item.id), [3]);
    assert.deepEqual(state.filteredItems.map(item => item.id), [3, 2, 1]);
    assert.deepEqual(selectPagedItems({...state, filteredItems: items}, 2).map(item => item.id), [2]);
    assert.equal(state.currentItemIndex, 0);
    assert.equal(state.searchString, "str>3");
});

// Catches runecrafting that updates only the charm string or only the displayed item stats.
test("builder reducer applies a runecraft selection atomically", async function() {
    const {builderReducer, createDefaultVariant, createInitialBuilderState, selectRuneCharms} = await loadReducer();
    const variant = createDefaultVariant("Original");
    const state = {...createInitialBuilderState(), allLists: [{name: "Hero", variants: [variant]}], selectedList: variant};
    let next = builderReducer(state, {
        type: "rune/update", index: 3, charm: "BCDEF", runeId: -5,
        runeStats: {strength: 4, charmName: "Power "}
    });

    assert.equal(next.selectedList.runeCharms.charm1, "BCDEF");
    assert.equal(next.selectedList.items[3].id, -5);
    assert.equal(next.selectedList.items[3].strength, 4);
    assert.equal(next.selectedList.items[3].name, "Runecharm (Power)");
    assert.equal(state.selectedList.items[3].id, 0);
    next = builderReducer(next, {type: "rune/toggle-mode"});
    assert.equal(next.isRuneCrafting, true);
    assert.deepEqual(selectRuneCharms(next, 3), ["B", "C", "D", "E", "F"]);
});

// Catches column and filter reset commands mutating shared metadata or resetting to the wrong defaults.
test("builder reducer owns visible-column and item-filter transitions", async function() {
    const {builderReducer, createInitialBuilderState} = await loadReducer();
    const state = {
        ...createInitialBuilderState(),
        statInfo: [
            {var: "strength", short: "Str", showColumn: true, showColumnDefault: false, filter: "old"},
            {var: "mind", short: "Min", showColumn: false, showColumnDefault: true, filter: "keep"}
        ],
        defaultStatInfo: [{var: "strength", filter: "default"}]
    };
    let next = builderReducer(state, {type: "column/toggle", stat: "Str"});
    assert.equal(next.statInfo[0].showColumn, false);
    next = builderReducer(next, {type: "columns/reset"});
    assert.deepEqual(next.statInfo.map(stat => stat.showColumn), [false, true]);
    next = builderReducer(next, {type: "filters/reset"});
    assert.deepEqual(next.statInfo.map(stat => stat.filter), ["default", "keep"]);
    assert.equal(state.statInfo[0].showColumn, true);
});
