"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
    createBuilderStorageService
} = require("../src/routes/api/builder-storage-service");
const {validateBuilderProfile} = require("../src/routes/api/builder-payload");

const NOW = new Date("2026-08-27T12:00:00.000Z");
const QUOTA_BYTES = 10_485_760;
const auth = {
    memberId: 73,
    emailVerified: true,
    storageNamespace: "00112233445566778899aabbccddeeff"
};
const baseStats = "0U0U0U0U0U0U";
const blanks37 = "_".repeat(37);
const singleVariantHero = `7*Hero~Tank~${baseStats}000000___00000000000000000${blanks37}*`;
const multiVariantHero = singleVariantHero +
    `Hero~Caster~${baseStats}000000___00000000000000000${blanks37}*`;

function deferred() {
    let resolve;
    const promise = new Promise(done => {
        resolve = done;
    });
    return {promise, resolve};
}

function profile(overrides = {}) {
    return {
        id: "profile-id",
        name: "Hero",
        payload: "canonical-server-payload",
        payloadVersion: 7,
        payloadBytes: 24,
        revision: 4,
        createdOn: NOW,
        updatedOn: NOW,
        deletedOn: null,
        ...overrides
    };
}

function createHarness(overrides = {}) {
    const events = [];
    const trace = [];
    const connection = {kind: "transaction-connection"};
    let state;
    let transactionSnapshot;
    const pool = {
        getConnection(callback) {
            callback(null, {
                ...connection,
                beginTransaction(done) {
                    events.push("begin");
                    trace.push("begin");
                    transactionSnapshot = {
                        profiles: structuredClone(state.profiles),
                        preferences: structuredClone(state.preferences),
                        receipts: structuredClone(state.receipts)
                    };
                    done(null);
                },
                commit(done) {
                    events.push("commit");
                    done(null);
                },
                rollback(done) {
                    events.push("rollback");
                    state.profiles = transactionSnapshot.profiles;
                    state.preferences = transactionSnapshot.preferences;
                    state.receipts = transactionSnapshot.receipts;
                    done(null);
                },
                release() {
                    events.push("release");
                }
            });
        }
    };
    state = {
        ownerMemberId: overrides.ownerMemberId || auth.memberId,
        profiles: (overrides.profiles || []).map(value => ({...value})),
        preferences: overrides.preferences === null ? null : {
            documentVersion: 1,
            payload: {},
            revision: 2,
            storageGeneration: 1,
            updatedOn: NOW,
            ...overrides.preferences
        },
        usedBytesResult: overrides.usedBytesResult,
        receipts: new Map(overrides.receipts || []),
        insertAttempts: 0,
        insertCount: 0,
        calls: []
    };
    let nextId = 0;

    function requireConnection(options) {
        assert.equal(options.executor.kind, connection.kind);
    }

    const repository = {
        async readPreferences(memberId) {
            state.calls.push(["readPreferences", memberId]);
            if (overrides.readPreferencesError)
                throw overrides.readPreferencesError;
            return state.preferences && {...state.preferences};
        },
        async readPreferencesForUpdate(memberId, options) {
            requireConnection(options);
            state.calls.push(["preferences", memberId]);
            if (overrides.readPreferencesError)
                throw overrides.readPreferencesError;
            return state.preferences && {...state.preferences};
        },
        async readStorageSummary(memberId) {
            state.calls.push(["readStorageSummary", memberId]);
            if (overrides.readSummaryError)
                throw overrides.readSummaryError;
            if (memberId !== state.ownerMemberId || !state.preferences)
                return null;
            const profiles = state.profiles.filter(value => !value.deletedOn).map(value => ({
                id: value.id,
                name: value.name,
                revision: value.revision,
                updatedOn: value.updatedOn
            }));
            return {
                profiles,
                profileCount: profiles.length,
                storageGeneration: state.preferences.storageGeneration,
                usedBytes: profiles.reduce((total, value) => {
                    const stored = state.profiles.find(profileValue => profileValue.id === value.id);
                    return total + stored.payloadBytes;
                }, 0)
            };
        },
        async writePreferences(memberId, value, options) {
            requireConnection(options);
            state.calls.push(["writePreferences", memberId, value]);
            if (overrides.writePreferencesError)
                throw overrides.writePreferencesError;
            state.preferences = {...value};
            return 1;
        },
        async list(memberId, options) {
            requireConnection(options);
            state.calls.push(["list", memberId]);
            if (memberId !== state.ownerMemberId)
                return [];
            return state.profiles.filter(value => !value.deletedOn).map(value => ({...value}));
        },
        async findByPublicIdForUpdate(memberId, id, options) {
            requireConnection(options);
            state.calls.push(["find", memberId, id]);
            if (memberId !== state.ownerMemberId)
                return undefined;
            const found = state.profiles.find(value => value.id === id);
            return found && {...found};
        },
        async usedBytes(memberId, options) {
            requireConnection(options);
            state.calls.push(["usedBytes", memberId]);
            if (state.usedBytesResult !== undefined)
                return state.usedBytesResult;
            return state.profiles.filter(value => !value.deletedOn)
                .reduce((total, value) => total + value.payloadBytes, 0);
        },
        async insert(value, options) {
            requireConnection(options);
            state.calls.push(["insert", value]);
            state.insertAttempts += 1;
            if (overrides.insertError || state.insertAttempts === overrides.insertErrorAt)
                throw overrides.insertError || new Error("insert failed");
            state.profiles.push({...value});
            state.insertCount += 1;
            return ++nextId;
        },
        async update(memberId, id, value, options) {
            requireConnection(options);
            state.calls.push(["update", memberId, id, value, options.expectedRevision]);
            const index = state.profiles.findIndex(item =>
                item.id === id && item.revision === options.expectedRevision && !item.deletedOn);
            if (index === -1)
                return 0;
            state.profiles[index] = {...state.profiles[index], ...value};
            return 1;
        },
        async markDeleted(memberId, id, value, options) {
            requireConnection(options);
            state.calls.push(["markDeleted", memberId, id, value]);
            if (overrides.markDeletedError && id === overrides.markDeletedError.id)
                throw overrides.markDeletedError.error;
            const index = state.profiles.findIndex(item =>
                item.id === id && item.revision === value.expectedRevision && !item.deletedOn);
            if (index === -1)
                return 0;
            state.profiles[index] = {
                ...state.profiles[index],
                payload: null,
                payloadVersion: null,
                payloadBytes: 0,
                revision: state.profiles[index].revision + 1,
                updatedOn: value.deletedOn,
                deletedOn: value.deletedOn
            };
            return 1;
        },
        async readImportReceipt(memberId, idempotencyKey, options) {
            requireConnection(options);
            state.calls.push(["readImportReceipt", memberId, idempotencyKey]);
            const stored = state.receipts.get(`${memberId}:${idempotencyKey}`);
            if (!stored)
                return null;
            const result = stored.result || stored;
            return {
                result: structuredClone(result),
                storageGeneration: stored.storageGeneration ??
                    result.state?.storageGeneration,
                createdOn: NOW
            };
        },
        async writeImportReceipt(memberId, idempotencyKey, result, createdOn, options) {
            requireConnection(options);
            state.calls.push([
                "writeImportReceipt", memberId, idempotencyKey, result, createdOn
            ]);
            if (overrides.writeReceiptError)
                throw overrides.writeReceiptError;
            state.receipts.set(`${memberId}:${idempotencyKey}`, {
                result: structuredClone(result),
                storageGeneration: result.state.storageGeneration
            });
            return 1;
        },
        async deleteImportReceipts(memberId, options) {
            requireConnection(options);
            state.calls.push(["deleteImportReceipts", memberId]);
            if (overrides.deleteReceiptsError)
                throw overrides.deleteReceiptsError;
            let removed = 0;
            for (const key of [...state.receipts.keys()]) {
                if (key.startsWith(`${memberId}:`)) {
                    state.receipts.delete(key);
                    removed += 1;
                }
            }
            return removed;
        }
    };
    const validated = overrides.validated || {};
    const validateCalls = [];
    async function validateProfile(input) {
        validateCalls.push(input);
        trace.push(`validate:${typeof input?.name === "string" ? input.name : "invalid"}`);
        if (overrides.beforeValidate)
            await overrides.beforeValidate(input);
        const validationError = overrides.validationErrors?.[input?.name] ||
            overrides.validationError;
        if (validationError)
            throw validationError;
        const profileValidated = overrides.validatedByName?.[input.name] || validated;
        return {
            name: input.name,
            payload: profileValidated.payload || `canonical-${input.payload}`,
            payloadVersion: profileValidated.payloadVersion || 7,
            byteLength: profileValidated.byteLength === undefined
                ? 70
                : profileValidated.byteLength,
            decoded: {name: input.name}
        };
    }
    async function renameProfile(validatedProfile, name) {
        const payload = `${validatedProfile.payload}|${name}`;
        return {
            ...validatedProfile,
            name,
            payload,
            byteLength: Buffer.byteLength(payload, "utf8"),
            decoded: {...validatedProfile.decoded, name}
        };
    }
    let uuidIndex = 0;
    const uuids = ["created-id", "conflict-id", "third-id"];
    const serviceOptions = {
        pool,
        repository,
        clock: () => NOW,
        randomUUID() {
            const value = uuids[uuidIndex] || `created-${uuidIndex + 1}`;
            uuidIndex += 1;
            return value;
        }
    };
    if (!overrides.useRealProfileBoundary) {
        serviceOptions.validateProfile = validateProfile;
        serviceOptions.renameProfile = renameProfile;
    }
    const service = createBuilderStorageService(serviceOptions);
    return {service, repository, state, events, trace, validateCalls};
}

function createSimultaneousImportHarness() {
    const trace = [];
    const profiles = [];
    const receipts = new Map();
    const preferences = {
        documentVersion: 1,
        payload: {
            version: 1,
            theme: "glass-blue",
            itemsPerPage: 20,
            itemColumns: [],
            builderColumns: {},
            selectedProfileId: null,
            selectedVariant: null
        },
        revision: 1,
        storageGeneration: 1,
        updatedOn: NOW
    };
    let connectionId = 0;
    let memberLockOwner = null;
    const memberLockWaiters = [];

    function releaseMemberLock(connection) {
        if (memberLockOwner !== connection)
            return;
        connection.memberLocked = false;
        const next = memberLockWaiters.shift();
        if (next) {
            memberLockOwner = next.connection;
            next.connection.memberLocked = true;
            next.resolve();
        }
        else {
            memberLockOwner = null;
        }
    }

    function acquireMemberLock(connection) {
        if (!memberLockOwner) {
            memberLockOwner = connection;
            connection.memberLocked = true;
            return Promise.resolve();
        }
        return new Promise(resolve => {
            memberLockWaiters.push({connection, resolve});
        });
    }

    const pool = {
        getConnection(callback) {
            const connection = {
                id: ++connectionId,
                memberLocked: false,
                beginTransaction(done) {
                    trace.push([this.id, "begin"]);
                    done(null);
                },
                commit(done) {
                    trace.push([this.id, "commit"]);
                    releaseMemberLock(this);
                    done(null);
                },
                rollback(done) {
                    trace.push([this.id, "rollback"]);
                    releaseMemberLock(this);
                    done(null);
                },
                release() {
                    trace.push([this.id, "release"]);
                }
            };
            callback(null, connection);
        }
    };
    const repository = {
        async readPreferencesForUpdate(_memberId, {executor}) {
            trace.push([executor.id, "preferences"]);
            await acquireMemberLock(executor);
            return structuredClone(preferences);
        },
        async readImportReceipt(memberId, key, {executor}) {
            trace.push([executor.id, "receipt", key]);
            if (executor.id > 2 && !executor.memberLocked)
                throw new Error("receipt gap lock preceded the member preference lock");
            const result = receipts.get(`${memberId}:${key}`);
            return result ? {result: structuredClone(result), createdOn: NOW} : null;
        },
        async list() {
            return profiles.map(value => ({...value}));
        },
        async usedBytes() {
            return profiles.reduce((total, value) => total + value.payloadBytes, 0);
        },
        async insert(value) {
            profiles.push({...value});
            return profiles.length;
        },
        async writeImportReceipt(memberId, key, result) {
            receipts.set(`${memberId}:${key}`, structuredClone(result));
            return receipts.size;
        }
    };
    const bothValidationsEntered = deferred();
    let validationCount = 0;
    async function validateProfile(input) {
        validationCount += 1;
        if (validationCount === 2)
            bothValidationsEntered.resolve();
        await bothValidationsEntered.promise;
        return {
            name: input.name,
            payload: `canonical-${input.payload}`,
            payloadVersion: 7,
            byteLength: 70,
            decoded: {name: input.name}
        };
    }
    let id = 0;
    const service = createBuilderStorageService({
        pool,
        repository,
        validateProfile,
        clock: () => NOW,
        randomUUID: () => `simultaneous-${++id}`
    });
    return {service, profiles, receipts, trace};
}

// Catches any storage method querying by profile before enforcing verified
// account access, or accepting a caller-supplied member identity.
test("unverified member cannot read or mutate account storage", async function() {
    const {service, state} = createHarness();
    const unverified = {...auth, emailVerified: false};
    const operations = [
        () => service.readPreferences(unverified),
        () => service.readSummary(unverified),
        () => service.readState(unverified),
        () => service.exportAll(unverified),
        () => service.createProfile(unverified, {}),
        () => service.updateProfile(unverified, {}),
        () => service.deleteProfile(unverified, {}),
        () => service.updatePreferences(unverified, {}),
        () => service.importProfiles(unverified, {}),
        () => service.deleteAll(unverified, {})
    ];

    for (const operation of operations)
        await assert.rejects(operation(), error => error.extensions.code === 403);
    assert.deepEqual(state.calls, []);
});

// Catches Account settings falling back to the transactional/full-state path,
// or allowing profile/preference payloads into the summary result.
test("account storage summary is payload-free and does not open a transaction", async function() {
    const {service, state, events} = createHarness({
        profiles: [profile({payload: "private-profile-payload", payloadBytes: 23})],
        preferences: {
            payload: {theme: "private-preference"},
            storageGeneration: 7
        }
    });

    const result = await service.readSummary(auth);

    assert.deepEqual(result, {
        profiles: [{
            id: "profile-id",
            name: "Hero",
            revision: 4,
            updatedOn: NOW
        }],
        profileCount: 1,
        storageGeneration: 7,
        usedBytes: 23,
        quotaBytes: QUOTA_BYTES
    });
    assert.deepEqual(state.calls, [["readStorageSummary", auth.memberId]]);
    assert.deepEqual(events, []);
    assert.equal(JSON.stringify(result).includes("private-profile-payload"), false);
    assert.equal(JSON.stringify(result).includes("private-preference"), false);
});

// Catches server-render bootstrap using the full transactional Builder state
// path, which reads every profile payload, usage totals, and a write lock.
test("preference bootstrap reads only canonical preferences without a transaction", async function() {
    const {service, state, events} = createHarness({
        profiles: [profile({payload: "private-profile-payload"})],
        preferences: {
            payload: {
                version: 1,
                theme: "dark",
                itemsPerPage: 50,
                itemPreviews: false,
                hideEquipmentZeros: true,
                itemColumns: ["Name"],
                builderColumns: {"profile-id": ["Rent"]},
                selectedProfileId: "profile-id",
                selectedVariant: "Tank",
                unknown: "private-unknown"
            },
            revision: 7,
            storageGeneration: 3
        }
    });

    const result = await service.readPreferences(auth);

    assert.deepEqual(result, {
        preferences: {
            documentVersion: 1,
            payload: {
                version: 1,
                theme: "dark",
                itemsPerPage: 50,
                itemPreviews: false,
                hideEquipmentZeros: true,
                itemColumns: ["Name"],
                builderColumns: {"profile-id": ["Rent"]},
                selectedProfileId: "profile-id",
                selectedVariant: "Tank"
            },
            revision: 7,
            storageGeneration: 3,
            updatedOn: NOW
        },
        storageGeneration: 3
    });
    assert.deepEqual(state.calls, [["readPreferences", auth.memberId]]);
    assert.deepEqual(events, []);
    assert.equal(JSON.stringify(result).includes("private-profile-payload"), false);
    assert.equal(JSON.stringify(result).includes("private-unknown"), false);
});

// Catches active-byte totals being computed from caller input or including
// tombstones, and pins the exact 10 MiB boundary.
test("account quota counts only active encoded bytes", async function() {
    const {service, state} = createHarness({usedBytesResult: 10_485_700});

    await assert.rejects(service.createProfile(auth, {
        name: "Hero",
        payload: "seventy-byte-input",
        storageGeneration: 1
    }), error => error.extensions.code === 413);
    assert.equal(state.calls.some(([name]) => name === "insert"), false);
});

// Catches treating the inclusive 10 MiB capacity as an exclusive ceiling.
test("account quota accepts an active-byte total exactly at 10 MB", async function() {
    const {service} = createHarness({usedBytesResult: 10_485_690});

    const result = await service.createProfile(auth, {
        name: "Hero",
        payload: "seventy-byte-input",
        storageGeneration: 1
    });

    assert.equal(result.status, "saved");
    assert.equal(result.usedBytes, QUOTA_BYTES);
});

// Catches checking generation after profile creation, or committing any
// profile data from a tab invalidated by delete-all.
test("generation mismatch rolls back without validating or creating data", async function() {
    const {service, state, events, validateCalls} = createHarness({
        preferences: {storageGeneration: 2}
    });

    await assert.rejects(service.createProfile(auth, {
        name: "Hero",
        payload: "raw-secret-payload",
        storageGeneration: 1
    }), error => error.extensions.code === 409);
    assert.deepEqual(validateCalls, []);
    assert.equal(state.calls.some(([name]) => name === "insert"), false);
    assert.deepEqual(events, ["begin", "rollback", "release"]);
});

// Catches driver diagnostics containing submitted Builder data escaping the
// service boundary after a transactional persistence failure.
test("unexpected persistence failures expose no raw payload diagnostics", async function() {
    const privatePayload = "raw-secret-payload";
    const {service, events} = createHarness({
        insertError: new Error(`database rejected ${privatePayload}`)
    });

    await assert.rejects(service.createProfile(auth, {
        name: "Hero",
        payload: privatePayload,
        storageGeneration: 1
    }), error => error.message === "The request could not be completed." &&
        !error.message.includes(privatePayload));
    assert.deepEqual(events, ["begin", "rollback", "release"]);
});

// Catches codec diagnostics echoing malformed encoded content or losing the
// stable validation status expected by the API layer.
test("unexpected validation failures become payload-free bad requests", async function() {
    const privatePayload = "malformed-secret-payload";
    const {service} = createHarness({
        validationError: new Error(`invalid ${privatePayload}`)
    });

    await assert.rejects(service.createProfile(auth, {
        name: "Hero",
        payload: privatePayload,
        storageGeneration: 1
    }), error => error.extensions.code === 400 &&
        !error.message.includes(privatePayload));
});

// Catches a matching revision updating outside the member transaction,
// applying quota to the full replacement instead of the encoded-byte delta,
// or failing to increment the revision exactly once.
test("matching revision saves canonical payload after generation and row locks", async function() {
    const current = profile({payloadBytes: 60});
    const {service, state, events} = createHarness({
        profiles: [current],
        usedBytesResult: QUOTA_BYTES - 5,
        validated: {payload: "canonical-client-payload", byteLength: 64}
    });

    const result = await service.updateProfile(auth, {
        id: current.id,
        name: "Hero",
        payload: "client-payload",
        revision: 4,
        storageGeneration: 1
    });

    assert.equal(result.status, "saved");
    assert.equal(result.profile.revision, 5);
    assert.equal(result.profile.payload, "canonical-client-payload");
    assert.equal(result.usedBytes, QUOTA_BYTES - 1);
    assert.deepEqual(state.calls.slice(0, 2).map(call => call[0]), ["preferences", "find"]);
    assert.equal(state.calls.some(call => call[0] === "update" && call[4] === 4), true);
    assert.deepEqual(events, ["begin", "commit", "release"]);
});

// Catches a committed save whose response was lost being replayed with its
// original revision and creating one or more identical conflict profiles.
test("stale replay of already-saved canonical content returns the current profile", async function() {
    const current = profile({
        payload: multiVariantHero,
        payloadBytes: Buffer.byteLength(multiVariantHero)
    });
    const {service, state} = createHarness({
        useRealProfileBoundary: true,
        profiles: [current]
    });

    const result = await service.updateProfile(auth, {
        id: current.id,
        name: current.name,
        payload: current.payload,
        revision: current.revision - 1,
        storageGeneration: 1
    });

    assert.equal(result.status, "saved");
    assert.deepEqual(result.profile, current);
    assert.equal(result.conflictProfile, undefined);
    assert.equal(result.usedBytes, current.payloadBytes);
    assert.equal(state.insertCount, 0);
    assert.equal(state.profiles.length, 1);
    assert.equal(state.calls.some(([operation]) => operation === "update"), false);
});

// Catches stale edits overwriting the server row, dropping the attempted
// edit, or choosing a non-deterministic/non-exact conflict name.
test("stale update preserves the server row and creates a conflict copy", async function() {
    const current = profile({revision: 4});
    const {service, state} = createHarness({
        profiles: [current],
        validated: {payload: "canonical-stale-payload", byteLength: 23}
    });

    const result = await service.updateProfile(auth, {
        id: "profile-id",
        name: "Hero",
        payload: "stale-payload",
        revision: 3,
        storageGeneration: 1
    });

    assert.equal(result.status, "conflict");
    assert.equal(result.profile.revision, 4);
    assert.equal(result.profile.payload, "canonical-server-payload");
    assert.equal(result.conflictProfile.name, "Hero Conflict");
    assert.equal(result.conflictProfile.payload,
        "canonical-stale-payload|Hero Conflict");
    assert.equal(state.profiles.find(value => value.id === "profile-id").payload,
        "canonical-server-payload");
});

// Catches the service persisting a generated conflict row name beside a
// payload whose per-variant names and byte metadata still describe the stale
// original profile.
test("real stale conflict copy renames every variant and recomputes canonical metadata", async function() {
    const {service, state} = createHarness({
        useRealProfileBoundary: true,
        profiles: [
            profile({
                payload: singleVariantHero,
                payloadBytes: Buffer.byteLength(singleVariantHero)
            }),
            profile({id: "existing-conflict", name: "Hero Conflict"})
        ]
    });

    const result = await service.updateProfile(auth, {
        id: "profile-id",
        name: "Hero",
        payload: multiVariantHero,
        revision: 3,
        storageGeneration: 1
    });
    const codec = await import("../shared/builder-codec.mjs");
    const inserted = state.profiles.find(value => value.id === "created-id");

    assert.equal(result.conflictProfile.name, "Hero Conflict 2");
    assert.deepEqual(codec.decodeBuilderEntries(result.conflictProfile.payload)
        .map(entry => entry.name), ["Hero Conflict 2", "Hero Conflict 2"]);
    assert.deepEqual(codec.decodeBuilderLists(result.conflictProfile.payload)[0].variants
        .map(variant => variant.name), ["Tank", "Caster"]);
    assert.equal(result.conflictProfile.payloadVersion, 7);
    assert.equal(result.conflictProfile.payloadBytes,
        Buffer.byteLength(result.conflictProfile.payload, "utf8"));
    assert.deepEqual(inserted, {...result.conflictProfile, memberId: auth.memberId});
    await validateBuilderProfile({
        name: result.conflictProfile.name,
        payload: result.conflictProfile.payload
    });
});

// Catches quota enforcement using the shorter pre-rename payload even though
// each re-encoded conflict variant grows with the generated suffix.
test("renamed conflict byte growth cannot exceed the account quota", async function() {
    const originalBytes = Buffer.byteLength(multiVariantHero, "utf8");
    const {service, state} = createHarness({
        useRealProfileBoundary: true,
        profiles: [profile({
            payload: singleVariantHero,
            payloadBytes: Buffer.byteLength(singleVariantHero)
        })],
        usedBytesResult: QUOTA_BYTES - originalBytes
    });

    await assert.rejects(service.updateProfile(auth, {
        id: "profile-id",
        name: "Hero",
        payload: multiVariantHero,
        revision: 3,
        storageGeneration: 1
    }), error => error.extensions.code === 413);
    assert.equal(state.calls.some(([operation]) => operation === "insert"), false);
});

// Catches case-insensitive collision detection or reusing an already-active
// exact conflict suffix.
test("conflict copy uses the first available exact case-sensitive suffix", async function() {
    const {service} = createHarness({
        profiles: [
            profile(),
            profile({id: "c1", name: "Hero Conflict"}),
            profile({id: "lower", name: "hero conflict 2"}),
            profile({id: "c2", name: "Hero Conflict 2"})
        ],
        validated: {payload: "canonical-stale-payload", byteLength: 23}
    });

    const result = await service.updateProfile(auth, {
        id: "profile-id",
        name: "Hero",
        payload: "stale-payload",
        revision: 3,
        storageGeneration: 1
    });

    assert.equal(result.conflictProfile.name, "Hero Conflict 3");
});

// Catches individually deleted rows being restored in place by a stale tab
// instead of retaining the tombstone and preserving a separately named copy.
test("an edit of a tombstone creates a conflict copy without restoring it", async function() {
    const tombstone = profile({payload: null, payloadVersion: null, payloadBytes: 0, deletedOn: NOW});
    const {service, state} = createHarness({
        profiles: [tombstone],
        validated: {payload: "canonical-recovered-payload", byteLength: 27}
    });

    const result = await service.updateProfile(auth, {
        id: "profile-id",
        name: "Hero",
        payload: "recovered-payload",
        revision: 4,
        storageGeneration: 1
    });

    assert.equal(result.status, "conflict");
    assert.equal(result.profile.deletedOn, NOW);
    assert.equal(result.conflictProfile.name, "Hero Conflict");
    assert.equal(state.profiles.find(value => value.id === "profile-id").payload, null);
});

// Catches cross-member profile IDs being treated as authorization, or
// disclosing whether that ID exists for another account.
test("profile ownership always comes from auth and foreign IDs are not found", async function() {
    const {service, state} = createHarness({profiles: [profile()]});

    await assert.rejects(service.updateProfile({...auth, memberId: 88}, {
        id: "profile-id",
        memberId: 73,
        name: "Hero",
        payload: "attempt",
        revision: 4,
        storageGeneration: 1
    }), error => error.extensions.code === 404);
    assert.deepEqual(state.calls.find(call => call[0] === "find").slice(1), [88, "profile-id"]);
    assert.equal(state.calls.some(([name]) => name === "update" || name === "insert"), false);
});

// Catches deletion leaving recoverable payload bytes or accepting a stale
// revision rather than advancing a durable tombstone exactly once.
test("delete clears the payload and retains a revisioned tombstone", async function() {
    const current = profile();
    const {service, state} = createHarness({profiles: [current]});

    const result = await service.deleteProfile(auth, {
        id: "profile-id",
        revision: 4,
        storageGeneration: 1
    });

    assert.equal(result.status, "deleted");
    assert.deepEqual(result.profile, {
        ...current,
        payload: null,
        payloadVersion: null,
        payloadBytes: 0,
        revision: 5,
        updatedOn: NOW,
        deletedOn: NOW
    });
    assert.equal(result.usedBytes, 0);
    assert.equal(state.calls.find(call => call[0] === "markDeleted")[3].expectedRevision, 4);
});

// Catches an atomic profile deletion leaving per-profile columns or selection
// pointing at the newly created tombstone while device fields remain durable.
test("delete removes its preference references and preserves syncable account fields", async function() {
    const deleting = profile({id: "deleting"});
    const survivor = profile({id: "survivor", name: "Survivor"});
    const {service, state} = createHarness({
        profiles: [deleting, survivor],
        preferences: {
            payload: {
                version: 1,
                theme: "dark",
                itemsPerPage: 50,
                itemPreviews: false,
                hideEquipmentZeros: true,
                itemColumns: ["Name"],
                builderColumns: {
                    deleting: ["Rent"],
                    survivor: ["Slot"]
                },
                selectedProfileId: "deleting",
                selectedVariant: "Tank",
                cookieConsent: true,
                timezone: 300
            }
        }
    });

    await service.deleteProfile(auth, {
        id: "deleting",
        revision: 4,
        storageGeneration: 1
    });

    assert.deepEqual(state.preferences, {
        documentVersion: 1,
        payload: {
            version: 1,
            theme: "dark",
            itemsPerPage: 50,
            itemPreviews: false,
            hideEquipmentZeros: true,
            itemColumns: ["Name"],
            builderColumns: {survivor: ["Slot"]},
            selectedProfileId: null,
            selectedVariant: null
        },
        revision: 3,
        storageGeneration: 1,
        updatedOn: NOW
    });
});

// Catches a preference write failure committing a tombstone independently of
// the required preference cleanup.
test("delete rolls back its tombstone when preference cleanup fails", async function() {
    const current = profile({id: "deleting"});
    const originalPreferences = {
        documentVersion: 1,
        payload: {
            builderColumns: {deleting: ["Slot"]},
            selectedProfileId: "deleting",
            selectedVariant: "Tank"
        },
        revision: 2,
        storageGeneration: 1,
        updatedOn: NOW
    };
    const {service, state, events} = createHarness({
        profiles: [current],
        preferences: originalPreferences,
        writePreferencesError: new Error("preference write failed")
    });

    await assert.rejects(service.deleteProfile(auth, {
        id: "deleting",
        revision: 4,
        storageGeneration: 1
    }), error => error.message === "The request could not be completed.");

    assert.deepEqual(state.profiles, [current]);
    assert.deepEqual(state.preferences, originalPreferences);
    assert.deepEqual(events, ["begin", "rollback", "release"]);
});

// Catches delete-all committing row deletion separately from its generation
// bump, or failing to revision each durable tombstone.
test("delete-all tombstones every active row and bumps generation in one transaction", async function() {
    const first = profile({id: "one", revision: 2, payloadBytes: 20});
    const second = profile({id: "two", revision: 7, payloadBytes: 30});
    const {service, state, events} = createHarness({
        profiles: [first, second],
        receipts: [[`${auth.memberId}:old-import`, {
            result: {state: {profiles: [{payload: "private-receipt-payload"}]}},
            storageGeneration: 1
        }]],
        preferences: {
            payload: {
                version: 1,
                theme: "glass-amber",
                itemsPerPage: 100,
                itemPreviews: false,
                hideEquipmentZeros: true,
                itemColumns: ["Name", "Rent"],
                builderColumns: {one: ["Slot"], two: ["Rent"]},
                selectedProfileId: "two",
                selectedVariant: "Caster",
                loginToken: "private",
                timezone: 300
            }
        }
    });

    const result = await service.deleteAll(auth, {storageGeneration: 1});

    assert.equal(result.status, "deleted");
    assert.equal(result.storageGeneration, 2);
    assert.equal(result.usedBytes, 0);
    assert.equal(state.profiles.every(value => value.deletedOn === NOW), true);
    assert.deepEqual(state.profiles.map(value => value.revision), [3, 8]);
    assert.deepEqual(state.calls.map(call => call[0]), [
        "preferences", "list", "markDeleted", "markDeleted", "writePreferences",
        "deleteImportReceipts"
    ]);
    assert.equal(state.receipts.size, 0);
    assert.equal(state.preferences.storageGeneration, 2);
    assert.equal(state.preferences.revision, 3);
    assert.deepEqual(state.preferences.payload, {
        version: 1,
        theme: "glass-amber",
        itemsPerPage: 100,
        itemPreviews: false,
        hideEquipmentZeros: true,
        itemColumns: ["Name", "Rent"],
        builderColumns: {},
        selectedProfileId: null,
        selectedVariant: null
    });
    assert.deepEqual(events, ["begin", "commit", "release"]);
});

// Catches receipt cleanup committing separately from profile tombstones and
// generation rotation. A failure must restore both data and replay receipts.
test("delete-all rolls back receipt cleanup with the account deletion", async function() {
    const current = profile({id: "one", payload: "private-profile"});
    const receiptKey = `${auth.memberId}:old-import`;
    const receipt = {
        result: {state: {profiles: [{payload: "private-receipt"}]}},
        storageGeneration: 1
    };
    const {service, state, events} = createHarness({
        profiles: [current],
        receipts: [[receiptKey, receipt]],
        deleteReceiptsError: new Error("receipt cleanup failed")
    });

    await assert.rejects(
        service.deleteAll(auth, {storageGeneration: 1}),
        error => error.message === "The request could not be completed."
    );

    assert.deepEqual(state.profiles, [current]);
    assert.equal(state.preferences.storageGeneration, 1);
    assert.deepEqual(state.receipts.get(receiptKey), receipt);
    assert.deepEqual(events, ["begin", "rollback", "release"]);
});

// Catches batch validation occurring under locks, raw invalid payloads leaking
// into results, canonical equality being missed, Local suffix collisions being
// overwritten, or imported per-profile preferences retaining local/stale IDs.
test("batch import validates independently then classifies and commits one result", async function() {
    const privatePayload = "raw-private-broken-profile";
    const existing = [
        profile({id: "account-same", name: "Same", payload: "canonical-identical", payloadBytes: 19}),
        profile({id: "account-hero", name: "Hero", payload: "canonical-server", payloadBytes: 16}),
        profile({id: "account-local", name: "Hero Local", payload: "occupied", payloadBytes: 8})
    ];
    const {service, state, trace} = createHarness({
        profiles: existing,
        validationErrors: {Broken: new Error(`invalid ${privatePayload}`)}
    });
    const input = {
        idempotencyKey: "batch-key",
        storageGeneration: 1,
        replacePreferences: true,
        preferencePayload: {
            version: 1,
            theme: "dark",
            itemsPerPage: 50,
            itemColumns: ["Name"],
            builderColumns: {
                "local-same": ["Slot"],
                "local-hero": ["Rent"],
                "local-fresh": ["Name"],
                stale: ["Name"]
            },
            selectedProfileId: "local-hero",
            selectedVariant: "Tank",
            cookieConsent: true,
            loginToken: "secret",
            timezone: 300
        },
        profiles: [
            {id: "local-same", name: "Same", payload: "identical"},
            {id: "local-hero", name: "Hero", payload: "client"},
            {id: "local-fresh", name: "Fresh", payload: "fresh"},
            {id: "local-broken", name: "Broken", payload: privatePayload}
        ]
    };

    const result = await service.importProfiles(auth, input);

    assert.deepEqual(result.copied, ["Fresh"]);
    assert.deepEqual(result.renamed, [{from: "Hero", to: "Hero Local 2"}]);
    assert.deepEqual(result.deduplicated, ["Same"]);
    assert.deepEqual(result.rejected, [{
        name: "Broken",
        reason: "The Builder profile is invalid."
    }]);
    assert.equal(JSON.stringify(result.rejected).includes(privatePayload), false);
    assert.equal(result.preferencesImported, true);
    assert.equal(state.insertCount, 2);
    assert.deepEqual(trace, [
        "begin", "validate:Same", "validate:Hero", "validate:Fresh", "validate:Broken",
        "begin"
    ]);
    assert.deepEqual(state.calls.slice(0, 5).map(call => call[0]), [
        "preferences", "readImportReceipt", "preferences", "readImportReceipt", "list"
    ]);
    const firstInsert = state.calls.findIndex(call => call[0] === "insert");
    assert.ok(state.calls.findIndex(call => call[0] === "usedBytes") < firstInsert);
    assert.deepEqual(state.preferences.payload.builderColumns, {
        "account-same": ["Slot"],
        "created-id": ["Rent"],
        "conflict-id": ["Name"]
    });
    assert.equal(state.preferences.payload.selectedProfileId, "created-id");
    assert.equal(state.preferences.payload.selectedVariant, "Tank");
    assert.equal(Object.hasOwn(state.preferences.payload, "cookieConsent"), false);
    assert.equal(Object.hasOwn(state.preferences.payload, "loginToken"), false);
    assert.equal(Object.hasOwn(state.preferences.payload, "timezone"), false);
    assert.equal(state.calls.at(-1)[0], "writeImportReceipt");
    assert.equal(result.state.storageGeneration, 1);
    assert.equal(result.state.usedBytes,
        existing.reduce((total, value) => total + value.payloadBytes, 0) +
        state.profiles.slice(existing.length).reduce((total, value) => total + value.payloadBytes, 0));
});

// Catches a repeated request key being reclassified against the now-mutated
// account and inserting another row instead of returning its durable receipt.
test("repeating an import key returns the stored result without new rows", async function() {
    const {service, state} = createHarness();
    const input = {
        idempotencyKey: "repeat-key",
        storageGeneration: 1,
        replacePreferences: false,
        profiles: [{name: "Fresh", payload: "fresh"}]
    };

    const first = await service.importProfiles(auth, input);
    const second = await service.importProfiles(auth, input);

    assert.deepEqual(second, first);
    assert.equal(state.receipts.get(`${auth.memberId}:repeat-key`).storageGeneration, 1);
    assert.equal(state.insertCount, first.copied.length + first.renamed.length);
    assert.equal(state.calls.filter(call => call[0] === "preferences").length, 3);
    assert.equal(state.calls.filter(call => call[0] === "readImportReceipt").length, 3);
});

// Catches a payload-bearing receipt surviving generation rotation. Once
// delete-all commits, the old key must neither disclose its state nor recreate
// any profile when retried with the old generation.
test("delete-all makes a prior import receipt unreplayable without recreating data", async function() {
    const {service, state} = createHarness();
    const input = {
        idempotencyKey: "delete-replay-key",
        storageGeneration: 1,
        replacePreferences: false,
        profiles: [{name: "Private", payload: "private-import-payload"}]
    };
    const imported = await service.importProfiles(auth, input);
    assert.equal(JSON.stringify(imported).includes("private-import-payload"), true);
    assert.equal(state.receipts.size, 1);

    await service.deleteAll(auth, {storageGeneration: 1});
    assert.equal(state.receipts.size, 0);
    const insertCount = state.insertCount;

    await assert.rejects(
        service.importProfiles(auth, input),
        error => error.extensions.code === 409
    );
    assert.equal(state.insertCount, insertCount);
    assert.equal(state.profiles.filter(value => !value.deletedOn).length, 0);
    assert.equal(JSON.stringify([...state.receipts.values()])
        .includes("private-import-payload"), false);
});

// Catches a stale receipt that escaped cleanup being treated as authoritative
// after the member generation changed.
test("receipt replay is accepted only for the current storage generation", async function() {
    const staleResult = {
        copied: ["Private"],
        state: {
            profiles: [{payload: "private-stale-receipt"}],
            storageGeneration: 1
        }
    };
    const {service, state} = createHarness({
        preferences: {storageGeneration: 2},
        receipts: [[`${auth.memberId}:stale-receipt-key`, {
            result: staleResult,
            storageGeneration: 1
        }]]
    });

    await assert.rejects(service.importProfiles(auth, {
        idempotencyKey: "stale-receipt-key",
        storageGeneration: 1,
        replacePreferences: false,
        profiles: [{name: "Private", payload: "private-stale-receipt"}]
    }), error => error.extensions.code === 409);

    assert.equal(state.insertCount, 0);
    assert.equal(state.calls.filter(call => call[0] === "preferences").length, 2);
    assert.equal(state.calls.filter(call => call[0] === "readImportReceipt").length, 2);
});

// Catches a completed key being coupled to a changed retry body. Authentication
// and key syntax still apply, but no other request field may precede replay.
test("receipt replay ignores malformed changed import body fields", async function() {
    const {service, state, validateCalls} = createHarness();
    const first = await service.importProfiles(auth, {
        idempotencyKey: "body-independent-key",
        storageGeneration: 1,
        replacePreferences: false,
        profiles: [{name: "Fresh", payload: "fresh"}]
    });

    const replay = await service.importProfiles(auth, {
        idempotencyKey: "body-independent-key",
        storageGeneration: "stale-and-malformed",
        replacePreferences: "invalid",
        preferencePayload: "{private malformed preference",
        profiles: null
    });

    assert.deepEqual(replay, first);
    assert.equal(validateCalls.length, 1);
    assert.equal(state.insertCount, 1);
    assert.equal(state.calls.filter(call => call[0] === "preferences").length, 3);
});

test("receipt replay still requires verified auth and a valid key shape", async function() {
    const stored = {copied: ["Stored"]};
    const {service, state, validateCalls} = createHarness({
        receipts: [[`${auth.memberId}:stored-key`, stored]]
    });

    await assert.rejects(service.importProfiles({...auth, emailVerified: false}, {
        idempotencyKey: "stored-key"
    }), error => error.extensions.code === 403);
    await assert.rejects(service.importProfiles(auth, {
        idempotencyKey: " "
    }), error => error.extensions.code === 400);

    assert.deepEqual(state.calls, []);
    assert.deepEqual(validateCalls, []);
});

// Catches a receipt-miss transaction being held through expensive profile
// validation, or the write transaction failing to recheck after a race winner.
test("import releases receipt preflight before validation and replays a concurrent winner", async function() {
    const validationEntered = deferred();
    const releaseValidation = deferred();
    const {service, state, events} = createHarness({
        beforeValidate: async input => {
            if (input.name === "Slow") {
                validationEntered.resolve();
                await releaseValidation.promise;
            }
        }
    });

    const slowPromise = service.importProfiles(auth, {
        idempotencyKey: "race-key",
        storageGeneration: 1,
        replacePreferences: false,
        profiles: [{name: "Slow", payload: "slow"}]
    });
    await validationEntered.promise;
    const eventsDuringValidation = events.slice();

    let winner;
    try {
        winner = await service.importProfiles(auth, {
            idempotencyKey: "race-key",
            storageGeneration: 1,
            replacePreferences: false,
            profiles: [{name: "Winner", payload: "winner"}]
        });
    }
    finally {
        releaseValidation.resolve();
    }
    const raced = await slowPromise;

    assert.deepEqual(eventsDuringValidation, ["begin", "commit", "release"]);
    assert.deepEqual(raced, winner);
    assert.deepEqual(winner.copied, ["Winner"]);
    assert.equal(state.insertCount, 1);
    assert.equal(state.profiles[0].name, "Winner");
    assert.equal(state.calls.filter(call => call[0] === "readImportReceipt").length, 4);
});

// Catches simultaneous receipt misses taking an InnoDB gap lock before the
// one per-member row. The deterministic lock model turns that inversion into
// a failure while preserving identical-key replay and distinct-key commits.
test("simultaneous import misses lock member state before receipt recheck", async function(t) {
    for (const sameKey of [true, false]) {
        await t.test(sameKey ? "identical keys" : "distinct keys", async function() {
            const {service, profiles, receipts, trace} = createSimultaneousImportHarness();
            const keys = sameKey ? ["same-key", "same-key"] : ["first-key", "second-key"];
            const settled = await Promise.allSettled([
                service.importProfiles(auth, {
                    idempotencyKey: keys[0],
                    storageGeneration: 1,
                    replacePreferences: false,
                    profiles: [{name: "First", payload: "first"}]
                }),
                service.importProfiles(auth, {
                    idempotencyKey: keys[1],
                    storageGeneration: 1,
                    replacePreferences: false,
                    profiles: [{name: "Second", payload: "second"}]
                })
            ]);

            assert.deepEqual(settled.map(result => result.status), ["fulfilled", "fulfilled"]);
            const results = settled.map(result => result.value);
            assert.equal(profiles.length, sameKey ? 1 : 2);
            assert.equal(receipts.size, sameKey ? 1 : 2);
            if (sameKey)
                assert.deepEqual(results[1], results[0]);
            else
                assert.deepEqual(results.map(result => result.copied).sort(), [["First"], ["Second"]]);

            const memberLockedConnections = [...new Set(trace.filter(([, operation]) =>
                operation === "preferences").map(([idValue]) => idValue))];
            assert.equal(memberLockedConnections.length, 4);
            for (const [idValue, operation] of trace.filter(([, value]) =>
                value === "receipt")) {
                const receiptIndex = trace.findIndex(entry =>
                    entry[0] === idValue && entry[1] === operation);
                assert.ok(trace.slice(0, receiptIndex).some(entry =>
                    entry[0] === idValue && entry[1] === "preferences"));
            }
            for (const idValue of memberLockedConnections) {
                assert.deepEqual(trace.filter(([traceId, operation]) =>
                    traceId === idValue && ["preferences", "receipt"].includes(operation))
                    .map(([, operation]) => operation), ["preferences", "receipt"]);
            }
        });
    }
});

// Catches a canonical duplicate of an earlier local row losing its source-ID
// mapping because the destination UUID did not exist during classification.
test("within-batch deduplication maps every local preference ID to one account row", async function() {
    const {service, state} = createHarness();

    const result = await service.importProfiles(auth, {
        idempotencyKey: "within-batch-dedup-key",
        storageGeneration: 1,
        replacePreferences: true,
        preferencePayload: {
            builderColumns: {second: ["Slot"]},
            selectedProfileId: "second",
            selectedVariant: "Tank"
        },
        profiles: [
            {id: "first", name: "Same", payload: "same"},
            {id: "second", name: "Same", payload: "same"}
        ]
    });

    assert.deepEqual(result.copied, ["Same"]);
    assert.deepEqual(result.deduplicated, ["Same"]);
    assert.equal(state.insertCount, 1);
    assert.deepEqual(state.preferences.payload.builderColumns, {"created-id": ["Slot"]});
    assert.equal(state.preferences.payload.selectedProfileId, "created-id");
});

// Catches destination renaming changing canonical source identity, which used
// to create a second Local row and charge its bytes to quota again.
test("renamed source duplicates share one destination row and preference mapping", async function() {
    const renamedBytes = Buffer.byteLength("canonical-local|Hero Local", "utf8");
    const existing = profile({
        id: "account-hero",
        name: "Hero",
        payload: "canonical-server",
        payloadBytes: 16
    });
    const {service, state} = createHarness({
        profiles: [existing],
        usedBytesResult: QUOTA_BYTES - renamedBytes
    });

    const result = await service.importProfiles(auth, {
        idempotencyKey: "renamed-source-dedup-key",
        storageGeneration: 1,
        replacePreferences: true,
        preferencePayload: {
            builderColumns: {second: ["Slot"]},
            selectedProfileId: "second",
            selectedVariant: "Tank"
        },
        profiles: [
            {id: "first", name: "Hero", payload: "local"},
            {id: "second", name: "Hero", payload: "local"}
        ]
    });

    assert.deepEqual(result.renamed, [{from: "Hero", to: "Hero Local"}]);
    assert.deepEqual(result.deduplicated, ["Hero"]);
    assert.equal(state.insertCount, 1);
    assert.equal(state.profiles.filter(value => value.name.startsWith("Hero Local")).length, 1);
    assert.deepEqual(state.preferences.payload.builderColumns, {"created-id": ["Slot"]});
    assert.equal(state.preferences.payload.selectedProfileId, "created-id");
    assert.equal(state.profiles[1].payloadBytes, renamedBytes);
    assert.equal(result.state.usedBytes, QUOTA_BYTES);
});

// Catches imported local IDs falling through unchanged when they happen to be
// valid UUIDs belonging to unrelated account profiles.
test("import drops preference profile IDs without an explicit source mapping", async function() {
    const unrelated = profile({
        id: "unrelated-active",
        name: "Account Only",
        payload: "canonical-account-only"
    });
    const {service, state} = createHarness({profiles: [unrelated]});

    await service.importProfiles(auth, {
        idempotencyKey: "unmapped-preference-key",
        storageGeneration: 1,
        replacePreferences: true,
        preferencePayload: {
            builderColumns: {
                "unrelated-active": ["Rent"],
                local: ["Slot"]
            },
            selectedProfileId: "unrelated-active",
            selectedVariant: "Tank"
        },
        profiles: [{id: "local", name: "Fresh", payload: "fresh"}]
    });

    assert.deepEqual(state.preferences.payload.builderColumns, {"created-id": ["Slot"]});
    assert.equal(state.preferences.payload.selectedProfileId, null);
    assert.equal(state.preferences.payload.selectedVariant, null);
});

// Catches per-row quota checks that allow an early insert before discovering
// the complete accepted batch exceeds 10 MiB.
test("batch import enforces quota across all accepted rows before inserting", async function() {
    const {service, state, events} = createHarness({usedBytesResult: QUOTA_BYTES - 100});

    await assert.rejects(service.importProfiles(auth, {
        idempotencyKey: "quota-key",
        storageGeneration: 1,
        replacePreferences: false,
        profiles: [
            {name: "One", payload: "one"},
            {name: "Two", payload: "two"}
        ]
    }), error => error.extensions.code === 413);

    assert.equal(state.insertAttempts, 0);
    assert.equal(state.profiles.length, 0);
    assert.equal(state.receipts.size, 0);
    assert.deepEqual(events, [
        "begin", "commit", "release", "begin", "rollback", "release"
    ]);
});

// Catches a mid-batch persistence failure leaving the first row or an import
// receipt durable even though the transaction reported failure.
test("batch import rolls back every row and receipt after a later insert fails", async function() {
    const {service, state, events} = createHarness({insertErrorAt: 2});

    await assert.rejects(service.importProfiles(auth, {
        idempotencyKey: "rollback-key",
        storageGeneration: 1,
        replacePreferences: false,
        profiles: [
            {name: "One", payload: "one"},
            {name: "Two", payload: "two"}
        ]
    }), error => error.message === "The request could not be completed.");

    assert.equal(state.profiles.length, 0);
    assert.equal(state.receipts.size, 0);
    assert.deepEqual(events, [
        "begin", "commit", "release", "begin", "rollback", "release"
    ]);
});

// Catches receipt persistence occurring outside the transaction or preference
// replacement surviving when the completed receipt cannot be stored.
test("batch import rolls back rows and preferences when receipt storage fails", async function() {
    const {service, state, events} = createHarness({
        writeReceiptError: new Error("receipt storage failed")
    });

    await assert.rejects(service.importProfiles(auth, {
        idempotencyKey: "receipt-failure-key",
        storageGeneration: 1,
        replacePreferences: true,
        preferencePayload: {theme: "dark"},
        profiles: [{name: "One", payload: "one"}]
    }), error => error.message === "The request could not be completed.");

    assert.equal(state.profiles.length, 0);
    assert.deepEqual(state.preferences.payload, {});
    assert.equal(state.preferences.revision, 2);
    assert.equal(state.receipts.size, 0);
    assert.deepEqual(events, [
        "begin", "commit", "release", "begin", "rollback", "release"
    ]);
});

// Catches generation verification happening before the write-time receipt
// recheck, after writes, or before every profile has independently validated.
test("batch import locks member state then receipt and rejects stale generation before writes", async function() {
    const {service, state, trace} = createHarness({preferences: {storageGeneration: 2}});

    await assert.rejects(service.importProfiles(auth, {
        idempotencyKey: "stale-generation-key",
        storageGeneration: 1,
        replacePreferences: false,
        profiles: [
            {name: "One", payload: "one"},
            {name: "Two", payload: "two"}
        ]
    }), error => error.extensions.code === 409);

    assert.deepEqual(trace, ["begin", "validate:One", "validate:Two", "begin"]);
    assert.deepEqual(state.calls.map(call => call[0]), [
        "preferences", "readImportReceipt", "preferences", "readImportReceipt"
    ]);
    assert.equal(state.insertAttempts, 0);
});

// Catches preference writes retaining device fields or stale profile IDs, and
// catches optimistic preference revisions preventing the later commit from
// winning independently of profile revisions.
test("preference updates are canonical and the last committed update wins", async function() {
    const active = profile({id: "active-id"});
    const {service, state} = createHarness({profiles: [active]});

    await service.updatePreferences(auth, {
        storageGeneration: 1,
        payload: {
            theme: "light",
            builderColumns: {"active-id": ["Name"], deleted: ["Slot"]},
            selectedProfileId: "deleted",
            selectedVariant: "Tank",
            cookieConsent: true
        }
    });
    const result = await service.updatePreferences(auth, {
        storageGeneration: 1,
        payload: {
            theme: "glass-amber",
            itemPreviews: false,
            hideEquipmentZeros: true,
            builderColumns: {"active-id": ["Slot"]},
            selectedProfileId: "active-id",
            selectedVariant: "Caster"
        }
    });

    assert.equal(result.preferences.revision, 4);
    assert.deepEqual(state.preferences.payload, {
        version: 1,
        theme: "glass-amber",
        itemsPerPage: 20,
        itemPreviews: false,
        hideEquipmentZeros: true,
        itemColumns: [],
        builderColumns: {"active-id": ["Slot"]},
        selectedProfileId: "active-id",
        selectedVariant: "Caster"
    });
});

// Catches an import collision changing only the SQL row name while retaining
// the original character name inside one or more canonical payload variants.
test("batch import re-encodes every variant under its generated Local name", async function() {
    const localPayload = multiVariantHero.replace(baseStats, `1U${baseStats.slice(2)}`);
    const existingBytes = Buffer.byteLength(multiVariantHero, "utf8");
    const {service, state} = createHarness({
        useRealProfileBoundary: true,
        profiles: [profile({payload: multiVariantHero, payloadBytes: existingBytes})]
    });

    const result = await service.importProfiles(auth, {
        idempotencyKey: "real-rename-key",
        storageGeneration: 1,
        replacePreferences: false,
        profiles: [{name: "Hero", payload: localPayload}]
    });
    const codec = await import("../shared/builder-codec.mjs");
    const inserted = state.profiles.find(value => value.id === "created-id");

    assert.deepEqual(result.renamed, [{from: "Hero", to: "Hero Local"}]);
    assert.deepEqual(codec.decodeBuilderEntries(inserted.payload).map(entry => entry.name), [
        "Hero Local", "Hero Local"
    ]);
    assert.equal(inserted.payloadBytes, Buffer.byteLength(inserted.payload, "utf8"));
    await validateBuilderProfile({name: "Hero Local", payload: inserted.payload});
});
