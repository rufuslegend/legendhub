"use strict";

const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");
const gql = require("graphql");

const {
    BadRequestError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
    PayloadTooLargeError,
    TooManyRequestsError,
    UnauthorizedError
} = require("../src/routes/api/utils");

const {
    createBuilderStorageFields,
    mutationFields,
    queryFields
} = require("../src/routes/api/builder-storage");
const {
    createBuilderProfileRepository
} = require("../src/routes/api/builder-profile-repository");
const {
    createBuilderStorageService
} = require("../src/routes/api/builder-storage-service");

const NOW = new Date("2026-08-27T12:00:00.000Z");
const AUTH = {
    memberId: 73,
    emailVerified: true,
    storageNamespace: "00112233445566778899aabbccddeeff"
};
const BASE_STATS = "0U0U0U0U0U0U";
const BLANK_ITEMS = "_".repeat(35);
const HERO = `6*Hero~Tank~${BASE_STATS}000000___00000000000000000${BLANK_ITEMS}*` +
    `Hero~Caster~${BASE_STATS}000000___00000000000000000${BLANK_ITEMS}*`;
const SCOUT = `6*Scout~Original~${BASE_STATS}000000___00000000000000000${BLANK_ITEMS}*`;
const CANONICAL_DEFAULT_PREFERENCES = {
    version: 1,
    theme: "glass-blue",
    itemsPerPage: 20,
    itemColumns: [],
    builderColumns: {},
    selectedProfileId: null,
    selectedVariant: null
};

function profile(overrides = {}) {
    return {
        id: "profile-id",
        name: "Hero",
        payload: HERO,
        payloadVersion: 6,
        payloadBytes: Buffer.byteLength(HERO, "utf8"),
        revision: 4,
        createdOn: NOW,
        updatedOn: NOW,
        deletedOn: null,
        ...overrides
    };
}

function state(overrides = {}) {
    return {
        profiles: [profile()],
        preferences: {
            documentVersion: 1,
            payload: {
                version: 1,
                theme: "glass-blue",
                itemsPerPage: 20,
                itemColumns: [],
                builderColumns: {"profile-id": ["Slot"]},
                selectedProfileId: "profile-id",
                selectedVariant: "Tank"
            },
            revision: 3,
            storageGeneration: 2,
            updatedOn: NOW
        },
        storageGeneration: 2,
        usedBytes: 417,
        quotaBytes: 10_485_760,
        ...overrides
    };
}

function loadApiRouter() {
    const apiPath = require.resolve("../src/routes/api");
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (request === "sync-rpc")
            return () => () => [];
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        delete require.cache[apiPath];
        return require(apiPath);
    }
    finally {
        Module._load = originalLoad;
    }
}

function createPreferenceStatePool(initial) {
    const calls = [];
    let row = initial ? {
        DocumentVersion: initial.documentVersion,
        Payload: initial.payload,
        Revision: initial.revision,
        StorageGeneration: initial.storageGeneration,
        UpdatedOn: initial.updatedOn
    } : null;
    const connection = {
        beginTransaction(callback) { callback(null); },
        commit(callback) { callback(null); },
        rollback(callback) { callback(null); },
        release() {},
        query(sql, values, callback) {
            calls.push({sql, values});
            if (sql.includes("INSERT IGNORE INTO AccountPreferences")) {
                if (!row) {
                    row = {
                        DocumentVersion: 1,
                        Payload: values[1],
                        Revision: 1,
                        StorageGeneration: 1,
                        UpdatedOn: NOW
                    };
                }
                callback(null, {affectedRows: 1});
                return;
            }
            if (sql.includes("UPDATE AccountPreferences")) {
                row.DocumentVersion = 1;
                row.Payload = values[0];
                callback(null, {affectedRows: 1});
                return;
            }
            if (sql.includes("FROM AccountPreferences")) {
                callback(null, row ? [{...row}] : []);
                return;
            }
            if (sql.includes("SUM(PayloadBytes)")) {
                callback(null, [{UsedBytes: 0}]);
                return;
            }
            if (sql.includes("FROM BuilderProfiles")) {
                callback(null, []);
                return;
            }
            callback(new Error("Unexpected Builder storage SQL in fresh-state test."));
        }
    };
    return {
        calls,
        getConnection(callback) { callback(null, connection); },
        storedPayload() { return row?.Payload; }
    };
}

// Catches any protected storage operation accepting a caller-owned account
// identity or replacing explicit scalar/input fields with an unbounded JSON
// scalar.
test("storage API derives ownership from auth and never exposes MemberId arguments", function() {
    const fields = {...queryFields, ...mutationFields};
    for (const operation of Object.values(fields)) {
        for (const name of Object.keys(operation.args || {}))
            assert.notEqual(name.toLowerCase(), "memberid");
        for (const argument of Object.values(operation.args || {})) {
            const namedType = gql.getNamedType(argument.type);
            assert.notEqual(namedType.name, "JSON");
            assert.equal(
                gql.isScalarType(namedType) || gql.isInputObjectType(namedType),
                true
            );
        }
    }
});

// Catches a field module existing without being imported into the production
// GraphQL schema.
test("production schema exposes every Builder storage operation", function() {
    const schema = loadApiRouter().schema;
    assert.ok(schema);
    const queries = schema.getQueryType().getFields();
    const mutations = schema.getMutationType().getFields();

    assert.ok(queries.getBuilderAccountState);
    assert.ok(queries.getBuilderAccountSummary);
    assert.ok(queries.getBuilderAccountPreferences);
    assert.ok(queries.exportBuilderData);
    for (const name of [
        "createBuilderProfile",
        "updateBuilderProfile",
        "deleteBuilderProfile",
        "updateBuilderPreferences",
        "importBuilderProfiles",
        "deleteAllBuilderData"
    ]) {
        assert.ok(mutations[name], `${name} is missing from the schema`);
    }
});

// Catches a reachable result/input field silently changing nullability or
// widening to JSON/MemberId even when the eight top-level operation names remain.
test("production storage schema keeps its exact recursive bounded contract", function() {
    const schema = loadApiRouter().schema;
    const operations = {
        getBuilderAccountPreferences: ["BuilderAccountPreferences!", {authToken: "String!"}],
        getBuilderAccountSummary: ["BuilderAccountSummary!", {authToken: "String!"}],
        getBuilderAccountState: ["BuilderAccountState!", {authToken: "String!"}],
        exportBuilderData: ["String!", {authToken: "String!"}],
        createBuilderProfile: ["BuilderProfileResult!", {
            authToken: "String!", name: "String!", payload: "String!", storageGeneration: "Int!"
        }],
        updateBuilderProfile: ["BuilderProfileResult!", {
            authToken: "String!", id: "String!", name: "String!", payload: "String!",
            revision: "Int!", storageGeneration: "Int!"
        }],
        deleteBuilderProfile: ["BuilderProfileResult!", {
            authToken: "String!", id: "String!", revision: "Int!", storageGeneration: "Int!"
        }],
        updateBuilderPreferences: ["BuilderPreferencesResult!", {
            authToken: "String!", preferences: "String!", storageGeneration: "Int!"
        }],
        importBuilderProfiles: ["BuilderImportResult!", {
            authToken: "String!", profiles: "[BuilderImportProfileInput!]!",
            preferences: "String", replacePreferences: "Boolean!",
            idempotencyKey: "String!", storageGeneration: "Int!"
        }],
        deleteAllBuilderData: ["BuilderDeleteAllResult!", {
            authToken: "String!", storageGeneration: "Int!"
        }]
    };
    const expectedTypes = {
        BuilderAccountPreferences: {
            preferences: "String!", preferenceRevision: "Int!",
            storageGeneration: "Int!"
        },
        BuilderProfileSummary: {
            id: "String!", name: "String!", revision: "Int!", updatedOn: "DateTime!"
        },
        BuilderAccountSummary: {
            profiles: "[BuilderProfileSummary!]!", profileCount: "Int!",
            storageGeneration: "Int!", usedBytes: "Int!", quotaBytes: "Int!"
        },
        BuilderProfile: {
            id: "String!", name: "String!", payload: "String", payloadVersion: "Int",
            payloadBytes: "Int!", revision: "Int!", createdOn: "DateTime!",
            updatedOn: "DateTime!", deletedOn: "DateTime"
        },
        BuilderAccountState: {
            profiles: "[BuilderProfile!]!", preferences: "String!",
            preferenceRevision: "Int!", preferencesUpdatedOn: "DateTime!",
            storageGeneration: "Int!", usedBytes: "Int!", quotaBytes: "Int!"
        },
        BuilderProfileResult: {
            status: "String!", profile: "BuilderProfile", conflictProfile: "BuilderProfile",
            storageGeneration: "Int!", usedBytes: "Int!", quotaBytes: "Int!"
        },
        BuilderPreferencesResult: {
            status: "String!", preferences: "String!", preferenceRevision: "Int!",
            preferencesUpdatedOn: "DateTime!", storageGeneration: "Int!",
            usedBytes: "Int!", quotaBytes: "Int!"
        },
        BuilderImportProfileInput: {id: "String", name: "String!", payload: "String!"},
        BuilderImportResult: {result: "String!", state: "BuilderAccountState!"},
        BuilderDeleteAllResult: {
            status: "String!", storageGeneration: "Int!", usedBytes: "Int!", quotaBytes: "Int!"
        }
    };
    const query = schema.getQueryType().getFields();
    const mutation = schema.getMutationType().getFields();
    const roots = {...query, ...mutation};

    for (const [name, [type, args]] of Object.entries(operations)) {
        assert.equal(String(roots[name].type), type, name);
        assert.deepEqual(Object.fromEntries(roots[name].args.map(argument => [
            argument.name, String(argument.type)
        ])), args, name);
    }
    for (const [name, expectedFields] of Object.entries(expectedTypes)) {
        const fields = schema.getType(name).getFields();
        assert.deepEqual(Object.fromEntries(Object.entries(fields).map(([fieldName, field]) => [
            fieldName, String(field.type)
        ])), expectedFields, name);
    }

    const visited = new Set();
    function assertBounded(type) {
        const named = gql.getNamedType(type);
        assert.notEqual(named.name, "JSON");
        if (visited.has(named.name))
            return;
        visited.add(named.name);
        if (!gql.isObjectType(named) && !gql.isInputObjectType(named))
            return;
        for (const [name, field] of Object.entries(named.getFields())) {
            assert.notEqual(name.toLowerCase(), "memberid");
            for (const argument of field.args || []) {
                assert.notEqual(argument.name.toLowerCase(), "memberid");
                assertBounded(argument.type);
            }
            assertBounded(field.type);
        }
    }
    for (const name of Object.keys(operations)) {
        assertBounded(roots[name].type);
        for (const argument of roots[name].args)
            assertBounded(argument.type);
    }
});

// Catches the Account settings resolver delegating to the full payload-bearing
// state path or widening the protected summary projection.
test("account storage summary exposes metadata only", async function() {
    const fields = createBuilderStorageFields({
        authenticate: async () => AUTH,
        storageService: {
            async readSummary() {
                return {
                    profiles: [{
                        id: "profile-id",
                        name: "Hero",
                        revision: 4,
                        updatedOn: NOW,
                        payload: "private-profile-payload",
                        memberId: 73
                    }],
                    profileCount: 1,
                    storageGeneration: 2,
                    usedBytes: 417,
                    quotaBytes: 10_485_760,
                    preferences: {payload: {theme: "private-preference"}}
                };
            }
        }
    });

    const result = await fields.queryFields.getBuilderAccountSummary.resolve(
        null, {authToken: "summary-token"}, {ip: "request"}
    );

    assert.deepEqual(result, {
        profiles: [{
            id: "profile-id",
            name: "Hero",
            revision: 4,
            updatedOn: NOW
        }],
        profileCount: 1,
        storageGeneration: 2,
        usedBytes: 417,
        quotaBytes: 10_485_760
    });
    assert.equal(JSON.stringify(result).includes("private-profile-payload"), false);
    assert.equal(JSON.stringify(result).includes("private-preference"), false);
});

// Catches preference documents being exposed as mutable server objects or
// losing their independently versioned account metadata.
test("account state returns a canonical preference string and typed quota metadata", async function() {
    const expectedState = state();
    const fields = createBuilderStorageFields({
        authenticate: async () => AUTH,
        storageService: {
            async readState() {
                return expectedState;
            }
        }
    });

    const result = await fields.queryFields.getBuilderAccountState.resolve(
        null, {authToken: "selector-validator"}, {ip: "request"}
    );

    assert.equal(result.preferences,
        "{\"version\":1,\"theme\":\"glass-blue\",\"itemsPerPage\":20," +
        "\"itemColumns\":[],\"builderColumns\":{\"profile-id\":[\"Slot\"]}," +
        "\"selectedProfileId\":\"profile-id\",\"selectedVariant\":\"Tank\"}");
    assert.equal(result.preferenceRevision, 3);
    assert.equal(result.preferencesUpdatedOn, NOW);
    assert.equal(result.storageGeneration, 2);
    assert.equal(result.usedBytes, 417);
    assert.equal(result.quotaBytes, 10_485_760);
    assert.equal(Object.hasOwn(result.profiles[0], "memberId"), false);
});

// Catches the preference-only resolver delegating to full account state or
// widening its response with profiles, usage, identity, or raw payload data.
test("account preference bootstrap returns only canonical preference metadata", async function() {
    const fields = createBuilderStorageFields({
        authenticate: async () => AUTH,
        storageService: {
            async readPreferences() {
                return {
                    preferences: state().preferences,
                    storageGeneration: 2,
                    profiles: [{payload: "private-profile-payload"}],
                    usedBytes: 417
                };
            }
        }
    });

    const result = await fields.queryFields.getBuilderAccountPreferences.resolve(
        null, {authToken: "selector-validator"}, {ip: "request"}
    );

    assert.deepEqual(result, {
        preferences: JSON.stringify(state().preferences.payload),
        preferenceRevision: 3,
        storageGeneration: 2
    });
    assert.equal(JSON.stringify(result).includes("private-profile-payload"), false);
    assert.equal(Object.hasOwn(result, "usedBytes"), false);
});

// Catches a fresh seed or an older empty preference row exposing `{}` at any
// point from SQL persistence through the authenticated GraphQL response.
test("fresh and migrated-empty accounts expose the complete canonical preference document", async function(t) {
    const cases = [
        ["fresh account", null, {revision: 1, storageGeneration: 1, updatedOn: NOW}],
        ["migrated empty row", {
            documentVersion: 1,
            payload: "{}",
            revision: 7,
            storageGeneration: 3,
            updatedOn: new Date("2026-08-20T12:00:00.000Z")
        }, {
            revision: 7,
            storageGeneration: 3,
            updatedOn: new Date("2026-08-20T12:00:00.000Z")
        }]
    ];

    for (const [label, initial, expectedMetadata] of cases) {
        await t.test(label, async function() {
            const pool = createPreferenceStatePool(initial);
            const repository = createBuilderProfileRepository({pool});
            const service = createBuilderStorageService({pool, repository});
            const fields = createBuilderStorageFields({
                authenticate: async () => AUTH,
                storageService: service
            });

            const result = await fields.queryFields.getBuilderAccountState.resolve(
                null, {authToken: "selector-validator"}, {ip: "request"}
            );

            assert.equal(result.preferences, JSON.stringify(CANONICAL_DEFAULT_PREFERENCES));
            assert.equal(pool.storedPayload(), JSON.stringify(CANONICAL_DEFAULT_PREFERENCES));
            assert.equal(result.preferenceRevision, expectedMetadata.revision);
            assert.equal(result.storageGeneration, expectedMetadata.storageGeneration);
            assert.equal(result.preferencesUpdatedOn.getTime(), expectedMetadata.updatedOn.getTime());
            assert.deepEqual(result.profiles, []);
            assert.equal(result.usedBytes, 0);
        });
    }
});

// Catches stale edits dropping either copy or a resolver translating a safe
// service result into a raw database failure.
test("profile conflict returns both safe copies and no raw database error", async function() {
    const serverProfile = profile();
    const conflictProfile = profile({
        id: "conflict-id",
        name: "Hero Conflict",
        revision: 1
    });
    const fields = createBuilderStorageFields({
        authenticate: async () => AUTH,
        storageService: {
            async updateProfile() {
                return {
                    status: "conflict",
                    profile: serverProfile,
                    conflictProfile,
                    storageGeneration: 2,
                    usedBytes: 834,
                    quotaBytes: 10_485_760
                };
            }
        }
    });

    const result = await fields.mutationFields.updateBuilderProfile.resolve(null, {
        authToken: "selector-validator",
        id: "profile-id",
        name: "Hero",
        payload: "client-payload",
        revision: 3,
        storageGeneration: 2
    }, {ip: "request"});

    assert.equal(result.status, "conflict");
    assert.equal(result.profile.name, "Hero");
    assert.equal(result.conflictProfile.name, "Hero Conflict");
    assert.equal(JSON.stringify(result).includes("MemberId"), false);
});

// Catches token rotation, skipped authentication, multiple service calls, or
// resolver-specific ownership rules drifting between operations.
test("every storage resolver authenticates without renewal then calls one service operation", async function(t) {
    const request = {ip: "request"};
    const scenarios = [
        ["queryFields", "getBuilderAccountPreferences", "readPreferences", {
            authToken: "preference-read-token"
        }, {
            preferences: state().preferences,
            storageGeneration: 2
        }],
        ["queryFields", "getBuilderAccountSummary", "readSummary", {
            authToken: "summary-token"
        }, {
            profiles: [], profileCount: 0, storageGeneration: 2,
            usedBytes: 0, quotaBytes: 10_485_760
        }],
        ["queryFields", "getBuilderAccountState", "readState", {
            authToken: "read-token"
        }, state()],
        ["queryFields", "exportBuilderData", "exportAll", {
            authToken: "export-token"
        }, state({profiles: []})],
        ["mutationFields", "createBuilderProfile", "createProfile", {
            authToken: "create-token", name: "Hero", payload: HERO,
            storageGeneration: 2
        }, {status: "saved"}],
        ["mutationFields", "updateBuilderProfile", "updateProfile", {
            authToken: "update-token", id: "profile-id", name: "Hero",
            payload: HERO, revision: 4, storageGeneration: 2
        }, {status: "saved"}],
        ["mutationFields", "deleteBuilderProfile", "deleteProfile", {
            authToken: "delete-token", id: "profile-id", revision: 4,
            storageGeneration: 2
        }, {status: "deleted"}],
        ["mutationFields", "updateBuilderPreferences", "updatePreferences", {
            authToken: "preference-token", preferences: "{\"theme\":\"dark\"}",
            storageGeneration: 2
        }, {
            status: "saved",
            preferences: {
                payload: {version: 1, theme: "dark"},
                revision: 4,
                updatedOn: NOW
            },
            storageGeneration: 2,
            usedBytes: 417,
            quotaBytes: 10_485_760
        }],
        ["mutationFields", "importBuilderProfiles", "importProfiles", {
            authToken: "import-token",
            profiles: [{id: "local-id", name: "Hero", payload: HERO}],
            preferences: "{\"theme\":\"dark\"}",
            replacePreferences: true,
            idempotencyKey: "import-key",
            storageGeneration: 2
        }, {
            copied: ["Hero"], renamed: [], deduplicated: [], rejected: [],
            preferencesImported: true, state: state()
        }],
        ["mutationFields", "deleteAllBuilderData", "deleteAll", {
            authToken: "delete-all-token", storageGeneration: 2
        }, {
            status: "deleted", storageGeneration: 3, usedBytes: 0,
            quotaBytes: 10_485_760
        }]
    ];

    for (const [fieldGroup, fieldName, serviceMethod, args, serviceResult] of scenarios) {
        await t.test(fieldName, async function() {
            const calls = [];
            const storageService = {
                async [serviceMethod](...values) {
                    calls.push([serviceMethod, ...values]);
                    return serviceResult;
                }
            };
            const fields = createBuilderStorageFields({
                authenticate: async (...values) => {
                    calls.push(["authenticate", ...values]);
                    return AUTH;
                },
                loadCodec: async () => ({
                    decodeBuilderLists() { return []; },
                    encodeBuilderLists() { return "6*"; }
                }),
                storageService
            });

            await fields[fieldGroup][fieldName].resolve(null, args, request);

            assert.deepEqual(calls[0], [
                "authenticate", request, args.authToken, {renew: false}
            ]);
            assert.equal(calls.filter(([name]) => name === serviceMethod).length, 1);
            assert.equal(calls[1][1], AUTH);
        });
    }
});

// Catches export returning stored row fragments directly, dropping variants,
// or serializing an empty account in an obsolete Builder format.
test("export combines every active profile and variant in current canonical format", async function() {
    const codec = await import("../shared/builder-codec.mjs");
    const exportedState = state({
        profiles: [
            profile(),
            profile({id: "scout-id", name: "Scout", payload: SCOUT})
        ]
    });
    const fields = createBuilderStorageFields({
        authenticate: async () => AUTH,
        loadCodec: async () => codec,
        storageService: {
            async exportAll() {
                return exportedState;
            }
        }
    });

    const value = await fields.queryFields.exportBuilderData.resolve(
        null, {authToken: "selector-validator"}, {ip: "request"}
    );
    const decoded = codec.decodeBuilderLists(value);

    assert.match(value, /^6\*/);
    assert.deepEqual(decoded.map(list => list.name), ["Hero", "Scout"]);
    assert.deepEqual(decoded[0].variants.map(variant => variant.name), ["Tank", "Caster"]);
    assert.equal(value, codec.encodeBuilderLists(decoded));

    const emptyFields = createBuilderStorageFields({
        authenticate: async () => AUTH,
        loadCodec: async () => codec,
        storageService: {async exportAll() { return state({profiles: []}); }}
    });
    assert.equal(await emptyFields.queryFields.exportBuilderData.resolve(
        null, {authToken: "selector-validator"}, {ip: "request"}
    ), "6*");
});

// Catches a malformed stored row reflecting account payload data through a
// codec diagnostic.
test("export sanitizes unexpected stored payload failures", async function() {
    const privatePayload = "private-account-builder-payload";
    const fields = createBuilderStorageFields({
        authenticate: async () => AUTH,
        storageService: {
            async exportAll() {
                return state({profiles: [profile({payload: privatePayload})]});
            }
        }
    });

    await assert.rejects(fields.queryFields.exportBuilderData.resolve(
        null, {authToken: "selector-validator"}, {ip: "request"}
    ), error => error.message === "The request could not be completed." &&
        !error.message.includes(privatePayload));
});

// Catches export trusting the row payload instead of re-applying the canonical
// one-character/name-matching server contract used for writes.
test("export rejects mismatched and multi-character stored rows generically", async function() {
    const corruptRows = [
        profile({name: "Private Mismatched Row"}),
        profile({payload: HERO + SCOUT.slice(2)})
    ];

    for (const corruptRow of corruptRows) {
        const fields = createBuilderStorageFields({
            authenticate: async () => AUTH,
            storageService: {
                async exportAll() {
                    return state({profiles: [corruptRow]});
                }
            }
        });

        await assert.rejects(fields.queryFields.exportBuilderData.resolve(
            null, {authToken: "selector-validator"}, {ip: "request"}
        ), error => error.message === "The request could not be completed." &&
            error.extensions.code === undefined &&
            !error.message.includes(corruptRow.name) &&
            !error.message.includes(corruptRow.payload));
    }
});

// Catches the resolver replacing intentional client-actionable statuses or
// reflecting unexpected SQL/payload messages.
test("storage resolvers preserve known safe application errors without private metadata", async function() {
    assert.equal(typeof ForbiddenError, "function");
    const expectedErrors = [
        new BadRequestError("The Builder profile is invalid."),
        new UnauthorizedError("Invalid token"),
        new ForbiddenError("A verified account is required."),
        new NotFoundError("Profile not found."),
        new ConflictError("Profile changed before it could be saved."),
        new PayloadTooLargeError("Builder account storage is limited to 10 MB."),
        new TooManyRequestsError("Try again later.")
    ];
    for (const expected of expectedErrors) {
        expected.extensions.privateDriverMetadata = "must-not-cross-boundary";
        expected.cause = new Error("private application cause");
        const fields = createBuilderStorageFields({
            authenticate: async () => AUTH,
            storageService: {async createProfile() { throw expected; }}
        });
        await assert.rejects(fields.mutationFields.createBuilderProfile.resolve(null, {
            authToken: "selector-validator", name: "Hero", payload: HERO,
            storageGeneration: 2
        }, {ip: "request"}), error => error !== expected &&
            error.message === expected.message &&
            error.extensions.code === expected.extensions.code &&
            Object.keys(error.extensions).length === 1 &&
            error.cause === undefined);
    }
});

// Catches arbitrary token, SQL, or codec errors laundering private diagnostics
// through an allowlisted numeric code.
test("coded token SQL and codec failures are always generic", async function() {
    const privateDiagnostic = "private-selector private SQL private codec payload";
    const codedError = code => new gql.GraphQLError(privateDiagnostic, {
        extensions: {code, privateDriverMetadata: privateDiagnostic},
        originalError: new Error(privateDiagnostic)
    });
    const privateTypedTokenError = new UnauthorizedError(privateDiagnostic);
    privateTypedTokenError.extensions.privateDriverMetadata = privateDiagnostic;
    const untypedSafeMessageError = new gql.GraphQLError("Invalid token", {
        extensions: {code: 401, privateDriverMetadata: privateDiagnostic},
        originalError: new Error(privateDiagnostic)
    });
    const privateDriverError = Object.assign(new Error(privateDiagnostic), {
        cause: new Error(privateDiagnostic),
        extensions: {code: 409, privateDriverMetadata: privateDiagnostic}
    });
    const mutationArgs = {
        authToken: "selector-validator", name: "Hero", payload: HERO,
        storageGeneration: 2
    };
    const attempts = [
        [createBuilderStorageFields({
            authenticate: async () => { throw codedError(401); },
            storageService: {}
        }).mutationFields.createBuilderProfile, mutationArgs],
        [createBuilderStorageFields({
            authenticate: async () => { throw untypedSafeMessageError; },
            storageService: {}
        }).mutationFields.createBuilderProfile, mutationArgs],
        [createBuilderStorageFields({
            authenticate: async () => { throw privateTypedTokenError; },
            storageService: {}
        }).mutationFields.createBuilderProfile, mutationArgs],
        [createBuilderStorageFields({
            authenticate: async () => AUTH,
            storageService: {
                async createProfile() { throw privateDriverError; }
            }
        }).mutationFields.createBuilderProfile, mutationArgs],
        [createBuilderStorageFields({
            authenticate: async () => AUTH,
            loadCodec: async () => ({
                encodeBuilderLists() { throw codedError(400); }
            }),
            storageService: {
                async exportAll() { return state({profiles: [profile()]}); }
            }
        }).queryFields.exportBuilderData, {authToken: "selector-validator"}]
    ];

    for (const [operation, args] of attempts) {
        await assert.rejects(operation.resolve(null, args, {ip: "request"}), error =>
            error.message === "The request could not be completed." &&
            error.extensions.code === undefined &&
            error.originalError === undefined &&
            error.cause === undefined &&
            !error.message.includes(privateDiagnostic));
    }
});

// Catches invalid JSON being forwarded to the service or echoing the submitted
// preference document from a parser error.
test("preference JSON strings fail safely before storage", async function() {
    const privateDocument = "{private malformed preference";
    let calls = 0;
    const fields = createBuilderStorageFields({
        authenticate: async () => AUTH,
        storageService: {
            async updatePreferences() {
                calls += 1;
            }
        }
    });

    await assert.rejects(fields.mutationFields.updateBuilderPreferences.resolve(null, {
        authToken: "selector-validator",
        preferences: privateDocument,
        storageGeneration: 2
    }, {ip: "request"}), error => error.extensions.code === 400 &&
        !error.message.includes(privateDocument));
    assert.equal(calls, 0);
});
