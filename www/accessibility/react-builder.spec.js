"use strict";

const Module = require("node:module");
const AxeBuilder = require("@axe-core/playwright").default;
const {expect, test} = require("@playwright/test");
const fulfillLocalBrowserScript = require("./support/local-browser-scripts");
const publicPageData = require("./support/public-page-data");

const encodedLists = "6*Hero~Tank~1c0K0K0K0J0J1-10000___00H00N00T00000100.00s00o00o-BHKAA_00t00u00v00w_______00p00q01b________________*Hero~Caster~0U0m0U0U0U0U000000___0000000000000000000f__00g_______________________________*Scout~Original~0X0X0X0X0X0X000000___0000000000000000000f__________________________________*";
const currentHeroExport = "6*Hero~Tank~1c0K0K0K0J0J1-10000___00H00N00T00000100.00s00o00o-BHKAA_00t00u00v00w_______00p00q01b________________*Hero~Caster~0U0m0U0U0U0U000000___0000000000000000000f__00g_______________________________*";
const currentTankExport = "6*Hero~Tank~1c0K0K0K0J0J1-10000___00H00N00T00000100.00s00o00o-BHKAA_00t00u00v00w_______00p00q01b________________*";
const guestImport = "6*Guest~Imported~0X0X0X0X0X0X000000___0000000000000000000f__-BHKAA_______________________________*";
const duplicateTankImport = "6*Hero~Tank~0X0X0X0X0X0X000000___0000000000000000000f__________________________________*";
const newHeroVariantImport = "6*Hero~Newcomer~0i0X0X0X0X0X000000___0000000000000000000g__________________________________*";
const accountProfilePayload = guestImport;
const accountProfile = {
    id: "account-profile-id",
    name: "Guest",
    payload: accountProfilePayload,
    payloadVersion: 6,
    revision: 4,
    updatedOn: "2026-08-26T12:00:00.000Z"
};
const scoutProfilePayload = "6*Scout~Original~0X0X0X0X0X0X000000___0000000000000000000f__________________________________*";
const importedAccountProfiles = [
    accountProfile,
    {
        id: "imported-hero-id",
        name: "Hero",
        payload: currentHeroExport,
        payloadVersion: 6,
        revision: 1,
        updatedOn: "2026-08-26T12:05:00.000Z"
    },
    {
        id: "imported-scout-id",
        name: "Scout",
        payload: scoutProfilePayload,
        payloadVersion: 6,
        revision: 1,
        updatedOn: "2026-08-26T12:05:00.000Z"
    }
];
const accountPreferences = JSON.stringify({
    version: 1,
    theme: "glass-blue",
    itemsPerPage: 50,
    itemColumns: ["Name"],
    builderColumns: {"account-profile-id": ["Rent"]},
    selectedProfileId: "account-profile-id",
    selectedVariant: "Imported",
    sentinel: "private-account-preference"
});
const canonicalDefaultPreferences = JSON.stringify({
    version: 1,
    theme: "glass-blue",
    itemsPerPage: 20,
    itemColumns: [],
    builderColumns: {},
    selectedProfileId: null,
    selectedVariant: null
});
const itemFragment = "fragment ItemAll on Item { id name slot strength strengthCap hit dam hp ma mv ac rent weight uniqueWear isLimited twoHanded fauxObject isLight alignRestriction weaponStat }";
const itemStatInfo = [
    {display: "Name", short: "Name", var: "name", type: "string", showColumnDefault: true},
    {display: "Strength", short: "Str", var: "strength", type: "int", showColumnDefault: true},
    {display: "Hit", short: "Hit", var: "hit", type: "int", showColumnDefault: true},
    {display: "Damage", short: "Dam", var: "dam", type: "int", showColumnDefault: true},
    {display: "Hit Points", short: "HP", var: "hp", type: "int", showColumnDefault: true},
    {display: "Mana", short: "Ma", var: "ma", type: "int", showColumnDefault: true},
    {display: "Movement", short: "Mv", var: "mv", type: "int", showColumnDefault: true},
    {display: "Armor Class", short: "AC", var: "ac", type: "int", showColumnDefault: true},
    {display: "Rent", short: "Rent", var: "rent", type: "int", showColumnDefault: true},
    {display: "Light", short: "Light", var: "isLight", type: "bool", showColumnDefault: true}
];
const itemStatCategories = [
    {name: "Basic", getItemStatInfo: [itemStatInfo[0]]},
    {name: "Main", getItemStatInfo: [itemStatInfo[1]]},
    {name: "Limits", getItemStatInfo: [itemStatInfo[2]]},
    {name: "Ranged", getItemStatInfo: [itemStatInfo[3]]},
    {name: "Regen", getItemStatInfo: [itemStatInfo[4]]},
    {name: "Tank", getItemStatInfo: [itemStatInfo[5]]},
    {name: "Melee", getItemStatInfo: [itemStatInfo[6]]},
    {name: "Mage", getItemStatInfo: [itemStatInfo[7]]},
    {name: "Weapon", getItemStatInfo: [itemStatInfo[8]]},
    {name: "Future", getItemStatInfo: [itemStatInfo[9]]}
];
const hydratedItems = [
    {id: 41, name: "Brass lantern", slot: 0, strength: 2, isLight: 1},
    {id: 42, name: "Faux moonlight", slot: 0, strength: 4, hp: 20, fauxObject: 1, isLight: 1},
    {id: 50, name: "Singular ring", slot: 1, uniqueWear: 1},
    {id: 51, name: "Massive greatsword", slot: 14, strength: 10, strengthCap: 4, weight: 30, twoHanded: 1, weaponStat: 1},
    {id: 52, name: "Tower shield", slot: 10, twoHanded: 1},
    {id: 54, name: "Limited light", slot: 0, isLimited: 1},
    {id: 55, name: "Limited body", slot: 3, isLimited: 1},
    {id: 56, name: "Limited head", slot: 4, isLimited: 1},
    {id: 57, name: "Limited face", slot: 5, isLimited: 1},
    {id: 58, name: "Limited legs", slot: 6, isLimited: 1}
];

function pickerItems(slotId) {
    if (slotId === 14) {
        return [
            hydratedItems.find(item => item.id === 51),
            {id: 61, name: "Balanced blade", slot: 14, strength: 3, weight: 4, twoHanded: 0},
            {id: 62, name: "Offhand focus", slot: 15, strength: 7, twoHanded: 0},
            {id: 63, name: "Defender shield", slot: 10, strength: 5, twoHanded: 0}
        ];
    }
    return [
        hydratedItems.find(item => item.id === 41),
        hydratedItems.find(item => item.id === 42),
        ...Array.from({length: 19}, (_, index) => ({id: 200 + index, name: `Fixture light ${String(index + 1).padStart(2, "0")}`, slot: 0, strength: index % 8}))
    ];
}

function equipmentTable(page) {
    return page.locator("main > section table").first();
}

async function totalFor(page, shortName) {
    await expect(equipmentTable(page)).toBeVisible();
    const headers = (await equipmentTable(page).locator("thead").first().getByRole("columnheader").allTextContents()).map(value => value.trim());
    const column = headers.indexOf(shortName);
    expect(column).toBeGreaterThan(-1);
    return equipmentTable(page).locator("tbody tr").first().locator("th, td").nth(column).innerText();
}
let baseUrl;
let restoreDependencies;
let restoreAuthDependencies;
let server;

function accountBuilderState(profiles = [accountProfile]) {
    return {
        profiles,
        preferences: accountPreferences,
        preferenceRevision: 1,
        preferencesUpdatedOn: "2026-08-26T12:00:00.000Z",
        storageGeneration: 1,
        usedBytes: profiles.length ? accountProfilePayload.length : 0,
        quotaBytes: 10485760
    };
}

function loadAppWithoutDatabaseMetadataQuery() {
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (request === "sync-rpc")
            return function() { return function() { return []; }; };
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        const authApi = require("../src/routes/api/auth");
        const originalAuthToken = authApi.utils.authToken;
        const originalGetPermissions = authApi.utils.getPermissions;
        authApi.utils.authToken = async function() {
            return {
                memberId: 7,
                username: "Builder Tester",
                email: "builder@example.test",
                emailVerified: true,
                storageNamespace: "0123456789abcdef0123456789abcdef"
            };
        };
        authApi.utils.getPermissions = async function() { return {}; };
        restoreAuthDependencies = function() {
            authApi.utils.authToken = originalAuthToken;
            authApi.utils.getPermissions = originalGetPermissions;
        };
        return require("../src/create-app")({logging: false});
    }
    finally {
        Module._load = originalLoad;
    }
}

test.beforeAll(async function() {
    const app = loadAppWithoutDatabaseMetadataQuery();
    const apiUtils = require("../src/routes/api/utils");
    const originalPostAsync = apiUtils.postAsync;
    apiUtils.postAsync = function(query, _ip, variables) {
        if (query.includes("getItems("))
            return publicPageData(query);
        if (query.includes("getItemStatCategories"))
            return Promise.resolve({getItemStatCategories: itemStatCategories, getItemStatInfo: itemStatInfo});
        if (query.includes("AccountPreferenceBootstrap")) {
            const itemPreferences = variables?.authToken === "item-preference-account";
            if (variables?.authToken === "bootstrap-unavailable-account")
                return Promise.reject(new Error("private preference database diagnostic"));
            return Promise.resolve({getBuilderAccountPreferences: {
                preferences: itemPreferences ? JSON.stringify({
                    version: 1,
                    theme: "dark",
                    itemsPerPage: 20,
                    itemColumns: ["Slot"],
                    builderColumns: {},
                    selectedProfileId: null,
                    selectedVariant: null
                }) : accountPreferences,
                preferenceRevision: itemPreferences ? 4 : 1,
                storageGeneration: itemPreferences ? 2 : 1
            }});
        }
        if (query.includes("getNotifications"))
            return Promise.resolve({getNotifications: {moreResults: false, results: []}});
        return publicPageData(query);
    };
    restoreDependencies = function() {
        apiUtils.postAsync = originalPostAsync;
        if (restoreAuthDependencies)
            restoreAuthDependencies();
    };
    server = await new Promise(function(resolve) {
        const listeningServer = app.listen(0, "127.0.0.1", function() {
            resolve(listeningServer);
        });
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

// Catches Item Search initializing from anonymous sc2 data in a verified
// account or mirroring an account column change back into that device cookie.
test("Item Search applies and saves account columns without changing its cookie", async function({context, page}) {
    await context.addCookies([
        {name: "loginToken", value: "item-preference-account", url: baseUrl},
        {name: "theme", value: "light", url: baseUrl},
        {name: "sc2", value: "Name-", url: baseUrl}
    ]);
    const preferenceRequests = [];
    await page.route(`${baseUrl}/api`, async function(route) {
        const request = route.request().postDataJSON();
        if (!request.query.includes("UpdateBuilderPreferences"))
            return route.fallback();
        preferenceRequests.push(request);
        if (preferenceRequests.length === 1)
            return route.abort("connectionreset");
        const document = JSON.parse(request.variables.preferences);
        return route.fulfill({contentType: "application/json", body: JSON.stringify({data: {
            updateBuilderPreferences: {
                status: "saved",
                preferences: JSON.stringify(document),
                preferenceRevision: 5,
                preferencesUpdatedOn: "2026-08-28T12:01:00.000Z",
                storageGeneration: 2,
                usedBytes: 0,
                quotaBytes: 10_485_760
            }
        }})});
    });

    await page.goto(`${baseUrl}/items/`);
    await expect(page.locator("link#theme")).toHaveAttribute("href", /bootstrap-dark\.min\.css/);
    await page.getByRole("button", {name: "Columns", exact: true}).click();
    await expect(page.getByRole("button", {name: "Slot", exact: true})).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", {name: "Name", exact: true})).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("button", {name: "Name", exact: true}).click();

    await expect(page.getByRole("status").filter({hasText: "Saving account preferences"})).toBeVisible();
    const preferenceProblem = page.getByRole("status").filter({hasText: "Account preference sync problem"});
    await expect(preferenceProblem).toBeVisible({timeout: 2500});
    await expect(preferenceProblem).not.toContainText(/connection|private/i);
    await expect.poll(() => preferenceRequests.length).toBe(2);
    await expect(preferenceProblem).toBeHidden();
    expect(JSON.parse(preferenceRequests[1].variables.preferences)).toEqual({
        version: 1,
        theme: "dark",
        itemsPerPage: 20,
        itemColumns: ["Slot", "Name"],
        builderColumns: {},
        selectedProfileId: null,
        selectedVariant: null
    });
    expect(preferenceRequests[1].variables.storageGeneration).toBe(2);
    expect((await context.cookies(baseUrl)).find(cookie => cookie.name === "sc2")?.value).toBe("Name-");
});

// Catches a non-network preference rejection retrying automatically, exposing
// server text, or preventing the same theme choice from explicitly recovering.
test("theme preference status is fixed, nonretrying, and repeatable after a problem", async function({context, page}) {
    await context.addCookies([{name: "loginToken", value: "item-preference-account", url: baseUrl}]);
    const preferenceRequests = [];
    await page.route(`${baseUrl}/api`, async function(route) {
        const request = route.request().postDataJSON();
        if (!request.query.includes("UpdateBuilderPreferences"))
            return route.fallback();
        preferenceRequests.push(request);
        if (preferenceRequests.length === 1) {
            return route.fulfill({contentType: "application/json", body: JSON.stringify({errors: [{
                message: "private stale preference diagnostic",
                extensions: {code: 409}
            }]})});
        }
        return route.fulfill({contentType: "application/json", body: JSON.stringify({data: {
            updateBuilderPreferences: {
                status: "saved",
                preferences: request.variables.preferences,
                preferenceRevision: 5,
                preferencesUpdatedOn: "2026-08-28T12:01:00.000Z",
                storageGeneration: 2,
                usedBytes: 0,
                quotaBytes: 10_485_760
            }
        }})});
    });

    await page.goto(`${baseUrl}/items/`);
    await page.getByRole("button", {name: "Choose theme"}).click();
    await page.getByRole("button", {name: "Solarized Dark", exact: true}).click();
    const problem = page.getByRole("status").filter({hasText: "Account preference sync problem"});
    await expect(problem).toBeVisible({timeout: 2500});
    await expect(problem).not.toContainText(/private|stale/i);
    await page.waitForTimeout(1250);
    expect(preferenceRequests).toHaveLength(1);

    await page.getByRole("button", {name: "Choose theme"}).click();
    await page.getByRole("button", {name: "Solarized Dark", exact: true}).click();
    await expect.poll(() => preferenceRequests.length).toBe(2);
    await expect(problem).toBeHidden();
});

test.afterAll(async function() {
    if (restoreDependencies)
        restoreDependencies();
    if (server)
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

// Catches verified startup reading or overwriting the retained anonymous
// snapshot, persisting account preferences to cookies, or exporting server
// identity metadata in a Builder string.
test("account mode never overwrites saved Builder browser data", async function({context, page}) {
    await context.addCookies([
        {name: "loginToken", value: "builder-account-token", url: baseUrl},
        {name: "ipp", value: "37", url: baseUrl},
        {name: "sc-Local", value: "Name-", url: baseUrl},
        {name: "cl1", value: "legacy-cookie-lists", url: baseUrl},
        {name: "scl1", value: "legacy-cookie-selection", url: baseUrl}
    ]);
    await page.addInitScript(function() {
        localStorage.setItem("cl2", "legacy-two");
        localStorage.setItem("cl1", "legacy-one");
        localStorage.setItem("cl", "legacy-oldest");
    });
    await page.route(`${baseUrl}/api`, async function(route) {
        const request = route.request().postDataJSON();
        if (request.query.includes("GetBuilderAccountState")) {
            return route.fulfill({contentType: "application/json", body: JSON.stringify({
                data: {getBuilderAccountState: accountBuilderState()}
            })});
        }
        return route.fallback();
    });

    await page.goto(`${baseUrl}/builder/`);
    await expect(page.getByLabel("Character", {exact: true})).toContainText("Guest");
    await expect(page.getByLabel("Character", {exact: true})).not.toContainText("Hero");
    await page.locator("#strInput").fill("44");
    await page.locator("#strInput").blur();
    await page.waitForTimeout(100);

    expect(await page.evaluate(() => ({
        lists: localStorage.getItem("cln"),
        selected: localStorage.getItem("scl"),
        version2: localStorage.getItem("cl2"),
        version1: localStorage.getItem("cl1"),
        legacy: localStorage.getItem("cl")
    }))).toEqual({
        lists: encodedLists,
        selected: "Hero!Tank",
        version2: "legacy-two",
        version1: "legacy-one",
        legacy: "legacy-oldest"
    });
    const browserCookies = await context.cookies(baseUrl);
    const cookieNames = browserCookies.map(cookie => cookie.name);
    expect(cookieNames).not.toContain("sc-Guest");
    expect(Object.fromEntries(browserCookies.map(cookie => [cookie.name, cookie.value]))).toMatchObject({
        ipp: "37",
        "sc-Local": "Name-",
        cl1: "legacy-cookie-lists",
        scl1: "legacy-cookie-selection"
    });
    expect(JSON.stringify(browserCookies)).not.toContain("private-account-preference");

    await page.getByRole("button", {name: "Export", exact: true}).click();
    for (const field of ["#allListsExport", "#curListExport", "#curVariantExport"])
        await expect(page.locator(field)).not.toHaveValue(/account-profile-id/);
});

// Catches a verified account whose lightweight preference bootstrap is
// temporarily unavailable being mistaken for anonymous before Builder's full
// account state enables the shared writable store at runtime.
test("unavailable verified preference bootstrap stays isolated until Builder enables account sync", async function({context, page}) {
    await context.addCookies([
        {name: "loginToken", value: "bootstrap-unavailable-account", url: baseUrl},
        {name: "cookie-consent", value: "true", url: baseUrl},
        {name: "theme", value: "light", url: baseUrl},
        {name: "ipp", value: "37", url: baseUrl},
        {name: "sc2", value: "Name-", url: baseUrl},
        {name: "sc-Guest", value: "Name-", url: baseUrl}
    ]);
    const preferenceRequests = [];
    await page.route(`${baseUrl}/api`, async function(route) {
        const request = route.request().postDataJSON();
        if (request.query.includes("GetBuilderAccountState")) {
            return route.fulfill({contentType: "application/json", body: JSON.stringify({
                data: {getBuilderAccountState: accountBuilderState()}
            })});
        }
        if (request.query.includes("UpdateBuilderPreferences")) {
            preferenceRequests.push(request);
            return route.fulfill({contentType: "application/json", body: JSON.stringify({data: {
                updateBuilderPreferences: {
                    status: "saved",
                    preferences: request.variables.preferences,
                    preferenceRevision: request.variables.preferenceRevision + 1,
                    preferencesUpdatedOn: "2026-08-28T12:01:00.000Z",
                    storageGeneration: 1,
                    usedBytes: 100,
                    quotaBytes: 10_485_760
                }
            }})});
        }
        return route.fallback();
    });

    await page.goto(`${baseUrl}/builder/`);
    await expect(page.locator("link#theme")).toHaveAttribute("href", /bootstrap-glass-blue\.min\.css/);
    await page.getByRole("button", {name: "Hide/Show Columns", exact: true}).click();
    await expect(page.getByRole("button", {name: "Rent", exact: true})).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", {name: "Name", exact: true})).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("Escape");
    await page.getByRole("button", {name: "Choose theme"}).click();
    await page.getByRole("button", {name: "Solarized Dark", exact: true}).click();

    await expect.poll(() => preferenceRequests.length).toBe(1);
    expect(JSON.parse(preferenceRequests[0].variables.preferences).theme).toBe("solarized-dark");
    const cookiesAfter = Object.fromEntries((await context.cookies(baseUrl)).map(cookie => [cookie.name, cookie.value]));
    expect(cookiesAfter).toMatchObject({theme: "light", ipp: "37", sc2: "Name-", "sc-Guest": "Name-"});
});

// Catches an empty verified account falling back to anonymous local profiles
// instead of creating only the first-edit account placeholder in memory.
test("Builder startup creates unsaved Untitled for an empty verified account", async function({context, page}) {
    await context.addCookies([{name: "loginToken", value: "empty-builder-account", url: baseUrl}]);
    await page.route(`${baseUrl}/api`, async function(route) {
        const request = route.request().postDataJSON();
        if (request.query.includes("GetBuilderAccountState")) {
            return route.fulfill({contentType: "application/json", body: JSON.stringify({
                data: {getBuilderAccountState: accountBuilderState([])}
            })});
        }
        return route.fallback();
    });

    await page.goto(`${baseUrl}/builder/`);
    await expect(page.getByLabel("Character", {exact: true})).toContainText("Untitled");
    await expect(page.getByLabel("Character", {exact: true})).not.toContainText("Hero");
    await page.locator("#strInput").fill("1");
    await page.locator("#strInput").blur();
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => localStorage.getItem("cln"))).toBe(encodedLists);
});

// Catches an unsaved account profile retaining the previous profile's columns,
// or its deletion failing to restore the newly selected saved profile columns.
test("Builder loads account columns when unsaved profiles are selected and deleted", async function({context, page}) {
    await context.addCookies([{name: "loginToken", value: "unsaved-delete-account", url: baseUrl}]);
    const preferences = {
        ...JSON.parse(accountPreferences),
        itemColumns: ["Name"],
        builderColumns: {"account-profile-id": ["Rent"]}
    };
    await page.route(`${baseUrl}/api`, async function(route) {
        const request = route.request().postDataJSON();
        if (request.query.includes("GetBuilderAccountState")) {
            return route.fulfill({contentType: "application/json", body: JSON.stringify({data: {
                getBuilderAccountState: {
                    ...accountBuilderState(),
                    preferences: JSON.stringify(preferences)
                }
            }})});
        }
        return route.fallback();
    });

    await page.goto(`${baseUrl}/builder/`);
    await page.getByRole("button", {name: "Add Character", exact: true}).click();
    const addDialog = page.getByRole("dialog", {name: "Add Character"});
    await addDialog.getByLabel("Name").fill("Temporary");
    await addDialog.getByRole("button", {name: "Add", exact: true}).click();
    await page.getByRole("button", {name: "Hide/Show Columns", exact: true}).click();
    await expect(page.getByRole("button", {name: "Name", exact: true})).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", {name: "Rent", exact: true})).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("Escape");

    await page.getByRole("button", {name: "Delete Character", exact: true}).click();
    await page.getByRole("dialog", {name: "Are you sure?"})
        .getByRole("button", {name: "Yes", exact: true}).click();
    await expect(page.getByLabel("Character", {exact: true})).toContainText("Guest");
    await page.getByRole("button", {name: "Hide/Show Columns", exact: true}).click();
    await expect(page.getByRole("button", {name: "Name", exact: true})).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("button", {name: "Rent", exact: true})).toHaveAttribute("aria-pressed", "true");
});

// Catches account paging, stable selection, and per-profile columns being
// replaced by anonymous cookies, or account changes leaking back into them.
test("Builder applies and saves canonical account preferences independently", async function({context, page}) {
    await context.addCookies([
        {name: "loginToken", value: "builder-preference-account", url: baseUrl},
        {name: "theme", value: "light", url: baseUrl},
        {name: "ipp", value: "37", url: baseUrl},
        {name: "sc-Scout", value: "Name-", url: baseUrl}
    ]);
    const preferences = {
        version: 1,
        theme: "dark",
        itemsPerPage: 50,
        itemColumns: ["Name"],
        builderColumns: {
            "account-profile-id": ["Name"],
            "scout-profile-id": ["Rent"]
        },
        selectedProfileId: "scout-profile-id",
        selectedVariant: "Original"
    };
    const scoutProfile = {
        id: "scout-profile-id",
        name: "Scout",
        payload: scoutProfilePayload,
        payloadVersion: 6,
        revision: 2,
        updatedOn: "2026-08-28T12:00:00.000Z"
    };
    const preferenceRequests = [];
    await page.route(`${baseUrl}/api`, async function(route) {
        const request = route.request().postDataJSON();
        if (request.query.includes("GetBuilderAccountState")) {
            return route.fulfill({contentType: "application/json", body: JSON.stringify({data: {
                getBuilderAccountState: {
                    ...accountBuilderState([accountProfile, scoutProfile]),
                    preferences: JSON.stringify(preferences),
                    preferenceRevision: 7,
                    storageGeneration: 3
                }
            }})});
        }
        if (request.query.includes("UpdateBuilderPreferences")) {
            preferenceRequests.push(request);
            const document = JSON.parse(request.variables.preferences);
            return route.fulfill({contentType: "application/json", body: JSON.stringify({data: {
                updateBuilderPreferences: {
                    status: "saved",
                    preferences: JSON.stringify(document),
                    preferenceRevision: 8,
                    preferencesUpdatedOn: "2026-08-28T12:01:00.000Z",
                    storageGeneration: 3,
                    usedBytes: 100,
                    quotaBytes: 10_485_760
                }
            }})});
        }
        return route.fallback();
    });

    await page.goto(`${baseUrl}/builder/`);
    await expect(page.locator("link#theme")).toHaveAttribute("href", /bootstrap-dark\.min\.css/);
    await expect(page.getByLabel("Character", {exact: true})).toHaveValue("1");
    await expect(page.getByLabel("Variant", {exact: true})).toHaveValue("0");
    await page.getByRole("button", {name: "Hide/Show Columns", exact: true}).click();
    await expect(page.getByRole("button", {name: "Rent", exact: true})).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", {name: "Name", exact: true})).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("button", {name: "Name", exact: true}).click();
    await page.keyboard.press("Escape");

    await expect.poll(() => preferenceRequests.length).toBe(1);
    const saved = JSON.parse(preferenceRequests[0].variables.preferences);
    expect(saved).toEqual({
        ...preferences,
        builderColumns: {
            ...preferences.builderColumns,
            "scout-profile-id": ["Name", "Rent"]
        }
    });
    expect(preferenceRequests[0].variables.storageGeneration).toBe(3);
    for (const key of ["cookieConsent", "loginToken", "timezone", "email", "memberId", "storageNamespace", "profiles"])
        expect(Object.hasOwn(saved, key)).toBe(false);

    const cookiesAfter = Object.fromEntries((await context.cookies(baseUrl)).map(cookie => [cookie.name, cookie.value]));
    expect(cookiesAfter).toMatchObject({theme: "light", ipp: "37", "sc-Scout": "Name-"});
});

// Catches account edits staying browser-only, announcing Saved before the
// server response, or exposing private network diagnostics in recovery UI.
test("Builder announces Saving, Sync problem, and committed account saves", async function({context, page}) {
    await context.addCookies([{name: "loginToken", value: "sync-status-account", url: baseUrl}]);
    let updateAttempts = 0;
    let preferenceAttempts = 0;
    await page.route(`${baseUrl}/api`, async function(route) {
        const request = route.request().postDataJSON();
        if (request.query.includes("GetBuilderAccountState")) {
            return route.fulfill({contentType: "application/json", body: JSON.stringify({
                data: {getBuilderAccountState: accountBuilderState()}
            })});
        }
        if (request.query.includes("UpdateBuilderPreferences")) {
            preferenceAttempts += 1;
            return route.fulfill({contentType: "application/json", body: JSON.stringify({errors: [{
                message: "private Builder preference revision diagnostic",
                extensions: {code: 409}
            }]})});
        }
        if (!request.query.includes("UpdateBuilderProfile"))
            return route.fallback();
        updateAttempts += 1;
        if (updateAttempts === 1)
            return route.abort("connectionreset");
        return route.fulfill({contentType: "application/json", body: JSON.stringify({data: {
            updateBuilderProfile: {
                status: "saved",
                profile: {
                    ...accountProfile,
                    payload: request.variables.payload,
                    revision: 5,
                    updatedOn: "2026-08-28T12:00:00.000Z"
                },
                conflictProfile: null,
                storageGeneration: 1,
                usedBytes: request.variables.payload.length,
                quotaBytes: 10485760
            }
        }})});
    });

    await page.goto(`${baseUrl}/builder/`);
    await expect(page.getByText("Saved to account", {exact: true})).toBeVisible();
    await page.locator("#strInput").fill("44");
    await expect(page.getByText("Saving…", {exact: true})).toBeVisible();
    const problem = page.getByText(/Sync problem/);
    await expect(problem).toBeVisible({timeout: 2500});
    await expect(problem).not.toContainText("private");
    await expect(page.getByText("Saved to account", {exact: true})).toBeVisible({timeout: 4000});
    expect(updateAttempts).toBe(2);

    await page.getByRole("button", {name: "Hide/Show Columns", exact: true}).click();
    await page.getByRole("button", {name: "Name", exact: true}).click();
    await page.keyboard.press("Escape");
    const preferenceProblem = page.getByRole("status")
        .filter({hasText: "Account preference sync problem"});
    await expect(preferenceProblem).toBeVisible({timeout: 2500});
    await expect(preferenceProblem).not.toContainText(/private|revision/i);
    await expect(page.getByText("Saved to account", {exact: true})).toBeVisible();
    await page.waitForTimeout(1250);
    expect(preferenceAttempts).toBe(1);
});

// Catches revision conflicts silently replacing the attempted edit, selecting
// the conflict copy, or providing no keyboard-operable export recovery.
test("Builder preserves and announces a saved conflict copy", async function({context, page}) {
    await context.addCookies([{name: "loginToken", value: "sync-conflict-account", url: baseUrl}]);
    await page.route(`${baseUrl}/api`, async function(route) {
        const request = route.request().postDataJSON();
        if (request.query.includes("GetBuilderAccountState")) {
            return route.fulfill({contentType: "application/json", body: JSON.stringify({
                data: {getBuilderAccountState: accountBuilderState()}
            })});
        }
        if (!request.query.includes("UpdateBuilderProfile"))
            return route.fallback();
        const conflictPayload = request.variables.payload.replaceAll("Guest~", "Guest Conflict~");
        return route.fulfill({contentType: "application/json", body: JSON.stringify({data: {
            updateBuilderProfile: {
                status: "conflict",
                profile: {...accountProfile, revision: 5, updatedOn: "2026-08-28T12:00:00.000Z"},
                conflictProfile: {
                    ...accountProfile,
                    id: "conflict-profile-id",
                    name: "Guest Conflict",
                    payload: conflictPayload,
                    revision: 1,
                    updatedOn: "2026-08-28T12:00:00.000Z"
                },
                storageGeneration: 1,
                usedBytes: accountProfilePayload.length + conflictPayload.length,
                quotaBytes: 10485760
            }
        }})});
    });

    await page.goto(`${baseUrl}/builder/`);
    await page.locator("#strInput").fill("44");
    const alert = page.getByRole("alert").filter({hasText: "conflict copy"});
    await expect(alert).toBeVisible({timeout: 2500});
    await expect(alert.getByRole("button", {name: "Export Builder data"})).toBeVisible();
    await expect(page.getByLabel("Character", {exact: true})).toContainText("Guest Conflict");
    await expect(page.getByLabel("Character", {exact: true})).toHaveValue("0");
});

// Catches a profile deleted at home making a work edit disappear instead of
// retaining the server-created conflict copy and another active selection.
test("Builder preserves a conflict copy when the original was deleted elsewhere", async function({context, page}) {
    await context.addCookies([{name: "loginToken", value: "sync-deleted-conflict-account", url: baseUrl}]);
    const preferences = {
        ...JSON.parse(accountPreferences),
        builderColumns: {
            "account-profile-id": ["Rent"],
            "imported-scout-id": ["Name"]
        }
    };
    const preferenceRequests = [];
    await page.route(`${baseUrl}/api`, async function(route) {
        const request = route.request().postDataJSON();
        if (request.query.includes("GetBuilderAccountState")) {
            return route.fulfill({contentType: "application/json", body: JSON.stringify({
                data: {getBuilderAccountState: {
                    ...accountBuilderState([accountProfile, importedAccountProfiles[2]]),
                    preferences: JSON.stringify(preferences)
                }}
            })});
        }
        if (request.query.includes("UpdateBuilderPreferences")) {
            preferenceRequests.push(request);
            return route.fulfill({contentType: "application/json", body: JSON.stringify({data: {
                updateBuilderPreferences: {
                    status: "saved",
                    preferences: request.variables.preferences,
                    preferenceRevision: preferenceRequests.length + 1,
                    preferencesUpdatedOn: "2026-08-28T12:01:00.000Z",
                    storageGeneration: 1,
                    usedBytes: 100,
                    quotaBytes: 10_485_760
                }
            }})});
        }
        if (!request.query.includes("UpdateBuilderProfile"))
            return route.fallback();
        const conflictPayload = request.variables.payload.replaceAll("Guest~", "Guest Conflict~");
        return route.fulfill({contentType: "application/json", body: JSON.stringify({data: {
            updateBuilderProfile: {
                status: "conflict",
                profile: {
                    ...accountProfile,
                    payload: null,
                    payloadVersion: null,
                    revision: 5,
                    updatedOn: "2026-08-28T12:00:00.000Z"
                },
                conflictProfile: {
                    ...accountProfile,
                    id: "deleted-conflict-profile-id",
                    name: "Guest Conflict",
                    payload: conflictPayload,
                    revision: 1,
                    updatedOn: "2026-08-28T12:00:00.000Z"
                },
                storageGeneration: 1,
                usedBytes: scoutProfilePayload.length + conflictPayload.length,
                quotaBytes: 10485760
            }
        }})});
    });

    await page.goto(`${baseUrl}/builder/`);
    await page.locator("#strInput").fill("44");
    await expect(page.getByRole("alert").filter({hasText: "conflict copy"})).toBeVisible({timeout: 2500});
    await expect(page.getByLabel("Character", {exact: true})).not.toContainText(/^Guest$/);
    await expect(page.getByLabel("Character", {exact: true})).toContainText("Guest Conflict");
    await expect(page.getByLabel("Character", {exact: true})).toHaveValue("1");
    await expect(page.getByLabel("Character", {exact: true})).toContainText("Scout");
    await page.getByRole("button", {name: "Hide/Show Columns", exact: true}).click();
    await expect(page.getByRole("button", {name: "Name", exact: true})).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", {name: "Rent", exact: true})).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("Escape");
    await expect.poll(() => preferenceRequests.length).toBe(1);
    const savedPreferences = JSON.parse(preferenceRequests[0].variables.preferences);
    expect(savedPreferences.selectedProfileId).toBe("imported-scout-id");
    expect(savedPreferences.builderColumns).toEqual(preferences.builderColumns);
});

// Catches generation rejection retrying or recreating deleted account data,
// leaking server text, or leaving no export-first recovery action.
test("Builder stops autosave and offers export on storage generation change", async function({context, page}) {
    await context.addCookies([{name: "loginToken", value: "sync-generation-account", url: baseUrl}]);
    let updateAttempts = 0;
    await page.route(`${baseUrl}/api`, async function(route) {
        const request = route.request().postDataJSON();
        if (request.query.includes("GetBuilderAccountState")) {
            return route.fulfill({contentType: "application/json", body: JSON.stringify({
                data: {getBuilderAccountState: accountBuilderState()}
            })});
        }
        if (!request.query.includes("UpdateBuilderProfile"))
            return route.fallback();
        updateAttempts += 1;
        return route.fulfill({contentType: "application/json", body: JSON.stringify({
            errors: [{
                message: "Account storage changed. Reload before saving.",
                extensions: {code: 409, privateDiagnostic: "private generation detail"}
            }]
        })});
    });

    await page.goto(`${baseUrl}/builder/`);
    await page.locator("#strInput").fill("44");
    const alert = page.getByRole("alert").filter({hasText: "Export your unsaved data before reloading."});
    await expect(alert).toBeVisible({timeout: 2500});
    await expect(alert).not.toContainText("private generation detail");
    await expect(alert.getByRole("button", {name: "Export Builder data"})).toBeVisible();
    await expect(alert.getByRole("button", {name: "Reload account data"})).toBeVisible();
    await page.waitForTimeout(1250);
    expect(updateAttempts).toBe(1);
    await page.locator("#minInput").fill("45");
    await page.waitForTimeout(850);
    expect(updateAttempts).toBe(1);
});

// Catches a thrown revision/name/delete 409 being presented as if the server
// had already preserved the edit in a conflict copy.
test("Builder Sync problem reports thrown 409 without claiming a conflict copy", async function({context, page}) {
    await context.addCookies([{name: "loginToken", value: "sync-thrown-conflict-account", url: baseUrl}]);
    let updateAttempts = 0;
    await page.route(`${baseUrl}/api`, async function(route) {
        const request = route.request().postDataJSON();
        if (request.query.includes("GetBuilderAccountState")) {
            return route.fulfill({contentType: "application/json", body: JSON.stringify({
                data: {getBuilderAccountState: accountBuilderState()}
            })});
        }
        if (!request.query.includes("UpdateBuilderProfile"))
            return route.fallback();
        updateAttempts += 1;
        return route.fulfill({status: 409, contentType: "application/json", body: JSON.stringify({
            errors: [{
                message: "private stale revision diagnostic",
                extensions: {code: 409}
            }]
        })});
    });

    await page.goto(`${baseUrl}/builder/`);
    await page.locator("#strInput").fill("44");
    const problem = page.getByRole("status").filter({hasText: "Builder data changed on the server."});
    await expect(problem).toBeVisible({timeout: 2500});
    await expect(problem).not.toContainText(/conflict copy|private/i);
    await expect(problem.getByRole("button", {name: "Export Builder data"})).toBeVisible();
    await expect(problem.getByRole("button", {name: "Reload account data"})).toBeVisible();
    await expect(page.locator("#strInput")).toHaveValue("44");
    await page.waitForTimeout(1000);
    expect(updateAttempts).toBe(1);
});

// Catches quota rejection leaking server text or omitting the fixed account
// limit and an export path while the unsaved edit remains in memory.
test("Builder Sync problem explains the 10 MB account storage limit", async function({context, page}) {
    await context.addCookies([{name: "loginToken", value: "sync-quota-account", url: baseUrl}]);
    let updateAttempts = 0;
    await page.route(`${baseUrl}/api`, async function(route) {
        const request = route.request().postDataJSON();
        if (request.query.includes("GetBuilderAccountState")) {
            return route.fulfill({contentType: "application/json", body: JSON.stringify({
                data: {getBuilderAccountState: accountBuilderState()}
            })});
        }
        if (!request.query.includes("UpdateBuilderProfile"))
            return route.fallback();
        updateAttempts += 1;
        return route.fulfill({status: 413, contentType: "application/json", body: JSON.stringify({
            errors: [{
                message: "private quota diagnostic",
                extensions: {code: 413}
            }]
        })});
    });

    await page.goto(`${baseUrl}/builder/`);
    await page.locator("#strInput").fill("44");
    const problem = page.getByRole("status").filter({hasText: "Builder account storage is limited to 10 MB."});
    await expect(problem).toBeVisible({timeout: 2500});
    await expect(problem).not.toContainText("private quota diagnostic");
    await expect(problem.getByRole("button", {name: "Export Builder data"})).toBeVisible();
    await expect(page.locator("#strInput")).toHaveValue("44");
    await page.waitForTimeout(1000);
    expect(updateAttempts).toBe(1);
});

// Catches an unsaved first edit using update, a completed create losing its ID
// before the next edit, or internal queue metadata crossing the API boundary.
test("Builder creates an empty-account profile once and updates it thereafter", async function({context, page}) {
    await context.addCookies([{name: "loginToken", value: "sync-create-account", url: baseUrl}]);
    const mutations = [];
    await page.route(`${baseUrl}/api`, async function(route) {
        const request = route.request().postDataJSON();
        if (request.query.includes("GetBuilderAccountState")) {
            return route.fulfill({contentType: "application/json", body: JSON.stringify({
                data: {getBuilderAccountState: accountBuilderState([])}
            })});
        }
        const field = request.query.includes("CreateBuilderProfile")
            ? "createBuilderProfile"
            : request.query.includes("UpdateBuilderProfile")
                ? "updateBuilderProfile"
                : null;
        if (!field)
            return route.fallback();
        mutations.push({field, variables: request.variables});
        const revision = field === "createBuilderProfile" ? 1 : 2;
        return route.fulfill({contentType: "application/json", body: JSON.stringify({data: {
            [field]: {
                status: "saved",
                profile: {
                    id: "created-profile-id",
                    name: request.variables.name,
                    payload: request.variables.payload,
                    payloadVersion: 6,
                    revision,
                    updatedOn: "2026-08-28T12:00:00.000Z"
                },
                conflictProfile: null,
                storageGeneration: 1,
                usedBytes: request.variables.payload.length,
                quotaBytes: 10485760
            }
        }})});
    });

    await page.goto(`${baseUrl}/builder/`);
    await page.locator("#strInput").fill("1");
    await expect.poll(() => mutations.length, {timeout: 2500}).toBe(1);
    expect(mutations[0].field).toBe("createBuilderProfile");
    expect(mutations[0].variables).not.toHaveProperty("id");
    expect(JSON.stringify(mutations[0].variables)).not.toContain("queueKey");
    await expect(page.getByText("Saved to account", {exact: true})).toBeVisible();

    await page.locator("#minInput").fill("2");
    await expect.poll(() => mutations.length, {timeout: 2500}).toBe(2);
    expect(mutations[1]).toMatchObject({
        field: "updateBuilderProfile",
        variables: {id: "created-profile-id", revision: 1, storageGeneration: 1}
    });
    expect(JSON.stringify(mutations[1].variables)).not.toContain("queueKey");
});

// Catches confirmed deletion waiting for debounce, removing local state before
// server success, or sending payload/client-only fields to the delete mutation.
test("Builder deletes a saved account profile immediately after confirmation", async function({context, page}) {
    await context.addCookies([{name: "loginToken", value: "sync-delete-account", url: baseUrl}]);
    const deletes = [];
    const preferences = {
        ...JSON.parse(accountPreferences),
        builderColumns: {
            "account-profile-id": ["Rent"],
            "imported-scout-id": ["Name"]
        }
    };
    const preferenceRequests = [];
    await page.route(`${baseUrl}/api`, async function(route) {
        const request = route.request().postDataJSON();
        if (request.query.includes("GetBuilderAccountState")) {
            return route.fulfill({contentType: "application/json", body: JSON.stringify({
                data: {getBuilderAccountState: {
                    ...accountBuilderState([accountProfile, importedAccountProfiles[2]]),
                    preferences: JSON.stringify(preferences)
                }}
            })});
        }
        if (request.query.includes("UpdateBuilderPreferences")) {
            preferenceRequests.push(request);
            return route.fulfill({contentType: "application/json", body: JSON.stringify({data: {
                updateBuilderPreferences: {
                    status: "saved",
                    preferences: request.variables.preferences,
                    preferenceRevision: preferenceRequests.length + 1,
                    preferencesUpdatedOn: "2026-08-28T12:01:00.000Z",
                    storageGeneration: 1,
                    usedBytes: 100,
                    quotaBytes: 10_485_760
                }
            }})});
        }
        if (!request.query.includes("DeleteBuilderProfile"))
            return route.fallback();
        deletes.push(request.variables);
        return route.fulfill({contentType: "application/json", body: JSON.stringify({data: {
            deleteBuilderProfile: {
                status: "deleted",
                profile: {
                    ...accountProfile,
                    payload: null,
                    payloadVersion: null,
                    revision: 5,
                    updatedOn: "2026-08-28T12:00:00.000Z"
                },
                conflictProfile: null,
                storageGeneration: 1,
                usedBytes: scoutProfilePayload.length,
                quotaBytes: 10485760
            }
        }})});
    });

    await page.goto(`${baseUrl}/builder/`);
    await page.getByRole("button", {name: "Delete Character", exact: true}).click();
    await page.getByRole("dialog", {name: "Are you sure?"})
        .getByRole("button", {name: "Yes", exact: true}).click();
    await expect.poll(() => deletes.length).toBe(1);
    expect(deletes[0]).toMatchObject({
        id: "account-profile-id", revision: 4, storageGeneration: 1
    });
    expect(deletes[0]).not.toHaveProperty("payload");
    await expect(page.getByLabel("Character", {exact: true})).toContainText("Scout");
    await page.getByRole("button", {name: "Hide/Show Columns", exact: true}).click();
    await expect(page.getByRole("button", {name: "Name", exact: true})).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", {name: "Rent", exact: true})).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("Escape");
    await expect.poll(() => preferenceRequests.length).toBe(1);
    const savedPreferences = JSON.parse(preferenceRequests[0].variables.preferences);
    expect(savedPreferences.selectedProfileId).toBe("imported-scout-id");
    expect(savedPreferences.builderColumns).toEqual(preferences.builderColumns);
    await expect(page.getByText("Saved to account", {exact: true})).toBeVisible();
});

// Catches account startup failure activating anonymous data, leaking a private
// diagnostic, or exposing no keyboard-operable recovery action.
test("Builder startup keeps verified account failures isolated behind Retry", async function({context, page}) {
    await context.addCookies([{name: "loginToken", value: "retry-builder-account", url: baseUrl}]);
    let attempts = 0;
    await page.route(`${baseUrl}/api`, async function(route) {
        const request = route.request().postDataJSON();
        if (!request.query.includes("GetBuilderAccountState"))
            return route.fallback();
        attempts += 1;
        if (attempts === 1) {
            return route.fulfill({contentType: "application/json", body: JSON.stringify({
                errors: [{message: "private account loader diagnostic"}]
            })});
        }
        return route.fulfill({contentType: "application/json", body: JSON.stringify({
            data: {getBuilderAccountState: accountBuilderState()}
        })});
    });

    await page.goto(`${baseUrl}/builder/`);
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("Builder account data could not be loaded.");
    await expect(alert).not.toContainText("private account loader diagnostic");
    await expect(page.getByLabel("Character", {exact: true})).toHaveCount(0);
    await expect(alert.getByRole("button", {name: "Retry", exact: true})).toBeVisible();
    await alert.getByRole("button", {name: "Retry", exact: true}).click();
    await expect(page.getByLabel("Character", {exact: true})).toContainText("Guest");
    expect(attempts).toBe(2);
    expect(await page.evaluate(() => localStorage.getItem("cln"))).toBe(encodedLists);
});

// Catches a verified startup prerequisite bypassing the stable account error,
// leaking GraphQL/driver text, or activating/writing the anonymous snapshot.
test("Builder startup normalizes verified item metadata failures before account loading", async function({context, page}) {
    await context.addCookies([{name: "loginToken", value: "metadata-builder-account", url: baseUrl}]);
    let metadataAttempts = 0;
    let accountAttempts = 0;
    await page.route(`${baseUrl}/api`, async function(route) {
        const request = route.request().postDataJSON();
        if (request.query.includes("getItemStatInfo")) {
            metadataAttempts += 1;
            if (metadataAttempts === 1) {
                return route.fulfill({contentType: "application/json", body: JSON.stringify({
                    errors: [{message: "private item metadata driver cause"}]
                })});
            }
            return route.fallback();
        }
        if (request.query.includes("GetBuilderAccountState")) {
            accountAttempts += 1;
            return route.fulfill({contentType: "application/json", body: JSON.stringify({
                data: {getBuilderAccountState: accountBuilderState()}
            })});
        }
        return route.fallback();
    });

    await page.goto(`${baseUrl}/builder/`);
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("Builder account data could not be loaded.");
    await expect(alert).not.toContainText("private item metadata driver cause");
    await expect(page.getByLabel("Character", {exact: true})).toHaveCount(0);
    expect(accountAttempts).toBe(0);
    expect(await page.evaluate(() => ({
        lists: localStorage.getItem("cln"), selected: localStorage.getItem("scl")
    }))).toEqual({lists: encodedLists, selected: "Hero!Tank"});

    await alert.getByRole("button", {name: "Retry", exact: true}).click();
    await expect(page.getByLabel("Character", {exact: true})).toContainText("Guest");
    expect(metadataAttempts).toBe(2);
    expect(accountAttempts).toBe(1);
    expect(await page.evaluate(() => localStorage.getItem("cln"))).toBe(encodedLists);
});

// Catches migration uploading before explicit consent, minting a fresh batch
// key on retry, acknowledging a failure, leaking private errors, or activating
// anything other than the strict account state returned by the atomic import.
test("local Builder data offer is theme-readable and marks its caution visually", async function({context, page}) {
    await context.addCookies([
        {name: "loginToken", value: "migration-theme-account", url: baseUrl},
        {name: "theme", value: "glass-blue", url: baseUrl}
    ]);
    await page.route(`${baseUrl}/api`, async function(route) {
        const request = route.request().postDataJSON();
        if (request.query.includes("GetBuilderAccountState")) {
            return route.fulfill({contentType: "application/json", body: JSON.stringify({
                data: {getBuilderAccountState: accountBuilderState()}
            })});
        }
        return route.fallback();
    });

    await page.goto(`${baseUrl}/builder/`);
    await expect(page.locator("link#theme")).toHaveAttribute(
        "href", /bootstrap-glass-blue\.min\.css/
    );
    const offer = page.getByRole("region", {name: "Local Builder data"});
    await expect(offer).toBeVisible();
    await expect(offer.locator('[aria-hidden="true"]')).toContainText("⚠");

    const results = await new AxeBuilder({page})
        .include('[aria-label="Local Builder data"]')
        .withRules(["color-contrast"])
        .analyze();
    expect(results.violations, JSON.stringify(results.violations)).toEqual([]);
});

// Catches hundreds of browser profiles expanding the Builder page or copy
// dialog instead of moving names into one bounded, keyboard-scrollable list.
test("local Builder data scales from a count into a bounded profile list", async function({context, page}) {
    const profileNames = Array.from(
        {length: 125},
        (_, index) => `Profile ${String(index + 1).padStart(3, "0")}`
    );
    const tankRow = currentTankExport.split("*")[1];
    const largeEncodedLists = `6*${profileNames.map(name =>
        tankRow.replace(/^Hero~/, `${name}~`)).join("*")}*`;
    await context.addCookies([
        {name: "loginToken", value: "large-migration-account", url: baseUrl},
        {name: "theme", value: "glass-blue", url: baseUrl}
    ]);
    await page.addInitScript(value => localStorage.setItem("cln", value), largeEncodedLists);
    await page.route(`${baseUrl}/api`, async function(route) {
        const request = route.request().postDataJSON();
        if (request.query.includes("GetBuilderAccountState")) {
            return route.fulfill({contentType: "application/json", body: JSON.stringify({
                data: {getBuilderAccountState: accountBuilderState()}
            })});
        }
        return route.fallback();
    });

    await page.goto(`${baseUrl}/builder/`);
    const offer = page.getByRole("region", {name: "Local Builder data"});
    await expect(offer).toContainText("125 profiles");
    await expect(offer).not.toContainText("Profile 001");
    await expect(offer.locator(".card-header [aria-hidden=\"true\"]")).toHaveCount(0);
    await expect(offer.locator(".card-body > [aria-hidden=\"true\"]")).toContainText("⚠");
    await expect(offer.locator(".card-body")).toHaveCSS("display", "flex");

    await offer.getByRole("button", {name: "Review local Builder data"}).click();
    const dialog = page.getByRole("dialog", {name: "Copy local Builder data"});
    await expect(dialog.getByRole("group", {name: "Builder preferences"})).toHaveCount(0);
    const profileList = dialog.getByRole("region", {name: "125 local Builder profiles"});
    await expect(profileList).toContainText("Profile 001");
    await expect(profileList).toContainText("Profile 125");
    await expect.poll(() => profileList.evaluate(element =>
        element.scrollHeight > element.clientHeight)).toBe(true);
});

test("local Builder data migration is explicit, retry-safe, private, and reports every result", async function({context, page}) {
    await context.addCookies([
        {name: "loginToken", value: "migration-builder-account", url: baseUrl},
        {name: "theme", value: "dark", url: baseUrl},
        {name: "ipp", value: "50", url: baseUrl},
        {name: "sc2", value: "Slot-AC-HP-", url: baseUrl},
        {name: "sc-Hero", value: "Name-Str-", url: baseUrl},
        {name: "sc-Scout", value: "Rent-Name-", url: baseUrl}
    ]);
    const privateMalformedRow = "private<malformed>builder-row";
    const mixedEncodedLists = encodedLists.replace(
        "*Scout~Original",
        `*${privateMalformedRow}*Scout~Original`
    );
    await page.addInitScript(value => localStorage.setItem("cln", value), mixedEncodedLists);
    const idempotencyKeys = [];
    let importAttempts = 0;
    let releaseFirstImport;
    let markFirstImportStarted;
    const firstImportGate = new Promise(resolve => { releaseFirstImport = resolve; });
    const firstImportStarted = new Promise(resolve => { markFirstImportStarted = resolve; });
    await page.route(`${baseUrl}/api`, async function(route) {
        const request = route.request().postDataJSON();
        if (request.query.includes("GetBuilderAccountState")) {
            return route.fulfill({contentType: "application/json", body: JSON.stringify({
                data: {getBuilderAccountState: {
                    ...accountBuilderState(),
                    preferences: canonicalDefaultPreferences
                }}
            })});
        }
        if (!request.query.includes("ImportBuilderProfiles"))
            return route.fallback();
        importAttempts += 1;
        idempotencyKeys.push(request.variables.idempotencyKey);
        expect(request.variables.profiles.map(profile => profile.name)).toEqual(["Hero", "Scout"]);
        const preferences = JSON.parse(request.variables.preferences);
        expect(preferences).toEqual({
            version: 1,
            theme: "dark",
            itemsPerPage: 50,
            itemColumns: ["Slot", "Ac", "Hp"],
            builderColumns: {
                "local-1": ["Name", "Str"],
                "local-2": ["Rent", "Name"]
            },
            selectedProfileId: "local-1",
            selectedVariant: "Tank"
        });
        const {authToken, ...migrationVariables} = request.variables;
        expect(authToken).toBe("migration-builder-account");
        expect(migrationVariables.replacePreferences).toBe(true);
        expect(JSON.stringify(migrationVariables)).not.toContain("migration-builder-account");
        expect(JSON.stringify(migrationVariables)).not.toContain(privateMalformedRow);
        if (importAttempts === 1) {
            markFirstImportStarted();
            await firstImportGate;
            return route.fulfill({contentType: "application/json", body: JSON.stringify({
                errors: [{message: "database rejected 6*private-builder-payload"}]
            })});
        }
        return route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({data: {
                importBuilderProfiles: {
                    result: JSON.stringify({
                        copied: ["Scout"],
                        renamed: [{from: "Hero", to: "Hero Local"}],
                        deduplicated: ["Same"],
                        rejected: [{
                            name: null,
                            reason: "decoder rejected 6*private-builder-payload"
                        }],
                        preferencesImported: true
                    }),
                    state: accountBuilderState(importedAccountProfiles)
                }
            }})
        });
    });

    await page.goto(`${baseUrl}/builder/`);
    const offer = page.getByRole("region", {name: "Local Builder data"});
    await expect(offer).toContainText("2 profiles");
    await expect(offer).not.toContainText("Hero");
    await expect(offer).not.toContainText("Scout");
    expect(importAttempts).toBe(0);
    expect(await page.evaluate(() => localStorage.getItem(
        "legendhub-builder-import:0123456789abcdef0123456789abcdef"
    ))).toBeNull();

    const trigger = offer.getByRole("button", {name: "Review local Builder data"});
    await trigger.focus();
    await trigger.click();
    const dialog = page.getByRole("dialog", {name: "Copy local Builder data"});
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("region", {name: "2 local Builder profiles"})).toContainText("Hero");
    await expect(dialog.getByRole("region", {name: "2 local Builder profiles"})).toContainText("Scout");
    await expect(dialog.getByRole("button", {name: "Copy all to my account"})).toBeFocused();
    await expect(dialog.getByRole("group", {name: "Builder preferences"})).toHaveCount(0);
    await dialog.getByRole("button", {name: "Copy all to my account"}).click();
    await firstImportStarted;
    await expect(dialog.getByRole("button", {name: "Close"})).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    releaseFirstImport();

    const alert = dialog.getByRole("alert");
    await expect(alert).toContainText("Local Builder data could not be copied. Try again.");
    await expect(alert).not.toContainText("private-builder-payload");
    expect(await page.evaluate(() => localStorage.getItem(
        "legendhub-builder-import:0123456789abcdef0123456789abcdef"
    ))).toBeNull();

    await dialog.getByRole("button", {name: "Copy all to my account"}).click();
    expect(idempotencyKeys).toHaveLength(2);
    expect(idempotencyKeys[1]).toBe(idempotencyKeys[0]);
    await expect(dialog.locator("#builder-migration-result")).toBeFocused();
    await expect(dialog.getByRole("heading", {name: "Copied"})).toBeVisible();
    await expect(dialog.getByText("Scout", {exact: true})).toBeVisible();
    await expect(dialog.getByText("Hero → Hero Local", {exact: true})).toBeVisible();
    await expect(dialog.getByText("Same", {exact: true})).toBeVisible();
    await expect(dialog.getByText("Local row 3 — Could not be copied.", {exact: true})).toBeVisible();
    const resultList = dialog.getByRole("region", {name: "Profile copy results"});
    await expect(resultList).toHaveCSS("overflow-y", "auto");
    await expect(resultList).not.toHaveCSS("max-height", "none");
    await expect(dialog.getByRole("heading", {name: "Copied (1)"})).toBeVisible();
    await expect(dialog).toContainText("This browser's Builder preferences are now saved to your account.");
    await expect(dialog.getByText("Server rejection 1 — Could not be copied.", {exact: true})).toBeVisible();
    await expect(dialog).not.toContainText("private-builder-payload");
    await expect(dialog).not.toContainText(privateMalformedRow);
    await expect(page.getByLabel("Character", {exact: true})).toContainText("Guest");
    await expect(page.getByLabel("Character", {exact: true})).toContainText("Hero");
    await expect(page.getByLabel("Character", {exact: true})).toContainText("Scout");
    expect(await page.evaluate(() => ({
        acknowledgement: localStorage.getItem(
            "legendhub-builder-import:0123456789abcdef0123456789abcdef"
        ),
        anonymousLists: localStorage.getItem("cln")
    }))).toEqual({
        acknowledgement: expect.stringMatching(/^profiles-v1:[a-f0-9]{64}$/),
        anonymousLists: mixedEncodedLists
    });

    await dialog.getByRole("button", {name: "Close results"}).click();
    await expect(page.getByRole("region", {name: "Local Builder data"})).toHaveCount(0);
});

// Catches dismissal modifying browser data, calling the import mutation, or
// failing to acknowledge the exact local fingerprint for the next login.
test("local Builder data migration dismissal retains browser source and hides the offer", async function({context, page}) {
    await context.addCookies([{name: "loginToken", value: "dismiss-migration-account", url: baseUrl}]);
    let importAttempts = 0;
    await page.route(`${baseUrl}/api`, async function(route) {
        const request = route.request().postDataJSON();
        if (request.query.includes("GetBuilderAccountState")) {
            return route.fulfill({contentType: "application/json", body: JSON.stringify({
                data: {getBuilderAccountState: {
                    ...accountBuilderState(),
                    preferences: canonicalDefaultPreferences,
                    preferenceRevision: 1
                }}
            })});
        }
        if (request.query.includes("ImportBuilderProfiles"))
            importAttempts += 1;
        return route.fallback();
    });

    await page.goto(`${baseUrl}/builder/`);
    const offer = page.getByRole("region", {name: "Local Builder data"});
    const trigger = offer.getByRole("button", {name: "Review local Builder data"});
    await trigger.click();
    const dialog = page.getByRole("dialog", {name: "Copy local Builder data"});
    await expect(dialog.getByRole("group", {name: "Builder preferences"})).toHaveCount(0);
    await dialog.getByRole("button", {name: "Not now"}).click();

    expect(importAttempts).toBe(0);
    await expect(page.getByRole("region", {name: "Local Builder data"})).toHaveCount(0);
    expect(await page.evaluate(() => ({
        acknowledgement: localStorage.getItem(
            "legendhub-builder-import:0123456789abcdef0123456789abcdef"
        ),
        anonymousLists: localStorage.getItem("cln")
    }))).toEqual({
        acknowledgement: expect.stringMatching(/^profiles-v1:[a-f0-9]{64}$/),
        anonymousLists: encodedLists
    });

    await page.reload();
    await expect(page.getByLabel("Character", {exact: true})).toBeVisible();
    await expect(page.getByRole("region", {name: "Local Builder data"})).toHaveCount(0);
    expect(importAttempts).toBe(0);
});

// Catches a local acknowledgement quota/privacy failure converting a committed
// atomic server import into a false retryable failure.
test("successful local Builder data migration survives acknowledgement storage failure", async function({context, page}) {
    await context.addCookies([{name: "loginToken", value: "migration-ack-failure", url: baseUrl}]);
    let importAttempts = 0;
    await page.route(`${baseUrl}/api`, async function(route) {
        const request = route.request().postDataJSON();
        if (request.query.includes("GetBuilderAccountState")) {
            return route.fulfill({contentType: "application/json", body: JSON.stringify({
                data: {getBuilderAccountState: accountBuilderState()}
            })});
        }
        if (!request.query.includes("ImportBuilderProfiles"))
            return route.fallback();
        importAttempts += 1;
        return route.fulfill({contentType: "application/json", body: JSON.stringify({data: {
            importBuilderProfiles: {
                result: JSON.stringify({
                    copied: ["Hero", "Scout"],
                    renamed: [],
                    deduplicated: [],
                    rejected: [],
                    preferencesImported: false
                }),
                state: accountBuilderState(importedAccountProfiles)
            }
        }})});
    });

    await page.goto(`${baseUrl}/builder/`);
    await page.evaluate(function() {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function(name, value) {
            if (name.startsWith("legendhub-builder-import:"))
                throw new DOMException("private acknowledgement diagnostic", "QuotaExceededError");
            return original.call(this, name, value);
        };
    });
    const offer = page.getByRole("region", {name: "Local Builder data"});
    await offer.getByRole("button", {name: "Review local Builder data"}).click();
    const dialog = page.getByRole("dialog", {name: "Copy local Builder data"});
    await dialog.getByRole("button", {name: "Copy all to my account"}).click();

    await expect(dialog.locator("#builder-migration-result")).toBeFocused();
    await expect(dialog).toContainText("The copy completed, but this browser could not remember it.");
    await expect(dialog).not.toContainText("private acknowledgement diagnostic");
    await expect(page.getByLabel("Character", {exact: true})).toContainText("Hero");
    expect(importAttempts).toBe(1);
    expect(await page.evaluate(() => ({
        acknowledgement: localStorage.getItem(
            "legendhub-builder-import:0123456789abcdef0123456789abcdef"
        ),
        anonymousLists: localStorage.getItem("cln")
    }))).toEqual({acknowledgement: null, anonymousLists: encodedLists});

    await dialog.getByRole("button", {name: "Close results"}).click();
    await expect(page.getByRole("region", {name: "Local Builder data"})).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("region", {name: "Local Builder data"})).toBeVisible();
    expect(importAttempts).toBe(1);
});

// Catches optional item-detail hydration converting an already committed
// atomic import into a retryable migration failure or withholding its receipt.
test("successful local Builder data migration survives item hydration failure", async function({context, page}) {
    await context.addCookies([{name: "loginToken", value: "migration-hydration-failure", url: baseUrl}]);
    let importAttempts = 0;
    let hydrationAttempts = 0;
    const privateHydrationDiagnostic = "private post-import hydration diagnostic";
    await page.route(`${baseUrl}/api`, async function(route) {
        const request = route.request().postDataJSON();
        if (request.query.includes("GetBuilderAccountState")) {
            return route.fulfill({contentType: "application/json", body: JSON.stringify({
                data: {getBuilderAccountState: accountBuilderState()}
            })});
        }
        if (request.query.includes("ImportBuilderProfiles")) {
            importAttempts += 1;
            return route.fulfill({contentType: "application/json", body: JSON.stringify({data: {
                importBuilderProfiles: {
                    result: JSON.stringify({
                        copied: ["Hero", "Scout"],
                        renamed: [],
                        deduplicated: [],
                        rejected: [],
                        preferencesImported: false
                    }),
                    state: accountBuilderState(importedAccountProfiles)
                }
            }})});
        }
        if (request.query.includes("getItemsInIds")) {
            hydrationAttempts += 1;
            if (hydrationAttempts === 1) {
                return route.fulfill({contentType: "application/json", body: JSON.stringify({data: {
                    getItemsInIds: hydratedItems.filter(item => request.variables.ids.includes(item.id))
                }})});
            }
            return route.fulfill({
                status: 503,
                contentType: "application/json",
                body: JSON.stringify({errors: [{message: privateHydrationDiagnostic}]})
            });
        }
        return route.fallback();
    });

    await page.goto(`${baseUrl}/builder/`);
    const offer = page.getByRole("region", {name: "Local Builder data"});
    await offer.getByRole("button", {name: "Review local Builder data"}).click();
    const dialog = page.getByRole("dialog", {name: "Copy local Builder data"});
    await dialog.getByRole("button", {name: "Copy all to my account"}).click();

    await expect(dialog.locator("#builder-migration-result")).toBeFocused();
    await expect(dialog.getByText("Hero", {exact: true})).toBeVisible();
    await expect(dialog.getByText("Scout", {exact: true})).toBeVisible();
    await expect(dialog).not.toContainText("Local Builder data could not be copied");
    await expect(dialog).not.toContainText(privateHydrationDiagnostic);
    expect(importAttempts).toBe(1);
    expect(hydrationAttempts).toBe(2);
    expect(await page.evaluate(() => ({
        acknowledgement: localStorage.getItem(
            "legendhub-builder-import:0123456789abcdef0123456789abcdef"
        ),
        anonymousLists: localStorage.getItem("cln")
    }))).toEqual({
        acknowledgement: expect.stringMatching(/^profiles-v1:[a-f0-9]{64}$/),
        anonymousLists: encodedLists
    });

    await dialog.getByRole("button", {name: "Close results"}).click();
    await expect(page.getByRole("region", {name: "Local Builder data"})).toHaveCount(0);
    await expect(page.getByLabel("Character", {exact: true})).toContainText("Guest");
    await expect(page.getByLabel("Character", {exact: true})).toContainText("Hero");
    await expect(page.getByLabel("Character", {exact: true})).toContainText("Scout");
    const warning = page.getByRole("alert").filter({
        hasText: "Saved builder data could not be hydrated. Retry to restore item details."
    });
    await expect(warning).toBeVisible();
    await expect(warning).not.toContainText(privateHydrationDiagnostic);
    expect(importAttempts).toBe(1);
});

// Catches the same best-effort acknowledgement boundary preventing Not now
// from closing or changing the retained anonymous source.
test("local Builder data dismissal closes when acknowledgement storage fails", async function({context, page}) {
    await context.addCookies([{name: "loginToken", value: "dismiss-ack-failure", url: baseUrl}]);
    await page.route(`${baseUrl}/api`, async function(route) {
        const request = route.request().postDataJSON();
        if (request.query.includes("GetBuilderAccountState")) {
            return route.fulfill({contentType: "application/json", body: JSON.stringify({
                data: {getBuilderAccountState: accountBuilderState()}
            })});
        }
        return route.fallback();
    });

    await page.goto(`${baseUrl}/builder/`);
    const offer = page.getByRole("region", {name: "Local Builder data"});
    const trigger = offer.getByRole("button", {name: "Review local Builder data"});
    await trigger.click();
    await page.evaluate(function() {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function(name, value) {
            if (name.startsWith("legendhub-builder-import:"))
                throw new DOMException("private dismissal diagnostic", "QuotaExceededError");
            return original.call(this, name, value);
        };
    });
    await page.getByRole("dialog", {name: "Copy local Builder data"})
        .getByRole("button", {name: "Not now"}).click();

    await expect(page.getByRole("dialog", {name: "Copy local Builder data"})).toHaveCount(0);
    await expect(page.getByRole("region", {name: "Local Builder data"})).toHaveCount(0);
    expect(await page.evaluate(() => ({
        acknowledgement: localStorage.getItem(
            "legendhub-builder-import:0123456789abcdef0123456789abcdef"
        ),
        anonymousLists: localStorage.getItem("cln")
    }))).toEqual({acknowledgement: null, anonymousLists: encodedLists});

    await page.reload();
    await expect(page.getByRole("region", {name: "Local Builder data"})).toBeVisible();
});

test.beforeEach(async function({context, page}) {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {origin: baseUrl});
    await context.addCookies([{name: "cookie-consent", value: "true", url: baseUrl}]);
    await page.addInitScript(function(value) {
        if (!localStorage.getItem("cln"))
            localStorage.setItem("cln", value);
        if (!localStorage.getItem("scl"))
            localStorage.setItem("scl", "Hero!Tank");
    }, encodedLists);
    await page.route(`${baseUrl}/api`, async function(route) {
        const request = route.request().postDataJSON();
        const query = request.query;
        if (query.includes("getItemStatInfo")) {
            return route.fulfill({contentType: "application/json", body: JSON.stringify({data: {
                getItemStatInfo: itemStatInfo,
                getItemFragment: itemFragment
            }})});
        }
        if (query.includes("getItemsBySlotId"))
            return route.fulfill({contentType: "application/json", body: JSON.stringify({data: {getItemsBySlotId: pickerItems(request.variables.slotId)}})});
        if (query.includes("getItemsInIds"))
            return route.fulfill({contentType: "application/json", body: JSON.stringify({data: {getItemsInIds: hydratedItems.filter(item => request.variables.ids.includes(item.id))}})});
        return route.abort();
    });
    await context.route(/^https?:\/\//, function(route) {
        if (route.request().url().startsWith(baseUrl))
            return route.continue();
        return fulfillLocalBrowserScript(route);
    });
});

// Catches migration regressions that lose persisted variants, calculated stats, collapsed modifiers, exports, or consent-gated saving.
test("Builder preserves persisted characters, variants, totals, panels, and export workflow", async function({page}) {
    await page.setViewportSize({width: 1280, height: 720});
    const response = await page.goto(`${baseUrl}/builder/`);
    expect(response).not.toBeNull();
    expect(response.status()).toBe(200);

    await expect(page.locator('[data-react-root="builder"]')).toHaveCount(1);
    await expect(page.getByText("Saved in this browser", {exact: true})).toBeVisible();
    await expect(page.getByLabel("Character", {exact: true})).toHaveValue("0");
    await expect(page.getByLabel("Variant", {exact: true})).toHaveValue("0");
    await expect(page.getByLabel("Variant", {exact: true})).toContainText("Tank Variant");
    await page.getByLabel("Variant", {exact: true}).selectOption("1");
    await expect(page.locator("#strInput")).toHaveValue("30");

    const ksm = page.getByRole("button", {name: "KSM Swap/Quest Mods", exact: true});
    await expect(ksm).toHaveAttribute("aria-expanded", "false");
    await expect(ksm.locator(".collapse-caret")).toHaveCount(1);
    await ksm.click();
    await expect(ksm).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByLabel("Longhouse", {exact: true})).toBeVisible();
    await expect(page.getByLabel("Quest HP", {exact: true})).toBeVisible();
    const era = page.getByRole("button", {name: "Era Abilities", exact: true});
    await era.click();
    await expect(era).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".era-abilities-table")).toHaveCount(3);

    await page.locator("#strInput").fill("44");
    await page.locator("#strInput").blur();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("scl"))).toBe("Hero!Caster");
    await expect.poll(() => page.evaluate(() => localStorage.getItem("cln")?.startsWith("6*"))).toBe(true);

    await page.getByRole("button", {name: "Export", exact: true}).click();
    await expect(page.getByRole("dialog", {name: "Export Lists"})).toBeVisible();
    await expect(page.locator("#allListsExport")).toHaveValue(/^6\*/);
    await expect(page.getByRole("button", {name: /^Copy /})).toHaveCount(3);
    await page.getByRole("button", {name: "Copy All Lists", exact: true}).click();
    await expect(page.getByRole("status")).toHaveText("All Lists copied.");
    await expect(page.evaluate(() => navigator.clipboard.readText())).resolves.toMatch(/^6\*Hero~Tank~/);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", {name: "Export", exact: true})).toBeFocused();
});

// Catches the Character and Variant selector actions regressing from the
// compact legacy icon controls back to visible word labels.
test("Builder character and variant actions use their legacy icons", async function({page}) {
    await page.goto(`${baseUrl}/builder/`);
    const cases = [
        ["Delete Character", "fa-trash"],
        ["Edit Character", "fa-edit"],
        ["Add Character", "fa-plus"],
        ["Delete Variant", "fa-trash"],
        ["Edit Variant", "fa-edit"],
        ["Add Variant", "fa-clone"]
    ];

    for (const [name, icon] of cases) {
        const button = page.getByRole("button", {name, exact: true});
        await expect(button).toBeVisible();
        await expect(button).toHaveText("");
        await expect(button.locator(`i.fas.${icon}`)).toHaveCount(1);
    }
});

// Catches the below-244 stat-quest bonus and its original per-stat help text
// disappearing from the React Stats card.
test("Builder shows stat-quest bonuses with hover and focus help", async function({page}) {
    await page.goto(`${baseUrl}/builder/`);
    const stats = page.locator('[aria-labelledby="builder-stats-heading"]');
    const bonuses = stats.locator(".builder-stat-quest-bonus");
    await expect(bonuses).toHaveCount(6);
    expect((await bonuses.allTextContents()).map(value => value.trim())).toEqual(["3", "3", "3", "3", "3", "3"]);

    const help = bonuses;
    expect(await help.evaluateAll(elements => elements.map(element => element.getAttribute("aria-label")))).toEqual([
        "...has been rewarded for aiding a goddess!",
        "...is smarter than the average Cyclops!",
        "...has bested the tricks and traps on the island of Circe!",
        "...has ventured into the Realm of the Dead and returned to tell the tale!",
        "...drank the nectar of the Black Lotus and lived to tell the tale!",
        "...has learned of the art and spirit of music."
    ]);
    expect(await help.evaluateAll(elements => elements.map(element => element.tabIndex))).toEqual([0, 0, 0, 0, 0, 0]);
    await help.first().hover();
    await expect(page.locator(".tooltip.show")).toContainText("...has been rewarded for aiding a goddess!");
    await stats.getByRole("heading", {name: "Stats", exact: true}).hover();
    await expect(page.locator(".tooltip.show")).toHaveCount(0);
    await help.nth(1).focus();
    await expect(page.locator(".tooltip.show")).toContainText("...is smarter than the average Cyclops!");
    await page.locator("#strInput").fill("146");
    await expect(bonuses).toHaveCount(0);
});

// Catches the long equipment table losing its repeated footer navigation or
// making a stat value clickable only through a non-semantic table-cell handler.
test("Builder equipment footer repeats totals and stat cells use real controls", async function({page}) {
    await page.goto(`${baseUrl}/builder/`);
    const table = equipmentTable(page);
    await expect(table).toBeVisible();
    const expectedHeaders = ["Slot", "Lock", "Name", "Str", "Hit", "Dam", "HP", "Ma", "Mv", "AC", "Rent", "Light"];
    expect((await table.locator("thead").getByRole("columnheader").allTextContents()).map(value => value.trim())).toEqual(expectedHeaders);
    const footer = table.locator("tfoot");
    await expect(footer).toBeVisible();
    await expect(footer.getByRole("row").first()).toHaveClass(/bg-dark text-white/);
    expect((await footer.getByRole("columnheader").allTextContents()).map(value => value.trim())).toEqual(expectedHeaders);
    await expect(footer.getByRole("rowheader", {name: "Total", exact: true})).toBeVisible();
    await expect(footer.getByRole("row").nth(1).locator("th, td").nth(3)).toContainText("104");

    const itemRow = table.locator("tbody tr").nth(1);
    const strengthCell = itemRow.locator("td").nth(2);
    await expect(strengthCell).toHaveRole("cell");
    await strengthCell.getByRole("button", {name: "Choose Limited light by Strength", exact: true}).click();
    await expect(page.getByRole("dialog", {name: "Choose Item"})).toBeVisible();
});

// The legacy Builder opened the item picker from the whole Name cell, not only
// from the visible item-name text. Keep the larger pointer target while using a
// real button for keyboard and assistive-technology semantics.
test("Builder item name cells remain clickable across the whole cell", async function({page}) {
    await page.goto(`${baseUrl}/builder/`);
    const itemRow = equipmentTable(page).locator("tbody tr").nth(1);
    const nameCell = itemRow.getByRole("rowheader");
    const bounds = await nameCell.boundingBox();
    expect(bounds).not.toBeNull();

    await nameCell.click({position: {x: bounds.width - 40, y: bounds.height / 2}});
    await expect(page.getByRole("dialog", {name: "Choose Item"})).toBeVisible();
});

// Catches picker results limiting selection to the item-name cell instead of
// accepting pointer input from any stat cell across the result row.
test("Builder picker item rows select from any result cell", async function({page}) {
    await page.goto(`${baseUrl}/builder/`);
    await page.getByLabel("Variant", {exact: true}).selectOption("1");
    const equipmentRow = equipmentTable(page).locator("tbody tr").nth(1);
    await equipmentRow.getByRole("button", {name: "Brass lantern", exact: true}).click();

    const dialog = page.getByRole("dialog", {name: "Choose Item"});
    const resultRow = dialog.locator(".builder-picker-results tbody tr")
        .filter({hasText: "Faux moonlight"});
    const statCell = resultRow.getByRole("cell").nth(1);
    const bounds = await statCell.boundingBox();
    expect(bounds).not.toBeNull();

    await statCell.click({position: {x: bounds.width / 2, y: bounds.height / 2}});
    await expect(dialog).toHaveCount(0);
    await expect(equipmentRow).toContainText("Faux moonlight");
});

// Catches the React table dropping the centered alignment used by the legacy
// Builder for both repeated header rows and both repeated total rows.
test("Builder centers repeated equipment headers and totals", async function({page}) {
    await page.goto(`${baseUrl}/builder/`);
    const table = equipmentTable(page);
    await expect(table).toBeVisible();

    const topHeaderAlignment = await table.locator("thead tr").first().locator("th").evaluateAll(cells => cells.map(cell => getComputedStyle(cell).textAlign));
    const topTotalAlignment = await table.locator("tbody tr").first().locator("th, td").evaluateAll(cells => cells.map(cell => getComputedStyle(cell).textAlign));
    const bottomHeaderAlignment = await table.locator("tfoot tr").first().locator("th").evaluateAll(cells => cells.map(cell => getComputedStyle(cell).textAlign));
    const bottomTotalAlignment = await table.locator("tfoot tr").nth(1).locator("th, td").evaluateAll(cells => cells.map(cell => getComputedStyle(cell).textAlign));

    expect(topHeaderAlignment).toEqual(["center", "center", "center", "center", "center", "center", "center", "center", "center", "center", "center", "center"]);
    expect(topTotalAlignment).toEqual(["center", "center", "center", "center", "center", "center", "center", "center", "center", "center", "center", "center"]);
    expect(bottomHeaderAlignment).toEqual(["center", "center", "center", "center", "center", "center", "center", "center", "center", "center", "center", "center"]);
    expect(bottomTotalAlignment).toEqual(["center", "center", "center", "center", "center", "center", "center", "center", "center", "center", "center", "center"]);
});

// Catches the React body rows dropping the legacy compact padding, centered
// slot/lock presentation, or non-wrapping slot and total values.
test("Builder equipment body rows preserve legacy alignment wrapping and density", async function({context, page}) {
    await context.addCookies([{name: "theme", value: "glass-blue", url: baseUrl}]);
    await page.setViewportSize({width: 1280, height: 720});
    await page.goto(`${baseUrl}/builder/`);
    const table = equipmentTable(page);
    const totalRow = table.locator("tbody tr").first();
    const itemRow = table.locator("tbody tr").nth(1);
    const slotCell = itemRow.locator("th, td").nth(0);
    const lockCell = itemRow.locator("th, td").nth(1);
    const nameCell = itemRow.locator("th, td").nth(2);
    const statButton = itemRow.getByRole("button", {name: "Choose Limited light by Strength", exact: true});
    const totalLabel = totalRow.getByRole("rowheader", {name: "Total", exact: true});
    const totalStat = totalRow.locator("th, td").nth(3);

    expect(await slotCell.evaluate(element => {
        const style = getComputedStyle(element);
        return {textAlign: style.textAlign, whiteSpace: style.whiteSpace, paddingTop: style.paddingTop, paddingBottom: style.paddingBottom};
    })).toEqual({textAlign: "center", whiteSpace: "nowrap", paddingTop: "0px", paddingBottom: "0px"});
    expect(await lockCell.evaluate(element => {
        const style = getComputedStyle(element);
        return {textAlign: style.textAlign, paddingTop: style.paddingTop, paddingBottom: style.paddingBottom};
    })).toEqual({textAlign: "center", paddingTop: "0px", paddingBottom: "0px"});
    const desktopRowHeight = await itemRow.evaluate(element => element.getBoundingClientRect().height);
    expect(desktopRowHeight).toBeGreaterThanOrEqual(19);
    expect(desktopRowHeight).toBeLessThanOrEqual(20);
    expect(await nameCell.evaluate(element => {
        const style = getComputedStyle(element);
        return {paddingTop: style.paddingTop, paddingBottom: style.paddingBottom};
    })).toEqual({paddingTop: "0px", paddingBottom: "0px"});
    expect(await statButton.evaluate(element => {
        const style = getComputedStyle(element);
        return {textAlign: style.textAlign, paddingTop: style.paddingTop, paddingBottom: style.paddingBottom};
    })).toEqual({textAlign: "center", paddingTop: "0px", paddingBottom: "0px"});
    await expect(totalStat).toHaveCSS("white-space", "nowrap");
    await expect(totalLabel).toHaveCSS("font-weight", "400");

    await page.setViewportSize({width: 375, height: 667});
    expect(await nameCell.evaluate(element => {
        const style = getComputedStyle(element);
        return {paddingTop: style.paddingTop, paddingBottom: style.paddingBottom};
    })).toEqual({paddingTop: "4px", paddingBottom: "4px"});
    expect(await statButton.evaluate(element => {
        const style = getComputedStyle(element);
        return {paddingTop: style.paddingTop, paddingBottom: style.paddingBottom};
    })).toEqual({paddingTop: "4px", paddingBottom: "4px"});
});

// Catches the Glass theme turning compact equipment-table actions into
// rounded, bordered buttons inside already-bordered cells.
test("Builder Glass table actions stay visually integrated and keyboard visible", async function({context, page}) {
    await context.addCookies([{name: "theme", value: "glass-blue", url: baseUrl}]);
    await page.goto(`${baseUrl}/builder/`);
    const table = equipmentTable(page);
    const row = table.locator("tbody tr").nth(1);
    const actions = [
        table.getByRole("button", {name: "Lock all items", exact: true}).first(),
        row.getByRole("button", {name: /^Toggle lock for /}),
        row.getByRole("button", {name: "Limited light", exact: true}),
        row.getByRole("button", {name: "Choose Limited light by Strength", exact: true})
    ];

    for (const action of actions) {
        await expect(action).toHaveClass(/builder-table-action/);
        expect(await action.evaluate(element => {
            const style = getComputedStyle(element);
            return {
                backgroundImage: style.backgroundImage,
                borderTopWidth: style.borderTopWidth,
                borderRadius: style.borderRadius,
                boxShadow: style.boxShadow,
                textShadow: style.textShadow
            };
        })).toEqual({
            backgroundImage: "none",
            borderTopWidth: "0px",
            borderRadius: "0px",
            boxShadow: "none",
            textShadow: "none"
        });
    }

    await actions[1].focus();
    await expect(actions[1]).toHaveCSS("outline-style", "solid");
    await expect(actions[1].locator(".fa-lock, .fa-unlock")).toHaveCount(1);
});

// Catches the semantic item-name button losing the legacy row-header color
// and emphasis while remaining keyboard operable.
test("Builder item-name actions preserve legacy table emphasis", async function({context, page}) {
    await context.addCookies([{name: "theme", value: "glass-blue", url: baseUrl}]);
    await page.goto(`${baseUrl}/builder/`);
    const row = equipmentTable(page).locator("tbody tr").nth(1);
    const nameCell = row.locator("th, td").nth(2);
    const nameAction = row.getByRole("button", {name: "Limited light", exact: true});
    const cellColor = await nameCell.evaluate(element => getComputedStyle(element).color);

    expect(await nameAction.evaluate(element => {
        const style = getComputedStyle(element);
        return {color: style.color, fontWeight: style.fontWeight};
    })).toEqual({color: cellColor, fontWeight: "700"});
});

// Catches either total-row bulk control changing every lock without the legacy
// confirmation, or using stale wording after all items become locked.
test("Builder bulk lock controls confirm cancel and apply for both lock states", async function({page}) {
    await page.goto(`${baseUrl}/builder/`);
    const table = equipmentTable(page);
    const itemLocks = table.getByRole("button", {name: /^Toggle lock for /});
    await expect(itemLocks).toHaveCount(35);
    expect((await itemLocks.evaluateAll(buttons => buttons.map(button => button.getAttribute("aria-pressed")))).some(value => value === "false")).toBe(true);

    let bulk = table.getByRole("button", {name: "Lock all items", exact: true});
    await expect(bulk).toHaveCount(2);
    await bulk.first().click();
    let dialog = page.getByRole("dialog", {name: "Confirm lock all items"});
    await expect(dialog).toContainText("Are you sure you want to lock all items?");
    await dialog.getByRole("button", {name: "Close"}).click();
    expect((await itemLocks.evaluateAll(buttons => buttons.map(button => button.getAttribute("aria-pressed")))).some(value => value === "false")).toBe(true);

    await bulk.nth(1).click();
    dialog = page.getByRole("dialog", {name: "Confirm lock all items"});
    await dialog.getByRole("button", {name: "Yes", exact: true}).click();
    expect((await itemLocks.evaluateAll(buttons => buttons.map(button => button.getAttribute("aria-pressed")))).every(value => value === "true")).toBe(true);

    bulk = table.getByRole("button", {name: "Unlock all items", exact: true});
    await expect(bulk).toHaveCount(2);
    await bulk.first().click();
    dialog = page.getByRole("dialog", {name: "Confirm unlock all items"});
    await expect(dialog).toContainText("Are you sure you want to unlock all items?");
    await dialog.getByRole("button", {name: "Close"}).click();
    expect((await itemLocks.evaluateAll(buttons => buttons.map(button => button.getAttribute("aria-pressed")))).every(value => value === "true")).toBe(true);

    await bulk.nth(1).click();
    dialog = page.getByRole("dialog", {name: "Confirm unlock all items"});
    await dialog.getByRole("button", {name: "Yes", exact: true}).click();
    expect((await itemLocks.evaluateAll(buttons => buttons.map(button => button.getAttribute("aria-pressed")))).every(value => value === "false")).toBe(true);
});

// Catches a React dialog that only looks modal: keyboard users must stay in it,
// close it with Escape, and return to the control that opened it.
test("Builder dialogs contain focus and restore their trigger", async function({page}) {
    await page.goto(`${baseUrl}/builder/`);
    const trigger = page.getByRole("button", {name: "Import", exact: true});
    await trigger.click();
    const dialog = page.getByRole("dialog", {name: "Import Lists"});
    await expect(dialog).toBeVisible();
    await expect(page.locator("#builder-import")).toBeFocused();
    expect(await page.getByLabel("Character", {exact: true}).evaluate(element => element.closest("[inert]") != null)).toBe(true);
    await page.getByLabel("Character", {exact: true}).evaluate(element => element.focus());
    await expect(page.locator("#builder-import")).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("button", {name: "Close", exact: true})).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("button", {name: "Import", exact: true})).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", {name: "Close", exact: true})).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
});

// Catches long Builder dialogs leaving wheel scrolling on the page or clipping
// item results instead of scrolling the dialog body within a short viewport.
test("Builder picker scrolls within the viewport and locks the page behind it", async function({page}) {
    await page.setViewportSize({width: 900, height: 420});
    await page.goto(`${baseUrl}/builder/`);
    await equipmentTable(page).locator("tbody tr").nth(1).getByRole("button", {name: "Limited light", exact: true}).click();

    const dialog = page.getByRole("dialog", {name: "Choose Item"});
    const dialogBody = dialog.locator(".modal-body");
    await expect(dialog.locator(".modal-dialog")).toHaveClass(/modal-dialog-scrollable/);
    await expect(page.locator("body")).toHaveClass(/modal-open/);
    expect(await dialogBody.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);

    const pageScroll = await page.evaluate(() => scrollY);
    await dialogBody.hover();
    await page.mouse.wheel(0, 500);
    await expect.poll(() => dialogBody.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    expect(await page.evaluate(() => scrollY)).toBe(pageScroll);

    await dialog.getByRole("button", {name: "Close", exact: true}).click();
    await expect(page.locator("body")).not.toHaveClass(/modal-open/);
});

// Catches the item picker inheriting the generic Builder dialog width, moving
// its primary search below the comparison card, or dropping the total row.
test("Builder item picker restores the wide search-first comparison layout", async function({context, page}) {
    await context.addCookies([{name: "theme", value: "glass-blue", url: baseUrl}]);
    await page.setViewportSize({width: 1280, height: 720});
    await page.goto(`${baseUrl}/builder/`);
    await equipmentTable(page).locator("tbody tr").nth(1).getByRole("button", {name: "Limited light", exact: true}).click();

    const dialog = page.getByRole("dialog", {name: "Choose Item"});
    const dialogBox = await dialog.locator(".modal-dialog").boundingBox();
    expect(dialogBox).not.toBeNull();
    expect(dialogBox.width).toBeGreaterThan(1100);

    const searchBox = await dialog.getByLabel("Search items").boundingBox();
    const comparisonHeadingBox = await dialog.getByRole("heading", {name: "Current Item and Stats", exact: true}).boundingBox();
    expect(searchBox).not.toBeNull();
    expect(comparisonHeadingBox).not.toBeNull();
    expect(searchBox.y).toBeLessThan(comparisonHeadingBox.y);

    const comparisonTable = dialog.locator("table").first();
    await expect(comparisonTable.getByRole("row").filter({hasText: /^Total/})).toHaveCount(1);
});

// Catches the result grid losing the familiar row separation, hover cue, or
// visible sorting vocabulary while its headers remain interactive buttons.
test("Builder item picker restores result-table and sort affordances", async function({context, page}) {
    await context.addCookies([{name: "theme", value: "glass-blue", url: baseUrl}]);
    await page.setViewportSize({width: 1280, height: 720});
    await page.goto(`${baseUrl}/builder/`);
    await equipmentTable(page).locator("tbody tr").nth(1).getByRole("button", {name: "Limited light", exact: true}).click();

    const dialog = page.getByRole("dialog", {name: "Choose Item"});
    const resultTable = dialog.locator("table").nth(1);
    const resultRows = resultTable.locator("tbody tr");
    const firstRowColor = await resultRows.nth(0).evaluate(element => getComputedStyle(element).backgroundColor);
    const secondRowColor = await resultRows.nth(1).evaluate(element => getComputedStyle(element).backgroundColor);
    expect(firstRowColor).not.toBe(secondRowColor);
    expect(await resultRows.nth(0).locator("td").first().evaluate(element => getComputedStyle(element).borderLeftWidth)).not.toBe("0px");

    const hoverColor = secondRowColor;
    await resultRows.nth(1).hover();
    await expect.poll(() => resultRows.nth(1).evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe(hoverColor);

    const headers = resultTable.getByRole("columnheader");
    await expect(resultTable.locator("thead i.fas[class*='fa-sort']")).toHaveCount(await headers.count());
    await headers.first().getByRole("button", {name: "Name", exact: true}).click();
    await expect(headers.first().getByRole("button", {name: "Name descending", exact: true}).locator("i.fa-sort-down")).toHaveCount(1);
});

// Catches locked choices dimming only their names without explaining why the
// result grid cannot currently replace the equipped item.
test("Builder item picker explains and consistently styles locked choices", async function({context, page}) {
    await context.addCookies([{name: "theme", value: "glass-blue", url: baseUrl}]);
    await page.goto(`${baseUrl}/builder/`);
    await equipmentTable(page).locator("tbody tr").nth(1).getByRole("button", {name: "Limited light", exact: true}).click();

    const dialog = page.getByRole("dialog", {name: "Choose Item"});
    const lockMessage = dialog.getByText("This slot is locked. Unlock the current item to choose a replacement.", {exact: true});
    await expect(lockMessage).toBeVisible();

    const resultTable = dialog.locator("table").nth(1);
    const firstResult = resultTable.locator("tbody tr").first();
    await expect(firstResult.getByRole("button", {name: "-", exact: true})).toBeDisabled();
    await expect(firstResult.locator("td").nth(1)).toHaveCSS("opacity", "0.65");
    const lockedNameCell = firstResult.getByRole("cell").first();
    const lockedBounds = await lockedNameCell.boundingBox();
    expect(lockedBounds).not.toBeNull();
    await lockedNameCell.click({position: {
        x: lockedBounds.width - 40,
        y: lockedBounds.height / 2
    }});
    await expect(dialog).toBeVisible();
    await expect(equipmentTable(page).locator("tbody tr").nth(1)).toContainText("Limited light");

    await dialog.getByRole("button", {name: "Unlock current item", exact: true}).click();
    await expect(lockMessage).toHaveCount(0);
    await expect(firstResult.getByRole("button", {name: "-", exact: true})).toBeEnabled();
    await expect(firstResult.locator("td").nth(1)).toHaveCSS("opacity", "1");
});

// Catches the shared Builder Columns picker clipping lower choices or
// scrolling the document behind it on a short mobile screen.
test("Builder Columns scrolls as a modal and locks the page behind it", async function({page}) {
    await page.setViewportSize({width: 375, height: 420});
    await page.goto(`${baseUrl}/builder/`);
    const trigger = page.getByRole("button", {name: "Hide/Show Columns", exact: true}).filter({visible: true});
    await trigger.click();

    const dialog = page.getByRole("dialog", {name: "Select visible columns"});
    await expect(dialog).toBeVisible();
    await expect(page.locator("body")).toHaveClass(/modal-open/);
    await expect(dialog).toHaveCSS("overflow-y", "auto");
    expect(await dialog.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);

    const pageScroll = await page.evaluate(() => scrollY);
    await dialog.locator(".modal-content").hover({position: {x: 10, y: 200}});
    await page.mouse.wheel(0, 500);
    await expect.poll(() => dialog.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    expect(await page.evaluate(() => scrollY)).toBe(pageScroll);

    await dialog.getByRole("button", {name: "Close", exact: true}).click();
    await expect(page.locator("body")).not.toHaveClass(/modal-open/);
    await expect(trigger).toBeFocused();
});

// Catches hydration that loses representative normal, faux, missing, or rune
// equipment as lists reload, switch, and enter through the import workflow.
test("Builder hydrates persisted and imported equipment without changing its encoding", async function({page}) {
    await page.goto(`${baseUrl}/builder/`);
    const rows = equipmentTable(page).locator("tbody tr");
    await expect(rows.nth(2)).toContainText("Singular ring");
    await expect(rows.nth(4)).toContainText("Runecharm (Uruz/Eihwaz/Gebo)");
    await expect(rows.nth(19)).toContainText("DELETED");

    await page.getByLabel("Variant", {exact: true}).selectOption("1");
    await expect(rows.nth(1)).toContainText("Brass lantern");
    await expect(rows.nth(4)).toContainText("Faux moonlight");
    await page.getByLabel("Character", {exact: true}).selectOption({label: "Scout"});
    await expect(rows.nth(1)).toContainText("Brass lantern");
    await expect.poll(() => page.evaluate(() => localStorage.getItem("scl"))).toBe("Scout!Original");
    await page.reload();
    await expect(page.getByLabel("Character", {exact: true})).toHaveValue("1");
    await expect.poll(() => page.evaluate(() => localStorage.getItem("cln"))).toBe(encodedLists);
    await page.getByLabel("Character", {exact: true}).selectOption({label: "Hero"});
    await page.getByLabel("Variant", {exact: true}).selectOption({label: "Caster Variant"});
    await expect(rows.nth(4)).toContainText("Faux moonlight");
    await page.getByLabel("Variant", {exact: true}).selectOption({label: "Tank Variant"});
    await expect(rows.nth(4)).toContainText("Runecharm (Uruz/Eihwaz/Gebo)");
    await expect(rows.nth(19)).toContainText("DELETED");

    await page.getByRole("button", {name: "Import", exact: true}).click();
    await page.locator("#builder-import").fill(guestImport);
    await page.getByRole("dialog", {name: "Import Lists"}).getByRole("button", {name: "Import", exact: true}).click();
    await page.getByLabel("Character", {exact: true}).selectOption({label: "Guest"});
    await expect(rows.nth(1)).toContainText("Brass lantern");
    await expect(rows.nth(4)).toContainText("Runecharm (Uruz/Eihwaz/Gebo)");
});

// Catches a transient hydration outage rewriting the exact saved bytes before
// the player can retry and recover the corresponding item metadata.
test("Builder preserves exact saved data through failed hydration and visible retry", async function({page}) {
    let hydrationAttempts = 0;
    await page.route(`${baseUrl}/api`, async function(route) {
        const request = route.request().postDataJSON();
        if (request.query.includes("getItemStatInfo")) {
            return route.fulfill({contentType: "application/json", body: JSON.stringify({data: {getItemStatInfo: itemStatInfo, getItemFragment: itemFragment}})});
        }
        if (request.query.includes("getItemsInIds")) {
            hydrationAttempts++;
            if (hydrationAttempts === 1)
                return route.fulfill({status: 503, contentType: "application/json", body: JSON.stringify({errors: [{message: "Database temporarily unavailable"}]})});
            return route.fulfill({contentType: "application/json", body: JSON.stringify({data: {getItemsInIds: hydratedItems.filter(item => request.variables.ids.includes(item.id))}})});
        }
        return route.fallback();
    });

    await page.goto(`${baseUrl}/builder/`);
    const alert = page.getByRole("alert").filter({hasText: "Saved builder data could not be hydrated"});
    await expect(alert).toBeVisible();
    await expect(alert.getByRole("button", {name: "Retry", exact: true})).toBeVisible();
    expect(await page.getByLabel("Character", {exact: true}).locator("option").allTextContents()).toEqual(["Hero", "Scout"]);
    await expect.poll(() => page.evaluate(() => localStorage.getItem("cln"))).toBe(encodedLists);
    await alert.getByRole("button", {name: "Retry", exact: true}).click();
    await expect(equipmentTable(page).locator("tbody tr").nth(4)).toContainText("Runecharm (Uruz/Eihwaz/Gebo)");
    await expect.poll(() => hydrationAttempts).toBe(2);
    await expect.poll(() => page.evaluate(() => localStorage.getItem("cln"))).toBe(encodedLists);
});

// Catches an initial metadata outage enabling persistence and replacing valid
// saved character bytes with the temporary Untitled fallback.
test("Builder leaves saved character bytes untouched when initial metadata fails", async function({page}) {
    await page.route(`${baseUrl}/api`, async function(route) {
        const request = route.request().postDataJSON();
        if (request.query.includes("getItemStatInfo")) {
            return route.fulfill({
                status: 503,
                contentType: "application/json",
                body: JSON.stringify({errors: [{message: "Metadata temporarily unavailable"}]})
            });
        }
        return route.fallback();
    });

    await page.goto(`${baseUrl}/builder/`);
    await expect(page.getByRole("alert")).toContainText("The request could not be completed");
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => ({
        lists: localStorage.getItem("cln"),
        selected: localStorage.getItem("scl")
    }))).toEqual({lists: encodedLists, selected: "Hero!Tank"});
});

// Catches malformed or future-version saved data being treated as a blank,
// successfully hydrated Builder and persisted over the original bytes.
test("Builder leaves malformed and unsupported saved character bytes untouched", async function({page}) {
    for (const savedLists of ["6*malformed", "7*Future~Original~opaque*"]) {
        await page.goto(`${baseUrl}/cookies.html`);
        await page.evaluate(function(value) {
            localStorage.setItem("cln", value);
            localStorage.setItem("scl", "Future!Original");
        }, savedLists);

        await page.goto(`${baseUrl}/builder/`);
        await expect(page.getByRole("alert")).toBeVisible();
        await page.waitForTimeout(100);
        expect(await page.evaluate(() => ({
            lists: localStorage.getItem("cln"),
            selected: localStorage.getItem("scl")
        }))).toEqual({lists: savedLists, selected: "Future!Original"});
    }
});

// Catches a picker that accepts only placeholder data or drops the established
// comparison, wield, sort, pagination, detail, unlock, and rune workflows.
test("Builder picker selects schema-shaped normal, faux, wield, and rune choices", async function({context, page}) {
    await context.addCookies([{name: "ipp", value: "2", url: baseUrl}]);
    await page.goto(`${baseUrl}/builder/`);
    const rows = equipmentTable(page).locator("tbody tr");
    await page.getByLabel("Variant", {exact: true}).selectOption("1");
    await rows.nth(1).getByRole("button", {name: "Brass lantern", exact: true}).click();
    let dialog = page.getByRole("dialog", {name: "Choose Item"});
    await expect(dialog.getByRole("link", {name: "Open details for Brass lantern in a new tab"}).first()).toHaveAttribute("href", "/items/details.html?id=41");
    await dialog.getByLabel("Search items").fill("Faux moonlight");
    await dialog.getByRole("button", {name: "Faux moonlight", exact: true}).click();
    await expect(rows.nth(1)).toContainText("Faux moonlight");
    await rows.nth(1).getByRole("button", {name: "Faux moonlight", exact: true}).click();
    dialog = page.getByRole("dialog", {name: "Choose Item"});
    await dialog.getByLabel("Search items").fill("");
    await expect(dialog.getByRole("navigation", {name: "Item result navigation"})).toBeVisible();
    await dialog.getByRole("button", {name: "Next", exact: true}).click();
    await expect(dialog.getByRole("button", {name: "2", exact: true})).toHaveAttribute("aria-current", "page");
    await page.keyboard.press("Escape");

    await page.getByLabel("Variant", {exact: true}).selectOption("0");
    await rows.nth(17).getByRole("button", {name: "Massive greatsword", exact: true}).click();
    dialog = page.getByRole("dialog", {name: "Choose Item"});
    await dialog.getByLabel("Slot Filter").selectOption("1");
    const resultTable = dialog.locator("table.mt-3");
    await expect(resultTable.getByRole("link", {name: "Open details for Balanced blade in a new tab", exact: true})).toHaveAttribute("href", "/items/details.html?id=61");
    await expect(dialog.getByRole("button", {name: "Offhand focus", exact: true})).toHaveCount(0);
    await expect(dialog.getByRole("button", {name: "Defender shield", exact: true})).toHaveCount(0);
    await dialog.getByLabel("Slot Filter").selectOption("2");
    await expect(dialog.getByRole("button", {name: "Offhand focus", exact: true})).toBeVisible();
    await expect(dialog.getByRole("button", {name: "Balanced blade", exact: true})).toHaveCount(0);
    await dialog.getByLabel("Search items").fill("Str>6");
    await expect(dialog.getByRole("button", {name: "Offhand focus", exact: true})).toBeVisible();
    await dialog.getByLabel("Slot Filter").selectOption("3");
    await expect(dialog.getByRole("button", {name: "Defender shield", exact: true})).toHaveCount(0);
    await dialog.getByLabel("Search items").fill("");
    await expect(dialog.getByRole("button", {name: "Defender shield", exact: true})).toBeVisible();
    await dialog.getByRole("button", {name: /Name/}).click();
    await expect(dialog.getByRole("button", {name: "Name descending", exact: true})).toBeVisible();
    await dialog.getByRole("button", {name: "Defender shield", exact: true}).click();
    await expect(rows.nth(17)).toContainText("Defender shield");

    await rows.nth(1).getByRole("button", {name: "Limited light", exact: true}).click();
    dialog = page.getByRole("dialog", {name: "Choose Item"});
    await expect(dialog.getByRole("button", {name: "Brass lantern", exact: true})).toBeDisabled();
    await dialog.getByRole("button", {name: "Unlock current item", exact: true}).click();
    await expect(dialog.getByRole("button", {name: "Brass lantern", exact: true})).toBeEnabled();
    await dialog.getByRole("button", {name: "Brass lantern", exact: true}).click();
    await expect(rows.nth(1)).toContainText("Brass lantern");

    await rows.nth(4).getByRole("button", {name: "Runecharm (Uruz\/Eihwaz\/Gebo)", exact: true}).click();
    dialog = page.getByRole("dialog", {name: "Choose Item"});
    await expect(dialog.getByLabel("Rune charm 1")).toHaveValue("B");
    await expect(dialog.getByLabel("Rune charm 2")).toHaveValue("H");
    await expect(dialog.getByLabel("Rune charm 3")).toHaveValue("K");
    await dialog.getByRole("button", {name: "Save Runecharm", exact: true}).click();
    await expect(rows.nth(4)).toContainText("Runecharm (Uruz/Eihwaz/Gebo)");
});

// Catches list dialogs that scope duplicate checks to the wrong entity type,
// lose multi-character typing, or omit add/rename/delete variant behavior.
test("Builder character and variant dialogs validate, duplicate, rename, and delete", async function({page}) {
    await page.goto(`${baseUrl}/builder/`);
    await page.getByRole("button", {name: "Add Character", exact: true}).click();
    let dialog = page.getByRole("dialog", {name: "Add Character"});
    await dialog.getByLabel("Name").fill("Bad!");
    await dialog.getByRole("button", {name: "Add", exact: true}).click();
    await expect(dialog.getByRole("alert")).toHaveText("Invalid characters.");
    await dialog.getByLabel("Name").fill("Hero");
    await dialog.getByRole("button", {name: "Add", exact: true}).click();
    await expect(dialog.getByRole("alert")).toHaveText("Duplicate entry.");
    await dialog.getByLabel("Name").fill("Tank");
    await dialog.getByRole("button", {name: "Add", exact: true}).click();
    await expect(page.getByLabel("Character", {exact: true})).toContainText("Tank");

    await page.getByRole("button", {name: "Edit Character", exact: true}).click();
    dialog = page.getByRole("dialog", {name: "Edit Character"});
    await dialog.getByLabel("Name").pressSequentially("Bravo Team");
    await expect(dialog.getByLabel("Name")).toHaveValue("TankBravo Team");
    await dialog.getByLabel("Name").fill("Bravo Team");
    await dialog.getByRole("button", {name: "Save", exact: true}).click();
    await expect(page.getByLabel("Character", {exact: true})).toContainText("Bravo Team");

    await page.getByRole("button", {name: "Add Variant", exact: true}).click();
    dialog = page.getByRole("dialog", {name: "Add Variant"});
    await dialog.getByLabel("Name").fill("Bravo Team");
    await dialog.getByRole("button", {name: "Add", exact: true}).click();
    await expect(page.getByLabel("Variant", {exact: true})).toContainText("Bravo Team Variant");
    await page.getByRole("button", {name: "Add Variant", exact: true}).click();
    dialog = page.getByRole("dialog", {name: "Add Variant"});
    await dialog.getByLabel("Name").fill("Bravo Team");
    await dialog.getByRole("button", {name: "Add", exact: true}).click();
    const variantError = dialog.getByRole("alert");
    await expect(variantError).toHaveText("Duplicate entry.");
    await expect(dialog.getByLabel("Name")).toHaveAttribute("aria-invalid", "true");
    await expect(dialog.getByLabel("Name")).toHaveAttribute("aria-describedby", await variantError.getAttribute("id"));
    await page.keyboard.press("Escape");
    await page.getByRole("button", {name: "Edit Variant", exact: true}).click();
    dialog = page.getByRole("dialog", {name: "Edit Variant"});
    await dialog.getByLabel("Name").fill("Field Build");
    await dialog.getByRole("button", {name: "Save", exact: true}).click();
    await expect(page.getByLabel("Variant", {exact: true})).toContainText("Field Build Variant");
    await page.getByRole("button", {name: "Delete Variant", exact: true}).click();
    await page.getByRole("dialog", {name: "Are you sure?"}).getByRole("button", {name: "Yes", exact: true}).click();
    await expect(page.getByLabel("Variant", {exact: true})).toContainText("Original Variant");
    await page.getByRole("button", {name: "Delete Character", exact: true}).click();
    await page.getByRole("dialog", {name: "Are you sure?"}).getByRole("button", {name: "Yes", exact: true}).click();
    await expect(page.getByLabel("Character", {exact: true})).not.toContainText("Bravo Team");
});

// Catches import branches that conflate empty, malformed, skip, overwrite, and
// successful new-list behavior.
test("Builder import handles empty, invalid, duplicate, overwrite, and success paths", async function({page}) {
    await page.goto(`${baseUrl}/builder/`);
    await page.getByRole("button", {name: "Import", exact: true}).click();
    let dialog = page.getByRole("dialog", {name: "Import Lists"});
    await dialog.getByRole("button", {name: "Import", exact: true}).click();
    await expect(dialog.getByRole("alert")).toHaveText("Invalid list import string.");
    await dialog.getByLabel("Builder list import string").fill("not-a-list");
    await expect(dialog.getByRole("alert")).toHaveText("Invalid list import string.");
    await dialog.getByLabel("Builder list import string").fill(duplicateTankImport);
    await expect(dialog.getByRole("alert")).toContainText("already exist");
    const overwrite = dialog.getByLabel("Overwrite Hero Tank");
    await expect(overwrite).toBeChecked();
    await overwrite.uncheck();
    await dialog.getByRole("button", {name: "Import", exact: true}).click();
    await expect(page.locator("#strInput")).toHaveValue("100");

    await page.getByRole("button", {name: "Import", exact: true}).click();
    dialog = page.getByRole("dialog", {name: "Import Lists"});
    await dialog.getByLabel("Builder list import string").fill(duplicateTankImport);
    await dialog.getByRole("button", {name: "Import", exact: true}).click();
    await expect(page.locator("#strInput")).toHaveValue("33");
    await page.getByRole("button", {name: "Import", exact: true}).click();
    dialog = page.getByRole("dialog", {name: "Import Lists"});
    await dialog.getByLabel("Builder list import string").fill(newHeroVariantImport);
    await dialog.getByRole("button", {name: "Import", exact: true}).click();
    await page.getByLabel("Variant", {exact: true}).selectOption({label: "Newcomer Variant"});
    await expect(equipmentTable(page).locator("tbody tr").nth(1)).toContainText("Faux moonlight");
    await page.getByRole("button", {name: "Import", exact: true}).click();
    dialog = page.getByRole("dialog", {name: "Import Lists"});
    await dialog.getByLabel("Builder list import string").fill(guestImport);
    await dialog.getByRole("button", {name: "Import", exact: true}).click();
    await expect(page.getByLabel("Character", {exact: true})).toContainText("Guest");
});

// Catches calculated resource/ability totals or warning text that is visible
// but not programmatically associated with the affected item/stat cell.
test("Builder renders literal totals, modifiers, abilities, and associated warnings", async function({page}) {
    await page.goto(`${baseUrl}/builder/`);
    expect(await totalFor(page, "Str")).toContain("104");
    expect(await totalFor(page, "Hit")).toContain("14 (2)");
    expect(await totalFor(page, "Dam")).toContain("39 (0)");
    expect(await totalFor(page, "HP")).toContain("358");
    expect(await totalFor(page, "Ma")).toContain("429");
    expect(await totalFor(page, "Mv")).toContain("490");
    expect(await totalFor(page, "AC")).toContain("98");
    expect(await totalFor(page, "Rent")).toContain("1553");
    expect(await totalFor(page, "Light")).toBe("");

    const heavyCell = equipmentTable(page).locator("tbody tr").nth(17).locator("td").first();
    await expect(heavyCell).toHaveClass(/bg-danger/);
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await heavyCell.hover();
    let tooltip = page.getByRole("tooltip");
    await expect(tooltip).toHaveText("You need 120 strength to wield this. You do not have enough hands to hold this item.");
    await expect(heavyCell).toHaveAttribute("aria-describedby", await tooltip.getAttribute("id"));
    await page.locator(".navbar-brand").hover();
    await expect(tooltip).toHaveCount(0);
    await heavyCell.focus();
    tooltip = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible();
    await expect(heavyCell).toHaveAttribute("aria-describedby", await tooltip.getAttribute("id"));
    await heavyCell.evaluate(element => element.blur());
    await expect(tooltip).toHaveCount(0);

    const statCell = equipmentTable(page).locator("tbody tr").first().locator("th, td").nth(3);
    await expect(statCell).toHaveClass(/bg-danger/);
    await statCell.hover();
    await expect(page.getByRole("tooltip")).toHaveText("The overall limit for this stat is 104. You currently have 115.");

    await page.getByRole("button", {name: "KSM Swap/Quest Mods", exact: true}).click();
    await expect(page.getByLabel("Quest HP", {exact: true})).toHaveValue("17");
    await expect(page.getByLabel("Quest Mana", {exact: true})).toHaveValue("23");
    await expect(page.getByLabel("Quest Mv", {exact: true})).toHaveValue("29");
    await page.getByLabel("Quest HP", {exact: true}).fill("18");
    expect(await totalFor(page, "HP")).toContain("359");
    await page.locator("#ksm-strength").fill("2");
    await expect(page.getByText("Total KSM stats must equal zero.", {exact: true})).toBeVisible();
    await page.locator("#ksm-mind").fill("-2");
    await page.locator("#ksm-strength").fill("4");
    await page.locator("#ksm-mind").fill("-4");
    await expect(page.getByText("You can only swap stats a maximum of three times.", {exact: true})).toBeVisible();

    await page.getByRole("button", {name: "Era Abilities", exact: true}).click();
    await page.getByLabel("Weapon Focus", {exact: true}).selectOption("0");
    expect(await totalFor(page, "Hit")).toContain("9 (2)");
    expect(await totalFor(page, "Dam")).toContain("34 (0)");
});

// Catches export controls copying the wrong scope or sharing an ambiguous name.
test("Builder exports and copies all three exact values", async function({page}) {
    await page.goto(`${baseUrl}/builder/`);
    await page.getByRole("button", {name: "Export", exact: true}).click();
    const dialog = page.getByRole("dialog", {name: "Export Lists"});
    const cases = [
        ["Copy All Lists", "#allListsExport", encodedLists],
        ["Copy Current List (w/ all variants): Hero", "#curListExport", currentHeroExport],
        ["Copy Current List Variant: Tank", "#curVariantExport", currentTankExport]
    ];
    for (const [buttonName, input, expected] of cases) {
        await expect(dialog.locator(input)).toHaveValue(expected);
        await dialog.getByRole("button", {name: buttonName, exact: true}).click();
        await expect(page.evaluate(() => navigator.clipboard.readText())).resolves.toBe(expected);
    }
});

// Catches Builder falling back to its former flat checkbox list instead of the
// same categorized, themed Columns picker used by Item Search.
test("Builder Columns preserves the shared visual and interaction contract in every theme", async function({context, page}) {
    const themes = ["light", "dark", "solarized-dark", "high-contrast", "glass-blue", "glass-emerald", "glass-ruby", "glass-amethyst", "glass-amber"];
    for (const theme of themes) {
        await context.addCookies([
            {name: "theme", value: theme, url: baseUrl},
            {name: "sc-Hero", value: "Name-Str-Hit", url: baseUrl}
        ]);
        await page.goto(`${baseUrl}/builder/`);
        await expect(page.locator("link#theme")).toHaveAttribute("href", new RegExp(`bootstrap-${theme}\\.min\\.css`));
        const trigger = page.getByRole("button", {name: "Hide/Show Columns", exact: true});
        await trigger.focus();
        await trigger.press("Enter");

        const dialog = page.getByRole("dialog", {name: "Select visible columns"});
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole("heading", {name: "Select visible columns", exact: true})).toBeVisible();
        await expect(dialog.locator(".modal-dialog")).toHaveClass(/modal-xl/);
        await expect(dialog.locator(".columns-picker-toolbar")).toContainText("Select columns to show and hide from the following:");
        await expect(dialog.getByRole("button", {name: "Reset to defaults", exact: true})).toHaveClass(/columns-picker-reset/);
        await expect(dialog.locator(".columns-picker-grid")).toHaveCount(1);
        await expect(dialog.locator(".columns-picker-stack")).toHaveCount(5);
        await expect(dialog.locator(".columns-picker-category")).toHaveCount(10);
        expect(await dialog.locator(".columns-picker-category-title").allTextContents()).toEqual(["Basic", "Main", "Limits", "Ranged", "Regen", "Tank", "Melee", "Mage", "Weapon", "Future"]);
        expect(await dialog.locator(".columns-picker-option").allTextContents()).toEqual(["Name", "Strength", "Hit", "Damage", "Hit Points", "Mana", "Movement", "Armor Class", "Rent", "Light"]);
        expect(await dialog.locator(".columns-picker-option").evaluateAll(options => options.map(option => option.tagName))).toEqual(["BUTTON", "BUTTON", "BUTTON", "BUTTON", "BUTTON", "BUTTON", "BUTTON", "BUTTON", "BUTTON", "BUTTON"]);
        await expect(dialog.getByRole("checkbox")).toHaveCount(0);

        const name = dialog.getByRole("button", {name: "Name", exact: true});
        const hitPoints = dialog.getByRole("button", {name: "Hit Points", exact: true});
        await expect(name).toHaveClass(/columns-picker-option/);
        await expect(name).toHaveAttribute("aria-pressed", "true");
        await expect(name.locator("svg.columns-picker-visibility-icon.text-success")).toBeVisible();
        await expect(hitPoints).toHaveAttribute("aria-pressed", "false");
        await expect(hitPoints.locator("svg.columns-picker-visibility-icon.text-danger")).toBeVisible();
        expect(await page.getByLabel("Character", {exact: true}).evaluate(element => element.closest("[inert]") != null)).toBe(true);

        await name.click();
        await expect(name).toHaveAttribute("aria-pressed", "false");
        await expect(name.locator("svg.columns-picker-visibility-icon.text-danger")).toBeVisible();
        await expect.poll(async () => (await context.cookies()).find(cookie => cookie.name === "sc-Hero")?.value).toBe("Str-Hit-");
        await dialog.getByRole("button", {name: "Reset to defaults", exact: true}).click();
        await expect(name).toHaveAttribute("aria-pressed", "true");
        await expect(name.locator("svg.columns-picker-visibility-icon.text-success")).toBeVisible();
        await expect.poll(async () => (await context.cookies()).find(cookie => cookie.name === "sc-Hero")?.value).toBe("Name-Str-Hit-Dam-HP-Ma-Mv-AC-Rent-Light-");

        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        await expect(trigger).toBeFocused();
    }
});

// Catches per-character column state falling back, migrating, deleting, or
// reloading through the wrong cookie key.
test("Builder preserves global and per-character columns across lifecycle changes", async function({context, page}) {
    await context.addCookies([
        {name: "sc2", value: "Name-HP", url: baseUrl},
        {name: "sc-Hero", value: "Name-Str-Hit", url: baseUrl}
    ]);
    await page.goto(`${baseUrl}/builder/`);
    await expect.poll(async () => (await context.cookies()).find(cookie => cookie.name === "sc-Hero")?.value).toBe("Name-Str-Hit-");
    await page.getByRole("button", {name: "Hide/Show Columns", exact: true}).click();
    let dialog = page.getByRole("dialog", {name: "Select visible columns"});
    await expect(dialog.getByRole("button", {name: "Strength", exact: true})).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.getByRole("button", {name: "Hit", exact: true})).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.getByRole("button", {name: "Hit Points", exact: true})).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("Escape");
    await page.getByLabel("Character", {exact: true}).selectOption({label: "Scout"});
    await page.getByRole("button", {name: "Hide/Show Columns", exact: true}).click();
    dialog = page.getByRole("dialog", {name: "Select visible columns"});
    await expect(dialog.getByRole("button", {name: "Strength", exact: true})).toHaveAttribute("aria-pressed", "false");
    await expect(dialog.getByRole("button", {name: "Hit Points", exact: true})).toHaveAttribute("aria-pressed", "true");
    await dialog.getByRole("button", {name: "Strength", exact: true}).click();
    await page.keyboard.press("Escape");
    await expect.poll(() => page.evaluate(() => document.cookie)).toContain("sc-Scout=");
    await expect.poll(async () => (await context.cookies()).find(cookie => cookie.name === "sc-Scout")?.value).toContain("Str");
    await page.getByRole("button", {name: "Edit Character", exact: true}).click();
    dialog = page.getByRole("dialog", {name: "Edit Character"});
    await dialog.getByLabel("Name").fill("Ranger");
    await dialog.getByRole("button", {name: "Save", exact: true}).click();
    await expect.poll(async () => (await context.cookies()).find(cookie => cookie.name === "sc-Ranger")?.value).toContain("Str");
    expect((await context.cookies()).find(cookie => cookie.name === "sc-Scout")).toBeUndefined();
    await page.reload();
    await expect(page.getByLabel("Character", {exact: true})).toHaveValue("1");
    await page.getByRole("button", {name: "Delete Character", exact: true}).click();
    await page.getByRole("dialog", {name: "Are you sure?"}).getByRole("button", {name: "Yes", exact: true}).click();
    await expect.poll(async () => (await context.cookies()).find(cookie => cookie.name === "sc-Ranger")).toBeUndefined();
    await expect(page.getByLabel("Character", {exact: true})).toHaveValue("0");
    await page.getByRole("button", {name: "Hide/Show Columns", exact: true}).click();
    dialog = page.getByRole("dialog", {name: "Select visible columns"});
    await expect(dialog.getByRole("button", {name: "Strength", exact: true})).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.getByRole("button", {name: "Hit", exact: true})).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.getByRole("button", {name: "Hit Points", exact: true})).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await context.cookies()).find(cookie => cookie.name === "sc-Hero")?.value).toBe("Name-Str-Hit-");
    await page.reload();
    await page.getByRole("button", {name: "Hide/Show Columns", exact: true}).click();
    dialog = page.getByRole("dialog", {name: "Select visible columns"});
    await expect(dialog.getByRole("button", {name: "Strength", exact: true})).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.getByRole("button", {name: "Hit", exact: true})).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.getByRole("button", {name: "Hit Points", exact: true})).toHaveAttribute("aria-pressed", "false");
    await expect.poll(async () => (await context.cookies()).find(cookie => cookie.name === "sc-Hero")?.value).toBe("Name-Str-Hit-");
});

// Catches responsive grouping, glass spacing, caret state, or reduced-motion
// behavior diverging in any of the nine shipped themes.
test("Builder controls and collapsible layout remain responsive in every theme", async function({context, page}) {
    const themes = ["light", "dark", "solarized-dark", "high-contrast", "glass-blue", "glass-emerald", "glass-ruby", "glass-amethyst", "glass-amber"];
    for (const theme of themes) {
        await context.addCookies([{name: "theme", value: theme, url: baseUrl}]);
        await page.emulateMedia({reducedMotion: "reduce"});
        const geometry = {};
        for (const viewport of [{width: 1280, height: 800}, {width: 375, height: 812}]) {
            await page.setViewportSize(viewport);
            await page.goto(`${baseUrl}/builder/`);
            await expect(page.locator("link#theme")).toHaveAttribute("href", new RegExp(`bootstrap-${theme}\\.min\\.css`));
            await expect(page.getByRole("button", {name: "Add Character", exact: true})).toBeVisible();
            await expect(page.getByRole("button", {name: "Add Variant", exact: true})).toBeVisible();
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
            const [character, stats] = await Promise.all([
                page.locator("main > .row > section").nth(0).boundingBox(),
                page.locator("main > .row > section").nth(1).boundingBox()
            ]);
            expect(character).not.toBeNull();
            expect(stats).not.toBeNull();
            if (viewport.width >= 992) {
                expect(Math.abs(character.y - stats.y)).toBeLessThan(2);
                expect(stats.x).toBeGreaterThan(character.x + character.width - 2);
            }
            else {
                expect(Math.abs(character.x - stats.x)).toBeLessThan(2);
                expect(stats.y).toBeGreaterThan(character.y + character.height - 2);
            }
            const characterCard = await page.locator("main > .row > section").first().locator(".card").boundingBox();
            const actions = page.getByRole("group", {name: "Character Options"});
            const actionBox = await actions.boundingBox();
            const actionButtons = await actions.getByRole("button").evaluateAll(buttons => buttons.map(button => {
                const box = button.getBoundingClientRect();
                return {x: box.x, y: box.y, width: box.width, height: box.height};
            }));
            expect(characterCard).not.toBeNull();
            expect(actionBox).not.toBeNull();
            expect(actionButtons).toHaveLength(4);
            geometry[viewport.width] = {characterCard, actionBox};
            if (viewport.width >= 768) {
                expect(actionBox.height).toBeLessThan(70);
                expect(actionButtons.every(button => Math.abs(button.y - actionButtons[0].y) < 2)).toBe(true);
                expect(actionButtons.every(button => Math.abs(button.width - actionButtons[0].width) < 2)).toBe(true);
                expect(Math.abs(
                    actionButtons[0].x - actionBox.x -
                    (actionBox.x + actionBox.width - actionButtons.at(-1).x - actionButtons.at(-1).width)
                )).toBeLessThan(2);
            }
            else {
                expect(actionBox.height).toBeGreaterThan(120);
                expect(actionButtons.every(button => Math.abs(button.x - actionButtons[0].x) < 2)).toBe(true);
                expect(actionButtons.every(button => Math.abs(button.height - actionBox.height / 4) < 2)).toBe(true);
            }
            await page.getByRole("button", {name: "Era Abilities", exact: true}).click();
            const eraColumns = page.locator("#eraAbilities > div");
            await expect(eraColumns).toHaveCount(3);
            const eraBoxes = await eraColumns.evaluateAll(columns => columns.map(column => {
                const box = column.getBoundingClientRect();
                const cells = column.querySelector("tbody tr").children;
                const key = cells[0].getBoundingClientRect();
                const value = cells[1].getBoundingClientRect();
                return {x: box.x, y: box.y, width: box.width, keyWidth: key.width, valueWidth: value.width};
            }));
            expect(eraBoxes.every(box => Math.abs(box.keyWidth / (box.keyWidth + box.valueWidth) - 0.7) < 0.03)).toBe(true);
            if (viewport.width >= 768) {
                expect(eraBoxes.every(box => Math.abs(box.y - eraBoxes[0].y) < 2)).toBe(true);
                expect(eraBoxes[1].x).toBeGreaterThan(eraBoxes[0].x + eraBoxes[0].width - 2);
            }
            else {
                expect(eraBoxes.every(box => Math.abs(box.x - eraBoxes[0].x) < 2)).toBe(true);
                expect(eraBoxes[1].y).toBeGreaterThan(eraBoxes[0].y);
            }
            const toggle = page.getByRole("button", {name: "KSM Swap/Quest Mods", exact: true});
            await expect(toggle).toHaveClass(/collapsed/);
            await expect(toggle.locator(".collapse-caret")).toHaveCSS("transition-duration", "0s");
            await toggle.click();
            await expect(toggle).not.toHaveClass(/collapsed/);
            await expect(toggle).toHaveAttribute("aria-expanded", "true");
            if (theme.startsWith("glass-")) {
                const spacing = await page.locator("main > .row > section").first().evaluate(element => ({
                    marginBottom: parseFloat(getComputedStyle(element).marginBottom),
                    rootFontSize: parseFloat(getComputedStyle(document.documentElement).fontSize)
                }));
                expect(spacing.marginBottom).toBeCloseTo(spacing.rootFontSize * 0.75, 1);
            }
        }
        expect(geometry[1280].characterCard.width).toBeGreaterThan(600);
        expect(geometry[1280].characterCard.height).toBeLessThan(260);
        expect(geometry[375].characterCard.width).toBeGreaterThan(340);
        expect(geometry[375].characterCard.height).toBeGreaterThan(geometry[1280].characterCard.height + 100);
    }
});
