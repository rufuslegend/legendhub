"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const {Kind, buildSchema, parse, validate} = require("graphql");
const React = require("react");
const {renderToStaticMarkup} = require("react-dom/server");

const root = path.resolve(__dirname, "../..");

const itemStatCategories = [
    {
        name: "Basic",
        getItemStatInfo: [
            {editable: true, type: "string", var: "name"},
            {editable: true, type: "select", var: "slot"},
            {editable: true, type: "select", var: "alignRestriction"},
            {editable: true, type: "bool", var: "isLight"},
            {editable: true, type: "bool", var: "isHeroic"},
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

const productionItemMutationSchema = buildSchema(`
    type TokenRenewal { token: String expires: String }
    type IdMutationResponse { id: Int! tokenRenewal: TokenRenewal }
    type Query { _contract: Boolean }
    type Mutation {
        insertItem(
            authToken: String!
            mobId: Int
            questId: Int
            notes: String
            name: String!
            slots: [Int!]
            alignRestriction: Int!
            isLight: Boolean!
            isHeroic: Boolean!
            rent: Int
            weight: Float
            accuracy: Int
            uniqueWear: Boolean
            weaponType: Int
        ): IdMutationResponse
        updateItem(
            authToken: String!
            id: Int!
            mobId: Int
            questId: Int
            notes: String
            name: String
            slots: [Int!]
            alignRestriction: Int
            isLight: Boolean
            isHeroic: Boolean
            rent: Int
            weight: Float
            accuracy: Int
            uniqueWear: Boolean
            weaponType: Int
        ): TokenRenewal
    }
    schema { query: Query mutation: Mutation }
`);

const editorConstants = {
    selectOptions: {
        slot: ["Light", "Finger", "Neck", "Head", "Body", "Legs", "Feet", "Hands", "Arms", "Shield", "About", "Waist", "Wrist", "Float", "Wield", "Hold", "Face", "Ear", "Back", "Tail", "Tattoo", "Other"],
        alignRestriction: ["No restriction"],
        weaponType: ["Sword"]
    }
};

async function withItemEditor(callback) {
    const {createServer} = await import("vite");
    const vite = await createServer({
        appType: "custom",
        root,
        plugins: [{
            name: "item-editor-markdown-stub",
            enforce: "pre",
            resolveId(source, importer) {
                if (source === "../../components/EntityChangelogFields.jsx" &&
                    importer?.endsWith("/client/features/editors/ItemEditor.jsx"))
                    return "\0item-editor-changelog-fields";
                return null;
            },
            load(id) {
                if (id === "\0item-editor-changelog-fields")
                    return `export default function EntityChangelogFields() { return null; }`;
                return null;
            }
        }],
        server: {hmr: false, middlewareMode: true, ws: false}
    });
    try {
        const module = await vite.ssrLoadModule("/client/features/editors/ItemEditor.jsx");
        return callback(module);
    }
    finally {
        await vite.close();
    }
}

function editorCategories() {
    return [
        {
            name: "Basic",
            getItemStatInfo: [
                {editable: true, short: "Name", type: "string", var: "name"},
                {editable: true, short: "Slot", type: "select", var: "slot"},
                {editable: true, short: "Align", type: "select", var: "alignRestriction"},
                {editable: true, short: "Light", type: "bool", var: "isLight"},
                {editable: true, short: "Heroic", type: "bool", var: "isHeroic"}
            ]
        },
        {
            name: "Weapon",
            getItemStatInfo: [
                {editable: true, short: "Accuracy", type: "int", var: "accuracy"},
                {editable: true, short: "Weapon type", type: "select", var: "weaponType"}
            ]
        }
    ];
}

function editorItem(slots, slot = 14) {
    return {
        alignRestriction: 0, isHeroic: false, isLight: false,
        name: "Dual capability blade", slot, slots, weaponType: 0
    };
}

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
            if (node.kind === Kind.NON_NULL_TYPE)
                return `${typeName(node.type)}!`;
            if (node.kind === Kind.LIST_TYPE)
                return `[${typeName(node.type)}]`;
            return node.name.value;
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

// Catches nullable client variables rejected by the production insertItem argument contract.
test("item add validates against the production required Item mutation arguments", async function() {
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
                alignRestriction: "0",
                isHeroic: false,
                isLight: false,
                mobId: "202",
                name: "Quoted \"blade\"",
                notes: "Line one\n${not interpolation}",
                questId: "302",
                rent: "19",
                slot: "14",
                slots: ["14", "15"],
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
            accuracy: "Int", alignRestriction: "Int!", authToken: "String!", isHeroic: "Boolean!",
            isLight: "Boolean!", mobId: "Int", name: "String!", notes: "String", questId: "Int",
            rent: "Int", slots: "[Int!]", uniqueWear: "Boolean",
            weaponType: "Int", weight: "Float"
        },
        variables: {
            accuracy: 0, alignRestriction: 0, authToken: "item-token", isHeroic: false, isLight: false,
            mobId: 202, name: "Quoted \"blade\"", notes: "Line one\n${not interpolation}", questId: 302, rent: 19, slots: [14, 15],
            uniqueWear: true, weaponType: 1, weight: 2.5
        }
    });
    const body = JSON.parse(saved.request.options.body);
    assert.equal(Object.hasOwn(body.variables, "slot"), false);
    assert.deepEqual(validate(productionItemMutationSchema, parse(body.query)), []);
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
                accuracy: 0, alignRestriction: 0, id: 101, isHeroic: false, isLight: false,
                mobId: 201, name: "Ember blade", notes: "Warm steel",
                questId: 301, rent: 20, slot: 14, slots: [14, 15], uniqueWear: false, weaponType: 1, weight: 2.5
            }, itemStatCategories, documentWithToken());
        }
    });

    inspectMutation(saved.request, {
        userText: "Ember blade",
        operation: "UpdateItem",
        field: "updateItem",
        types: {
            accuracy: "Int", alignRestriction: "Int", authToken: "String!", id: "Int!", isHeroic: "Boolean",
            isLight: "Boolean", mobId: "Int", name: "String", notes: "String", questId: "Int", rent: "Int", slots: "[Int!]", uniqueWear: "Boolean",
            weaponType: "Int", weight: "Float"
        },
        variables: {
            accuracy: 0, alignRestriction: 0, authToken: "item-token", id: 101, isHeroic: false, isLight: false,
            mobId: 201, name: "Ember blade", notes: "Warm steel", questId: 301, rent: 20, slots: [14, 15], uniqueWear: false,
            weaponType: 1, weight: 2.5
        }
    });
    assert.equal(Object.hasOwn(JSON.parse(saved.request.options.body).variables, "slot"), false);
    assert.deepEqual(saved.result, {redirectUrl: "/items/details.html?id=101"});
});

// Catches returning to one scalar select, which prevents authors from recording
// every worn capability and cannot preserve an existing dual-slot item.
test("item editor renders every selected slot as an accessible checkbox", async function() {
    const markup = await withItemEditor(function({default: ItemEditor}) {
        return renderToStaticMarkup(React.createElement(ItemEditor, {
            constants: editorConstants,
            item: editorItem([14, 15]),
            itemStatCategories: editorCategories()
        }));
    });

    assert.match(markup, /<fieldset[^>]*>/);
    assert.match(markup, /<legend[^>]*>Slots<\/legend>/);
    assert.match(markup, /name="slots"[^>]*(?:value="14"[^>]*checked|checked[^>]*value="14")/);
    assert.match(markup, /name="slots"[^>]*(?:value="15"[^>]*checked|checked[^>]*value="15")/);
    assert.doesNotMatch(markup, /<select[^>]*name="slot"/);
});

// Catches a blank capability set being submitted, which the slot-mask write
// contract must reject instead of asking the server to infer a primary slot.
test("item editor disables Save until at least one slot is selected", async function() {
    const markup = await withItemEditor(function({default: ItemEditor}) {
        return renderToStaticMarkup(React.createElement(ItemEditor, {
            constants: editorConstants,
            item: editorItem([], 2),
            itemStatCategories: editorCategories()
        }));
    });

    assert.match(markup, /<button[^>]*type="submit"[^>]*disabled[^>]*>Save<\/button>/);
});

// Catches a multi-slot change handler that permits Other alongside wearable
// capabilities or leaves Other selected after choosing a wearable slot.
test("item editor makes Other exclusive when slot selections change", async function() {
    await withItemEditor(function({toggleSlot}) {
        assert.deepEqual(toggleSlot([14, 15], 21), [21]);
        assert.deepEqual(toggleSlot([21], 14), [14]);
        assert.deepEqual(toggleSlot([14, 15], 15), [14]);
    });
});

// Catches weapon fields following the deprecated primary scalar instead of the
// authoritative capability membership used by the server and public display.
test("item editor exposes Hold weapon fields from slots even with another primary", async function() {
    const markup = await withItemEditor(function({default: ItemEditor}) {
        return renderToStaticMarkup(React.createElement(ItemEditor, {
            constants: editorConstants,
            item: {...editorItem([15], 2), accuracy: 5},
            itemStatCategories: editorCategories()
        }));
    });

    assert.match(markup, /<section><div class="form-row"><h2 class="h4">Weapon<\/h2>/);
    assert.match(markup, /<input[^>]*name="accuracy"(?![^>]*hidden)/);
    assert.match(markup, /<div[^>]*hidden[^>]*>[\s\S]*name="weaponType"/);
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
