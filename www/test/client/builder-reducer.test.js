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

    assert.equal(first.items.length, 37);
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
    });
});

// Catches ordinary queued/saved updates clearing a recovery notice before the
// player has exported or reloaded, or source replacement retaining a stale one.
test("sync recovery statuses persist until a fresh source is loaded", async function() {
    const {builderReducer, createDefaultVariant, createInitialBuilderState} = await loadReducer();
    const profile = {
        name: "Hero",
        variants: [createDefaultVariant("Original")],
        account: {id: "profile-id", revision: 4}
    };
    let state = builderReducer(createInitialBuilderState(), {
        type: "source/loaded", mode: "account", profiles: [profile],
        accountState: {storageGeneration: 2}
    });
    assert.equal(state.syncSourceVersion, 1);

    state = builderReducer(state, {
        type: "sync/status", status: "conflict",
        message: "Your edits were saved as a conflict copy."
    });
    state = builderReducer(state, {type: "sync/status", status: "saving", message: "Saving…"});
    assert.deepEqual([state.syncStatus, state.syncMessage], [
        "conflict", "Your edits were saved as a conflict copy."
    ]);

    state = builderReducer(state, {
        type: "sync/status", status: "generation-changed",
        message: "Export your unsaved data before reloading."
    });
    state = builderReducer(state, {type: "sync/status", status: "saved"});
    assert.deepEqual([state.syncStatus, state.syncMessage], [
        "generation-changed", "Export your unsaved data before reloading."
    ]);

    state = builderReducer(state, {
        type: "source/loaded", mode: "account", profiles: [profile],
        accountState: {storageGeneration: 3}
    });
    assert.equal(state.syncSourceVersion, 2);
    assert.deepEqual([state.syncStatus, state.syncMessage], ["saved", ""]);
});

// Catches migration retries minting a second batch key, failures acknowledging
// data, or result actions losing the dialog's accessible state.
test("migration reducer reuses one atomic request through failure and retry", async function() {
    const {builderReducer, createInitialBuilderState} = await loadReducer();
    const snapshot = {encodedLists: "7*local*"};
    const request = {idempotencyKey: "one-batch-key", profiles: [{name: "Hero"}]};
    let state = builderReducer(createInitialBuilderState(), {
        type: "migration/offered",
        snapshot,
        fingerprint: "abc123",
        profiles: ["Hero"],
        preferencesChoice: "browser"
    });
    assert.deepEqual(state.migration, {
        status: "offered", open: false, snapshot, fingerprint: "abc123",
        profiles: ["Hero"], preferencesChoice: "browser", request: null,
        result: null, error: "", acknowledgementWarning: false
    });

    state = builderReducer(state, {type: "migration/opened"});
    state = builderReducer(state, {type: "migration/requested", request});
    assert.equal(state.migration.status, "pending");
    assert.equal(state.migration.open, true);
    assert.equal(state.migration.request, request);

    state = builderReducer(state, {
        type: "migration/failed",
        error: "Local Builder data could not be copied. Try again."
    });
    assert.equal(state.migration.status, "error");
    assert.equal(state.migration.request, request);
    assert.equal(state.migration.fingerprint, "abc123");

    state = builderReducer(state, {type: "migration/requested"});
    assert.equal(state.migration.request, request);
    state = builderReducer(state, {
        type: "migration/succeeded",
        result: {copied: ["Hero"]},
        acknowledgementWarning: true
    });
    assert.equal(state.migration.status, "succeeded");
    assert.deepEqual(state.migration.result, {copied: ["Hero"]});
    assert.equal(state.migration.acknowledgementWarning, true);
    assert.equal(state.migration.request, null);
});

// Catches dismissal mutating the retained anonymous snapshot or active
// account profiles.
test("migration dismissal preserves both profile sources", async function() {
    const {builderReducer, createDefaultVariant, createInitialBuilderState} = await loadReducer();
    const accountProfile = {
        name: "Account Hero", variants: [createDefaultVariant("Original")],
        account: {id: "account-id", revision: 1}
    };
    const snapshot = {encodedLists: "7*local*"};
    let state = builderReducer(createInitialBuilderState(), {
        type: "source/loaded", mode: "account", profiles: [accountProfile],
        accountState: {storageGeneration: 1}, anonymousSnapshot: snapshot
    });
    state = builderReducer(state, {
        type: "migration/offered", snapshot, fingerprint: "abc123",
        profiles: ["Local Hero"], preferencesChoice: "account"
    });
    const activeProfiles = state.allLists;
    state = builderReducer(state, {type: "migration/dismissed"});
    assert.equal(state.migration.status, "dismissed");
    assert.equal(state.migration.open, false);
    assert.equal(state.migration.fingerprint, "abc123");
    assert.equal(state.migration.snapshot, snapshot);
    assert.equal(state.allLists, activeProfiles);
});

// Catches source activation dropping the stable server identity that later
// edits must use for optimistic account updates.
test("account source keeps stable profile metadata through character rename", async function() {
    const {builderReducer, createDefaultVariant, createInitialBuilderState} = await loadReducer();
    const accountState = {
        storageGeneration: 2, usedBytes: 32, quotaBytes: 10485760
    };
    const accountProfiles = [{
        name: "Account Hero",
        variants: [createDefaultVariant("Original")],
        account: {
            id: "profile-id", revision: 4,
            updatedOn: "2026-08-26T12:00:00.000Z"
        }
    }];

    let state = createInitialBuilderState();
    state = builderReducer(state, {
        type: "source/loaded", mode: "account", profiles: accountProfiles, accountState
    });
    state = builderReducer(state, {type: "character/rename", name: "Renamed"});

    assert.equal(state.storageMode, "account");
    assert.equal(state.accountState, accountState);
    assert.equal(state.allLists[0].account.id, "profile-id");
    assert.equal(state.allLists[0].account.revision, 4);
});

// Catches account-only characters entering reducer memory without the explicit
// unsaved identity required for first-edit creation, or stable identity being
// dropped by variant and import mutations.
test("account character lifecycle retains saved identity and marks new profiles unsaved", async function() {
    const {builderReducer, createDefaultVariant, createInitialBuilderState} = await loadReducer();
    const saved = {
        name: "Hero", variants: [createDefaultVariant("Original")],
        account: {id: "profile-id", revision: 4, updatedOn: "2026-08-26T12:00:00.000Z"}
    };
    let state = builderReducer(createInitialBuilderState(), {
        type: "source/loaded", mode: "account", profiles: [saved],
        accountState: {storageGeneration: 2, usedBytes: 32, quotaBytes: 10485760}
    });

    state = builderReducer(state, {
        type: "variant/add", listIndex: 0, variant: createDefaultVariant("Caster")
    });
    state = builderReducer(state, {type: "variant/rename", name: "Mage"});
    state = builderReducer(state, {type: "variant/make-primary"});
    state = builderReducer(state, {type: "stat/change", section: "baseStats", stat: "strength", value: 44});
    state = builderReducer(state, {type: "lists/import", lists: [{
        name: "Hero", exists: true, overwrite: true,
        variants: [createDefaultVariant("Mage")]
    }]});
    assert.deepEqual(state.allLists[0].account, saved.account);

    state = builderReducer(state, {
        type: "character/add", name: "New Hero", variant: createDefaultVariant("Original")
    });
    assert.deepEqual(state.allLists.find(list => list.name === "New Hero").account, {
        id: null, revision: 0
    });

    state = builderReducer(state, {type: "lists/import", lists: [{
        name: "Imported", exists: false, variants: [createDefaultVariant("Original")]
    }]});
    assert.deepEqual(state.allLists.find(list => list.name === "Imported").account, {
        id: null, revision: 0
    });
});

// Catches an empty verified account activating an anonymous profile or leaving
// no editable in-memory profile for first-edit creation.
test("empty account source creates only an in-memory unsaved Untitled profile", async function() {
    const {builderReducer, createInitialBuilderState} = await loadReducer();
    let state = builderReducer(createInitialBuilderState(), {
        type: "source/loaded", mode: "account", profiles: [],
        accountState: {storageGeneration: 1, usedBytes: 0, quotaBytes: 10485760}
    });

    assert.equal(state.allLists.length, 1);
    assert.equal(state.allLists[0].name, "Untitled");
    assert.equal(state.allLists[0].variants[0].name, "Original");
    assert.deepEqual(state.allLists[0].account, {id: null, revision: 0});
    assert.equal(state.selectedList, state.allLists[0].variants[0]);
    assert.equal(state.syncStatus, "saved");

    state = builderReducer(state, {
        type: "character/delete",
        fallbackVariant: state.allLists[0].variants[0]
    });
    assert.equal(state.allLists[0].account.placeholder, true);
});

// Catches sync-result actions updating detached copies, losing usage/generation
// state, selecting a conflict copy, or leaving stale status text behind.
test("account result and status actions update canonical profile state", async function() {
    const {builderReducer, createDefaultVariant, createInitialBuilderState} = await loadReducer();
    const local = {
        name: "Hero", variants: [createDefaultVariant("Original")],
        account: {id: "profile-id", revision: 4, updatedOn: "2026-08-26T12:00:00.000Z"}
    };
    let state = builderReducer(createInitialBuilderState(), {
        type: "source/loaded", mode: "account", profiles: [local],
        accountState: {storageGeneration: 2, usedBytes: 32, quotaBytes: 1000}
    });
    state = builderReducer(state, {type: "sync/status", status: "saving", message: "Saving…"});
    assert.deepEqual([state.syncStatus, state.syncMessage], ["saving", "Saving…"]);
    state = builderReducer(state, {type: "character/rename", name: "Renamed"});

    state = builderReducer(state, {
        type: "account/profile-saved", previousId: "profile-id",
        profile: {
            name: "Renamed", variants: [createDefaultVariant("Original")],
            account: {id: "profile-id", revision: 5, updatedOn: "2026-08-26T12:01:00.000Z"}
        },
        storageGeneration: 2, usedBytes: 36, quotaBytes: 1000
    });
    assert.equal(state.allLists[0].name, "Renamed");
    assert.equal(state.allLists[0].account.revision, 5);
    assert.equal(state.selectedList, state.allLists[0].variants[0]);
    assert.deepEqual([state.accountState.storageGeneration, state.accountState.usedBytes], [2, 36]);
    assert.deepEqual([state.syncStatus, state.syncMessage], ["saved", ""]);

    const server = {
        name: "Renamed", variants: [createDefaultVariant("Server")],
        account: {id: "profile-id", revision: 6, updatedOn: "2026-08-26T12:02:00.000Z"}
    };
    const conflict = {
        name: "Renamed Conflict", variants: [createDefaultVariant("Local")],
        account: {id: "conflict-id", revision: 1, updatedOn: "2026-08-26T12:02:00.000Z"}
    };
    state = builderReducer(state, {
        type: "account/profile-conflicted", profile: server, conflictProfile: conflict,
        storageGeneration: 2, usedBytes: 70, quotaBytes: 1000,
        message: "A conflict copy was saved."
    });
    assert.deepEqual(state.allLists.map(list => list.name), ["Renamed", "Renamed Conflict"]);
    assert.equal(state.selectedList.name, "Server");
    assert.deepEqual([state.syncStatus, state.syncMessage], ["conflict", "A conflict copy was saved."]);

    state = builderReducer(state, {
        type: "account/profile-deleted", id: "conflict-id",
        storageGeneration: 2, usedBytes: 36, quotaBytes: 1000
    });
    assert.deepEqual(state.allLists.map(list => list.name), ["Renamed"]);

    state = builderReducer(state, {
        type: "account/generation-changed", storageGeneration: 3,
        usedBytes: 0, quotaBytes: 1000,
        message: "Account storage changed. Export before reloading."
    });
    assert.equal(state.accountState.storageGeneration, 3);
    assert.deepEqual([state.syncStatus, state.syncMessage], [
        "generation-changed", "Account storage changed. Export before reloading."
    ]);
});

// Catches a stale edit of a profile deleted in another browser discarding the
// server-created conflict copy or selecting that copy over an existing profile.
test("deleted-server conflicts remove the tombstone and preserve the conflict copy", async function() {
    const {builderReducer, createDefaultVariant, createInitialBuilderState} = await loadReducer();
    const hero = {
        name: "Hero", variants: [createDefaultVariant("Original")],
        account: {id: "hero-id", revision: 4}
    };
    const scout = {
        name: "Scout", variants: [createDefaultVariant("Original")],
        account: {id: "scout-id", revision: 2}
    };
    const conflict = {
        name: "Hero Conflict", variants: [createDefaultVariant("Local")],
        account: {id: "conflict-id", revision: 1}
    };
    let state = builderReducer(createInitialBuilderState(), {
        type: "source/loaded", mode: "account", profiles: [hero, scout],
        accountState: {storageGeneration: 2}
    });
    state = builderReducer(state, {
        type: "account/profile-conflicted",
        id: "hero-id",
        profile: null,
        conflictProfile: conflict,
        message: "A conflict copy was saved."
    });

    assert.deepEqual(state.allLists.map(profile => profile.name), ["Hero Conflict", "Scout"]);
    assert.equal(state.selectedList, state.allLists[1].variants[0]);
    assert.equal(state.selectedList.name, "Original");
    assert.equal(state.syncStatus, "conflict");
});

// Catches a conflict completion replacing edits made after that request began.
// The returned conflict identity owns the newest in-memory work for a follow-up save.
test("account conflict response preserves edits made while the request was in flight", async function() {
    const {builderReducer, createDefaultVariant, createInitialBuilderState} = await loadReducer();
    let state = builderReducer(createInitialBuilderState(), {
        type: "source/loaded",
        mode: "account",
        profiles: [{
            name: "Hero",
            variants: [createDefaultVariant("Original")],
            account: {id: "hero-id", revision: 4}
        }],
        accountState: {storageGeneration: 2}
    });
    state = builderReducer(state, {
        type: "stat/change", section: "baseStats", stat: "strength", value: 77
    });

    const server = {
        name: "Hero", variants: [createDefaultVariant("Server")],
        account: {id: "hero-id", revision: 5}
    };
    const olderConflict = {
        name: "Hero Conflict", variants: [createDefaultVariant("Earlier edit")],
        account: {id: "conflict-id", revision: 1}
    };
    state = builderReducer(state, {
        type: "account/profile-conflicted",
        id: "hero-id",
        profile: server,
        conflictProfile: olderConflict,
        preserveNewerEdits: true,
        message: "A conflict copy was saved."
    });

    const conflict = state.allLists.find(profile => profile.account.id === "conflict-id");
    assert.equal(conflict.name, "Hero Conflict");
    assert.equal(conflict.variants[0].name, "Original");
    assert.equal(conflict.variants[0].baseStats.strength, 77);
    assert.equal(state.allLists.find(profile => profile.account.id === "hero-id").variants[0].name, "Server");
});

// Catches an older completed update replacing edits made after that request
// began. A successful save owns only account metadata, never character content.
test("account save response merges metadata without reverting newer local edits", async function() {
    const {builderReducer, createDefaultVariant, createInitialBuilderState} = await loadReducer();
    const original = createDefaultVariant("Original");
    let state = builderReducer(createInitialBuilderState(), {
        type: "source/loaded",
        mode: "account",
        profiles: [{
            name: "Hero",
            variants: [original],
            account: {id: "profile-id", revision: 4, updatedOn: "2026-08-26T12:00:00.000Z"}
        }],
        accountState: {storageGeneration: 2, usedBytes: 32, quotaBytes: 1000}
    });

    state = builderReducer(state, {type: "character/rename", name: "Newest Name"});
    state = builderReducer(state, {
        type: "variant/add", listIndex: 0, variant: createDefaultVariant("Newest Variant")
    });
    state = builderReducer(state, {
        type: "stat/change", section: "baseStats", stat: "strength", value: 44
    });
    const selectedBeforeSave = state.selectedList;
    const staleVariant = createDefaultVariant("Original");
    staleVariant.baseStats.strength = 1;

    state = builderReducer(state, {
        type: "account/profile-saved",
        previous: {id: "profile-id", name: "Hero"},
        current: {id: "profile-id", name: "Newest Name"},
        profile: {
            name: "Older Name",
            variants: [staleVariant],
            account: {id: "profile-id", revision: 5, updatedOn: "2026-08-26T12:01:00.000Z"}
        },
        storageGeneration: 2,
        usedBytes: 36,
        quotaBytes: 1000
    });

    assert.equal(state.allLists[0].name, "Newest Name");
    assert.deepEqual(state.allLists[0].variants.map(variant => variant.name), [
        "Original", "Newest Variant"
    ]);
    assert.equal(state.allLists[0].variants[1].baseStats.strength, 44);
    assert.equal(state.allLists[0].account.revision, 5);
    assert.equal(state.selectedList, selectedBeforeSave);
    assert.equal(state.selectedListVariantIndex, 1);
});

// Catches a first create response missing the unsaved row after another rename,
// or attaching the new server ID to a different unsaved character.
test("account create response attaches metadata to the current renamed unsaved row", async function() {
    const {builderReducer, createDefaultVariant, createInitialBuilderState} = await loadReducer();
    let state = builderReducer(createInitialBuilderState(), {
        type: "source/loaded",
        mode: "account",
        profiles: [],
        accountState: {storageGeneration: 1, usedBytes: 0, quotaBytes: 1000}
    });
    state = builderReducer(state, {type: "character/rename", name: "First Name"});
    state = builderReducer(state, {type: "character/rename", name: "Latest Name"});
    state = builderReducer(state, {
        type: "stat/change", section: "baseStats", stat: "mind", value: 33
    });
    state = builderReducer(state, {
        type: "character/add", name: "Other Unsaved", variant: createDefaultVariant("Original")
    });
    const selectedBeforeSave = state.selectedList;

    state = builderReducer(state, {
        type: "account/profile-saved",
        previous: {id: null, name: "First Name"},
        current: {id: null, name: "Latest Name"},
        profile: {
            id: "created-profile-id",
            name: "First Name",
            revision: 1,
            updatedOn: "2026-08-26T12:01:00.000Z"
        },
        storageGeneration: 1,
        usedBytes: 24,
        quotaBytes: 1000
    });

    const created = state.allLists.find(character => character.name === "Latest Name");
    const other = state.allLists.find(character => character.name === "Other Unsaved");
    assert.deepEqual(created.account, {
        id: "created-profile-id", revision: 1, updatedOn: "2026-08-26T12:01:00.000Z"
    });
    assert.equal(created.variants[0].baseStats.mind, 33);
    assert.deepEqual(other.account, {id: null, revision: 0});
    assert.equal(state.selectedList, selectedBeforeSave);
    assert.equal(state.allLists[state.selectedListIndex].name, "Other Unsaved");
});

// Production break caught: a completed create attaches its server ID to a
// different same-name row after the original local row was deleted.
test("account create completion never falls back past its stable local identity", async function() {
    const {builderReducer, createDefaultVariant, createInitialBuilderState} = await loadReducer();
    const originalAccount = {id: null, revision: 0};
    let state = builderReducer(createInitialBuilderState(), {
        type: "source/loaded",
        mode: "account",
        profiles: [{
            name: "Untitled",
            variants: [createDefaultVariant("Original")],
            account: originalAccount
        }],
        accountState: {storageGeneration: 1, usedBytes: 0, quotaBytes: 1000}
    });
    state = builderReducer(state, {
        type: "character/delete",
        fallbackVariant: createDefaultVariant("Original")
    });
    state = builderReducer(state, {
        type: "stat/change", section: "baseStats", stat: "strength", value: 77
    });
    const replacement = state.allLists[0];

    state = builderReducer(state, {
        type: "account/profile-saved",
        previous: {id: null, name: "Untitled", localIdentity: originalAccount},
        current: {id: "old-created-id", name: "Untitled"},
        profile: {
            name: "Untitled",
            variants: [createDefaultVariant("Original")],
            account: {id: "old-created-id", revision: 1, updatedOn: "2026-08-28T12:00:00.000Z"}
        }
    });

    assert.equal(state.allLists[0], replacement);
    assert.deepEqual(state.allLists[0].account, {id: null, revision: 0, placeholder: true});
    assert.equal(state.allLists[0].variants[0].baseStats.strength, 77);
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
        {id: 1, name: "Sword", slot: 15, slots: [14, 15], strength: 3},
        {id: 2, name: "Axe", slot: 15, slots: [14, 15], strength: 5},
        {id: 3, name: "Spear", slot: 15, slots: [14, 15], strength: 7}
    ];
    let state = {
        ...createInitialBuilderState(), itemsBySlot: Array.from({length: 22}, () => []),
        statInfo: [{short: "Str", var: "strength"}], itemsPerPage: 1
    };
    state.itemsBySlot[15] = items;
    state = builderReducer(state, {type: "search/open", item: items[0], index: 0});
    state = builderReducer(state, {type: "search/text", value: "str>3"});
    state = {...state, filteredItems: items};
    state = builderReducer(state, {type: "search/sort", stat: "strength"});

    assert.deepEqual(selectFilteredItems(state).map(item => item.id), [2, 3]);
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
