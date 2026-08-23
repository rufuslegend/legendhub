"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {Kind, parse} = require("graphql");

const itemStatCategories = [
    {
        name: "Basic",
        getItemStatInfo: [
            {editable: true, type: "string", var: "name"},
            {editable: true, type: "select", var: "slot"},
            {editable: true, type: "int", var: "rent"},
            {editable: true, type: "decimal", var: "weight"},
            {editable: false, type: "int", var: "netStat"}
        ]
    },
    {
        name: "Weapon",
        getItemStatInfo: [
            {editable: true, type: "int", var: "accuracy"},
            {editable: true, type: "bool", var: "uniqueWear"},
            {editable: true, type: "select", var: "weaponType"}
        ]
    }
];

function documentWithToken(cookie = "loginToken=item-token") {
    let value = cookie;
    return {
        get cookie() { return value; },
        set cookie(next) { value = next; }
    };
}

function jsonResponse(body) {
    return {status: 200, json: async function() { return body; }};
}

function inspectMutation(request, expected) {
    const body = JSON.parse(request.options.body);
    const document = parse(body.query);
    assert.equal(body.query.includes(expected.userText), false,
        "user-entered item text must not appear in GraphQL source");
    const operation = document.definitions[0];
    assert.equal(operation.kind, Kind.OPERATION_DEFINITION);
    assert.equal(operation.operation, "mutation");
    assert.equal(operation.name.value, expected.operation);
    assert.deepEqual(Object.fromEntries(operation.variableDefinitions.map(function(definition) {
        function typeName(node) {
            return node.kind === Kind.NON_NULL_TYPE ? `${typeName(node.type)}!` : node.name.value;
        }
        return [definition.variable.name.value, typeName(definition.type)];
    })), expected.types);
    const mutation = operation.selectionSet.selections[0];
    assert.equal(mutation.name.value, expected.field);
    for (const argument of mutation.arguments)
        assert.equal(argument.value.kind, Kind.VARIABLE, `${argument.name.value} must use a variable`);
    assert.deepEqual(body.variables, expected.variables);
}

async function captureRequest(call) {
    const originalFetch = globalThis.fetch;
    let request;
    globalThis.fetch = async function(url, options) {
        request = {url, options};
        return jsonResponse(call.response);
    };
    try {
        const result = await call.run();
        return {request, result};
    }
    finally {
        globalThis.fetch = originalFetch;
    }
}

// Catches dropped stat fields, interpolated user input, relationship IDs, and token-renewal drift.
test("item add uses GraphQL variables for every editable stat and relationship", async function() {
    const {saveItem} = await import("../../client/features/editors/editor-api.js");
    const document = documentWithToken();
    const saved = await captureRequest({
        response: {
            data: {
                insertItem: {
                    id: 102,
                    tokenRenewal: {token: "item-renewed", expires: "2030-01-01T00:00:00.000Z"}
                }
            }
        },
        run: function() {
            return saveItem({
                accuracy: "0",
                mobId: "202",
                name: "Quoted \"blade\"",
                notes: "Line one\n${not interpolation}",
                questId: "302",
                rent: "19",
                slot: "14",
                uniqueWear: true,
                weaponType: "1",
                weight: "2.5"
            }, itemStatCategories, document);
        }
    });

    inspectMutation(saved.request, {
        userText: "Quoted \"blade\"",
        operation: "InsertItem",
        field: "insertItem",
        types: {
            accuracy: "Int", authToken: "String!", mobId: "Int", name: "String",
            notes: "String", questId: "Int", rent: "Int", slot: "Int", uniqueWear: "Boolean",
            weaponType: "Int", weight: "Float"
        },
        variables: {
            accuracy: 0, authToken: "item-token", mobId: 202, name: "Quoted \"blade\"",
            notes: "Line one\n${not interpolation}", questId: 302, rent: 19, slot: 14,
            uniqueWear: true, weaponType: 1, weight: 2.5
        }
    });
    assert.deepEqual(saved.result, {redirectUrl: "/items/details.html?id=102"});
    assert.equal(document.cookie,
        "loginToken=item-renewed; Path=/; SameSite=Lax; Secure; Expires=Tue, 01 Jan 2030 00:00:00 GMT");
});

// Catches edit requests that omit an initialized stat or redirect to a newly inserted ID.
test("item edit preserves stat payloads and redirects to the existing item", async function() {
    const {saveItem} = await import("../../client/features/editors/editor-api.js");
    const saved = await captureRequest({
        response: {data: {updateItem: {token: "item-edit", expires: null}}},
        run: function() {
            return saveItem({
                accuracy: 0, id: 101, mobId: 201, name: "Ember blade", notes: "Warm steel",
                questId: 301, rent: 20, slot: 14, uniqueWear: false, weaponType: 1, weight: 2.5
            }, itemStatCategories, documentWithToken());
        }
    });

    inspectMutation(saved.request, {
        userText: "Ember blade",
        operation: "UpdateItem",
        field: "updateItem",
        types: {
            accuracy: "Int", authToken: "String!", id: "Int!", mobId: "Int", name: "String",
            notes: "String", questId: "Int", rent: "Int", slot: "Int", uniqueWear: "Boolean",
            weaponType: "Int", weight: "Float"
        },
        variables: {
            accuracy: 0, authToken: "item-token", id: 101, mobId: 201, name: "Ember blade",
            notes: "Warm steel", questId: 301, rent: 20, slot: 14, uniqueWear: false,
            weaponType: 1, weight: 2.5
        }
    });
    assert.deepEqual(saved.result, {redirectUrl: "/items/details.html?id=101"});
});

// Catches lookup text interpolation and a lookup that cannot be cancelled after the user changes it.
test("entity lookups send search text as variables and forward cancellation signals", async function() {
    const {searchMobs, searchQuests} = await import("../../client/features/editors/editor-api.js");
    const signal = new AbortController().signal;
    const originalFetch = globalThis.fetch;
    const requests = [];
    globalThis.fetch = async function(url, options) {
        requests.push({url, options});
        return jsonResponse({data: options.body.includes("SearchMobs")
            ? {getMobs: {mobs: [{id: 201, name: "Test sentry"}]}}
            : {getQuests: {quests: [{id: 301, title: "A representative quest"}]}}});
    };
    try {
        assert.deepEqual(await searchMobs("quoted \"mob\"", signal), [{id: 201, name: "Test sentry"}]);
        assert.deepEqual(await searchQuests("quoted \"quest\"", signal), [{id: 301, title: "A representative quest"}]);
    }
    finally {
        globalThis.fetch = originalFetch;
    }

    for (const request of requests) {
        const body = JSON.parse(request.options.body);
        assert.equal(body.query.includes("quoted"), false);
        assert.equal(body.variables.searchString.startsWith("quoted"), true);
        assert.equal(request.options.signal, signal);
    }
});
