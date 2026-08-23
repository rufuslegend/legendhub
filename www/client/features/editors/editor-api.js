import {formatCookie, parseCookieHeader} from "../../lib/cookies.js";
import {graphqlRequest} from "../../lib/graphql-request.js";

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

function integer(value) {
    return value == null || value === "" ? null : Number(value);
}

function currentToken(document) {
    return parseCookieHeader(document.cookie).loginToken;
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
