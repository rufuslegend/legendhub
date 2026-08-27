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
const blanks35 = "_".repeat(35);
const multiVariantHero = `6*Hero~Tank~${baseStats}000000___00000000000000000${blanks35}*` +
    `Hero~Caster~${baseStats}000000___00000000000000000${blanks35}*`;

function profile(overrides = {}) {
    return {
        id: "profile-id",
        name: "Hero",
        payload: "canonical-server-payload",
        payloadVersion: 6,
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
    const connection = {kind: "transaction-connection"};
    const pool = {
        getConnection(callback) {
            callback(null, {
                ...connection,
                beginTransaction(done) {
                    events.push("begin");
                    done(null);
                },
                commit(done) {
                    events.push("commit");
                    done(null);
                },
                rollback(done) {
                    events.push("rollback");
                    done(null);
                },
                release() {
                    events.push("release");
                }
            });
        }
    };
    const state = {
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
        calls: []
    };
    let nextId = 0;

    function requireConnection(options) {
        assert.equal(options.executor.kind, connection.kind);
    }

    const repository = {
        async readPreferencesForUpdate(memberId, options) {
            requireConnection(options);
            state.calls.push(["preferences", memberId]);
            if (overrides.readPreferencesError)
                throw overrides.readPreferencesError;
            return state.preferences && {...state.preferences};
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
            if (overrides.insertError)
                throw overrides.insertError;
            state.profiles.push({...value});
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
        async readImportReceipt() {
            state.calls.push(["readImportReceipt"]);
            return null;
        },
        async writeImportReceipt() {
            state.calls.push(["writeImportReceipt"]);
            return 1;
        }
    };
    const validated = overrides.validated || {};
    const validateCalls = [];
    async function validateProfile(input) {
        validateCalls.push(input);
        if (overrides.validationError)
            throw overrides.validationError;
        return {
            name: input.name,
            payload: validated.payload || `canonical-${input.payload}`,
            payloadVersion: validated.payloadVersion || 6,
            byteLength: validated.byteLength === undefined ? 70 : validated.byteLength,
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
    const uuids = ["created-id", "conflict-id", "third-id"];
    const serviceOptions = {
        pool,
        repository,
        clock: () => NOW,
        randomUUID: () => uuids.shift()
    };
    if (!overrides.useRealProfileBoundary) {
        serviceOptions.validateProfile = validateProfile;
        serviceOptions.renameProfile = renameProfile;
    }
    const service = createBuilderStorageService(serviceOptions);
    return {service, repository, state, events, validateCalls};
}

// Catches any storage method querying by profile before enforcing verified
// account access, or accepting a caller-supplied member identity.
test("unverified member cannot read or mutate account storage", async function() {
    const {service, state} = createHarness();
    const unverified = {...auth, emailVerified: false};
    const operations = [
        () => service.readState(unverified),
        () => service.exportAll(unverified),
        () => service.createProfile(unverified, {}),
        () => service.updateProfile(unverified, {}),
        () => service.deleteProfile(unverified, {}),
        () => service.updatePreferences(unverified, {}),
        () => service.deleteAll(unverified, {})
    ];

    for (const operation of operations)
        await assert.rejects(operation(), error => error.extensions.code === 403);
    assert.deepEqual(state.calls, []);
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
            profile({payload: multiVariantHero, payloadBytes: Buffer.byteLength(multiVariantHero)}),
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
    assert.equal(result.conflictProfile.payloadVersion, 6);
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
        profiles: [profile({payload: multiVariantHero, payloadBytes: originalBytes})],
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

// Catches delete-all committing row deletion separately from its generation
// bump, or failing to revision each durable tombstone.
test("delete-all tombstones every active row and bumps generation in one transaction", async function() {
    const first = profile({id: "one", revision: 2, payloadBytes: 20});
    const second = profile({id: "two", revision: 7, payloadBytes: 30});
    const {service, state, events} = createHarness({profiles: [first, second]});

    const result = await service.deleteAll(auth, {storageGeneration: 1});

    assert.equal(result.status, "deleted");
    assert.equal(result.storageGeneration, 2);
    assert.equal(result.usedBytes, 0);
    assert.equal(state.profiles.every(value => value.deletedOn === NOW), true);
    assert.deepEqual(state.profiles.map(value => value.revision), [3, 8]);
    assert.deepEqual(state.calls.map(call => call[0]), [
        "preferences", "list", "markDeleted", "markDeleted", "writePreferences"
    ]);
    assert.equal(state.preferences.storageGeneration, 2);
    assert.deepEqual(events, ["begin", "commit", "release"]);
});
