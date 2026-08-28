"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {Kind, parse} = require("graphql");

async function loadApi() {
    return import("../../client/features/builder/builder-account-api.js");
}

function requestDocument(cookie = "loginToken=account-token") {
    let value = cookie;
    return {
        get cookie() { return value; },
        set cookie(next) { value = next; }
    };
}

function jsonResponse(body, status = 200) {
    return {status, json: async function() { return body; }};
}

async function captureRequest(call, response, document = requestDocument()) {
    const originalFetch = globalThis.fetch;
    let request;
    globalThis.fetch = async function(url, options) {
        request = {url, options};
        return jsonResponse({data: response});
    };
    try {
        const result = await call(document);
        return {request, result};
    }
    finally {
        globalThis.fetch = originalFetch;
    }
}

function inspectRequest(captured, expected) {
    const body = JSON.parse(captured.request.options.body);
    const document = parse(body.query);
    assert.equal(captured.request.url, "/api");
    assert.equal(document.definitions.length, 1);
    const operation = document.definitions[0];
    assert.equal(operation.kind, Kind.OPERATION_DEFINITION);
    assert.equal(operation.operation, expected.operation);
    assert.equal(operation.name.value, expected.name);
    assert.equal(body.query.includes("account-token"), false);
    assert.equal(body.query.includes(expected.userText), false);
    assert.equal(body.query.toLowerCase().includes("memberid"), false);
    assert.deepEqual(Object.fromEntries(operation.variableDefinitions.map(function(definition) {
        function typeName(node) {
            if (node.kind === Kind.NON_NULL_TYPE)
                return `${typeName(node.type)}!`;
            if (node.kind === Kind.LIST_TYPE)
                return `[${typeName(node.type)}]`;
            return node.name.value;
        }
        return [definition.variable.name.value, typeName(definition.type)];
    })), expected.types);
    const field = operation.selectionSet.selections[0];
    assert.equal(field.name.value, expected.field);
    assert.deepEqual(Object.fromEntries(field.arguments.map(function(argument) {
        assert.equal(argument.value.kind, Kind.VARIABLE);
        return [argument.name.value, argument.value.name.value];
    })), Object.fromEntries(Object.keys(expected.variables).map(name => [name, name])));
    assert.deepEqual(body.variables, expected.variables);
}

// Catches account-storage calls inlining credentials or Builder payloads,
// drifting from the Plan 2 operation names, or sending server-owned identity.
test("Builder account API sends every exact protected operation through GraphQL variables", async function(t) {
    const api = await loadApi();
    const profile = {
        id: "profile-id", name: "Hero \"quoted\"", payload: "6*Hero*",
        revision: 4, storageGeneration: 2
    };
    const cases = [
        ["state", document => api.loadBuilderAccountState(document), {
            getBuilderAccountState: {
                profiles: [], preferences: "{}", preferenceRevision: 3,
                storageGeneration: 2, usedBytes: 1, quotaBytes: 10485760
            }
        }, {operation: "query", name: "GetBuilderAccountState", field: "getBuilderAccountState",
            types: {authToken: "String!"}, variables: {authToken: "account-token"}, userText: profile.name}],
        ["export", document => api.exportAccountBuilderData(document), {
            exportBuilderData: "6*Hero*"
        }, {operation: "query", name: "ExportBuilderData", field: "exportBuilderData",
            types: {authToken: "String!"}, variables: {authToken: "account-token"}, userText: profile.name}],
        ["create", document => api.createAccountProfile(profile, document), {
            createBuilderProfile: {status: "saved"}
        }, {operation: "mutation", name: "CreateBuilderProfile", field: "createBuilderProfile",
            types: {authToken: "String!", name: "String!", payload: "String!", storageGeneration: "Int!"},
            variables: {authToken: "account-token", name: profile.name, payload: profile.payload, storageGeneration: 2}, userText: profile.name}],
        ["update", document => api.updateAccountProfile(profile, document), {
            updateBuilderProfile: {status: "saved"}
        }, {operation: "mutation", name: "UpdateBuilderProfile", field: "updateBuilderProfile",
            types: {authToken: "String!", id: "String!", name: "String!", payload: "String!", revision: "Int!", storageGeneration: "Int!"},
            variables: {authToken: "account-token", ...profile}, userText: profile.name}],
        ["delete", document => api.deleteAccountProfile(profile, document), {
            deleteBuilderProfile: {status: "deleted"}
        }, {operation: "mutation", name: "DeleteBuilderProfile", field: "deleteBuilderProfile",
            types: {authToken: "String!", id: "String!", revision: "Int!", storageGeneration: "Int!"},
            variables: {authToken: "account-token", id: profile.id, revision: 4, storageGeneration: 2}, userText: profile.name}],
        ["preferences", document => api.updateAccountPreferences({
            preferences: "{\"theme\":\"dark\"}", storageGeneration: 2
        }, document), {updateBuilderPreferences: {status: "saved"}}, {
            operation: "mutation", name: "UpdateBuilderPreferences", field: "updateBuilderPreferences",
            types: {authToken: "String!", preferences: "String!", storageGeneration: "Int!"},
            variables: {authToken: "account-token", preferences: "{\"theme\":\"dark\"}", storageGeneration: 2}, userText: profile.name
        }],
        ["import", document => api.importAccountProfiles({
            profiles: [{id: profile.id, name: profile.name, payload: profile.payload}],
            preferences: "{\"theme\":\"dark\"}", replacePreferences: true,
            idempotencyKey: "batch-key", storageGeneration: 2
        }, document), {importBuilderProfiles: {result: "{}", state: {profiles: [], preferences: "{}"}}}, {
            operation: "mutation", name: "ImportBuilderProfiles", field: "importBuilderProfiles",
            types: {authToken: "String!", profiles: "[BuilderImportProfileInput!]!", preferences: "String", replacePreferences: "Boolean!", idempotencyKey: "String!", storageGeneration: "Int!"},
            variables: {authToken: "account-token", profiles: [{id: profile.id, name: profile.name, payload: profile.payload}], preferences: "{\"theme\":\"dark\"}", replacePreferences: true, idempotencyKey: "batch-key", storageGeneration: 2}, userText: profile.name
        }],
        ["delete all", document => api.deleteAllAccountBuilderData({storageGeneration: 2}, document), {
            deleteAllBuilderData: {status: "deleted"}
        }, {operation: "mutation", name: "DeleteAllBuilderData", field: "deleteAllBuilderData",
            types: {authToken: "String!", storageGeneration: "Int!"},
            variables: {authToken: "account-token", storageGeneration: 2}, userText: profile.name}]
    ];

    for (const [label, call, response, expected] of cases) {
        await t.test(label, async function() {
            const captured = await captureRequest(call, response);
            inspectRequest(captured, expected);
        });
    }
});
