"use strict";

function itemStatInfo() {
    return [{
        display: "Name",
        filterString: "name",
        short: "Name",
        showColumnDefault: true,
        type: "string",
        var: "name"
    }, {
        display: "Slot", filterString: "= {0}", short: "Slot", showColumnDefault: false,
        type: "select", var: "slot"
    }, {
        display: "Light", filterString: "= {0}", short: "Light", showColumnDefault: false,
        type: "bool", var: "isLight"
    }];
}

function itemMetadata() {
    const stats = itemStatInfo();
    return {
        getItemStatCategories: [
            {name: "Basic", getItemStatInfo: stats},
            ...["Main", "Limits", "Ranged", "Regen", "Tank", "Melee", "Mage", "Weapon", "Future"].map((name, index) => ({
                name, getItemStatInfo: [{display: `${name} Stat`, filterString: "= {0}", short: `${name} Stat`, showColumnDefault: false, type: "int", var: `stat${index}`}]
            }))
        ],
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

module.exports = async function publicPageData(query, variables = {}) {
    if (query.includes("getNotificationSettings")) {
        return {
            getNotificationSettings: {
                itemAdded: true,
                itemUpdated: false,
                mobAdded: false,
                mobUpdated: true,
                questAdded: true,
                questUpdated: false,
                wikiPageAdded: false,
                wikiPageUpdated: true,
                changelogAdded: true
            }
        };
    }

    if (query.includes("getNotifications(")) {
        return {
            getNotifications: {
                moreResults: false,
                results: []
            }
        };
    }

    if (query.includes("getItemById")) {
        const id = Number(variables.id) || 101;
        const names = {41: "Brass lantern", 54: "Limited light", 101: "Brass lantern"};
        return {
            ...itemMetadata(),
            getItemById: {
                ac: 0,
                alignRestriction: 0,
                constitution: 0,
                dexterity: 0,
                getHistories: [],
                getMob: null,
                getQuest: null,
                id,
                mind: 0,
                modifiedBy: "Fixture author",
                modifiedOn: "2026-09-01T12:00:00.000Z",
                name: names[id] || `Fixture item ${id}`,
                netStat: 2,
                notes: "A dependable light.",
                perception: 0,
                rent: 5,
                slot: 0,
                slots: [0],
                spirit: 0,
                strength: 2,
                uniqueWear: false,
                value: 0,
                weight: 1
            }
        };
    }

    if (query.includes("getItems(")) {
        return {
            ...itemMetadata(),
            getItems: {
                items: [{ id: 101, name: "Brass lantern", slot: 0, isLight: true }],
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
