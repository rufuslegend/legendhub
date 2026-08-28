"use strict";

const gql = require("graphql");
const {GraphQLDateTime} = require("graphql-scalars");
const auth = require("./auth");
const mysql = require("./mysql-connection");
const {createBuilderStorageService} = require("./builder-storage-service");
const {BadRequestError} = require("./utils");

const SAFE_ERROR_CODES = new Set([400, 401, 403, 404, 409, 413, 429]);
const storageService = createBuilderStorageService({pool: mysql});
let codecPromise;

function loadCodec() {
    codecPromise ||= import("../../../shared/builder-codec.mjs");
    return codecPromise;
}

function canonicalJson(value) {
    return JSON.stringify(value);
}

function parsePreferenceDocument(value) {
    try {
        return JSON.parse(value);
    }
    catch {
        throw new BadRequestError("The preference payload is invalid.");
    }
}

function publicProfile(profile) {
    if (!profile)
        return null;
    const {memberId, MemberId, ...result} = profile;
    return result;
}

function accountStateResult(state) {
    return {
        profiles: state.profiles.map(publicProfile),
        preferences: canonicalJson(state.preferences.payload),
        preferenceRevision: state.preferences.revision,
        preferencesUpdatedOn: state.preferences.updatedOn,
        storageGeneration: state.storageGeneration,
        usedBytes: state.usedBytes,
        quotaBytes: state.quotaBytes
    };
}

function profileResult(result) {
    return {
        status: result.status,
        profile: publicProfile(result.profile),
        conflictProfile: publicProfile(result.conflictProfile),
        storageGeneration: result.storageGeneration,
        usedBytes: result.usedBytes,
        quotaBytes: result.quotaBytes
    };
}

function preferencesResult(result) {
    return {
        status: result.status,
        preferences: canonicalJson(result.preferences.payload),
        preferenceRevision: result.preferences.revision,
        preferencesUpdatedOn: result.preferences.updatedOn,
        storageGeneration: result.storageGeneration,
        usedBytes: result.usedBytes,
        quotaBytes: result.quotaBytes
    };
}

function importResult(result) {
    const {state, ...summary} = result;
    return {
        result: canonicalJson(summary),
        state: accountStateResult(state)
    };
}

async function authenticatedRequest({authenticate, req, authToken, operation}) {
    try {
        const authenticated = await authenticate(req, authToken, {renew: false});
        return await operation(authenticated);
    }
    catch (error) {
        if (SAFE_ERROR_CODES.has(error?.extensions?.code))
            throw error;
        throw new gql.GraphQLError("The request could not be completed.");
    }
}

const builderProfileType = new gql.GraphQLObjectType({
    name: "BuilderProfile",
    fields: () => ({
        id: {type: new gql.GraphQLNonNull(gql.GraphQLString)},
        name: {type: new gql.GraphQLNonNull(gql.GraphQLString)},
        payload: {type: gql.GraphQLString},
        payloadVersion: {type: gql.GraphQLInt},
        payloadBytes: {type: new gql.GraphQLNonNull(gql.GraphQLInt)},
        revision: {type: new gql.GraphQLNonNull(gql.GraphQLInt)},
        createdOn: {type: new gql.GraphQLNonNull(GraphQLDateTime)},
        updatedOn: {type: new gql.GraphQLNonNull(GraphQLDateTime)},
        deletedOn: {type: GraphQLDateTime}
    })
});

const builderAccountStateType = new gql.GraphQLObjectType({
    name: "BuilderAccountState",
    fields: () => ({
        profiles: {
            type: new gql.GraphQLNonNull(new gql.GraphQLList(
                new gql.GraphQLNonNull(builderProfileType)
            ))
        },
        preferences: {type: new gql.GraphQLNonNull(gql.GraphQLString)},
        preferenceRevision: {type: new gql.GraphQLNonNull(gql.GraphQLInt)},
        preferencesUpdatedOn: {type: new gql.GraphQLNonNull(GraphQLDateTime)},
        storageGeneration: {type: new gql.GraphQLNonNull(gql.GraphQLInt)},
        usedBytes: {type: new gql.GraphQLNonNull(gql.GraphQLInt)},
        quotaBytes: {type: new gql.GraphQLNonNull(gql.GraphQLInt)}
    })
});

const builderProfileResultType = new gql.GraphQLObjectType({
    name: "BuilderProfileResult",
    fields: () => ({
        status: {type: new gql.GraphQLNonNull(gql.GraphQLString)},
        profile: {type: builderProfileType},
        conflictProfile: {type: builderProfileType},
        storageGeneration: {type: new gql.GraphQLNonNull(gql.GraphQLInt)},
        usedBytes: {type: new gql.GraphQLNonNull(gql.GraphQLInt)},
        quotaBytes: {type: new gql.GraphQLNonNull(gql.GraphQLInt)}
    })
});

const builderPreferencesResultType = new gql.GraphQLObjectType({
    name: "BuilderPreferencesResult",
    fields: () => ({
        status: {type: new gql.GraphQLNonNull(gql.GraphQLString)},
        preferences: {type: new gql.GraphQLNonNull(gql.GraphQLString)},
        preferenceRevision: {type: new gql.GraphQLNonNull(gql.GraphQLInt)},
        preferencesUpdatedOn: {type: new gql.GraphQLNonNull(GraphQLDateTime)},
        storageGeneration: {type: new gql.GraphQLNonNull(gql.GraphQLInt)},
        usedBytes: {type: new gql.GraphQLNonNull(gql.GraphQLInt)},
        quotaBytes: {type: new gql.GraphQLNonNull(gql.GraphQLInt)}
    })
});

const builderImportProfileInputType = new gql.GraphQLInputObjectType({
    name: "BuilderImportProfileInput",
    fields: () => ({
        id: {type: gql.GraphQLString},
        name: {type: new gql.GraphQLNonNull(gql.GraphQLString)},
        payload: {type: new gql.GraphQLNonNull(gql.GraphQLString)}
    })
});

const builderImportResultType = new gql.GraphQLObjectType({
    name: "BuilderImportResult",
    fields: () => ({
        result: {type: new gql.GraphQLNonNull(gql.GraphQLString)},
        state: {type: new gql.GraphQLNonNull(builderAccountStateType)}
    })
});

const builderDeleteAllResultType = new gql.GraphQLObjectType({
    name: "BuilderDeleteAllResult",
    fields: () => ({
        status: {type: new gql.GraphQLNonNull(gql.GraphQLString)},
        storageGeneration: {type: new gql.GraphQLNonNull(gql.GraphQLInt)},
        usedBytes: {type: new gql.GraphQLNonNull(gql.GraphQLInt)},
        quotaBytes: {type: new gql.GraphQLNonNull(gql.GraphQLInt)}
    })
});

const authTokenArgument = {
    authToken: {type: new gql.GraphQLNonNull(gql.GraphQLString)}
};

function createBuilderStorageFields({
    authenticate = auth.utils.authenticate,
    loadCodec: codecLoader = loadCodec,
    storageService: service = storageService
} = {}) {
    const queryFields = {
        getBuilderAccountState: {
            type: new gql.GraphQLNonNull(builderAccountStateType),
            args: {...authTokenArgument},
            resolve: function(_, {authToken}, req) {
                return authenticatedRequest({
                    authenticate,
                    req,
                    authToken,
                    operation: async authenticated => accountStateResult(
                        await service.readState(authenticated)
                    )
                });
            }
        },
        exportBuilderData: {
            type: new gql.GraphQLNonNull(gql.GraphQLString),
            args: {...authTokenArgument},
            resolve: function(_, {authToken}, req) {
                return authenticatedRequest({
                    authenticate,
                    req,
                    authToken,
                    operation: async authenticated => {
                        const snapshot = await service.exportAll(authenticated);
                        const codec = await codecLoader();
                        const lists = snapshot.profiles.flatMap(profile =>
                            codec.decodeBuilderLists(profile.payload)
                        );
                        return codec.encodeBuilderLists(lists);
                    }
                });
            }
        }
    };

    const mutationFields = {
        createBuilderProfile: {
            type: new gql.GraphQLNonNull(builderProfileResultType),
            args: {
                ...authTokenArgument,
                name: {type: new gql.GraphQLNonNull(gql.GraphQLString)},
                payload: {type: new gql.GraphQLNonNull(gql.GraphQLString)},
                storageGeneration: {type: new gql.GraphQLNonNull(gql.GraphQLInt)}
            },
            resolve: function(_, {authToken, ...input}, req) {
                return authenticatedRequest({
                    authenticate,
                    req,
                    authToken,
                    operation: async authenticated => profileResult(
                        await service.createProfile(authenticated, input)
                    )
                });
            }
        },
        updateBuilderProfile: {
            type: new gql.GraphQLNonNull(builderProfileResultType),
            args: {
                ...authTokenArgument,
                id: {type: new gql.GraphQLNonNull(gql.GraphQLString)},
                name: {type: new gql.GraphQLNonNull(gql.GraphQLString)},
                payload: {type: new gql.GraphQLNonNull(gql.GraphQLString)},
                revision: {type: new gql.GraphQLNonNull(gql.GraphQLInt)},
                storageGeneration: {type: new gql.GraphQLNonNull(gql.GraphQLInt)}
            },
            resolve: function(_, {authToken, ...input}, req) {
                return authenticatedRequest({
                    authenticate,
                    req,
                    authToken,
                    operation: async authenticated => profileResult(
                        await service.updateProfile(authenticated, input)
                    )
                });
            }
        },
        deleteBuilderProfile: {
            type: new gql.GraphQLNonNull(builderProfileResultType),
            args: {
                ...authTokenArgument,
                id: {type: new gql.GraphQLNonNull(gql.GraphQLString)},
                revision: {type: new gql.GraphQLNonNull(gql.GraphQLInt)},
                storageGeneration: {type: new gql.GraphQLNonNull(gql.GraphQLInt)}
            },
            resolve: function(_, {authToken, ...input}, req) {
                return authenticatedRequest({
                    authenticate,
                    req,
                    authToken,
                    operation: async authenticated => profileResult(
                        await service.deleteProfile(authenticated, input)
                    )
                });
            }
        },
        updateBuilderPreferences: {
            type: new gql.GraphQLNonNull(builderPreferencesResultType),
            args: {
                ...authTokenArgument,
                preferences: {type: new gql.GraphQLNonNull(gql.GraphQLString)},
                storageGeneration: {type: new gql.GraphQLNonNull(gql.GraphQLInt)}
            },
            resolve: function(_, {authToken, preferences, storageGeneration}, req) {
                return authenticatedRequest({
                    authenticate,
                    req,
                    authToken,
                    operation: async authenticated => preferencesResult(
                        await service.updatePreferences(authenticated, {
                            payload: parsePreferenceDocument(preferences),
                            storageGeneration
                        })
                    )
                });
            }
        },
        importBuilderProfiles: {
            type: new gql.GraphQLNonNull(builderImportResultType),
            args: {
                ...authTokenArgument,
                profiles: {
                    type: new gql.GraphQLNonNull(new gql.GraphQLList(
                        new gql.GraphQLNonNull(builderImportProfileInputType)
                    ))
                },
                preferences: {type: gql.GraphQLString},
                replacePreferences: {type: new gql.GraphQLNonNull(gql.GraphQLBoolean)},
                idempotencyKey: {type: new gql.GraphQLNonNull(gql.GraphQLString)},
                storageGeneration: {type: new gql.GraphQLNonNull(gql.GraphQLInt)}
            },
            resolve: function(_, {
                authToken,
                profiles,
                preferences,
                replacePreferences,
                idempotencyKey,
                storageGeneration
            }, req) {
                return authenticatedRequest({
                    authenticate,
                    req,
                    authToken,
                    operation: async authenticated => importResult(
                        await service.importProfiles(authenticated, {
                            profiles,
                            preferencePayload: preferences === undefined || preferences === null
                                ? undefined
                                : parsePreferenceDocument(preferences),
                            replacePreferences,
                            idempotencyKey,
                            storageGeneration
                        })
                    )
                });
            }
        },
        deleteAllBuilderData: {
            type: new gql.GraphQLNonNull(builderDeleteAllResultType),
            args: {
                ...authTokenArgument,
                storageGeneration: {type: new gql.GraphQLNonNull(gql.GraphQLInt)}
            },
            resolve: function(_, {authToken, storageGeneration}, req) {
                return authenticatedRequest({
                    authenticate,
                    req,
                    authToken,
                    operation: authenticated => service.deleteAll(authenticated, {
                        storageGeneration
                    })
                });
            }
        }
    };

    return {queryFields, mutationFields};
}

const fields = createBuilderStorageFields();

module.exports = {
    createBuilderStorageFields,
    mutationFields: fields.mutationFields,
    queryFields: fields.queryFields,
    types: {
        builderAccountStateType,
        builderDeleteAllResultType,
        builderImportProfileInputType,
        builderImportResultType,
        builderPreferencesResultType,
        builderProfileResultType,
        builderProfileType
    }
};
