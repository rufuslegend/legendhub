import gameStats from "../../../src/public/js/services/game-stats.js";
import {
    EMPTY_RUNE_CHARMS,
    ITEMS_PER_PAGE_OPTIONS,
    RUNE_CHARM_ITEM_INDEX,
    SLOT_ORDER
} from "./item-constants.js";

function cloneSelected(state, change) {
    const allLists = state.allLists.slice();
    const character = {...allLists[state.selectedListIndex]};
    character.variants = character.variants.slice();
    const selectedList = {
        ...character.variants[state.selectedListVariantIndex],
        baseStats: {...character.variants[state.selectedListVariantIndex].baseStats},
        ksmStats: {...character.variants[state.selectedListVariantIndex].ksmStats},
        eraAbilities: {...character.variants[state.selectedListVariantIndex].eraAbilities},
        runeCharms: {...character.variants[state.selectedListVariantIndex].runeCharms},
        items: character.variants[state.selectedListVariantIndex].items.map(item => ({...item}))
    };
    change(selectedList);
    character.variants[state.selectedListVariantIndex] = selectedList;
    allLists[state.selectedListIndex] = character;
    return {...state, allLists, selectedList};
}

export function createDefaultVariant(name) {
    return {
        name,
        baseStats: {
            strength: 0,
            mind: 0,
            dexterity: 0,
            constitution: 0,
            perception: 0,
            spirit: 0,
            longhouse: -1,
            hazelnut: -1,
            amulet: -1,
            quest_hp: 0,
            quest_mana: 0,
            quest_move: 0
        },
        ksmStats: {
            strength: 0,
            mind: 0,
            dexterity: 0,
            constitution: 0,
            perception: 0,
            spirit: 0
        },
        eraAbilities: gameStats.getDefaultEraAbilityRanks(),
        runeCharms: {...EMPTY_RUNE_CHARMS},
        items: SLOT_ORDER.map(slot => ({slot, id: 0, name: "-"}))
    };
}

export function createInitialBuilderState() {
    return {
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
        itemsPerPage: ITEMS_PER_PAGE_OPTIONS[0],
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
    };
}

export function builderReducer(state, action) {
    switch (action.type) {
        case "lists/load":
            return {...state, allLists: action.lists};
        case "variant/select": {
            const selectedList = state.allLists[action.listIndex].variants[action.variantIndex];
            return {
                ...state,
                selectedListIndex: action.listIndex,
                selectedListVariantIndex: action.variantIndex,
                selectedList
            };
        }
        case "stat/change":
            return cloneSelected(state, function(selectedList) {
                selectedList[action.section][action.stat] = action.value;
                if (action.section === "baseStats") {
                    const total = [
                        "strength", "mind", "dexterity",
                        "constitution", "perception", "spirit"
                    ].reduce((sum, stat) => sum + selectedList.baseStats[stat], 0);
                    if (total === 244) {
                        selectedList.baseStats.longhouse = -1;
                        selectedList.baseStats.amulet = -1;
                        selectedList.baseStats.hazelnut = -1;
                    }
                }
            });
        case "item/toggle-lock":
            return cloneSelected(state, function(selectedList) {
                const item = selectedList.items[action.index];
                item.locked = !item.locked;
            });
        case "items/toggle-lock":
            return cloneSelected(state, function(selectedList) {
                const allLocked = selectedList.items.every(item => item.locked);
                selectedList.items.forEach(item => {
                    item.locked = !allLocked;
                });
            });
        case "items/clear-unlocked":
            return cloneSelected(state, function(selectedList) {
                selectedList.items.forEach(function(item, index) {
                    if (item.locked)
                        return;
                    const charmSlot = RUNE_CHARM_ITEM_INDEX[index];
                    if (charmSlot)
                        selectedList.runeCharms[charmSlot] = "AAAAA";
                    selectedList.items[index] = {slot: item.slot, id: 0, name: "-"};
                });
            });
        case "page/change":
            return {
                ...state,
                currentPage: Math.min(Math.max(Number(action.page) || 1, 1), Math.max(state.totalPages, 1))
            };
        case "search/text":
            return {...state, searchString: action.value, currentPage: 1};
        case "search/sort":
            return {
                ...state,
                sortStat: action.stat,
                sortDir: state.sortStat === action.stat && state.sortDir === "-" ? "+" : "-"
            };
        case "request/pending":
            return {...state, requestStatus: "pending", requestError: null};
        case "request/succeeded":
            return {...state, requestStatus: "idle", requestError: null};
        case "request/failed":
            return {...state, requestStatus: "error", requestError: action.error};
        case "dialog/confirm":
            return {...state, confirmMessage: action.message, confirmAction: action.action};
        case "dialog/close":
            return {...state, confirmMessage: "", confirmAction: null};
        default:
            return state;
    }
}

export function selectStatTotal(state, statName) {
    return gameStats.calculateBuilderStatTotal(state.selectedList, statName).value;
}

export function selectStatRestrictions(state, statName) {
    return gameStats.calculateBuilderStatTotal(state.selectedList, statName).restrictions;
}
