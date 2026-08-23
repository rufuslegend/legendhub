import {formatCookie, parseCookieHeader} from "../../lib/cookies.js";
import {
    GraphQLRequestError,
    graphqlRequest,
    redirectToUnauthorizedPage
} from "../../lib/graphql-request.js";

const insertMobMutation = `
    mutation InsertMob(
        $authToken: String!
        $name: String!
        $xp: Int
        $areaId: Int
        $gold: Int
        $notes: String
        $aggro: Boolean
    ) {
        insertMob(
            authToken: $authToken
            name: $name
            xp: $xp
            areaId: $areaId
            gold: $gold
            notes: $notes
            aggro: $aggro
        ) {
            id
            tokenRenewal {
                token
                expires
            }
        }
    }
`;

const updateMobMutation = `
    mutation UpdateMob(
        $authToken: String!
        $id: Int!
        $name: String
        $xp: Int
        $areaId: Int
        $gold: Int
        $notes: String
        $aggro: Boolean
    ) {
        updateMob(
            authToken: $authToken
            id: $id
            name: $name
            xp: $xp
            areaId: $areaId
            gold: $gold
            notes: $notes
            aggro: $aggro
        ) {
            token
            expires
        }
    }
`;

const insertQuestMutation = `
    mutation InsertQuest(
        $authToken: String!
        $title: String!
        $areaId: Int!
        $whoises: String
        $stat: Boolean
        $content: String
    ) {
        insertQuest(
            authToken: $authToken
            title: $title
            areaId: $areaId
            whoises: $whoises
            stat: $stat
            content: $content
        ) {
            id
            tokenRenewal {
                token
                expires
            }
        }
    }
`;

const updateQuestMutation = `
    mutation UpdateQuest(
        $authToken: String!
        $id: Int!
        $title: String
        $areaId: Int
        $whoises: String
        $stat: Boolean
        $content: String
    ) {
        updateQuest(
            authToken: $authToken
            id: $id
            title: $title
            areaId: $areaId
            whoises: $whoises
            stat: $stat
            content: $content
        ) {
            token
            expires
        }
    }
`;

const insertWikiPageMutation = `
    mutation InsertWikiPage(
        $authToken: String!
        $title: String!
        $categoryId: Int!
        $subcategoryId: Int
        $tags: String
        $content: String
    ) {
        insertWikiPage(
            authToken: $authToken
            title: $title
            categoryId: $categoryId
            subcategoryId: $subcategoryId
            tags: $tags
            content: $content
        ) {
            id
            tokenRenewal {
                token
                expires
            }
        }
    }
`;

const updateWikiPageMutation = `
    mutation UpdateWikiPage(
        $authToken: String!
        $id: Int!
        $title: String
        $categoryId: Int
        $subcategoryId: Int
        $tags: String
        $content: String
    ) {
        updateWikiPage(
            authToken: $authToken
            id: $id
            title: $title
            categoryId: $categoryId
            subcategoryId: $subcategoryId
            tags: $tags
            content: $content
        ) {
            token
            expires
        }
    }
`;

const searchMobsQuery = `
    query SearchMobs($searchString: String) {
        getMobs(searchString: $searchString) {
            mobs {
                id
                name
            }
        }
    }
`;

const searchQuestsQuery = `
    query SearchQuests($searchString: String) {
        getQuests(searchString: $searchString) {
            quests {
                id
                title
            }
        }
    }
`;

function integer(value) {
    return value == null || value === "" ? null : Number(value);
}

function currentToken(document) {
    const token = parseCookieHeader(document.cookie).loginToken;
    if (token)
        return token;
    redirectToUnauthorizedPage();
    throw new GraphQLRequestError("Authorization required.");
}

function persistTokenRenewal(document, tokenRenewal) {
    if (!tokenRenewal?.token)
        return;
    const options = tokenRenewal.expires
        ? {expires: new Date(tokenRenewal.expires)}
        : {};
    document.cookie = formatCookie("loginToken", tokenRenewal.token, options);
}

function mobVariables(mob, document) {
    return {
        authToken: currentToken(document),
        name: mob.name,
        xp: integer(mob.xp),
        areaId: integer(mob.areaId),
        gold: integer(mob.gold),
        notes: mob.notes ?? "",
        aggro: Boolean(mob.aggro)
    };
}

function questVariables(quest, document) {
    return {
        authToken: currentToken(document),
        title: quest.title,
        areaId: integer(quest.areaId),
        whoises: quest.whoises ?? "",
        stat: Boolean(quest.stat),
        content: quest.content ?? ""
    };
}

function wikiVariables(wikiPage, document) {
    return {
        authToken: currentToken(document),
        title: wikiPage.title,
        categoryId: integer(wikiPage.categoryId),
        subcategoryId: integer(wikiPage.subcategoryId),
        tags: wikiPage.tags ?? "",
        content: wikiPage.content ?? ""
    };
}

function itemValue(stat, value) {
    if (stat.type === "bool")
        return Boolean(value);
    if (stat.type === "decimal")
        return value == null || value === "" ? 0 : Number(value);
    if (stat.type === "int" || stat.type === "select")
        return integer(value) ?? 0;
    return value ?? "";
}

function itemGraphQLType(stat) {
    if (stat.type === "decimal")
        return "Float";
    if (stat.type === "int" || stat.type === "select")
        return "Int";
    if (stat.type === "bool")
        return "Boolean";
    return "String";
}

function editableItemStats(itemStatCategories) {
    return itemStatCategories.flatMap(category => category.getItemStatInfo || [])
        .filter(stat => stat.editable && !["mobId", "questId", "notes"].includes(stat.var));
}

function itemMutation(itemStatCategories, edit) {
    const requiredInsertStats = new Set([
        "name", "slot", "alignRestriction", "isLight", "isHeroic"
    ]);
    const fields = [
        {name: "authToken", type: "String", required: true},
        ...(edit ? [{name: "id", type: "Int", required: true}] : []),
        {name: "mobId", type: "Int"},
        {name: "questId", type: "Int"},
        {name: "notes", type: "String"},
        ...editableItemStats(itemStatCategories).map(stat => ({
            name: stat.var,
            type: itemGraphQLType(stat),
            required: !edit && requiredInsertStats.has(stat.var)
        }))
    ];
    const operation = edit ? "UpdateItem" : "InsertItem";
    const field = edit ? "updateItem" : "insertItem";
    const variableDefinitions = fields.map(definition =>
        `$${definition.name}: ${definition.type}${definition.required ? "!" : ""}`).join("\n");
    const argumentsList = fields.map(definition => `${definition.name}: $${definition.name}`).join("\n");
    const response = edit
        ? "token\nexpires"
        : "id\ntokenRenewal { token expires }";

    return `
        mutation ${operation}(${variableDefinitions}) {
            ${field}(${argumentsList}) {
                ${response}
            }
        }
    `;
}

function itemVariables(item, itemStatCategories, document) {
    const variables = {
        authToken: currentToken(document),
        mobId: integer(item.mobId) ?? 0,
        questId: integer(item.questId) ?? 0,
        notes: item.notes ?? ""
    };
    for (const stat of editableItemStats(itemStatCategories))
        variables[stat.var] = itemValue(stat, item[stat.var]);
    if (item.id != null)
        variables.id = integer(item.id);
    return variables;
}

export async function saveMob(mob, document = window.document) {
    const edit = mob.id != null;
    const variables = mobVariables(mob, document);
    if (edit)
        variables.id = integer(mob.id);
    const data = await graphqlRequest({
        query: edit ? updateMobMutation : insertMobMutation,
        variables
    });
    const id = edit ? variables.id : data.insertMob.id;
    persistTokenRenewal(document, edit ? data.updateMob : data.insertMob.tokenRenewal);
    return {redirectUrl: `/mobs/details.html?id=${id}`};
}

export async function saveQuest(quest, document = window.document) {
    const edit = quest.id != null;
    const variables = questVariables(quest, document);
    if (edit)
        variables.id = integer(quest.id);
    const data = await graphqlRequest({
        query: edit ? updateQuestMutation : insertQuestMutation,
        variables
    });
    const id = edit ? variables.id : data.insertQuest.id;
    persistTokenRenewal(document, edit ? data.updateQuest : data.insertQuest.tokenRenewal);
    return {redirectUrl: `/quests/details.html?id=${id}`};
}

export async function saveWikiPage(wikiPage, document = window.document) {
    const edit = wikiPage.id != null;
    const variables = wikiVariables(wikiPage, document);
    if (edit)
        variables.id = integer(wikiPage.id);
    const data = await graphqlRequest({
        query: edit ? updateWikiPageMutation : insertWikiPageMutation,
        variables
    });
    const id = edit ? variables.id : data.insertWikiPage.id;
    persistTokenRenewal(document, edit ? data.updateWikiPage : data.insertWikiPage.tokenRenewal);
    return {redirectUrl: `/wiki/details.html?id=${id}`};
}

export async function saveItem(item, itemStatCategories, document = window.document) {
    const edit = item.id != null;
    const variables = itemVariables(item, itemStatCategories, document);
    const data = await graphqlRequest({
        query: itemMutation(itemStatCategories, edit),
        variables
    });
    const id = edit ? variables.id : data.insertItem.id;
    persistTokenRenewal(document, edit ? data.updateItem : data.insertItem.tokenRenewal);
    return {redirectUrl: `/items/details.html?id=${id}`};
}

export async function searchMobs(searchString, signal) {
    const data = await graphqlRequest({
        query: searchMobsQuery,
        variables: {searchString},
        signal
    });
    return data.getMobs.mobs;
}

export async function searchQuests(searchString, signal) {
    const data = await graphqlRequest({
        query: searchQuestsQuery,
        variables: {searchString},
        signal
    });
    return data.getQuests.quests;
}
