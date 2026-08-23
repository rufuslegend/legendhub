"use strict";

const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");
const graphql = require("graphql");

const questApiPath = require.resolve("../src/routes/api/quests");

function loadQuestApi(mysql, auth, apiUtils) {
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (parent?.filename === questApiPath && request === "./mysql-connection")
            return mysql;
        if (parent?.filename === questApiPath && request === "./auth")
            return auth;
        if (parent?.filename === questApiPath && request === "./utils")
            return apiUtils;
        if (parent?.filename === questApiPath && request === "./items.js") {
            return {
                classes: {Item: class Item {}},
                selectSQL: {itemSelectSQL: "SELECT Id"},
                types: {itemType: graphql.GraphQLString}
            };
        }
        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        delete require.cache[questApiPath];
        return require(questApiPath);
    }
    finally {
        Module._load = originalLoad;
    }
}

// Catches the quest revert resolver reading expiration from a misspelled response binding.
test("quest revert returns the production id and complete token renewal", async function() {
    const timestamp = "2030-01-01T00:00:00.000Z";
    const authResponse = {
        expires: timestamp,
        ip: "192.0.2.9",
        token: "quest-revert-token",
        username: "Archivist"
    };
    const statements = [];
    const questApi = loadQuestApi({
        query: function(sql, values, callback) {
            statements.push({sql, values});
            if (sql.startsWith("SELECT QuestId")) {
                callback(null, [{
                    QuestId: 301,
                    Title: "Historic quest",
                    AreaId: 12,
                    Content: "Historic content",
                    Whoises: "Archivist",
                    Stat: 1
                }]);
                return;
            }
            if (sql.startsWith("UPDATE Quests Q SET")) {
                callback(null, {affectedRows: 1});
                return;
            }
            assert.fail(`Unexpected SQL: ${sql}`);
        }
    }, {
        types: {
            idMutationResponseType: graphql.GraphQLString,
            tokenRenewalType: graphql.GraphQLString
        },
        utils: {
            authMutation: async function() { return authResponse; }
        }
    }, {
        NotFoundError: class NotFoundError extends Error {},
        UnauthorizedError: class UnauthorizedError extends Error {},
        trackPageUpdate: function() {}
    });

    const result = await questApi.mutationFields.revertQuest.resolve(
        null,
        {authToken: "quest-route-token", historyId: 1301},
        {ip: "192.0.2.9"}
    );

    assert.deepEqual(result, {
        id: 301,
        tokenRenewal: {token: "quest-revert-token", expires: timestamp}
    });
    assert.deepEqual(statements.map(statement => statement.values), [
        [1301],
        [
            "Historic quest", 12, "Historic content", "Archivist", 1,
            "Archivist", "192.0.2.9", 301
        ]
    ]);
});
