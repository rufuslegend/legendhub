"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

async function loadAccountApi() {
    return import("../../client/features/account/account-api.js");
}

async function loadBuilderApi() {
    return import("../../client/features/builder/builder-account-api.js");
}

async function loadReducer() {
    return import("../../client/features/account/account-reducer.js");
}

function jsonResponse(data) {
    return {
        status: 200,
        async json() { return {data}; }
    };
}

// Catches Account settings cloning the protected operations instead of using
// the one Task 1 adapter whose auth-token and query contracts are reviewed.
test("account storage management reuses the Builder export and delete adapters", async function() {
    const accountApi = await loadAccountApi();
    const builderApi = await loadBuilderApi();

    assert.equal(accountApi.exportAccountBuilderData,
        builderApi.exportAccountBuilderData);
    assert.equal(accountApi.deleteAllAccountBuilderData,
        builderApi.deleteAllAccountBuilderData);
});

// Catches exporting route props or a prior in-memory response instead of
// asking the protected API for its canonical current snapshot on every click.
test("each account export requests a fresh canonical Builder payload", async function(t) {
    const accountApi = await loadAccountApi();
    const bodies = [];
    let response = "7*First~Original~encoded*";
    t.mock.method(globalThis, "fetch", async function(_url, options) {
        bodies.push(JSON.parse(options.body));
        return jsonResponse({exportBuilderData: response});
    });
    const document = {cookie: "loginToken=account-session"};

    assert.equal(await accountApi.exportAccountBuilderData(document), response);
    response = "7*Fresh~Original~newer*";
    assert.equal(await accountApi.exportAccountBuilderData(document), response);

    assert.equal(bodies.length, 2);
    for (const body of bodies) {
        assert.match(body.query, /query ExportBuilderData/);
        assert.deepEqual(body.variables, {authToken: "account-session"});
        assert.equal(body.query.includes("account-session"), false);
    }
});

// Catches decimal units, a server-provided quota label, or rounding that can
// make the fixed 10 MiB account limit look larger than it is.
test("storage usage is human readable against the fixed ten megabyte limit", async function() {
    const {formatBuilderStorageUsage} = await loadReducer();

    assert.equal(formatBuilderStorageUsage(0, 10_485_760), "0 B of 10 MB used");
    assert.equal(formatBuilderStorageUsage(1_572_864, 10_485_760),
        "1.5 MB of 10 MB used");
    assert.equal(formatBuilderStorageUsage(10_485_760, 10_485_760),
        "10 MB of 10 MB used");
});

// Catches a future route regression placing raw payloads, ownership fields,
// or storage namespaces into the account component's long-lived state.
test("account storage state retains only display-safe profile metadata", async function() {
    const {createInitialAccountState} = await loadReducer();
    const state = createInitialAccountState({}, {
        verified: true,
        canUseAccountStorage: true
    }, {
        enabled: true,
        profiles: [{
            id: "profile-1",
            name: "Hero",
            revision: 4,
            updatedOn: "2026-08-28T00:00:00.000Z",
            payload: "7*private-payload*",
            memberId: 7,
            storageNamespace: "private-namespace"
        }],
        usedBytes: 20,
        quotaBytes: 10_485_760,
        storageGeneration: 7
    });

    assert.deepEqual(state.builderStorage.profiles, [{
        id: "profile-1",
        name: "Hero",
        revision: 4,
        updatedOn: "2026-08-28T00:00:00.000Z"
    }]);
    assert.equal(JSON.stringify(state).includes("private-payload"), false);
    assert.equal(JSON.stringify(state).includes("private-namespace"), false);
});
