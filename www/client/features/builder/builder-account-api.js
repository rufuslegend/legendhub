import {parseCookieHeader} from "../../lib/cookies.js";
import {graphqlRequest} from "../../lib/graphql-request.js";

const profileFields = `
    id
    name
    payload
    payloadVersion
    revision
    updatedOn
`;

const accountStateFields = `
    profiles { ${profileFields} }
    preferences
    preferenceRevision
    preferencesUpdatedOn
    storageGeneration
    usedBytes
    quotaBytes
`;

const profileResultFields = `
    status
    profile { ${profileFields} }
    conflictProfile { ${profileFields} }
    storageGeneration
    usedBytes
    quotaBytes
`;

const preferencesResultFields = `
    status
    preferences
    preferenceRevision
    preferencesUpdatedOn
    storageGeneration
    usedBytes
    quotaBytes
`;

const getBuilderAccountStateQuery = `
    query GetBuilderAccountState($authToken: String!) {
        getBuilderAccountState(authToken: $authToken) { ${accountStateFields} }
    }
`;

const exportBuilderDataQuery = `
    query ExportBuilderData($authToken: String!) {
        exportBuilderData(authToken: $authToken)
    }
`;

const createBuilderProfileMutation = `
    mutation CreateBuilderProfile(
        $authToken: String!
        $name: String!
        $payload: String!
        $storageGeneration: Int!
    ) {
        createBuilderProfile(
            authToken: $authToken
            name: $name
            payload: $payload
            storageGeneration: $storageGeneration
        ) { ${profileResultFields} }
    }
`;

const updateBuilderProfileMutation = `
    mutation UpdateBuilderProfile(
        $authToken: String!
        $id: String!
        $name: String!
        $payload: String!
        $revision: Int!
        $storageGeneration: Int!
    ) {
        updateBuilderProfile(
            authToken: $authToken
            id: $id
            name: $name
            payload: $payload
            revision: $revision
            storageGeneration: $storageGeneration
        ) { ${profileResultFields} }
    }
`;

const deleteBuilderProfileMutation = `
    mutation DeleteBuilderProfile(
        $authToken: String!
        $id: String!
        $revision: Int!
        $storageGeneration: Int!
    ) {
        deleteBuilderProfile(
            authToken: $authToken
            id: $id
            revision: $revision
            storageGeneration: $storageGeneration
        ) { ${profileResultFields} }
    }
`;

const updateBuilderPreferencesMutation = `
    mutation UpdateBuilderPreferences(
        $authToken: String!
        $preferences: String!
        $storageGeneration: Int!
    ) {
        updateBuilderPreferences(
            authToken: $authToken
            preferences: $preferences
            storageGeneration: $storageGeneration
        ) { ${preferencesResultFields} }
    }
`;

const importBuilderProfilesMutation = `
    mutation ImportBuilderProfiles(
        $authToken: String!
        $profiles: [BuilderImportProfileInput!]!
        $preferences: String
        $replacePreferences: Boolean!
        $idempotencyKey: String!
        $storageGeneration: Int!
    ) {
        importBuilderProfiles(
            authToken: $authToken
            profiles: $profiles
            preferences: $preferences
            replacePreferences: $replacePreferences
            idempotencyKey: $idempotencyKey
            storageGeneration: $storageGeneration
        ) {
            result
            state { ${accountStateFields} }
        }
    }
`;

const deleteAllBuilderDataMutation = `
    mutation DeleteAllBuilderData($authToken: String!, $storageGeneration: Int!) {
        deleteAllBuilderData(
            authToken: $authToken
            storageGeneration: $storageGeneration
        ) {
            status
            storageGeneration
            usedBytes
            quotaBytes
        }
    }
`;

function authToken(document) {
    return parseCookieHeader(document.cookie).loginToken;
}

export async function loadBuilderAccountState(document = window.document) {
    const data = await graphqlRequest({
        query: getBuilderAccountStateQuery,
        variables: {authToken: authToken(document)}
    });
    return data.getBuilderAccountState;
}

export async function exportAccountBuilderData(document = window.document) {
    const data = await graphqlRequest({
        query: exportBuilderDataQuery,
        variables: {authToken: authToken(document)}
    });
    return data.exportBuilderData;
}

export async function createAccountProfile(profile, document = window.document) {
    const data = await graphqlRequest({
        query: createBuilderProfileMutation,
        variables: {
            authToken: authToken(document),
            name: profile.name,
            payload: profile.payload,
            storageGeneration: profile.storageGeneration
        }
    });
    return data.createBuilderProfile;
}

export async function updateAccountProfile(profile, document = window.document) {
    const data = await graphqlRequest({
        query: updateBuilderProfileMutation,
        variables: {
            authToken: authToken(document),
            id: profile.id,
            name: profile.name,
            payload: profile.payload,
            revision: profile.revision,
            storageGeneration: profile.storageGeneration
        }
    });
    return data.updateBuilderProfile;
}

export async function deleteAccountProfile(profile, document = window.document) {
    const data = await graphqlRequest({
        query: deleteBuilderProfileMutation,
        variables: {
            authToken: authToken(document),
            id: profile.id,
            revision: profile.revision,
            storageGeneration: profile.storageGeneration
        }
    });
    return data.deleteBuilderProfile;
}

export async function importAccountProfiles(request, document = window.document) {
    const data = await graphqlRequest({
        query: importBuilderProfilesMutation,
        variables: {
            authToken: authToken(document),
            profiles: request.profiles,
            preferences: request.preferences,
            replacePreferences: request.replacePreferences,
            idempotencyKey: request.idempotencyKey,
            storageGeneration: request.storageGeneration
        }
    });
    return data.importBuilderProfiles;
}

export async function updateAccountPreferences(preferences, document = window.document) {
    const data = await graphqlRequest({
        query: updateBuilderPreferencesMutation,
        variables: {
            authToken: authToken(document),
            preferences: preferences.preferences,
            storageGeneration: preferences.storageGeneration
        }
    });
    return data.updateBuilderPreferences;
}

export async function deleteAllAccountBuilderData(state, document = window.document) {
    const data = await graphqlRequest({
        query: deleteAllBuilderDataMutation,
        variables: {
            authToken: authToken(document),
            storageGeneration: state.storageGeneration
        }
    });
    return data.deleteAllBuilderData;
}
