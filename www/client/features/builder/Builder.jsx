import {useCallback, useEffect, useMemo, useReducer, useRef} from "react";
import gameStats from "../../../src/public/js/services/game-stats.js";
import {graphqlRequest} from "../../lib/graphql-request.js";
import CharacterPanel from "./CharacterPanel.jsx";
import EquipmentPanel from "./EquipmentPanel.jsx";
import StatsPanel from "./StatsPanel.jsx";
import ImportExportDialog from "./ImportExportDialog.jsx";
import BuilderListsDialog from "./BuilderListsDialog.jsx";
import {deriveItemRestrictions, deriveRuneCharmStats} from "./builder-derivations.js";
import {decodeBuilderEntries, decodeBuilderLists, encodeBuilderLists, encodeBuilderVariant} from "./builder-encoding.js";
import {applyBuilderPersistencePlan, applySelectedColumns, calculateStorageSize, createBuilderPersistencePlan, formatStorageSize, readBuilderPersistence} from "./builder-persistence.js";
import {builderReducer, createDefaultVariant, createInitialBuilderState, selectStatRestrictions, selectStatTotal} from "./builder-reducer.js";
import {RUNE_CHARM_ID} from "./item-constants.js";
import {createItemsBySlotQuery, createItemsInIdsQuery, hydrateBuilderVariant} from "./builder-api.js";

function cookies() { return Object.fromEntries(document.cookie.split("; ").filter(Boolean).map(value => value.split("=").map(decodeURIComponent))); }
function cookieStore() { return {get: name => cookies()[name], put(name, value, options) { document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=${options.path}; SameSite=Lax; Secure; expires=${options.expires.toUTCString()}`; }, remove(name) { document.cookie = `${encodeURIComponent(name)}=; path=/; expires=${new Date(0).toUTCString()}`; }}; }

function storageAdapter() { return {setItem: (name, value) => localStorage.setItem(name, value)}; }
async function hydrateLists(lists, fragment) {
    const ids = [...new Set(lists.flatMap(list => list.variants.flatMap(variant => variant.items.map(item => item.id).filter(id => id > 0))))];
    const data = ids.length ? await graphqlRequest({query: createItemsInIdsQuery(fragment), variables: {ids}}) : {getItemsInIds: []};
    return lists.map(list => ({...list, variants: list.variants.map(variant => hydrateBuilderVariant(variant, data.getItemsInIds))}));
}

export default function Builder({itemStatCategories = [], selectedColumns = []}) {
    const [state, dispatch] = useReducer(builderReducer, undefined, createInitialBuilderState);
    const hydrated = useRef(false);
    const selected = state.selectedList;
    const totals = useMemo(() => Object.fromEntries(state.statInfo.map(stat => [stat.var, selected && (stat.type === "int" || stat.var === "alignRestriction") ? selectStatTotal({selectedList: selected}, stat.var) : ""])), [state.statInfo, selected]);
    const statRestrictions = useMemo(() => Object.fromEntries(state.statInfo.map(stat => [stat.var, selected && (stat.type === "int" || stat.var === "alignRestriction") ? selectStatRestrictions({selectedList: selected}, stat.var) : []])), [state.statInfo, selected]);
    const restrictions = useMemo(() => selected ? deriveItemRestrictions({items: selected.items, strength: totals.strength || 0}) : [], [selected, totals.strength]);

    useEffect(function() {
        let cancelled = false;
        async function load() {
            dispatch({type: "request/pending"});
            try {
                const data = await graphqlRequest({query: "{ getItemStatInfo { display short var type filterString defaultValue netStat showColumnDefault } getItemFragment }"});
                if (cancelled) return;
                const cookieValues = cookies();
                const persisted = readBuilderPersistence({cookies: cookieValues, storage: localStorage});
                let lists = persisted.encodedLists ? decodeBuilderLists(persisted.encodedLists) : [];
                if (!lists.length) lists.push({name: "Untitled", variants: [createDefaultVariant("Original")]});
                lists = await hydrateLists(lists, data.getItemFragment);
                if (cancelled) return;
                lists.sort((left, right) => left.name.localeCompare(right.name, undefined, {sensitivity: "accent"}));
                const [characterName, variantName] = String(persisted.selectedList || "!").split("!");
                const listIndex = Math.max(lists.findIndex(list => list.name === characterName), 0);
                const variantIndex = Math.max(lists[listIndex].variants.findIndex(variant => variant.name === variantName), 0);
                const selectedCharacterName = lists[listIndex].name;
                const statInfo = applySelectedColumns(cookies()[`sc-${selectedCharacterName}`] || persisted.columns, data.getItemStatInfo);
                dispatch({type: "ui/patch", value: {allLists: lists, selectedListIndex: listIndex, selectedListVariantIndex: variantIndex, selectedList: lists[listIndex].variants[variantIndex], statInfo, defaultStatInfo: data.getItemStatInfo, itemFragment: data.getItemFragment, itemsPerPage: persisted.itemsPerPage, initialized: true}});
                dispatch({type: "request/succeeded"});
                hydrated.current = true;
            }
            catch (error) {
                if (cancelled) return;
                const list = {name: "Untitled", variants: [createDefaultVariant("Original")]};
                const fallbackStatInfo = itemStatCategories.flatMap(category => category.getItemStatInfo || []).map(stat => ({...stat, showColumn: selectedColumns.includes(stat.short) || Boolean(stat.showColumnDefault)}));
                dispatch({type: "ui/patch", value: {allLists: [list], selectedListIndex: 0, selectedListVariantIndex: 0, selectedList: list.variants[0], statInfo: fallbackStatInfo, defaultStatInfo: fallbackStatInfo, initialized: true, requestStatus: "error", requestError: error.message || "Builder data could not be loaded. Try refreshing the page."}});
                hydrated.current = true;
            }
        }
        load();
        return () => { cancelled = true; };
    }, []);

    useEffect(function() {
        if (!hydrated.current || !selected) return;
        const plan = createBuilderPersistencePlan({hasConsent: Boolean(cookies()["cookie-consent"]), exceptionEncountered: state.exceptionEncountered, encodedLists: encodeBuilderLists(state.allLists), selectedCharacter: state.allLists[state.selectedListIndex].name, selectedVariant: selected.name, itemsPerPage: state.itemsPerPage, selectedColumns: state.statInfo.filter(stat => stat.showColumn).map(stat => stat.short)});
        applyBuilderPersistencePlan(plan, {cookies: cookieStore(), storage: storageAdapter()});
        const size = calculateStorageSize(localStorage);
        if (size !== state.clientSideDataSize) dispatch({type: "ui/patch", value: {clientSideDataSize: formatStorageSize(size)}});
    }, [state.allLists, state.selectedListIndex, state.selectedListVariantIndex, selected, state.statInfo, state.itemsPerPage, state.exceptionEncountered]);

    function action(value) {
        if (value.type === "variant/select" && value.listIndex !== state.selectedListIndex) {
            const characterName = state.allLists[value.listIndex].name;
            dispatch({type: "ui/patch", value: {statInfo: applySelectedColumns(cookies()[`sc-${characterName}`], state.defaultStatInfo)}});
        }
        dispatch(value);
    }
    const close = useCallback(function() { dispatch({type: "ui/patch", value: {currentDialog: null, currentItem: null, isRuneCrafting: false}}); }, []);
    const openDialog = useCallback(function(currentDialog) {
        dispatch({type: "ui/patch", value: {currentDialog, dialogError: "", importModel: currentDialog === "import" ? {input: "", lists: [], message: "", loading: false} : state.importModel, dialogName: currentDialog === "edit-character" ? state.allLists[state.selectedListIndex].name : currentDialog === "edit-variant" ? selected.name : ""}});
    }, [selected, state.allLists, state.importModel, state.selectedListIndex]);
    function listsDialog(value, typing) {
        if (typing) return dispatch({type: "ui/patch", value: {dialogName: value}});
        if (state.currentDialog === "clear") dispatch({type: "items/clear-unlocked"});
        else if (state.currentDialog === "delete-character") {
            cookieStore().remove(`sc-${state.allLists[state.selectedListIndex].name}`);
            dispatch({type: "character/delete", fallbackVariant: createDefaultVariant("Original")});
        }
        else if (state.currentDialog === "delete-variant") dispatch({type: "variant/delete", fallbackVariant: createDefaultVariant("Original")});
        else if (["add-character", "edit-character", "edit-variant"].includes(state.currentDialog)) {
            const name = String(value || "").trim();
            const character = state.allLists[state.selectedListIndex];
            const duplicateCharacter = state.allLists.some((list, index) => list.name === name && (state.currentDialog !== "edit-character" || index !== state.selectedListIndex));
            const duplicateVariant = character.variants.some((variant, index) => variant.name === name && (state.currentDialog !== "edit-variant" || index !== state.selectedListVariantIndex));
            const tooMany = state.currentDialog === "add-character" && state.allLists.length >= 20000;
            if (!/^[A-Za-z\s\d]+$/.test(name)) return dispatch({type: "ui/patch", value: {dialogError: "Invalid characters."}});
            if (tooMany) return dispatch({type: "ui/patch", value: {dialogError: "Limit reached."}});
            if (duplicateCharacter || duplicateVariant) return dispatch({type: "ui/patch", value: {dialogError: "Duplicate entry."}});
            if (state.currentDialog === "add-character") dispatch({type: "character/add", name, variant: createDefaultVariant("Original")});
            if (state.currentDialog === "edit-character") {
                const oldName = character.name;
                const columns = cookies()[`sc-${oldName}`];
                if (columns) { cookieStore().put(`sc-${name}`, columns, {path: "/", expires: new Date("2100-01-01")}); cookieStore().remove(`sc-${oldName}`); }
                dispatch({type: "character/rename", name});
            }
            if (state.currentDialog === "edit-variant") dispatch({type: "variant/rename", name});
        }
        close();
    }
    function exportValue() { const character = state.allLists[state.selectedListIndex]; return {allLists: encodeBuilderLists(state.allLists), curList: `6*${character.variants.map(variant => encodeBuilderVariant(character.name, variant)).join("*")}*`, curVariant: `6*${encodeBuilderVariant(character.name, selected)}*`, characterName: character.name, variantName: selected.name}; }
    function importChange(input, overwriteIndex, overwrite) {
        let lists = [];
        let message = "";
        try { lists = input ? decodeBuilderEntries(input) : []; }
        catch (_error) { message = "Invalid list import string."; }
        lists = lists.map(entry => { const existing = state.allLists.find(list => list.name === entry.name)?.variants.some(variant => variant.name === entry.variants[0].name); return {...entry, exists: Boolean(existing), overwrite: existing}; });
        if (overwriteIndex !== undefined) { const existingRows = lists.filter(list => list.exists); if (existingRows[overwriteIndex]) existingRows[overwriteIndex].overwrite = overwrite; }
        if (!message && lists.some(list => list.exists)) message = "The following lists already exist and will be overwritten unless otherwise specified:";
        dispatch({type: "ui/patch", value: {importModel: {input, lists, message, loading: false}}});
    }
    async function submitImport() {
        if (!state.importModel?.lists?.length) {
            dispatch({type: "ui/patch", value: {importModel: {...state.importModel, message: "Invalid list import string."}}});
            return;
        }
        dispatch({type: "ui/patch", value: {importModel: {...state.importModel, loading: true}}});
        dispatch({type: "request/pending"});
        try {
            const lists = await hydrateLists(state.importModel.lists, state.itemFragment);
            dispatch({type: "lists/import", lists});
            dispatch({type: "request/succeeded"});
            close();
        }
        catch (error) {
            const message = error.message || "Imported items could not be loaded. Try again.";
            dispatch({type: "ui/patch", value: {importModel: {...state.importModel, loading: false, message}}});
            dispatch({type: "request/failed", error: message});
        }
    }
    async function openItem(index) {
        const item = selected.items[index];
        dispatch({type: "search/open", item, index});
        if (state.itemsBySlot[item.slot]?.length) return;
        dispatch({type: "request/pending"});
        try { const data = await graphqlRequest({query: createItemsBySlotQuery(state.itemFragment), variables: {slotId: item.slot}}); const itemsBySlot = state.itemsBySlot.slice(); itemsBySlot[item.slot] = [{id: 0, name: "-", slot: item.slot, realSlot: -1}, ...data.getItemsBySlotId.map(result => ({...result, realSlot: result.slot, slot: item.slot}))]; dispatch({type: "ui/patch", value: {itemsBySlot}}); dispatch({type: "request/succeeded"}); }
        catch (error) { dispatch({type: "request/failed", error: error.message || "Items could not be loaded. Try again."}); }
    }
    function pickItem(item, rune) { if (rune) { const charm = state.charmSelectors.join(""); dispatch({type: "rune/update", index: state.currentItemIndex, charm, runeId: RUNE_CHARM_ID, runeStats: deriveRuneCharmStats(charm)}); } else dispatch({type: "item/select", index: state.currentItemIndex, item}); close(); }
    if (state.requestStatus === "pending" && !state.initialized) return <main className="container-fluid"><p role="status">Loading Builder…</p></main>;
    if (!selected) return null;
    return <main className="container-fluid"><div className="row"><CharacterPanel state={state} onAction={action} onDialog={openDialog} /><StatsPanel state={state} onAction={action} /></div>{state.requestError && <p role="alert" className="text-danger">{state.requestError}</p>}<EquipmentPanel state={state} totals={totals} restrictions={restrictions} statRestrictions={statRestrictions} onAction={action} onOpen={openItem} onPick={pickItem} onClose={close} />{state.currentDialog === "export" && <ImportExportDialog mode="export" value={exportValue()} onClose={close} />}{state.currentDialog === "import" && <ImportExportDialog mode="import" value={state.importModel || {input: "", lists: [], message: "", loading: false}} onChange={importChange} onClose={close} onSubmit={submitImport} />}{state.currentDialog && !["import", "export"].includes(state.currentDialog) && <BuilderListsDialog dialog={state.currentDialog} state={state} onClose={close} onSubmit={listsDialog} onColumns={short => short ? dispatch({type: "column/toggle", stat: short}) : dispatch({type: "columns/reset"})} />}</main>;
}
