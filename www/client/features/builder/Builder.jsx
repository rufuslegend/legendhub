import {useCallback, useEffect, useMemo, useReducer, useRef} from "react";
import gameStats from "../../../src/public/js/services/game-stats.js";
import ColumnsDialog from "../../components/ColumnsDialog.jsx";
import {graphqlRequest} from "../../lib/graphql-request.js";
import CharacterPanel from "./CharacterPanel.jsx";
import EquipmentPanel from "./EquipmentPanel.jsx";
import StatsPanel from "./StatsPanel.jsx";
import ImportExportDialog, {BuilderModal} from "./ImportExportDialog.jsx";
import BuilderListsDialog from "./BuilderListsDialog.jsx";
import BuilderMigrationDialog, {BuilderMigrationOffer} from "./BuilderMigrationDialog.jsx";
import {deriveItemRestrictions, deriveRuneCharmStats} from "./builder-derivations.js";
import {decodeBuilderEntries, decodeBuilderLists, encodeBuilderLists, encodeBuilderVariant} from "./builder-encoding.js";
import {buildImportRequest, classifyAnonymousData, defaultMigrationPreferencesChoice, fingerprintAnonymousData, migrationAcknowledgementKey, normalizeMigrationResult, shouldOfferMigration, writeMigrationAcknowledgement} from "./builder-migration.js";
import {applyBuilderPersistencePlan, applySelectedColumns, calculateStorageSize, createBuilderPersistencePlan, formatStorageSize, readBuilderPersistence} from "./builder-persistence.js";
import {builderReducer, createDefaultVariant, createInitialBuilderState, selectStatRestrictions, selectStatTotal} from "./builder-reducer.js";
import {RUNE_CHARM_ID} from "./item-constants.js";
import {createItemsBySlotQuery, createItemsInIdsQuery, hydrateBuilderVariant} from "./builder-api.js";
import {importAccountProfiles, loadBuilderAccountState} from "./builder-account-api.js";
import {BUILDER_ACCOUNT_LOAD_ERROR, loadBuilderSource} from "./builder-source.js";
import {validateBuilderListName} from "./builder-list-validation.js";

function cookies() { return Object.fromEntries(document.cookie.split("; ").filter(Boolean).map(value => value.split("=").map(decodeURIComponent))); }
function cookieStore() { return {get: name => cookies()[name], put(name, value, options) { document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=${options.path}; SameSite=Lax; Secure; expires=${options.expires.toUTCString()}`; }, remove(name) { document.cookie = `${encodeURIComponent(name)}=; path=/; expires=${new Date(0).toUTCString()}`; }}; }

function storageAdapter() { return {setItem: (name, value) => localStorage.setItem(name, value)}; }
async function hydrateLists(lists, fragment) {
    const ids = [...new Set(lists.flatMap(list => list.variants.flatMap(variant => variant.items.map(item => item.id).filter(id => id > 0))))];
    const data = ids.length ? await graphqlRequest({query: createItemsInIdsQuery(fragment), variables: {ids}}) : {getItemsInIds: []};
    return lists.map(list => ({...list, variants: list.variants.map(variant => hydrateBuilderVariant(variant, data.getItemsInIds))}));
}

export default function Builder({
    itemStatCategories = [],
    selectedColumns = [],
    accountContext = {
        authenticated: false,
        emailVerified: false,
        canUseAccountStorage: false,
        storageNamespace: null
    }
}) {
    const [state, dispatch] = useReducer(builderReducer, undefined, createInitialBuilderState);
    const columnsTriggerRef = useRef(null);
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
                const source = await loadBuilderSource({
                    accountContext,
                    loadAccount: () => loadBuilderAccountState(),
                    readAnonymous: () => readBuilderPersistence({cookies: cookies(), storage: localStorage}),
                    decode: decodeBuilderLists
                });
                if (cancelled) return;
                let migrationOffer = null;
                if (source.mode === "account" && accountContext.authenticated === true &&
                    accountContext.emailVerified === true && accountContext.canUseAccountStorage === true &&
                    typeof accountContext.storageNamespace === "string" && accountContext.storageNamespace) {
                    try {
                        const fingerprint = await fingerprintAnonymousData(source.anonymousSnapshot, globalThis.crypto);
                        const acknowledgedFingerprint = localStorage.getItem(
                            migrationAcknowledgementKey(accountContext.storageNamespace)
                        );
                        if (shouldOfferMigration({
                            snapshot: source.anonymousSnapshot,
                            fingerprint,
                            acknowledgedFingerprint
                        })) {
                            migrationOffer = {
                                snapshot: source.anonymousSnapshot,
                                fingerprint,
                                profiles: classifyAnonymousData(source.anonymousSnapshot).profiles.map(profile => profile.name),
                                preferencesChoice: defaultMigrationPreferencesChoice(
                                    source.preferences,
                                    source.accountState?.preferenceRevision
                                )
                            };
                        }
                    }
                    catch {
                        // Invalid or unavailable browser-local data is never uploaded.
                    }
                }
                const preferences = source.preferences || {};
                let lists = source.profiles;
                if (!lists.length) {
                    lists = [{
                        name: "Untitled",
                        variants: [createDefaultVariant("Original")],
                        ...(source.mode === "account" ? {account: {id: null, revision: 0}} : {})
                    }];
                }
                try { lists = await hydrateLists(lists, data.getItemFragment); }
                catch (error) {
                    // The encoding is still usable. Never replace it or persist an empty
                    // fallback merely because the optional item metadata request failed.
                    lists.sort((left, right) => left.name.localeCompare(right.name, undefined, {sensitivity: "accent"}));
                    const [characterName, variantName] = source.mode === "anonymous"
                        ? String(preferences.selectedList || "!").split("!")
                        : ["", ""];
                    const listIndex = Math.max(lists.findIndex(list => list.name === characterName), 0);
                    const variantIndex = Math.max(lists[listIndex].variants.findIndex(variant => variant.name === variantName), 0);
                    const columns = source.mode === "anonymous"
                        ? preferences.builderColumns?.[lists[listIndex].name] || preferences.itemColumns
                        : null;
                    dispatch({type: "source/loaded", mode: source.mode, profiles: lists, accountState: source.accountState});
                    if (migrationOffer)
                        dispatch({type: "migration/offered", ...migrationOffer});
                    dispatch({type: "ui/patch", value: {allLists: lists, selectedListIndex: listIndex, selectedListVariantIndex: variantIndex, selectedList: lists[listIndex].variants[variantIndex], statInfo: applySelectedColumns(columns, data.getItemStatInfo), defaultStatInfo: data.getItemStatInfo, itemFragment: data.getItemFragment, itemsPerPage: source.mode === "anonymous" ? preferences.itemsPerPage : state.itemsPerPage, initialized: true, requestStatus: "error", requestError: "Saved builder data could not be hydrated. Retry to restore item details."}});
                    return;
                }
                if (cancelled) return;
                lists.sort((left, right) => left.name.localeCompare(right.name, undefined, {sensitivity: "accent"}));
                const [characterName, variantName] = source.mode === "anonymous"
                    ? String(preferences.selectedList || "!").split("!")
                    : ["", ""];
                const listIndex = Math.max(lists.findIndex(list => list.name === characterName), 0);
                const variantIndex = Math.max(lists[listIndex].variants.findIndex(variant => variant.name === variantName), 0);
                const selectedCharacterName = lists[listIndex].name;
                const columns = source.mode === "anonymous"
                    ? preferences.builderColumns?.[selectedCharacterName] || preferences.itemColumns
                    : null;
                const statInfo = applySelectedColumns(columns, data.getItemStatInfo);
                dispatch({type: "source/loaded", mode: source.mode, profiles: lists, accountState: source.accountState});
                if (migrationOffer)
                    dispatch({type: "migration/offered", ...migrationOffer});
                dispatch({type: "ui/patch", value: {allLists: lists, selectedListIndex: listIndex, selectedListVariantIndex: variantIndex, selectedList: lists[listIndex].variants[variantIndex], statInfo, defaultStatInfo: data.getItemStatInfo, itemFragment: data.getItemFragment, itemsPerPage: source.mode === "anonymous" ? preferences.itemsPerPage : state.itemsPerPage, initialized: true}});
                dispatch({type: "request/succeeded"});
                hydrated.current = true;
            }
            catch (error) {
                if (cancelled) return;
                if (accountContext.canUseAccountStorage) {
                    dispatch({type: "ui/patch", value: {
                        storageMode: "account",
                        initialized: true,
                        requestStatus: "error",
                        requestError: BUILDER_ACCOUNT_LOAD_ERROR,
                        exceptionEncountered: true
                    }});
                    return;
                }
                const list = {name: "Untitled", variants: [createDefaultVariant("Original")]};
                const fallbackStatInfo = itemStatCategories.flatMap(category => category.getItemStatInfo || []).map(stat => ({...stat, showColumn: selectedColumns.includes(stat.short) || Boolean(stat.showColumnDefault)}));
                dispatch({type: "ui/patch", value: {allLists: [list], selectedListIndex: 0, selectedListVariantIndex: 0, selectedList: list.variants[0], statInfo: fallbackStatInfo, defaultStatInfo: fallbackStatInfo, initialized: true, requestStatus: "error", requestError: error.message || "Builder data could not be loaded. Try refreshing the page.", exceptionEncountered: true}});
            }
        }
        load();
        return () => { cancelled = true; };
    }, []);

    useEffect(function() {
        if (state.storageMode !== "anonymous" || !hydrated.current || !selected) return;
        const plan = createBuilderPersistencePlan({hasConsent: Boolean(cookies()["cookie-consent"]), exceptionEncountered: state.exceptionEncountered, storageMode: state.storageMode, encodedLists: encodeBuilderLists(state.allLists), selectedCharacter: state.allLists[state.selectedListIndex].name, selectedVariant: selected.name, itemsPerPage: state.itemsPerPage, selectedColumns: state.statInfo.filter(stat => stat.showColumn).map(stat => stat.short)});
        applyBuilderPersistencePlan(plan, {cookies: cookieStore(), storage: storageAdapter()});
        const size = calculateStorageSize(localStorage);
        if (size !== state.clientSideDataSize) dispatch({type: "ui/patch", value: {clientSideDataSize: formatStorageSize(size)}});
    }, [state.allLists, state.selectedListIndex, state.selectedListVariantIndex, selected, state.statInfo, state.itemsPerPage, state.exceptionEncountered, state.storageMode]);

    function action(value) {
        if (state.storageMode === "anonymous" && value.type === "variant/select" && value.listIndex !== state.selectedListIndex) {
            const characterName = state.allLists[value.listIndex].name;
            const cookieValues = cookies();
            dispatch({type: "ui/patch", value: {statInfo: applySelectedColumns(cookieValues[`sc-${characterName}`] || cookieValues.sc2, state.defaultStatInfo)}});
        }
        dispatch(value);
    }
    function acknowledgeMigration() {
        return writeMigrationAcknowledgement({
            storage: localStorage,
            storageNamespace: accountContext.storageNamespace,
            fingerprint: state.migration.fingerprint
        });
    }
    function closeMigration() {
        if (state.migration.status === "pending")
            return;
        if (state.migration.status === "succeeded") {
            dispatch({type: "migration/closed"});
            return;
        }
        acknowledgeMigration();
        dispatch({type: "migration/dismissed"});
    }
    async function copyMigration() {
        let request = state.migration.request;
        try {
            if (!request) {
                request = buildImportRequest({
                    snapshot: state.migration.snapshot,
                    preferencesChoice: state.migration.preferencesChoice,
                    storageGeneration: state.accountState.storageGeneration
                });
            }
            dispatch({type: "migration/requested", request});
            const response = await importAccountProfiles({
                ...request,
                preferences: request.preferences === null
                    ? null
                    : JSON.stringify(request.preferences)
            });
            const result = normalizeMigrationResult(response.result, request.localRejected);
            const importedSource = await loadBuilderSource({
                accountContext,
                loadAccount: async function() { return response.state; },
                readAnonymous: function() { return state.migration.snapshot; },
                decode: decodeBuilderLists
            });
            const profiles = await hydrateLists(importedSource.profiles, state.itemFragment);
            dispatch({
                type: "source/loaded",
                mode: "account",
                profiles,
                accountState: importedSource.accountState
            });
            const acknowledged = acknowledgeMigration();
            dispatch({
                type: "migration/succeeded",
                result,
                acknowledgementWarning: !acknowledged
            });
        }
        catch {
            dispatch({
                type: "migration/failed",
                error: "Local Builder data could not be copied. Try again."
            });
        }
    }
    const close = useCallback(function() { dispatch({type: "ui/patch", value: {currentDialog: null, currentItem: null, isRuneCrafting: false}}); }, []);
    const closeConfirmation = useCallback(function() { dispatch({type: "dialog/close"}); }, []);
    function requestToggleLocks() {
        const action = selected.items.every(item => item.locked) ? "unlock" : "lock";
        dispatch({type: "dialog/confirm", message: `Are you sure you want to ${action} all items?`, action: {type: "items/toggle-lock"}});
    }
    function confirmAction() {
        if (state.confirmAction)
            dispatch(state.confirmAction);
        closeConfirmation();
    }
    const resetColumns = useCallback(function() { dispatch({type: "columns/reset"}); }, []);
    const toggleColumn = useCallback(function(short) { dispatch({type: "column/toggle", stat: short}); }, []);
    const openDialog = useCallback(function(currentDialog) {
        dispatch({type: "ui/patch", value: {currentDialog, dialogError: "", importModel: currentDialog === "import" ? {input: "", lists: [], message: "", loading: false} : state.importModel, dialogName: currentDialog === "edit-character" ? state.allLists[state.selectedListIndex].name : currentDialog === "edit-variant" ? selected.name : ""}});
    }, [selected, state.allLists, state.importModel, state.selectedListIndex]);
    function listsDialog(value, typing) {
        if (typing) return dispatch({type: "ui/patch", value: {dialogName: value}});
        if (state.currentDialog === "clear") dispatch({type: "items/clear-unlocked"});
        else if (state.currentDialog === "delete-character") {
            const deletedCharacter = state.allLists[state.selectedListIndex].name;
            const remainingCharacters = state.allLists.filter((_list, index) => index !== state.selectedListIndex);
            const fallbackIndex = Math.min(state.selectedListIndex, remainingCharacters.length - 1);
            const fallbackCharacter = remainingCharacters[fallbackIndex]?.name || "Untitled";
            if (state.storageMode === "anonymous") {
                const cookieValues = cookies();
                dispatch({type: "ui/patch", value: {statInfo: applySelectedColumns(cookieValues[`sc-${fallbackCharacter}`] || cookieValues.sc2, state.defaultStatInfo)}});
                cookieStore().remove(`sc-${deletedCharacter}`);
            }
            dispatch({type: "character/delete", fallbackVariant: createDefaultVariant("Original")});
        }
        else if (state.currentDialog === "delete-variant") dispatch({type: "variant/delete", fallbackVariant: createDefaultVariant("Original")});
        else if (["add-character", "edit-character", "add-variant", "edit-variant"].includes(state.currentDialog)) {
            const validation = validateBuilderListName({name: value, mode: state.currentDialog, allLists: state.allLists, selectedListIndex: state.selectedListIndex, selectedVariantIndex: state.selectedListVariantIndex});
            const name = validation.name;
            const character = state.allLists[state.selectedListIndex];
            if (validation.error) return dispatch({type: "ui/patch", value: {dialogError: validation.error}});
            if (state.currentDialog === "add-character") dispatch({type: "character/add", name, variant: createDefaultVariant("Original")});
            if (state.currentDialog === "add-variant") dispatch({type: "variant/add", listIndex: state.selectedListIndex, variant: {...selected, name}});
            if (state.currentDialog === "edit-character") {
                const oldName = character.name;
                if (state.storageMode === "anonymous") {
                    const columns = cookies()[`sc-${oldName}`];
                    if (columns) { cookieStore().put(`sc-${name}`, columns, {path: "/", expires: new Date("2100-01-01")}); cookieStore().remove(`sc-${oldName}`); }
                }
                dispatch({type: "character/rename", name});
            }
            if (state.currentDialog === "edit-variant") dispatch({type: "variant/rename", name});
        }
        close();
    }
    function exportValue() { const character = state.allLists[state.selectedListIndex]; const exportLists = state.allLists.map(({account: _account, ...list}) => list); return {allLists: encodeBuilderLists(exportLists), curList: `6*${character.variants.map(variant => encodeBuilderVariant(character.name, variant)).join("*")}*`, curVariant: `6*${encodeBuilderVariant(character.name, selected)}*`, characterName: character.name, variantName: selected.name}; }
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
    const requestAlert = state.requestError && <p role="alert" className="text-danger">{state.requestError} <button type="button" className="btn btn-link p-0" onClick={() => window.location.reload()}>Retry</button></p>;
    if (state.requestStatus === "pending" && !state.initialized) return <main className="container-fluid"><p role="status">Loading Builder…</p></main>;
    if (!selected) return <main className="container-fluid">{requestAlert}</main>;
    return <main className="container-fluid"><div className="row"><CharacterPanel state={state} columnsOpen={state.currentDialog === "columns"} columnsTriggerRef={columnsTriggerRef} onAction={action} onDialog={openDialog} /><StatsPanel state={state} onAction={action} /></div>{requestAlert}<BuilderMigrationOffer migration={state.migration} onOpen={() => dispatch({type: "migration/opened"})} /><EquipmentPanel state={state} totals={totals} restrictions={restrictions} statRestrictions={statRestrictions} onAction={action} onToggleLocks={requestToggleLocks} onOpen={openItem} onPick={pickItem} onClose={close} />{state.currentDialog === "export" && <ImportExportDialog mode="export" value={exportValue()} onClose={close} />}{state.currentDialog === "import" && <ImportExportDialog mode="import" value={state.importModel || {input: "", lists: [], message: "", loading: false}} onChange={importChange} onClose={close} onSubmit={submitImport} />}{state.currentDialog === "columns" && <ColumnsDialog categories={itemStatCategories} open onClose={close} onReset={resetColumns} onToggle={toggleColumn} selectedColumns={state.statInfo.filter(stat => stat.showColumn).map(stat => stat.short)} triggerRef={columnsTriggerRef} />}{state.currentDialog && !["columns", "import", "export"].includes(state.currentDialog) && <BuilderListsDialog dialog={state.currentDialog} state={state} onClose={close} onSubmit={listsDialog} />}{state.confirmMessage && <BuilderModal label={`Confirm ${state.confirmMessage.includes("unlock") ? "unlock" : "lock"} all items`} onClose={closeConfirmation}><div className="modal-body"><p>{state.confirmMessage}</p><button className="btn btn-primary" type="button" onClick={confirmAction}>Yes</button></div></BuilderModal>}<BuilderMigrationDialog migration={state.migration} onClose={closeMigration} onCopy={copyMigration} onPreferenceChange={value => dispatch({type: "migration/preferences-changed", value})} /></main>;
}
