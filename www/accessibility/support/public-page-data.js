"use strict";

function itemStatInfo() {
    return [{
        display: "Name",
        filterString: "name",
        short: "Name",
        showColumnDefault: true,
        type: "string",
        var: "name"
    }];
}

function itemMetadata() {
    const stats = itemStatInfo();
    return {
        getItemStatCategories: [{
            getItemStatInfo: stats,
            name: "Identity"
        }],
        getItemStatInfo: stats
    };
}

function eraData() {
    return [{
        getAreas: [{ id: 11, name: "Thebes" }],
        id: 1,
        name: "Ancient"
    }];
}

module.exports = async function publicPageData(query) {
    if (query.includes("getItems(")) {
        return {
            ...itemMetadata(),
            getItems: {
                items: [{ id: 101, name: "Brass lantern" }],
                moreResults: false
            }
        };
    }

    if (query.includes("getMobs(")) {
        return {
            getEras: eraData(),
            getMobs: {
                mobs: [{
                    aggro: false,
                    areaName: "Thebes",
                    eraName: "Ancient",
                    gold: 12,
                    id: 201,
                    name: "Test sentry",
                    xp: 450
                }],
                moreResults: false
            }
        };
    }

    if (query.includes("getQuests(")) {
        return {
            getEras: eraData(),
            getQuests: {
                moreResults: false,
                quests: [{
                    areaName: "Thebes",
                    eraName: "Ancient",
                    id: 301,
                    title: "A representative quest"
                }]
            }
        };
    }

    if (query.includes("getWikiPages(")) {
        return {
            getCategories: [{
                getSubcategories: [{ id: 41, name: "Getting Started" }],
                id: 4,
                name: "Guides"
            }],
            getWikiPages: {
                moreResults: false,
                wikiPages: [{
                    categoryName: "Guides",
                    id: 401,
                    locked: false,
                    pinnedRecent: false,
                    pinnedSearch: false,
                    subcategoryName: "Getting Started",
                    title: "A representative wiki page"
                }]
            }
        };
    }

    if (query.includes("getItemStatCategories"))
        return itemMetadata();

    throw new Error("No accessibility fixture matches the GraphQL query.");
};
