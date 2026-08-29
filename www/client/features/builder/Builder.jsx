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
import BuilderSyncStatus from "./BuilderSyncStatus.jsx";
import {
    canonicalizeAccountPreferences,
    getPageAccountPreferencesStore
} from "../../lib/account-preferences-store.js";
import {deriveItemRestrictions, deriveRuneCharmStats} from "./builder-derivations.js";
import {decodeBuilderEntries, decodeBuilderLists, encodeBuilderLists, encodeBuilderVariant} from "./builder-encoding.js";
import {buildImportRequest, classifyAnonymousData, defaultMigrationPreferencesChoice, fingerprintAnonymousData, migrationAcknowledgementKey, normalizeMigrationResult, shouldOfferMigration, writeMigrationAcknowledgement} from "./builder-migration.js";
import {accountPreferenceColumns, applyBuilderPersistencePlan, applySelectedColumns, calculateStorageSize, createBuilderAccountPreferencePatch, createBuilderPersistencePlan, formatStorageSize, readBuilderPersistence} from "./builder-persistence.js";
import {builderReducer, createDefaultVariant, createInitialBuilderState, selectStatRestrictions, selectStatTotal} from "./builder-reducer.js";
import {RUNE_CHARM_ID} from "./item-constants.js";
import {createItemsBySlotQuery, createItemsInIdsQuery, hydrateBuilderVariant} from "./builder-api.js";
import {createAccountProfile, deleteAccountProfile, importAccountProfiles, loadBuilderAccountState, updateAccountProfile} from "./builder-account-api.js";
import {BUILDER_ACCOUNT_LOAD_ERROR, loadBuilderSource} from "./builder-source.js";
import {validateBuilderListName} from "./builder-list-validation.js";
import {createBuilderSyncController} from "./builder-sync-controller.js";

const BUILDER_HYDRATION_ERROR = "Saved builder data could not be hydrated. Retry to restore item details.";

function cookies() { return Object.fromEntries(document.cookie.split("; ").filter(Boolean).map(value => value.split("=").map(decodeURIComponent))); }
function cookieStore() { return {get: name => cookies()[name], put(name, value, options) { document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=${options.path}; SameSite=Lax; Secure; expires=${options.expires.toUTCString()}`; }, remove(name) { document.cookie = `${encodeURIComponent(name)}=; path=/; expires=${new Date(0).toUTCString()}`; }}; }

function storageAdapter() { return {setItem: (name, value) => localStorage.setItem(name, value)}; }
async function hydrateLists(lists, fragment) {
    const ids = [...new Set(lists.flatMap(list => list.variants.flatMap(variant => variant.items.map(item => item.id).filter(id => id > 0))))];
    const data = ids.length ? await graphqlRequest({query: createItemsInIdsQuery(fragment), variables: {ids}}) : {getItemsInIds: []};
    return lists.map(list => ({...list, variants: list.variants.map(variant => hydrateBuilderVariant(variant, data.getItemsInIds))}));
}

function builderPreferencePresentation(mode, preferences, lists, defaultStatInfo) {
    let listIndex = 0;
    let variantIndex = 0;
    let columns = null;
    if (mode === "anonymous") {
        const [characterName, variantName] = String(preferences.selectedList || "!").split("!");
        listIndex = Math.max(lists.findIndex(list => list.name === characterName), 0);
        variantIndex = Math.max(lists[listIndex].variants.findIndex(variant => variant.name === variantName), 0);
        columns = preferences.builderColumns?.[lists[listIndex].name] || preferences.itemColumns;
    }
    else {
        listIndex = Math.max(lists.findIndex(list =>
            list.account?.id && list.account.id === preferences.selectedProfileId), 0);
        variantIndex = Math.max(lists[listIndex].variants.findIndex(variant =>
            variant.name === preferences.selectedVariant), 0);
        columns = preferences.builderColumns?.[lists[listIndex].account?.id] || preferences.itemColumns;
    }
    return {
        listIndex,
        variantIndex,
        statInfo: applySelectedColumns(columns, defaultStatInfo),
        itemsPerPage: preferences.itemsPerPage
    };
}

function decodeAccountProfile(profile) {
    if (!profile || typeof profile !== "object" || Array.isArray(profile) ||
        typeof profile.id !== "string" || !profile.id ||
        typeof profile.name !== "string" || !profile.name ||
        typeof profile.payload !== "string" || !profile.payload ||
        !Number.isInteger(profile.payloadVersion) || profile.payloadVersion < 1 || profile.payloadVersion > 6 ||
        !Number.isInteger(profile.revision) || profile.revision < 1 ||
        typeof profile.updatedOn !== "string" || !profile.updatedOn || Number.isNaN(Date.parse(profile.updatedOn)))
        throw new Error("Builder account data could not be loaded.");
    const decoded = decodeBuilderLists(profile.payload);
    if (decoded.length !== 1 || decoded[0].name !== profile.name)
        throw new Error("Builder account data could not be loaded.");
    return {
        ...decoded[0],
        account: {
            id: profile.id,
            revision: profile.revision,
            updatedOn: profile.updatedOn
        }
    };
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
    const syncControllerRef = useRef(null);
    const preferenceStoreRef = useRef(getPageAccountPreferencesStore());
    const selectedAccountPreferenceIdentityRef = useRef(undefined);
    const syncBaselinesRef = useRef(new Map());
    const syncLocalKeysRef = useRef(new WeakMap());
    const nextSyncLocalKeyRef = useRef(1);
    const latestStateRef = useRef(state);
    latestStateRef.current = state;
    const selected = state.selectedList;
    const selectedCharacter = state.allLists[state.selectedListIndex] || null;
    const selectedAccountPreferenceIdentity = state.storageMode === "account" && selectedCharacter?.account
        ? (selectedCharacter.account.id || selectedCharacter.account)
        : null;
    const selectedAccountPreferenceIdentityChanged = state.storageMode === "account" &&
        state.initialized && selectedAccountPreferenceIdentity !== null &&
        selectedAccountPreferenceIdentityRef.current !== selectedAccountPreferenceIdentity;
    const selectedAccountPreferenceStatInfo = selectedAccountPreferenceIdentityChanged
        ? accountPreferenceColumns(
            preferenceStoreRef.current?.get?.().document,
            selectedCharacter,
            state.defaultStatInfo
        )
        : null;
    const selectedAccountPreferenceColumnsChanged = selectedAccountPreferenceStatInfo !== null &&
        selectedAccountPreferenceStatInfo.some((stat, index) =>
            Boolean(stat.showColumn) !== Boolean(state.statInfo[index]?.showColumn));
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
                const preferences = source.mode === "account"
                    ? canonicalizeAccountPreferences(source.preferences)
                    : source.preferences || {};
                if (source.mode === "account") {
                    preferenceStoreRef.current?.replace?.({
                        enabled: true,
                        payload: preferences,
                        revision: source.accountState.preferenceRevision,
                        storageGeneration: source.accountState.storageGeneration
                    });
                }
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
                                    preferences,
                                    source.accountState?.preferenceRevision
                                )
                            };
                        }
                    }
                    catch {
                        // Invalid or unavailable browser-local data is never uploaded.
                    }
                }
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
                    const presentation = builderPreferencePresentation(
                        source.mode, preferences, lists, data.getItemStatInfo
                    );
                    dispatch({type: "source/loaded", mode: source.mode, profiles: lists, accountState: source.accountState});
                    if (migrationOffer)
                        dispatch({type: "migration/offered", ...migrationOffer});
                    dispatch({type: "ui/patch", value: {allLists: lists, selectedListIndex: presentation.listIndex, selectedListVariantIndex: presentation.variantIndex, selectedList: lists[presentation.listIndex].variants[presentation.variantIndex], statInfo: presentation.statInfo, defaultStatInfo: data.getItemStatInfo, itemFragment: data.getItemFragment, itemsPerPage: presentation.itemsPerPage, initialized: true, requestStatus: "error", requestError: BUILDER_HYDRATION_ERROR}});
                    return;
                }
                if (cancelled) return;
                lists.sort((left, right) => left.name.localeCompare(right.name, undefined, {sensitivity: "accent"}));
                const presentation = builderPreferencePresentation(
                    source.mode, preferences, lists, data.getItemStatInfo
                );
                dispatch({type: "source/loaded", mode: source.mode, profiles: lists, accountState: source.accountState});
                if (migrationOffer)
                    dispatch({type: "migration/offered", ...migrationOffer});
                dispatch({type: "ui/patch", value: {allLists: lists, selectedListIndex: presentation.listIndex, selectedListVariantIndex: presentation.variantIndex, selectedList: lists[presentation.listIndex].variants[presentation.variantIndex], statInfo: presentation.statInfo, defaultStatInfo: data.getItemStatInfo, itemFragment: data.getItemFragment, itemsPerPage: presentation.itemsPerPage, initialized: true}});
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

    useEffect(function() {
        if (state.storageMode !== "account" || !state.initialized ||
            selectedAccountPreferenceIdentity === null) {
            selectedAccountPreferenceIdentityRef.current = undefined;
            return;
        }
        if (!selectedAccountPreferenceIdentityChanged)
            return;
        selectedAccountPreferenceIdentityRef.current = selectedAccountPreferenceIdentity;
        if (selectedAccountPreferenceColumnsChanged)
            dispatch({type: "ui/patch", value: {statInfo: selectedAccountPreferenceStatInfo}});
    }, [state.storageMode, state.initialized, selectedAccountPreferenceIdentity,
        selectedAccountPreferenceIdentityChanged, selectedAccountPreferenceColumnsChanged,
        selectedAccountPreferenceStatInfo]);

    useEffect(function() {
        const store = preferenceStoreRef.current;
        if (state.storageMode !== "account" || !state.initialized || !selected ||
            !state.accountState || !store?.get?.().enabled ||
            (selectedAccountPreferenceIdentityChanged && selectedAccountPreferenceColumnsChanged))
            return;
        const character = state.allLists[state.selectedListIndex];
        store.patch(createBuilderAccountPreferencePatch({
            document: store.get().document,
            character,
            variant: selected,
            itemsPerPage: state.itemsPerPage,
            selectedColumns: state.statInfo.filter(stat => stat.showColumn).map(stat => stat.short)
        }));
    }, [state.allLists, state.selectedListIndex, state.selectedListVariantIndex, selected, state.statInfo, state.itemsPerPage, state.storageMode, state.initialized, state.accountState, selectedAccountPreferenceIdentityChanged, selectedAccountPreferenceColumnsChanged]);

    function accountSnapshot(character, storageGeneration) {
        const {account, ...profile} = character;
        let queueKey = null;
        if (!account?.id) {
            queueKey = syncLocalKeysRef.current.get(account);
            if (!queueKey) {
                queueKey = `profile-${nextSyncLocalKeyRef.current++}`;
                syncLocalKeysRef.current.set(account, queueKey);
            }
        }
        const payload = encodeBuilderLists([profile]);
        return {
            id: account?.id || null,
            name: character.name,
            payload,
            revision: account?.revision || 0,
            storageGeneration,
            fingerprint: payload,
            ...(!account?.id ? {localIdentity: account} : {}),
            ...(queueKey ? {queueKey} : {})
        };
    }

    function snapshotKey(snapshot) {
        if (snapshot.queueKey)
            return `local:${snapshot.queueKey}`;
        return `id:${snapshot.id}`;
    }

    useEffect(function() {
        syncControllerRef.current?.dispose();
        syncControllerRef.current = null;
        syncBaselinesRef.current = new Map();
        if (state.storageMode !== "account" || !state.initialized || !state.accountState)
            return;

        let active = true;
        for (const character of state.allLists) {
            const snapshot = accountSnapshot(character, state.accountState.storageGeneration);
            syncBaselinesRef.current.set(snapshotKey(snapshot), snapshot.fingerprint);
        }

        const controller = createBuilderSyncController({
            saveProfile: async function(snapshot) {
                const request = {
                    id: snapshot.id,
                    name: snapshot.name,
                    payload: snapshot.payload,
                    revision: snapshot.revision,
                    storageGeneration: snapshot.storageGeneration
                };
                return snapshot.id
                    ? updateAccountProfile(request)
                    : createAccountProfile(request);
            },
            deleteProfile: async function(snapshot) {
                return deleteAccountProfile({
                    id: snapshot.id,
                    revision: snapshot.revision,
                    storageGeneration: snapshot.storageGeneration
                });
            },
            onStatus: function(value) {
                if (active)
                    dispatch({type: "sync/status", ...value});
            },
            onResult: async function(event) {
                if (!active)
                    return;
                if (event.type === "generation-changed") {
                    dispatch({
                        type: "account/generation-changed",
                        message: "Synced Builder data changed in another session. Export your unsaved data before reloading."
                    });
                    return;
                }
                if (event.type === "deleted") {
                    dispatch({
                        type: "account/profile-deleted",
                        id: event.snapshot.id,
                        storageGeneration: event.result.storageGeneration,
                        usedBytes: event.result.usedBytes,
                        quotaBytes: event.result.quotaBytes
                    });
                    return;
                }
                if (event.type === "saved") {
                    const profile = decodeAccountProfile(event.result.profile);
                    const previousKey = snapshotKey(event.previous);
                    const currentKey = `id:${profile.account.id}`;
                    syncBaselinesRef.current.delete(previousKey);
                    syncBaselinesRef.current.set(currentKey, event.current.fingerprint);
                    const currentState = latestStateRef.current;
                    const currentCharacter = currentState.allLists[currentState.selectedListIndex];
                    if (!event.previous.id && event.previous.localIdentity &&
                        currentCharacter?.account === event.previous.localIdentity) {
                        const store = preferenceStoreRef.current;
                        store?.patch?.(createBuilderAccountPreferencePatch({
                            document: store.get().document,
                            character: {...currentCharacter, account: profile.account},
                            variant: currentState.selectedList,
                            itemsPerPage: currentState.itemsPerPage,
                            selectedColumns: currentState.statInfo
                                .filter(stat => stat.showColumn)
                                .map(stat => stat.short)
                        }));
                    }
                    dispatch({
                        type: "account/profile-saved",
                        previous: {
                            id: event.previous.id,
                            name: event.previous.name,
                            localIdentity: event.previous.localIdentity
                        },
                        current: {id: event.current.id, name: event.current.name},
                        profile,
                        storageGeneration: event.result.storageGeneration,
                        usedBytes: event.result.usedBytes,
                        quotaBytes: event.result.quotaBytes
                    });
                    return;
                }
                if (event.type === "conflict") {
                    const serverDeleted = event.result.profile?.payload === null;
                    if (serverDeleted &&
                        (typeof event.result.profile?.id !== "string" ||
                        event.result.profile.id !== event.previous.id ||
                        !Number.isInteger(event.result.profile.revision) ||
                        event.result.profile.revision < 1))
                        throw new Error("Builder account data could not be loaded.");
                    let profiles = [
                        ...(!serverDeleted ? [decodeAccountProfile(event.result.profile)] : []),
                        decodeAccountProfile(event.result.conflictProfile)
                    ];
                    try {
                        profiles = await hydrateLists(profiles, latestStateRef.current.itemFragment);
                    }
                    catch {
                        dispatch({
                            type: "ui/patch",
                            value: {requestStatus: "error", requestError: BUILDER_HYDRATION_ERROR}
                        });
                    }
                    if (!active)
                        return;
                    syncBaselinesRef.current.delete(`id:${event.previous.id}`);
                    for (const profile of profiles) {
                        syncBaselinesRef.current.set(`id:${profile.account.id}`, encodeBuilderLists([
                            {name: profile.name, variants: profile.variants}
                        ]));
                    }
                    const serverProfile = serverDeleted ? null : profiles[0];
                    const conflictProfile = serverDeleted ? profiles[0] : profiles[1];
                    dispatch({
                        type: "account/profile-conflicted",
                        id: event.previous.id,
                        profile: serverProfile,
                        conflictProfile,
                        preserveNewerEdits: event.current.fingerprint !== event.previous.fingerprint,
                        storageGeneration: event.result.storageGeneration,
                        usedBytes: event.result.usedBytes,
                        quotaBytes: event.result.quotaBytes,
                        message: "A newer account copy was kept and your edits were saved as a conflict copy."
                    });
                }
            }
        });
        syncControllerRef.current = controller;
        return function() {
            active = false;
            controller.dispose();
            if (syncControllerRef.current === controller)
                syncControllerRef.current = null;
        };
    }, [state.storageMode, state.syncSourceVersion, state.initialized]);

    useEffect(function() {
        const controller = syncControllerRef.current;
        if (!controller || state.storageMode !== "account" || !state.accountState)
            return;
        const currentKeys = new Set();
        for (const character of state.allLists) {
            const snapshot = accountSnapshot(character, state.accountState.storageGeneration);
            const key = snapshotKey(snapshot);
            currentKeys.add(key);
            const priorFingerprint = syncBaselinesRef.current.get(key);
            if (priorFingerprint === undefined && character.account?.placeholder === true) {
                syncBaselinesRef.current.set(key, snapshot.fingerprint);
                continue;
            }
            if (priorFingerprint === undefined || priorFingerprint !== snapshot.fingerprint)
                controller.queue(snapshot);
            syncBaselinesRef.current.set(key, snapshot.fingerprint);
        }
        for (const key of syncBaselinesRef.current.keys()) {
            if (!currentKeys.has(key))
                syncBaselinesRef.current.delete(key);
        }
    }, [state.allLists, state.accountState?.storageGeneration, state.storageMode, state.syncSourceVersion, state.initialized]);

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
            let profiles = importedSource.profiles;
            if (!profiles.length) {
                profiles = [{
                    name: "Untitled",
                    variants: [createDefaultVariant("Original")],
                    account: {id: null, revision: 0}
                }];
            }
            let hydrationFailed = false;
            try {
                profiles = await hydrateLists(profiles, state.itemFragment);
            }
            catch {
                hydrationFailed = true;
            }
            const preferences = canonicalizeAccountPreferences(importedSource.preferences);
            preferenceStoreRef.current?.replace?.({
                enabled: true,
                payload: preferences,
                revision: importedSource.accountState.preferenceRevision,
                storageGeneration: importedSource.accountState.storageGeneration
            });
            profiles.sort((left, right) => left.name.localeCompare(right.name, undefined, {sensitivity: "accent"}));
            const presentation = builderPreferencePresentation(
                "account", preferences, profiles, state.defaultStatInfo
            );
            dispatch({
                type: "source/loaded",
                mode: "account",
                profiles,
                accountState: importedSource.accountState
            });
            dispatch({type: "ui/patch", value: {
                allLists: profiles,
                selectedListIndex: presentation.listIndex,
                selectedListVariantIndex: presentation.variantIndex,
                selectedList: profiles[presentation.listIndex]?.variants[presentation.variantIndex] || null,
                statInfo: presentation.statInfo,
                itemsPerPage: presentation.itemsPerPage,
                initialized: true
            }});
            if (hydrationFailed) {
                dispatch({
                    type: "ui/patch",
                    value: {
                        requestStatus: "error",
                        requestError: BUILDER_HYDRATION_ERROR
                    }
                });
            }
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
            const deletedProfile = state.allLists[state.selectedListIndex];
            const deletedCharacter = deletedProfile.name;
            const remainingCharacters = state.allLists.filter((_list, index) => index !== state.selectedListIndex);
            const fallbackIndex = Math.min(state.selectedListIndex, remainingCharacters.length - 1);
            const fallbackCharacter = remainingCharacters[fallbackIndex]?.name || "Untitled";
            if (state.storageMode === "anonymous") {
                const cookieValues = cookies();
                dispatch({type: "ui/patch", value: {statInfo: applySelectedColumns(cookieValues[`sc-${fallbackCharacter}`] || cookieValues.sc2, state.defaultStatInfo)}});
                cookieStore().remove(`sc-${deletedCharacter}`);
            }
            if (state.storageMode === "account" && state.accountState) {
                const snapshot = accountSnapshot(deletedProfile, state.accountState.storageGeneration);
                syncBaselinesRef.current.delete(snapshotKey(snapshot));
                syncControllerRef.current?.remove(snapshot);
                if (snapshot.id) {
                    close();
                    return;
                }
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
    const storageStatus = <BuilderSyncStatus mode={state.storageMode} status={state.syncStatus} message={state.syncMessage} onExport={() => openDialog("export")} onReload={() => window.location.reload()} />;
    return <main className="container-fluid"><div className="row"><CharacterPanel state={state} columnsOpen={state.currentDialog === "columns"} columnsTriggerRef={columnsTriggerRef} storageStatus={storageStatus} onAction={action} onDialog={openDialog} /><StatsPanel state={state} onAction={action} /></div>{requestAlert}<BuilderMigrationOffer migration={state.migration} onOpen={() => dispatch({type: "migration/opened"})} /><EquipmentPanel state={state} totals={totals} restrictions={restrictions} statRestrictions={statRestrictions} onAction={action} onToggleLocks={requestToggleLocks} onOpen={openItem} onPick={pickItem} onClose={close} />{state.currentDialog === "export" && <ImportExportDialog mode="export" value={exportValue()} onClose={close} />}{state.currentDialog === "import" && <ImportExportDialog mode="import" value={state.importModel || {input: "", lists: [], message: "", loading: false}} onChange={importChange} onClose={close} onSubmit={submitImport} />}{state.currentDialog === "columns" && <ColumnsDialog categories={itemStatCategories} open onClose={close} onReset={resetColumns} onToggle={toggleColumn} selectedColumns={state.statInfo.filter(stat => stat.showColumn).map(stat => stat.short)} triggerRef={columnsTriggerRef} />}{state.currentDialog && !["columns", "import", "export"].includes(state.currentDialog) && <BuilderListsDialog dialog={state.currentDialog} state={state} onClose={close} onSubmit={listsDialog} />}{state.confirmMessage && <BuilderModal label={`Confirm ${state.confirmMessage.includes("unlock") ? "unlock" : "lock"} all items`} onClose={closeConfirmation}><div className="modal-body"><p>{state.confirmMessage}</p><button className="btn btn-primary" type="button" onClick={confirmAction}>Yes</button></div></BuilderModal>}<BuilderMigrationDialog migration={state.migration} onClose={closeMigration} onCopy={copyMigration} onPreferenceChange={value => dispatch({type: "migration/preferences-changed", value})} /></main>;
}
