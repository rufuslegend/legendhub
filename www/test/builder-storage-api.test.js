"use strict";

const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");
const gql = require("graphql");

const {
    createBuilderStorageFields,
    mutationFields,
    queryFields
} = require("../src/routes/api/builder-storage");

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
        loadCodec: async () => ({
            decodeBuilderLists() {
                throw new Error(`invalid ${privatePayload}`);
            }
        }),
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

// Catches the resolver replacing intentional client-actionable statuses or
// reflecting unexpected SQL/payload messages.
test("storage resolvers preserve safe status errors and sanitize unexpected failures", async function() {
    for (const code of [400, 409, 413, 429]) {
        const expected = new gql.GraphQLError(`safe ${code}`, {extensions: {code}});
        const fields = createBuilderStorageFields({
            authenticate: async () => AUTH,
            storageService: {async createProfile() { throw expected; }}
        });
        await assert.rejects(fields.mutationFields.createBuilderProfile.resolve(null, {
            authToken: "selector-validator", name: "Hero", payload: HERO,
            storageGeneration: 2
        }, {ip: "request"}), error => error === expected);
    }

    const privateDiagnostic = "private SQL near Builder payload";
    const fields = createBuilderStorageFields({
        authenticate: async () => AUTH,
        storageService: {
            async createProfile() {
                throw new Error(privateDiagnostic);
            }
        }
    });
    await assert.rejects(fields.mutationFields.createBuilderProfile.resolve(null, {
        authToken: "selector-validator", name: "Hero", payload: HERO,
        storageGeneration: 2
    }, {ip: "request"}), error =>
        error.message === "The request could not be completed." &&
        !error.message.includes(privateDiagnostic));
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
