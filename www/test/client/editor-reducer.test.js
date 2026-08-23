"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {Kind, parse} = require("graphql");

async function loadReducer() {
    return import("../../client/features/editors/editor-reducer.js");
}

async function loadApi() {
    return import("../../client/features/editors/editor-api.js");
}

function jsonResponse(body, status = 200) {
    return {
        status,
        json: async function() { return body; }
    };
}

function requestDocument(cookie = "loginToken=editor-token") {
    let value = cookie;
    return {
        get cookie() { return value; },
        set cookie(next) { value = next; }
    };
}

function inspectMutation(request, expected) {
    const body = JSON.parse(request.options.body);
    const document = parse(body.query);
    assert.equal(body.query.includes(expected.userText), false,
        "user-entered text must not appear in GraphQL source");
    assert.equal(document.definitions.length, 1);
    const operation = document.definitions[0];
    assert.equal(operation.kind, Kind.OPERATION_DEFINITION);
    assert.equal(operation.operation, "mutation");
    assert.equal(operation.name.value, expected.operationName);
    assert.deepEqual(Object.fromEntries(operation.variableDefinitions.map(function(definition) {
        function typeName(node) {
            if (node.kind === Kind.NON_NULL_TYPE)
                return `${typeName(node.type)}!`;
            return node.name.value;
        }
        return [definition.variable.name.value, typeName(definition.type)];
    })), expected.types);

    const mutation = operation.selectionSet.selections[0];
    assert.equal(mutation.name.value, expected.field);
    assert.deepEqual(Object.fromEntries(mutation.arguments.map(function(argument) {
        assert.equal(argument.value.kind, Kind.VARIABLE);
        return [argument.name.value, argument.value.name.value];
    })), Object.fromEntries(Object.keys(expected.variables).map(name => [name, name])));
    assert.deepEqual(body.variables, expected.variables);
}

async function captureSave(save, entity, responseBody, document) {
    const originalFetch = globalThis.fetch;
    let request;
    globalThis.fetch = async function(url, options) {
        request = {url, options};
        return jsonResponse({data: responseBody});
    };
    try {
        const result = await save(entity, document);
        return {request, result};
    }
    finally {
        globalThis.fetch = originalFetch;
    }
}

// Catches initialization that aliases route props or loses add/edit mode.
test("editor state snapshots route props and identifies add and edit modes", async function() {
    const {createInitialEditorState} = await loadReducer();
    const mob = {id: 201, name: "Test sentry", xp: 450};
    const edit = createInitialEditorState(mob);
    const add = createInitialEditorState({name: "", xp: 0});

    mob.name = "Mutated outside reducer";
    assert.deepEqual(edit, {
        mode: "edit",
        initial: {id: 201, name: "Test sentry", xp: 450},
        draft: {id: 201, name: "Test sentry", xp: 450},
        status: "editing",
        error: null
    });
    assert.equal(add.mode, "add");
    assert.notEqual(edit.initial, edit.draft);
});

// Catches field updates that mutate the saved snapshot or leave a stale failure visible.
test("field changes update only the draft and clear request errors", async function() {
    const {createInitialEditorState, editorReducer, isEditorDirty} = await loadReducer();
    let state = createInitialEditorState({id: 301, title: "Original", areaId: 11});
    state = editorReducer(state, {type: "save/failed", error: "request"});
    state = editorReducer(state, {type: "field/change", field: "title", value: "Revised"});

    assert.equal(state.initial.title, "Original");
    assert.equal(state.draft.title, "Revised");
    assert.equal(state.status, "editing");
    assert.equal(state.error, null);
    assert.equal(isEditorDirty(state), true);

    state = editorReducer(state, {type: "field/change", field: "title", value: "Original"});
    assert.equal(isEditorDirty(state), false);
});

// Catches category changes that retain a subcategory from the prior category.
test("a category change can atomically clear its dependent subcategory", async function() {
    const {createInitialEditorState, editorReducer} = await loadReducer();
    const state = editorReducer(
        createInitialEditorState({categoryId: 4, subcategoryId: 42}),
        {type: "category/change", field: "categoryId", value: 5, dependentField: "subcategoryId"}
    );

    assert.deepEqual(state.draft, {categoryId: 5, subcategoryId: null});
});

// Catches duplicate submissions and failure transitions that leave the editor disabled.
test("save transitions prevent duplicate requests and restore editing after failure", async function() {
    const {createInitialEditorState, editorReducer} = await loadReducer();
    let state = createInitialEditorState({title: "Guide"});
    state = editorReducer(state, {type: "save/requested"});
    assert.equal(state.status, "saving");
    assert.equal(editorReducer(state, {type: "save/requested"}), state);

    state = editorReducer(state, {type: "save/failed", error: "request"});
    assert.equal(state.status, "editing");
    assert.equal(state.error, "request");
});

// Catches mob insert fields, values, result mapping, and secure token renewal drift.
test("mob add uses variables and preserves every insert payload field", async function() {
    const {saveMob} = await loadApi();
    const document = requestDocument("loginToken=editor-token; cookie-consent=true");
    const saved = await captureSave(saveMob, {
        name: "Quoted \"guardian\"",
        xp: "725",
        areaId: "12",
        gold: "19",
        notes: "Line one\n${not interpolation}",
        aggro: true
    }, {
        insertMob: {
            id: 202,
            tokenRenewal: {token: "mob-renewed", expires: "2030-01-01T00:00:00.000Z"}
        }
    }, document);

    inspectMutation(saved.request, {
        userText: "Quoted \"guardian\"",
        operationName: "InsertMob",
        field: "insertMob",
        types: {
            authToken: "String!", name: "String!", xp: "Int", areaId: "Int",
            gold: "Int", notes: "String", aggro: "Boolean"
        },
        variables: {
            authToken: "editor-token", name: "Quoted \"guardian\"", xp: 725,
            areaId: 12, gold: 19, notes: "Line one\n${not interpolation}", aggro: true
        }
    });
    assert.deepEqual(saved.result, {redirectUrl: "/mobs/details.html?id=202"});
    assert.equal(document.cookie,
        "loginToken=mob-renewed; Path=/; SameSite=Lax; Secure; Expires=Tue, 01 Jan 2030 00:00:00 GMT");
});

// Catches mob update operation, ID, payload, and redirect drift.
test("mob edit preserves every update payload field", async function() {
    const {saveMob} = await loadApi();
    const document = requestDocument();
    const saved = await captureSave(saveMob, {
        id: 201,
        name: "Test sentry",
        xp: 450,
        areaId: 11,
        gold: 38,
        notes: "Watchful",
        aggro: false
    }, {updateMob: {token: "mob-edit", expires: null}}, document);

    inspectMutation(saved.request, {
        userText: "Test sentry",
        operationName: "UpdateMob",
        field: "updateMob",
        types: {
            authToken: "String!", id: "Int!", name: "String", xp: "Int",
            areaId: "Int", gold: "Int", notes: "String", aggro: "Boolean"
        },
        variables: {
            authToken: "editor-token", id: 201, name: "Test sentry", xp: 450,
            areaId: 11, gold: 38, notes: "Watchful", aggro: false
        }
    });
    assert.deepEqual(saved.result, {redirectUrl: "/mobs/details.html?id=201"});
    assert.equal(document.cookie, "loginToken=mob-edit; Path=/; SameSite=Lax; Secure");
});

// Catches quest insert field order/value mapping, including stat and multi-line content.
test("quest add uses variables and preserves every insert payload field", async function() {
    const {saveQuest} = await loadApi();
    const document = requestDocument();
    const saved = await captureSave(saveQuest, {
        title: "Quoted \"errand\"",
        areaId: "11",
        whoises: "Archivist;Scribe",
        stat: true,
        content: "Return the **folio**.\nNext line."
    }, {
        insertQuest: {id: 302, tokenRenewal: {token: "quest-renewed", expires: null}}
    }, document);

    inspectMutation(saved.request, {
        userText: "Quoted \"errand\"",
        operationName: "InsertQuest",
        field: "insertQuest",
        types: {
            authToken: "String!", title: "String!", areaId: "Int!",
            whoises: "String", stat: "Boolean", content: "String"
        },
        variables: {
            authToken: "editor-token", title: "Quoted \"errand\"", areaId: 11,
            whoises: "Archivist;Scribe", stat: true,
            content: "Return the **folio**.\nNext line."
        }
    });
    assert.deepEqual(saved.result, {redirectUrl: "/quests/details.html?id=302"});
});

// Catches quest update field/value mapping and established detail redirect.
test("quest edit preserves every update payload field", async function() {
    const {saveQuest} = await loadApi();
    const saved = await captureSave(saveQuest, {
        id: 301,
        title: "A representative quest",
        areaId: 12,
        whoises: "Captain;Quartermaster",
        stat: false,
        content: "Briefing"
    }, {updateQuest: {token: "quest-edit", expires: null}}, requestDocument());

    inspectMutation(saved.request, {
        userText: "A representative quest",
        operationName: "UpdateQuest",
        field: "updateQuest",
        types: {
            authToken: "String!", id: "Int!", title: "String", areaId: "Int",
            whoises: "String", stat: "Boolean", content: "String"
        },
        variables: {
            authToken: "editor-token", id: 301, title: "A representative quest",
            areaId: 12, whoises: "Captain;Quartermaster", stat: false,
            content: "Briefing"
        }
    });
    assert.deepEqual(saved.result, {redirectUrl: "/quests/details.html?id=301"});
});

// Catches wiki insert mapping, nullable subcategory semantics, and content interpolation.
test("wiki add uses variables and preserves every insert payload field", async function() {
    const {saveWikiPage} = await loadApi();
    const saved = await captureSave(saveWikiPage, {
        title: "Quoted \"guide\"",
        categoryId: "6",
        subcategoryId: null,
        tags: "news;archive",
        content: "[Safe](https://example.test)"
    }, {
        insertWikiPage: {id: 402, tokenRenewal: {token: "wiki-renewed", expires: null}}
    }, requestDocument());

    inspectMutation(saved.request, {
        userText: "Quoted \"guide\"",
        operationName: "InsertWikiPage",
        field: "insertWikiPage",
        types: {
            authToken: "String!", title: "String!", categoryId: "Int!",
            subcategoryId: "Int", tags: "String", content: "String"
        },
        variables: {
            authToken: "editor-token", title: "Quoted \"guide\"", categoryId: 6,
            subcategoryId: null, tags: "news;archive",
            content: "[Safe](https://example.test)"
        }
    });
    assert.deepEqual(saved.result, {redirectUrl: "/wiki/details.html?id=402"});
});

// Catches wiki update ID, dependent category fields, and redirect drift.
test("wiki edit preserves every update payload field", async function() {
    const {saveWikiPage} = await loadApi();
    const saved = await captureSave(saveWikiPage, {
        id: 401,
        title: "A representative wiki page",
        categoryId: 4,
        subcategoryId: 42,
        tags: "guide;trail;updated",
        content: "Follow the trail."
    }, {updateWikiPage: {token: "wiki-edit", expires: null}}, requestDocument());

    inspectMutation(saved.request, {
        userText: "A representative wiki page",
        operationName: "UpdateWikiPage",
        field: "updateWikiPage",
        types: {
            authToken: "String!", id: "Int!", title: "String", categoryId: "Int",
            subcategoryId: "Int", tags: "String", content: "String"
        },
        variables: {
            authToken: "editor-token", id: 401, title: "A representative wiki page",
            categoryId: 4, subcategoryId: 42, tags: "guide;trail;updated",
            content: "Follow the trail."
        }
    });
    assert.deepEqual(saved.result, {redirectUrl: "/wiki/details.html?id=401"});
});

// Catches API failures that are swallowed instead of reaching the live-region state.
test("entity save APIs preserve normalized GraphQL failures", async function(t) {
    const originalFetch = globalThis.fetch;
    t.after(function() { globalThis.fetch = originalFetch; });
    globalThis.fetch = async function() {
        return jsonResponse({
            data: {insertMob: null},
            errors: [{message: "Mob validation failed."}]
        });
    };
    const {saveMob} = await loadApi();

    await assert.rejects(saveMob({name: "Sentry", xp: 0, areaId: 11, gold: 0, notes: "", aggro: false}, requestDocument()),
        /Mob validation failed\./);
});
