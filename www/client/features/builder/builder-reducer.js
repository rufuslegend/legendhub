import gameStats from "../../../src/public/js/services/game-stats.js";
import {parseBuilderItemQuery} from "./builder-item-query.js";
import {
    EMPTY_RUNE_CHARMS,
    ITEMS_PER_PAGE_OPTIONS,
    RUNE_CHARM_ID,
    RUNE_CHARM_ITEM_INDEX,
    SLOT_ORDER
} from "./item-constants.js";

function cloneVariant(variant) {
    return {
        ...variant,
        baseStats: {...variant.baseStats},
        ksmStats: {...variant.ksmStats},
        eraAbilities: {...variant.eraAbilities},
        runeCharms: {...variant.runeCharms},
        items: variant.items.map(item => ({...item}))
    };
}

function selectVariant(state, allLists, listIndex, variantIndex) {
    const selectedList = allLists[listIndex].variants[variantIndex];
    return {...state, allLists, selectedListIndex: listIndex, selectedListVariantIndex: variantIndex, selectedList};
}

function compareCharacters(a, b) {
    const left = a.name.toLowerCase();
    const right = b.name.toLowerCase();
    return left < right ? -1 : left > right ? 1 : 0;
}

function accountMetadata(profile) {
    if (profile?.account)
        return {...profile.account};
    if (!profile || !(typeof profile.id === "string" || profile.id === null) || !Number.isInteger(profile.revision))
        return null;
    return {
        id: profile.id,
        revision: profile.revision,
        ...(profile.updatedOn ? {updatedOn: profile.updatedOn} : {})
    };
}

function newCharacter(state, name, variant, account = {}) {
    return {
        name,
        variants: [cloneVariant(variant)],
        ...(state.storageMode === "account" ? {account: {id: null, revision: 0, ...account}} : {})
    };
}

function accountStateWithUsage(state, action) {
    if (action.accountState)
        return action.accountState;
    if (!state.accountState)
        return null;
    const usage = {};
    for (const property of ["storageGeneration", "usedBytes", "quotaBytes"]) {
        if (action[property] !== undefined)
            usage[property] = action[property];
    }
    return {...state.accountState, ...usage};
}

function actionIdentity(action, phase) {
    const identity = action[phase] || {};
    return {
        id: identity.id ?? action[`${phase}Id`],
        name: identity.name ?? action[`${phase}Name`],
        localIdentity: identity.localIdentity
    };
}

function savedProfileIndex(allLists, action, metadata) {
    const current = actionIdentity(action, "current");
    const previous = actionIdentity(action, "previous");
    const localIdentities = [current.localIdentity, previous.localIdentity]
        .filter(identity => identity && typeof identity === "object");
    if (localIdentities.length > 0)
        return allLists.findIndex(character => localIdentities.includes(character.account));
    for (const id of [current.id, previous.id, metadata?.id]) {
        if (typeof id !== "string")
            continue;
        const index = allLists.findIndex(character => character.account?.id === id);
        if (index >= 0)
            return index;
    }
    for (const name of [current.name, previous.name]) {
        if (typeof name !== "string")
            continue;
        const index = allLists.findIndex(character =>
            character.account?.id === null && character.name === name);
        if (index >= 0)
            return index;
    }
    return -1;
}

function selectedCharacterKey(state) {
    const character = state.allLists[state.selectedListIndex];
    if (!character)
        return null;
    return character.account?.id || `name:${character.name}`;
}

function selectAfterAccountMutation(state, allLists, preferredKey = selectedCharacterKey(state)) {
    allLists.sort(compareCharacters);
    let listIndex = allLists.findIndex(character =>
        (character.account?.id || `name:${character.name}`) === preferredKey);
    if (listIndex < 0)
        listIndex = Math.min(state.selectedListIndex, allLists.length - 1);
    const character = allLists[listIndex];
    const selectedName = state.selectedList?.name;
    let variantIndex = character.variants.findIndex(variant => variant.name === selectedName);
    if (variantIndex < 0)
        variantIndex = Math.min(state.selectedListVariantIndex, character.variants.length - 1);
    return selectVariant(state, allLists, listIndex, Math.max(variantIndex, 0));
}

function cloneSelected(state, change) {
    const allLists = state.allLists.slice();
    const character = {...allLists[state.selectedListIndex]};
    character.variants = character.variants.slice();
    const selectedList = cloneVariant(character.variants[state.selectedListVariantIndex]);
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
        sorts: [],
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
        storageMode: null,
        accountState: null,
        syncSourceVersion: 0,
        syncStatus: "browser",
        syncMessage: "",
        migration: {
            status: "idle",
            open: false,
            snapshot: null,
            fingerprint: null,
            profiles: [],
            preferencesChoice: "account",
            request: null,
            result: null,
            error: "",
            acknowledgementWarning: false
        },
        exceptionEncountered: false,
        clientSideDataSize: 0
    };
}

export function builderReducer(state, action) {
    switch (action.type) {
        case "ui/patch":
            return {...state, ...action.value};
        case "lists/load":
            return {
                ...state,
                allLists: action.lists.slice().sort(compareCharacters)
            };
        case "source/loaded": {
            const allLists = action.profiles.slice();
            if (allLists.length === 0)
                allLists.push(newCharacter({...state, storageMode: action.mode}, "Untitled", createDefaultVariant("Original")));
            allLists.sort(compareCharacters);
            return {
                ...state,
                storageMode: action.mode,
                accountState: action.accountState,
                syncSourceVersion: state.syncSourceVersion + 1,
                syncStatus: action.mode === "account" ? "saved" : "browser",
                syncMessage: "",
                allLists,
                selectedListIndex: 0,
                selectedListVariantIndex: 0,
                selectedList: allLists[0]?.variants[0] || null
            };
        }
        case "migration/offered":
            return {
                ...state,
                migration: {
                    status: "offered",
                    open: false,
                    snapshot: action.snapshot,
                    fingerprint: action.fingerprint,
                    profiles: action.profiles.slice(),
                    preferencesChoice: action.preferencesChoice,
                    request: null,
                    result: null,
                    error: "",
                    acknowledgementWarning: false
                }
            };
        case "migration/opened":
            return {...state, migration: {...state.migration, open: true}};
        case "migration/requested":
            return {
                ...state,
                migration: {
                    ...state.migration,
                    status: "pending",
                    open: true,
                    request: action.request || state.migration.request,
                    error: "",
                    acknowledgementWarning: false
                }
            };
        case "migration/succeeded":
            return {
                ...state,
                migration: {
                    ...state.migration,
                    status: "succeeded",
                    open: true,
                    request: null,
                    result: action.result,
                    error: "",
                    acknowledgementWarning: Boolean(action.acknowledgementWarning)
                }
            };
        case "migration/failed":
            return {
                ...state,
                migration: {
                    ...state.migration,
                    status: "error",
                    open: true,
                    error: action.error
                }
            };
        case "migration/dismissed":
            return {
                ...state,
                migration: {
                    ...state.migration,
                    status: "dismissed",
                    open: false,
                    error: ""
                }
            };
        case "account/profile-saved": {
            const allLists = state.allLists.slice();
            const metadata = accountMetadata(action.profile);
            const index = savedProfileIndex(allLists, action, metadata);
            if (index < 0 || !metadata)
                return state;
            allLists[index] = {...allLists[index], account: metadata};
            return {
                ...state,
                allLists,
                accountState: accountStateWithUsage(state, action),
                syncStatus: "saved",
                syncMessage: ""
            };
        }
        case "account/profile-conflicted": {
            const allLists = state.allLists.slice();
            const profileMetadata = accountMetadata(action.profile);
            const profileId = profileMetadata?.id || action.id;
            const index = allLists.findIndex(character => character.account?.id === profileId);
            if (index < 0 || !action.conflictProfile?.variants ||
                (action.profile !== null && !action.profile?.variants))
                return state;
            const wasSelected = index === state.selectedListIndex;
            const returnedConflictMetadata = accountMetadata(action.conflictProfile);
            const conflictProfile = action.preserveNewerEdits
                ? {
                    ...allLists[index],
                    name: action.conflictProfile.name,
                    account: returnedConflictMetadata
                }
                : {
                    ...action.conflictProfile,
                    account: returnedConflictMetadata
                };
            let preferredKey = selectedCharacterKey(state);
            if (action.profile) {
                const profile = {...action.profile, account: profileMetadata || allLists[index].account};
                allLists[index] = profile;
                if (wasSelected)
                    preferredKey = profile.account?.id || `name:${profile.name}`;
            }
            else {
                const fallback = state.allLists[index + 1] || state.allLists[index - 1];
                allLists.splice(index, 1);
                if (wasSelected)
                    preferredKey = fallback
                        ? (fallback.account?.id || `name:${fallback.name}`)
                        : (conflictProfile.account?.id || `name:${conflictProfile.name}`);
            }
            allLists.push(conflictProfile);
            const next = selectAfterAccountMutation(state, allLists, preferredKey);
            return {
                ...next,
                accountState: accountStateWithUsage(state, action),
                syncStatus: "conflict",
                syncMessage: action.message || ""
            };
        }
        case "account/profile-deleted": {
            const allLists = state.allLists.filter(character => character.account?.id !== action.id);
            if (allLists.length === 0)
                allLists.push(newCharacter(
                    state,
                    "Untitled",
                    action.fallbackVariant || createDefaultVariant("Original"),
                    {placeholder: true}
                ));
            const next = selectAfterAccountMutation(state, allLists);
            return {
                ...next,
                accountState: accountStateWithUsage(state, action),
                syncStatus: "saved",
                syncMessage: ""
            };
        }
        case "account/generation-changed":
            return {
                ...state,
                accountState: accountStateWithUsage(state, action),
                syncStatus: "generation-changed",
                syncMessage: action.message || ""
            };
        case "sync/status":
            if (["conflict", "generation-changed"].includes(state.syncStatus) &&
                !["conflict", "generation-changed"].includes(action.status))
                return state;
            if (state.syncStatus === "generation-changed" && action.status === "conflict")
                return state;
            return {
                ...state,
                syncStatus: action.status,
                syncMessage: action.message || ""
            };
        case "variant/select": {
            const selectedList = state.allLists[action.listIndex].variants[action.variantIndex];
            return {
                ...state,
                selectedListIndex: action.listIndex,
                selectedListVariantIndex: action.variantIndex,
                selectedList
            };
        }
        case "character/add": {
            const allLists = state.allLists.slice();
            allLists.push(newCharacter(state, action.name, action.variant));
            allLists.sort(compareCharacters);
            return selectVariant(state, allLists, allLists.findIndex(list => list.name === action.name), 0);
        }
        case "character/rename": {
            const allLists = state.allLists.slice();
            allLists[state.selectedListIndex] = {...allLists[state.selectedListIndex], name: action.name};
            return selectVariant(state, allLists, state.selectedListIndex, state.selectedListVariantIndex);
        }
        case "character/delete": {
            const allLists = state.allLists.slice();
            allLists.splice(state.selectedListIndex, 1);
            if (allLists.length === 0)
                allLists.push(newCharacter(state, "Untitled", action.fallbackVariant, {placeholder: true}));
            const listIndex = Math.min(state.selectedListIndex, allLists.length - 1);
            return selectVariant(state, allLists, listIndex, 0);
        }
        case "variant/clone": {
            const allLists = state.allLists.slice();
            const character = {...allLists[state.selectedListIndex], variants: allLists[state.selectedListIndex].variants.slice()};
            const names = new Set(character.variants.map(variant => variant.name));
            let number = 1;
            while (names.has(`Variant ${number}`)) number++;
            character.variants.push({...cloneVariant(state.selectedList), name: `Variant ${number}`});
            allLists[state.selectedListIndex] = character;
            return selectVariant(state, allLists, state.selectedListIndex, character.variants.length - 1);
        }
        case "variant/rename":
            return cloneSelected(state, selectedList => {
                selectedList.name = action.name;
            });
        case "variant/make-primary": {
            const allLists = state.allLists.slice();
            const character = {...allLists[state.selectedListIndex], variants: allLists[state.selectedListIndex].variants.slice()};
            const selected = character.variants[state.selectedListVariantIndex];
            character.variants[state.selectedListVariantIndex] = character.variants[0];
            character.variants[0] = selected;
            allLists[state.selectedListIndex] = character;
            return selectVariant(state, allLists, state.selectedListIndex, 0);
        }
        case "variant/delete": {
            const allLists = state.allLists.slice();
            const character = {...allLists[state.selectedListIndex], variants: allLists[state.selectedListIndex].variants.slice()};
            character.variants.splice(state.selectedListVariantIndex, 1);
            if (character.variants.length === 0)
                character.variants.push(cloneVariant(action.fallbackVariant));
            allLists[state.selectedListIndex] = character;
            const variantIndex = Math.min(state.selectedListVariantIndex, character.variants.length - 1);
            return selectVariant(state, allLists, state.selectedListIndex, variantIndex);
        }
        case "lists/import": {
            const allLists = state.allLists.map(list => ({...list, variants: list.variants.map(cloneVariant)}));
            for (const imported of action.lists) {
                if (imported.exists && !imported.overwrite)
                    continue;
                const variant = cloneVariant(imported.variants[0]);
                const character = allLists.find(list => list.name === imported.name);
                if (!character) {
                    allLists.push({
                        name: imported.name,
                        variants: [variant],
                        ...(state.storageMode === "account" ? {account: {id: null, revision: 0}} : {})
                    });
                    continue;
                }
                const variantIndex = character.variants.findIndex(entry => entry.name === variant.name);
                if (variantIndex >= 0)
                    character.variants[variantIndex] = variant;
                else
                    character.variants.push(variant);
            }
            return selectVariant(state, allLists, state.selectedListIndex, state.selectedListVariantIndex);
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
        case "stats/normalize":
            return cloneSelected(state, function(selectedList) {
                const total = [
                    "strength", "mind", "dexterity",
                    "constitution", "perception", "spirit"
                ].reduce((sum, stat) => sum + selectedList.baseStats[stat], 0);
                if (total === 244) {
                    selectedList.baseStats.longhouse = -1;
                    selectedList.baseStats.amulet = -1;
                    selectedList.baseStats.hazelnut = -1;
                }
            });
        case "item/select":
            return cloneSelected(state, function(selectedList) {
                const charmSlot = RUNE_CHARM_ITEM_INDEX[action.index];
                if (selectedList.items[action.index].id === RUNE_CHARM_ID && action.item.id !== RUNE_CHARM_ID && charmSlot)
                    selectedList.runeCharms[charmSlot] = "AAAAA";
                selectedList.items[action.index] = {...action.item};
            });
        case "item/toggle-lock":
            return cloneSelected(state, function(selectedList) {
                const item = selectedList.items[action.index];
                item.locked = !item.locked;
            });
        case "search/toggle-lock": {
            const next = cloneSelected(state, function(selectedList) {
                const item = selectedList.items[state.currentItemIndex];
                item.locked = !item.locked;
            });
            return {...next, currentItem: next.selectedList.items[state.currentItemIndex]};
        }
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
        case "search/open":
            return {
                ...state,
                loadingModal: false,
                searchString: "",
                sortStat: "",
                sortDir: "",
                sorts: [],
                currentItem: action.item,
                currentItemIndex: action.index,
                isRuneCrafting: action.item.id === RUNE_CHARM_ID,
                charmSelectors: action.item.id === RUNE_CHARM_ID
                    ? (state.selectedList.runeCharms[RUNE_CHARM_ITEM_INDEX[action.index]] || "AAAAA").split("")
                    : ["A", "A", "A", "A", "A"]
            };
        case "search/sort": {
            const sortDir = state.sortStat === action.stat && state.sortDir === "-" ? "+" : "-";
            const previousSorts = Array.isArray(state.sorts) ? state.sorts : [];
            const sorts = [
                {stat: action.stat, direction: sortDir},
                ...previousSorts.filter(sort => sort.stat !== action.stat)
            ];
            return {
                ...state,
                sortStat: action.stat,
                sortDir,
                sorts,
                filteredItems: sortBuilderItems(state.filteredItems, sorts)
            };
        }
        case "rune/update":
            return cloneSelected(state, function(selectedList) {
                const charmSlot = RUNE_CHARM_ITEM_INDEX[action.index];
                if (!charmSlot)
                    return;
                selectedList.runeCharms[charmSlot] = action.charm;
                Object.assign(selectedList.items[action.index], action.runeStats);
                const name = action.runeStats.charmName.slice(0, -1);
                selectedList.items[action.index].name = `Runecharm (${name})`;
                selectedList.items[action.index].id = action.runeId;
            });
        case "rune/toggle-mode":
            return {...state, isRuneCrafting: !state.isRuneCrafting};
        case "column/toggle":
            return {
                ...state,
                statInfo: state.statInfo.map(stat => stat.var !== "name" && stat.short === action.stat ? {...stat, showColumn: !stat.showColumn} : stat)
            };
        case "columns/reset":
            return {
                ...state,
                statInfo: state.statInfo.map(stat => ({...stat, showColumn: stat.var === "name" || stat.showColumnDefault}))
            };
        case "filters/reset": {
            const defaults = new Map(state.defaultStatInfo.map(stat => [stat.var, stat.filter]));
            return {
                ...state,
                statInfo: state.statInfo.map(stat => defaults.has(stat.var) ? {...stat, filter: defaults.get(stat.var)} : stat)
            };
        }
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

export function sortBuilderItems(items, sorts = []) {
    if (!Array.isArray(sorts) || sorts.length === 0)
        return items;
    return items.slice().sort(function(a, b) {
        for (const sort of sorts) {
            const left = a[sort.stat];
            const right = b[sort.stat];
            if (left === undefined && right === undefined)
                continue;
            if (left === undefined)
                return -1;
            if (right === undefined)
                return 1;
            const normalizedLeft = typeof left === "string" ? left.toUpperCase() : left;
            const normalizedRight = typeof right === "string" ? right.toUpperCase() : right;
            const result = normalizedLeft < normalizedRight ? -1 : normalizedLeft > normalizedRight ? 1 : 0;
            if (result !== 0)
                return result * (sort.direction === "-" ? -1 : 1);
        }
        return 0;
    });
}

export function selectFilteredItems(state) {
    if (!state.currentItem)
        return undefined;
    const items = state.itemsBySlot[state.currentItem.slot];
    if (!items)
        return items;
    const {matches} = parseBuilderItemQuery(state.searchString, state.statInfo);
    return items.filter(matches);
}

export function selectSortedItems(state) {
    const items = selectFilteredItems(state);
    if (!items)
        return items;
    const sorts = Array.isArray(state.sorts) ? state.sorts : state.sortStat
        ? [{stat: state.sortStat, direction: state.sortDir}]
        : [];
    return sortBuilderItems(items, sorts);
}

export function selectItemSearchError(state) {
    return parseBuilderItemQuery(state.searchString, state.statInfo).error;
}

export function selectPagedItems(state, page = state.currentPage) {
    const start = (page - 1) * state.itemsPerPage;
    return (state.filteredItems || []).slice(start, start + state.itemsPerPage);
}

export function selectRuneCharms(state, index) {
    const charmSlot = RUNE_CHARM_ITEM_INDEX[index];
    const charm = charmSlot && state.selectedList ? state.selectedList.runeCharms[charmSlot] : "";
    return charm.split("");
}

export function selectStatTotal(state, statName) {
    return gameStats.calculateBuilderStatTotal(state.selectedList, statName).value;
}

export function selectStatRestrictions(state, statName) {
    return gameStats.calculateBuilderStatTotal(state.selectedList, statName).restrictions;
}
