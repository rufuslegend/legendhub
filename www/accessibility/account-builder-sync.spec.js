"use strict";

const Module = require("node:module");
const {expect, test} = require("@playwright/test");
const fulfillLocalBrowserScript = require("./support/local-browser-scripts");
const publicPageData = require("./support/public-page-data");

const defaultPreferences = {
    version: 1,
    theme: "glass-blue",
    itemsPerPage: 20,
    itemColumns: [],
    builderColumns: {},
    selectedProfileId: null,
    selectedVariant: null
};
const anonymousPayload = "6*Local Hero~Original~0X0X0X0X0X0X000000___0000000000000000000f__________________________________*";
const heroMigrationPayload = "6*Hero~Tank~1c0K0K0K0J0J1-10000___00H00N00T00000100.00s00o00o-BHKAA_00t00u00v00w_______00p00q01b________________*Hero~Caster~0U0m0U0U0U0U000000___0000000000000000000f__00g_______________________________*";
const scoutMigrationPayload = "6*Scout~Original~0X0X0X0X0X0X000000___0000000000000000000f__________________________________*";
const guestMigrationEntry = "Guest~Imported~0X0X0X0X0X0X000000___0000000000000000000f__-BHKAA_______________________________*";
const rejectedMigrationEntry = "Rejected~Original~0i0X0X0X0X0X000000___0000000000000000000g__________________________________*";
const migrationPayload = `${heroMigrationPayload}${scoutMigrationPayload.slice(2)}${guestMigrationEntry}${rejectedMigrationEntry}`;
const itemFragment = "fragment ItemAll on Item { id name slot strength strengthCap hit dam hp ma mv ac rent weight uniqueWear isLimited twoHanded fauxObject isLight alignRestriction weaponStat }";
const itemStatInfo = [
    {display: "Name", short: "Name", var: "name", type: "string", showColumnDefault: true},
    {display: "Strength", short: "Str", var: "strength", type: "int", showColumnDefault: true},
    {display: "Mind", short: "Min", var: "mind", type: "int", showColumnDefault: true},
    {display: "Rent", short: "Rent", var: "rent", type: "int", showColumnDefault: true}
];
const itemStatCategories = itemStatInfo.map((stat, index) => ({
    name: `Fixture ${index + 1}`,
    getItemStatInfo: [stat]
}));
const quotaBytes = 10 * 1024 * 1024;
const notificationSettings = {
    itemAdded: true,
    itemUpdated: false,
    mobAdded: false,
    mobUpdated: false,
    questAdded: false,
    questUpdated: false,
    wikiPageAdded: false,
    wikiPageUpdated: false,
    changelogAdded: true
};

let backend;
let baseUrl;
let restoreDependencies;
let server;

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function now() {
    return "2026-08-29T12:00:00.000Z";
}

function createBackend() {
    return {
        nextId: 1,
        profiles: [],
        preferences: JSON.stringify(defaultPreferences),
        preferenceRevision: 1,
        preferencesUpdatedOn: now(),
        storageGeneration: 1,
        networkFailures: 0,
        updateRequests: 0,
        mutationLog: []
    };
}

function usedBytes() {
    return backend.profiles.reduce((total, profile) => total + profile.payload.length, 0) +
        backend.preferences.length;
}

function accountState() {
    return clone({
        profiles: backend.profiles,
        preferences: backend.preferences,
        preferenceRevision: backend.preferenceRevision,
        preferencesUpdatedOn: backend.preferencesUpdatedOn,
        storageGeneration: backend.storageGeneration,
        usedBytes: usedBytes(),
        quotaBytes
    });
}

function profileResult(status, profile, conflictProfile = null) {
    return clone({
        status,
        profile,
        conflictProfile,
        storageGeneration: backend.storageGeneration,
        usedBytes: usedBytes(),
        quotaBytes
    });
}

function savedProfile(variables, previous = null) {
    return {
        id: previous?.id || `profile-${backend.nextId++}`,
        name: variables.name,
        payload: variables.payload,
        payloadVersion: 6,
        revision: (previous?.revision || 0) + 1,
        updatedOn: now()
    };
}

function graphQLError(message, code) {
    return {errors: [{message, extensions: {code}}]};
}

function generationError() {
    return graphQLError("Account storage changed. Reload before saving.", 409);
}

function handleAccountRequest(request) {
    const variables = request.variables || {};
    if (request.query.includes("GetBuilderAccountState"))
        return {data: {getBuilderAccountState: accountState()}};
    if (request.query.includes("ExportBuilderData")) {
        backend.mutationLog.push({operation: "export", variables: clone(variables)});
        return {data: {exportBuilderData: backend.profiles[0]?.payload || "6*"}};
    }
    if (request.query.includes("DeleteAllBuilderData")) {
        if (variables.storageGeneration !== backend.storageGeneration)
            return generationError();
        backend.profiles = [];
        backend.storageGeneration += 1;
        backend.mutationLog.push({operation: "delete-all", variables: clone(variables)});
        return {data: {deleteAllBuilderData: {
            status: "deleted",
            storageGeneration: backend.storageGeneration,
            usedBytes: 0,
            quotaBytes
        }}};
    }
    if (request.query.includes("getItemStatInfo")) {
        return {data: {
            getItemStatInfo: itemStatInfo,
            getItemFragment: itemFragment
        }};
    }
    if (request.query.includes("getItemsBySlotId")) {
        return {data: {getItemsBySlotId: Array.from({length: 40}, (_, index) => ({
            id: 1000 + index,
            name: `Preference fixture ${String(index + 1).padStart(2, "0")}`,
            slot: variables.slotId,
            strength: index,
            rent: index * 10
        }))}};
    }
    if (request.query.includes("getItemsInIds"))
        return {data: {getItemsInIds: []}};
    if (request.query.includes("ImportBuilderProfiles")) {
        if (variables.storageGeneration !== backend.storageGeneration)
            return generationError();
        const result = {copied: [], renamed: [], deduplicated: [], rejected: []};
        for (const input of variables.profiles) {
            if (input.name === "Rejected") {
                result.rejected.push({name: input.name, reason: "Profile could not be copied."});
                continue;
            }
            const existing = backend.profiles.find(profile => profile.name === input.name);
            if (existing?.payload === input.payload) {
                result.deduplicated.push(input.name);
                continue;
            }
            const name = existing ? `${input.name} Local` : input.name;
            const profile = savedProfile({
                ...input,
                name,
                payload: input.payload.replaceAll(`${input.name}~`, `${name}~`)
            });
            backend.profiles.push(profile);
            if (existing)
                result.renamed.push({from: input.name, to: name});
            else
                result.copied.push(name);
        }
        if (variables.replacePreferences && variables.preferences !== null) {
            backend.preferences = variables.preferences;
            backend.preferenceRevision += 1;
            backend.preferencesUpdatedOn = now();
            result.preferencesImported = true;
        }
        else {
            result.preferencesImported = false;
        }
        backend.mutationLog.push({operation: "import", variables: clone(variables)});
        return {data: {importBuilderProfiles: {
            result: JSON.stringify(result),
            state: accountState()
        }}};
    }
    if (request.query.includes("CreateBuilderProfile")) {
        if (variables.storageGeneration !== backend.storageGeneration)
            return generationError();
        const profile = savedProfile(variables);
        backend.profiles.push(profile);
        backend.mutationLog.push({operation: "create", variables: clone(variables)});
        return {data: {createBuilderProfile: profileResult("saved", profile)}};
    }
    if (request.query.includes("UpdateBuilderProfile")) {
        if (variables.storageGeneration !== backend.storageGeneration)
            return generationError();
        const index = backend.profiles.findIndex(profile => profile.id === variables.id);
        const current = backend.profiles[index];
        if (!current)
            return graphQLError("Profile no longer exists.", 409);
        if (current.revision !== variables.revision) {
            const conflictProfile = savedProfile({
                ...variables,
                name: `${variables.name} Conflict`,
                payload: variables.payload.replaceAll(
                    `${variables.name}~`,
                    `${variables.name} Conflict~`
                )
            });
            backend.profiles.push(conflictProfile);
            backend.mutationLog.push({operation: "conflict", variables: clone(variables)});
            return {data: {updateBuilderProfile: profileResult(
                "conflict", current, conflictProfile
            )}};
        }
        const profile = savedProfile(variables, current);
        backend.profiles[index] = profile;
        backend.mutationLog.push({operation: "update", variables: clone(variables)});
        return {data: {updateBuilderProfile: profileResult("saved", profile)}};
    }
    if (request.query.includes("DeleteBuilderProfile")) {
        if (variables.storageGeneration !== backend.storageGeneration)
            return generationError();
        const index = backend.profiles.findIndex(profile => profile.id === variables.id);
        const current = backend.profiles[index];
        if (!current || current.revision !== variables.revision)
            return graphQLError("Profile changed.", 409);
        backend.profiles.splice(index, 1);
        backend.mutationLog.push({operation: "delete", variables: clone(variables)});
        return {data: {deleteBuilderProfile: profileResult("deleted", {
            ...current,
            payload: null,
            payloadVersion: null,
            revision: current.revision + 1,
            updatedOn: now()
        })}};
    }
    if (request.query.includes("UpdateBuilderPreferences")) {
        if (variables.storageGeneration !== backend.storageGeneration)
            return generationError();
        backend.preferences = variables.preferences;
        backend.preferenceRevision += 1;
        backend.preferencesUpdatedOn = now();
        backend.mutationLog.push({operation: "preferences", variables: clone(variables)});
        return {data: {updateBuilderPreferences: clone({
            status: "saved",
            preferences: backend.preferences,
            preferenceRevision: backend.preferenceRevision,
            preferencesUpdatedOn: backend.preferencesUpdatedOn,
            storageGeneration: backend.storageGeneration,
            usedBytes: usedBytes(),
            quotaBytes
        })}};
    }
    throw new Error("No account Builder sync fixture matches the browser GraphQL request.");
}

function loadApp() {
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (request === "sync-rpc")
            return function() { return function() { return []; }; };
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        const authApi = require("../src/routes/api/auth");
        const apiUtils = require("../src/routes/api/utils");
        const originals = {
            authToken: authApi.utils.authToken,
            getPermissions: authApi.utils.getPermissions,
            logout: authApi.utils.logout,
            postAsync: apiUtils.postAsync
        };
        authApi.utils.authToken = async function(token) {
            const verified = token === "shared-account-session";
            return {
                memberId: 7,
                username: "Cross-device Tester",
                email: "builder@example.test",
                emailVerified: verified,
                storageNamespace: "0123456789abcdef0123456789abcdef"
            };
        };
        authApi.utils.getPermissions = async function() { return {}; };
        authApi.utils.logout = function() {};
        apiUtils.postAsync = async function(query, _ip, variables) {
            if (query.includes("getItemStatCategories")) {
                return {
                    getItemStatCategories: itemStatCategories,
                    getItemStatInfo: itemStatInfo
                };
            }
            if (query.includes("AccountPreferenceBootstrap")) {
                return {getBuilderAccountPreferences: {
                    preferences: backend.preferences,
                    preferenceRevision: backend.preferenceRevision,
                    storageGeneration: backend.storageGeneration
                }};
            }
            if (query.includes("getNotificationSettings")) {
                return {
                    getNotificationSettings: notificationSettings,
                    getAccountEmailStatus: {
                        email: "builder@example.test",
                        verified: true,
                        pendingEmail: null,
                        canUseAccountStorage: true
                    },
                    getBuilderAccountSummary: {
                        profiles: backend.profiles.map(profile => ({
                            id: profile.id,
                            name: profile.name,
                            revision: profile.revision,
                            updatedOn: profile.updatedOn
                        })),
                        usedBytes: usedBytes(),
                        quotaBytes,
                        storageGeneration: backend.storageGeneration,
                        profileCount: backend.profiles.length
                    }
                };
            }
            if (query.includes("getNotifications"))
                return {getNotifications: {moreResults: false, results: []}};
            return publicPageData(query, variables);
        };
        restoreDependencies = function() {
            authApi.utils.authToken = originals.authToken;
            authApi.utils.getPermissions = originals.getPermissions;
            authApi.utils.logout = originals.logout;
            apiUtils.postAsync = originals.postAsync;
        };
        return require("../src/create-app")({logging: false});
    }
    finally {
        Module._load = originalLoad;
    }
}

async function installDevice(context, device, token = "shared-account-session") {
    const cookies = [{name: "device", value: device, url: baseUrl}];
    if (token)
        cookies.push({name: "loginToken", value: token, url: baseUrl});
    await context.addCookies(cookies);
    await context.addInitScript(marker => {
        localStorage.setItem("device-marker", marker);
    }, device);
    await context.route(/^https?:\/\//, async function(route) {
        if (!route.request().url().startsWith(baseUrl))
            return fulfillLocalBrowserScript(route);
        if (route.request().url() !== `${baseUrl}/api`)
            return route.continue();
        const request = route.request().postDataJSON();
        if (request.query.includes("UpdateBuilderProfile")) {
            backend.updateRequests += 1;
            if (backend.networkFailures > 0) {
                backend.networkFailures -= 1;
                return route.abort("connectionreset");
            }
        }
        const body = handleAccountRequest(request);
        return route.fulfill({
            contentType: "application/json",
            body: JSON.stringify(body)
        });
    });
}

async function renameCharacter(page, name) {
    await page.getByRole("button", {name: "Edit Character", exact: true}).click();
    const dialog = page.getByRole("dialog", {name: "Edit Character"});
    await dialog.getByLabel("Name").fill(name);
    await dialog.getByRole("button", {name: "Save", exact: true}).click();
}

test.beforeAll(async function() {
    backend = createBackend();
    const app = loadApp();
    server = await new Promise(resolve => {
        const listeningServer = app.listen(0, "127.0.0.1", function() {
            resolve(listeningServer);
        });
    });
    baseUrl = `http://localhost:${server.address().port}`;
});

test.afterAll(async function() {
    if (restoreDependencies)
        restoreDependencies();
    if (server) {
        await new Promise((resolve, reject) => server.close(error =>
            error ? reject(error) : resolve()));
    }
});

test.beforeEach(function() {
    backend = createBackend();
});

test("account Builder sync follows a verified player from work to home", async function({browser}) {
    const work = await browser.newContext();
    const home = await browser.newContext();
    await installDevice(work, "work");
    await installDevice(home, "home");

    try {
        const workPage = await work.newPage();
        await workPage.goto(`${baseUrl}/builder/`);
        await expect(workPage.getByLabel("Character", {exact: true})).toContainText("Untitled");
        await renameCharacter(workPage, "Work Hero");
        await expect(workPage.getByText("Saved to account", {exact: true})).toBeVisible({timeout: 3000});
        await expect.poll(() => backend.profiles.map(profile => profile.name)).toEqual(["Work Hero"]);

        const homePage = await home.newPage();
        await homePage.goto(`${baseUrl}/builder/`);
        await expect(homePage.getByLabel("Character", {exact: true})).toContainText("Work Hero");
        await homePage.locator("#strInput").fill("12");
        await expect(homePage.getByText("Saved to account", {exact: true})).toBeVisible({timeout: 3000});
        await expect.poll(() => backend.profiles[0].revision).toBe(2);

        await workPage.reload();
        await expect(workPage.getByLabel("Character", {exact: true})).toContainText("Work Hero");
        await expect(workPage.locator("#strInput")).toHaveValue("12");

        expect(await workPage.evaluate(() => localStorage.getItem("device-marker"))).toBe("work");
        expect(await homePage.evaluate(() => localStorage.getItem("device-marker"))).toBe("home");
        expect(Object.fromEntries((await work.cookies(baseUrl)).map(cookie => [cookie.name, cookie.value])).device).toBe("work");
        expect(Object.fromEntries((await home.cookies(baseUrl)).map(cookie => [cookie.name, cookie.value])).device).toBe("home");
        expect(backend.mutationLog
            .map(entry => entry.operation)
            .filter(operation => operation !== "preferences"))
            .toEqual(["create", "update"]);
    }
    finally {
        await work.close();
        await home.close();
    }
});

test("account Builder sync preserves simultaneous edits as a conflict copy", async function({browser}) {
    const work = await browser.newContext();
    const home = await browser.newContext();
    await installDevice(work, "work");
    await installDevice(home, "home");

    try {
        const workPage = await work.newPage();
        await workPage.goto(`${baseUrl}/builder/`);
        await renameCharacter(workPage, "Shared Hero");
        await expect.poll(() => backend.profiles[0]?.revision).toBe(1);

        const homePage = await home.newPage();
        await homePage.goto(`${baseUrl}/builder/`);
        await expect(homePage.getByLabel("Character", {exact: true})).toContainText("Shared Hero");

        await workPage.locator("#strInput").fill("21");
        await expect.poll(() => backend.profiles[0]?.revision).toBe(2);
        await homePage.locator("#minInput").fill("17");

        const conflictAlert = homePage.getByRole("alert").filter({hasText: "conflict copy"});
        await expect(conflictAlert).toBeVisible({timeout: 3000});
        await expect(homePage.getByLabel("Character", {exact: true})).toContainText("Shared Hero");
        await expect(homePage.getByLabel("Character", {exact: true})).toContainText("Shared Hero Conflict");
        await expect.poll(() => backend.profiles.map(profile => profile.name).sort()).toEqual([
            "Shared Hero",
            "Shared Hero Conflict"
        ]);
        expect(backend.mutationLog.some(entry => entry.operation === "conflict")).toBe(true);
    }
    finally {
        await work.close();
        await home.close();
    }
});

test("account Builder sync leaves anonymous and unverified players in browser storage", async function({browser}) {
    const anonymous = await browser.newContext();
    const unverified = await browser.newContext();
    await installDevice(anonymous, "anonymous", null);
    await installDevice(unverified, "unverified", "unverified-session");
    for (const context of [anonymous, unverified]) {
        await context.addCookies([{name: "cookie-consent", value: "true", url: baseUrl}]);
        await context.addInitScript(payload => {
            localStorage.setItem("cln", payload);
            localStorage.setItem("scl", "Local Hero!Original");
        }, anonymousPayload);
    }

    try {
        const anonymousPage = await anonymous.newPage();
        await anonymousPage.goto(`${baseUrl}/builder/`);
        await expect(anonymousPage.getByText("Saved in this browser", {exact: true})).toBeVisible();
        await expect(anonymousPage.getByLabel("Character", {exact: true})).toContainText("Local Hero");
        await anonymousPage.locator("#strInput").fill("31");
        await expect.poll(() => anonymousPage.evaluate(() => localStorage.getItem("cln")))
            .not.toBe(anonymousPayload);

        const unverifiedPage = await unverified.newPage();
        await unverifiedPage.goto(`${baseUrl}/builder/`);
        await expect(unverifiedPage.getByRole("heading", {name: "Verify your email address"})).toBeVisible();
        await expect(unverifiedPage.getByText("Saved in this browser", {exact: true})).toBeVisible();
        await expect(unverifiedPage.getByLabel("Character", {exact: true})).toContainText("Local Hero");
        await unverifiedPage.locator("#minInput").fill("27");
        await expect.poll(() => unverifiedPage.evaluate(() => localStorage.getItem("cln")))
            .not.toBe(anonymousPayload);

        expect(backend.profiles).toEqual([]);
        expect(backend.mutationLog).toEqual([]);
    }
    finally {
        await anonymous.close();
        await unverified.close();
    }
});

test("account Builder sync logout reveals only that device's anonymous data", async function({browser}) {
    backend.profiles = [{
        id: "account-hero",
        name: "Account Hero",
        payload: anonymousPayload.replace("Local Hero~", "Account Hero~"),
        payloadVersion: 6,
        revision: 1,
        updatedOn: now()
    }];
    const work = await browser.newContext();
    await installDevice(work, "work");
    await work.addCookies([{name: "cookie-consent", value: "true", url: baseUrl}]);
    await work.addInitScript(payload => {
        localStorage.setItem("cln", payload);
        localStorage.setItem("scl", "Local Hero!Original");
    }, anonymousPayload);

    try {
        const page = await work.newPage();
        await page.goto(`${baseUrl}/builder/`);
        await expect(page.getByLabel("Character", {exact: true})).toContainText("Account Hero");
        await expect(page.getByLabel("Character", {exact: true})).not.toContainText("Local Hero");

        await page.getByRole("button", {name: "Cross-device Tester"}).click();
        await Promise.all([
            page.waitForURL(`${baseUrl}/`),
            page.getByRole("button", {name: "Logout", exact: true}).click()
        ]);
        expect((await work.cookies(baseUrl)).map(cookie => cookie.name)).not.toContain("loginToken");

        await page.goto(`${baseUrl}/builder/`);
        await expect(page.getByText("Saved in this browser", {exact: true})).toBeVisible();
        await expect(page.getByLabel("Character", {exact: true})).toContainText("Local Hero");
        await expect(page.getByLabel("Character", {exact: true})).not.toContainText("Account Hero");
        expect(await page.evaluate(() => localStorage.getItem("cln"))).toBe(anonymousPayload);
    }
    finally {
        await work.close();
    }
});

test("account Builder sync explicitly migrates and reports every server outcome", async function({browser}) {
    backend.profiles = [
        {
            id: "existing-hero",
            name: "Hero",
            payload: heroMigrationPayload.replace("1c0K", "0X0X"),
            payloadVersion: 6,
            revision: 3,
            updatedOn: now()
        },
        {
            id: "existing-scout",
            name: "Scout",
            payload: scoutMigrationPayload,
            payloadVersion: 6,
            revision: 2,
            updatedOn: now()
        }
    ];
    const device = await browser.newContext();
    await installDevice(device, "migration");
    await device.addCookies([{name: "cookie-consent", value: "true", url: baseUrl}]);
    await device.addInitScript(payload => {
        localStorage.setItem("cln", payload);
        localStorage.setItem("scl", "Hero!Tank");
    }, migrationPayload);

    try {
        const page = await device.newPage();
        await page.goto(`${baseUrl}/builder/`);
        const offer = page.getByRole("region", {name: "Local Builder data"});
        await expect(offer).toContainText("Hero");
        await expect(offer).toContainText("Scout");
        await expect(offer).toContainText("Guest");
        await expect(offer).toContainText("Rejected");
        expect(backend.mutationLog).toEqual([]);

        await offer.getByRole("button", {name: "Review local Builder data"}).click();
        const dialog = page.getByRole("dialog", {name: "Copy local Builder data"});
        await dialog.getByRole("button", {name: "Copy all to my account"}).click();

        await expect(dialog.getByRole("heading", {name: "Copied"})).toBeVisible();
        await expect(dialog.getByText("Guest", {exact: true})).toBeVisible();
        await expect(dialog.getByText("Hero → Hero Local", {exact: true})).toBeVisible();
        await expect(dialog.getByText("Scout", {exact: true})).toBeVisible();
        await expect(dialog.getByText("Rejected — Could not be copied.", {exact: true})).toBeVisible();
        await expect(page.getByLabel("Character", {exact: true})).toContainText("Hero Local");
        await expect(page.getByLabel("Character", {exact: true})).toContainText("Guest");
        expect(await page.evaluate(payload => ({
            source: localStorage.getItem("cln"),
            acknowledgement: localStorage.getItem(
                "legendhub-builder-import:0123456789abcdef0123456789abcdef"
            ),
            expected: payload
        }), migrationPayload)).toEqual({
            source: migrationPayload,
            acknowledgement: expect.stringMatching(/^[a-f0-9]{64}$/),
            expected: migrationPayload
        });
        expect(backend.mutationLog.map(entry => entry.operation)).toContain("import");
        expect(backend.profiles.map(profile => profile.name).sort()).toEqual([
            "Guest",
            "Hero",
            "Hero Local",
            "Scout"
        ]);
    }
    finally {
        await device.close();
    }
});

test("account Builder sync retries a transient network failure and commits", async function({browser}) {
    backend.profiles = [{
        id: "retry-hero",
        name: "Retry Hero",
        payload: anonymousPayload.replace("Local Hero~", "Retry Hero~"),
        payloadVersion: 6,
        revision: 1,
        updatedOn: now()
    }];
    backend.networkFailures = 1;
    const device = await browser.newContext();
    await installDevice(device, "retry");

    try {
        const page = await device.newPage();
        await page.goto(`${baseUrl}/builder/`);
        await page.locator("#strInput").fill("41");
        await expect(page.getByText(/Sync problem/)).toBeVisible({timeout: 2500});
        await expect.poll(() => backend.profiles[0].revision, {timeout: 4000}).toBe(2);
        await expect(page.getByText("Saved to account", {exact: true})).toBeVisible();
        expect(backend.updateRequests).toBe(2);
        expect(backend.mutationLog.filter(entry => entry.operation === "update")).toHaveLength(1);
    }
    finally {
        await device.close();
    }
});

test("account Builder sync stops a stale tab after account data is deleted", async function({browser}) {
    backend.profiles = [{
        id: "stale-hero",
        name: "Stale Hero",
        payload: anonymousPayload.replace("Local Hero~", "Stale Hero~"),
        payloadVersion: 6,
        revision: 1,
        updatedOn: now()
    }];
    const device = await browser.newContext();
    await installDevice(device, "stale");

    try {
        const page = await device.newPage();
        await page.goto(`${baseUrl}/builder/`);
        await expect(page.getByLabel("Character", {exact: true})).toContainText("Stale Hero");

        backend.profiles = [];
        backend.storageGeneration = 2;
        await page.locator("#strInput").fill("49");
        const alert = page.getByRole("alert").filter({
            hasText: "Synced Builder data changed in another session."
        });
        await expect(alert).toBeVisible({timeout: 2500});
        await expect(alert.getByRole("button", {name: "Export Builder data"})).toBeVisible();
        await page.waitForTimeout(1250);
        expect(backend.profiles).toEqual([]);
        expect(backend.updateRequests).toBe(1);
        expect(backend.mutationLog.filter(entry =>
            ["create", "update"].includes(entry.operation))).toEqual([]);
    }
    finally {
        await device.close();
    }
});

test("account Builder sync selection rename and deletion never rewrite anonymous cookies", async function({browser}) {
    backend.profiles = [
        {
            id: "isolation-hero",
            name: "Hero",
            payload: heroMigrationPayload,
            payloadVersion: 6,
            revision: 1,
            updatedOn: now()
        },
        {
            id: "isolation-scout",
            name: "Scout",
            payload: scoutMigrationPayload,
            payloadVersion: 6,
            revision: 1,
            updatedOn: now()
        }
    ];
    backend.preferences = JSON.stringify({
        ...defaultPreferences,
        selectedProfileId: "isolation-hero",
        selectedVariant: "Tank"
    });
    const device = await browser.newContext();
    await installDevice(device, "isolation");
    await device.addCookies([
        {name: "cookie-consent", value: "true", url: baseUrl},
        {name: "scl1", value: "Anonymous!Original", url: baseUrl},
        {name: "sc-Hero", value: "Name-", url: baseUrl},
        {name: "sc-Scout", value: "Rent-", url: baseUrl}
    ]);
    await device.addInitScript(payload => {
        localStorage.setItem("cln", payload);
        localStorage.setItem("scl", "Local Hero!Original");
    }, anonymousPayload);

    try {
        const page = await device.newPage();
        await page.goto(`${baseUrl}/builder/`);
        const character = page.getByLabel("Character", {exact: true});
        await expect(character).toHaveValue("0");
        await character.selectOption("1");
        await renameCharacter(page, "Scout Renamed");
        await expect.poll(() => backend.profiles.map(profile => profile.name).sort()).toEqual([
            "Hero",
            "Scout Renamed"
        ]);

        await page.getByRole("button", {name: "Delete Character", exact: true}).click();
        await page.getByRole("dialog", {name: "Are you sure?"})
            .getByRole("button", {name: "Yes", exact: true}).click();
        await expect.poll(() => backend.profiles.map(profile => profile.name)).toEqual(["Hero"]);
        await expect(character).toContainText("Hero");

        await page.getByRole("button", {name: "Delete Character", exact: true}).click();
        await page.getByRole("dialog", {name: "Are you sure?"})
            .getByRole("button", {name: "Yes", exact: true}).click();
        await expect.poll(() => backend.profiles).toEqual([]);
        await expect(character).toContainText("Untitled");
        await page.waitForTimeout(1000);
        expect(backend.mutationLog.filter(entry => entry.operation === "create")).toEqual([]);

        expect(await page.evaluate(() => ({
            lists: localStorage.getItem("cln"),
            selected: localStorage.getItem("scl")
        }))).toEqual({lists: anonymousPayload, selected: "Local Hero!Original"});
        expect(Object.fromEntries((await device.cookies(baseUrl)).map(cookie =>
            [cookie.name, cookie.value]))).toMatchObject({
            scl1: "Anonymous!Original",
            "sc-Hero": "Name-",
            "sc-Scout": "Rent-"
        });
        expect(backend.mutationLog.filter(entry => entry.operation === "delete")).toHaveLength(2);
    }
    finally {
        await device.close();
    }
});

test("account Builder sync preferences follow the account but device cookies do not", async function({browser}) {
    backend.profiles = [{
        id: "preference-hero",
        name: "Hero",
        payload: heroMigrationPayload,
        payloadVersion: 6,
        revision: 1,
        updatedOn: now()
    }];
    backend.preferences = JSON.stringify({
        ...defaultPreferences,
        itemsPerPage: 50,
        itemColumns: ["Name"],
        builderColumns: {"preference-hero": ["Name"]},
        selectedProfileId: "preference-hero",
        selectedVariant: "Tank"
    });
    const work = await browser.newContext({timezoneId: "America/Chicago"});
    const home = await browser.newContext({timezoneId: "Asia/Tokyo"});
    await installDevice(work, "work-preferences");
    await installDevice(home, "home-preferences");
    await work.addCookies([
        {name: "theme", value: "light", url: baseUrl},
        {name: "ipp", value: "20", url: baseUrl}
    ]);
    await home.addCookies([
        {name: "theme", value: "dark", url: baseUrl},
        {name: "ipp", value: "20", url: baseUrl}
    ]);

    try {
        const workPage = await work.newPage();
        await workPage.goto(`${baseUrl}/builder/`);
        await workPage.getByLabel("Variant", {exact: true}).selectOption("1");
        await workPage.getByRole("button", {name: "Hide/Show Columns", exact: true}).click();
        await workPage.getByRole("button", {name: "Rent", exact: true}).click();
        await workPage.keyboard.press("Escape");
        await workPage.getByRole("button", {name: "Choose theme"}).click();
        await workPage.getByRole("button", {name: "Solarized Dark", exact: true}).click();

        await expect.poll(() => JSON.parse(backend.preferences), {timeout: 3000}).toMatchObject({
            theme: "solarized-dark",
            itemsPerPage: 50,
            builderColumns: {"preference-hero": ["Name", "Rent"]},
            selectedProfileId: "preference-hero",
            selectedVariant: "Caster"
        });

        const homePage = await home.newPage();
        await homePage.goto(`${baseUrl}/builder/`);
        await expect(homePage.locator("link#theme")).toHaveAttribute(
            "href", /bootstrap-solarized-dark\.min\.css/
        );
        await expect(homePage.getByLabel("Variant", {exact: true})).toHaveValue("1");
        await homePage.getByRole("button", {name: "Hide/Show Columns", exact: true}).click();
        await expect(homePage.getByRole("button", {name: "Name", exact: true}))
            .toHaveAttribute("aria-pressed", "true");
        await expect(homePage.getByRole("button", {name: "Rent", exact: true}))
            .toHaveAttribute("aria-pressed", "true");
        await homePage.keyboard.press("Escape");

        await homePage.locator(".builder-equipment-table tbody tr").nth(1)
            .locator("th button").click();
        const picker = homePage.getByRole("dialog", {name: "Choose Item"});
        await expect(picker.locator(".builder-picker-results tbody tr")).toHaveCount(41);
        await expect(picker.getByRole("navigation", {name: "Item result navigation"}))
            .toHaveCount(0);

        const workCookies = Object.fromEntries((await work.cookies(baseUrl)).map(cookie =>
            [cookie.name, cookie.value]));
        const homeCookies = Object.fromEntries((await home.cookies(baseUrl)).map(cookie =>
            [cookie.name, cookie.value]));
        expect(workCookies).toMatchObject({
            theme: "light",
            ipp: "20"
        });
        expect(homeCookies).toMatchObject({
            theme: "dark",
            ipp: "20"
        });
        expect(workCookies.tzoffset).toBe(String(await workPage.evaluate(() =>
            new Date().getTimezoneOffset())));
        expect(homeCookies.tzoffset).toBe(String(await homePage.evaluate(() =>
            new Date().getTimezoneOffset())));
        expect(workCookies.tzoffset).not.toBe(homeCookies.tzoffset);
    }
    finally {
        await work.close();
        await home.close();
    }
});

test("account Builder sync export and delete-all stop an open work tab", async function({browser}) {
    backend.profiles = [{
        id: "delete-all-hero",
        name: "Delete All Hero",
        payload: anonymousPayload.replace("Local Hero~", "Delete All Hero~"),
        payloadVersion: 6,
        revision: 1,
        updatedOn: now()
    }];
    const work = await browser.newContext();
    const home = await browser.newContext();
    await installDevice(work, "work-delete-all");
    await installDevice(home, "home-delete-all");
    await home.addInitScript(function() {
        window.__builderDownloads = [];
        window.URL.createObjectURL = function(blob) {
            window.__builderDownloads.push({type: "create", size: blob.size});
            return "blob:builder-export";
        };
        window.URL.revokeObjectURL = function(value) {
            window.__builderDownloads.push({type: "revoke", value});
        };
        const click = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function() {
            if (this.download) {
                window.__builderDownloads.push({
                    type: "click",
                    download: this.download
                });
                return;
            }
            return click.call(this);
        };
    });

    try {
        const workPage = await work.newPage();
        await workPage.goto(`${baseUrl}/builder/`);
        await expect(workPage.getByLabel("Character", {exact: true}))
            .toContainText("Delete All Hero");

        const homePage = await home.newPage();
        await homePage.goto(`${baseUrl}/account/`);
        await expect(homePage.getByText("1 synced Builder profile", {exact: true})).toBeVisible();
        await homePage.getByRole("button", {name: "Export all Builder data"}).click();
        await expect(homePage.getByRole("status").filter({
            hasText: "Builder data export downloaded."
        })).toBeVisible();
        expect(await homePage.evaluate(() => window.__builderDownloads)).toEqual([
            {type: "create", size: backend.profiles[0].payload.length},
            {
                type: "click",
                download: expect.stringMatching(/^legendhub-builder-\d{4}-\d{2}-\d{2}\.txt$/)
            },
            {type: "revoke", value: "blob:builder-export"}
        ]);

        await homePage.getByRole("button", {
            name: "Delete all synced Builder data",
            exact: true
        }).click();
        await homePage.getByRole("dialog", {name: "Delete all synced Builder data"})
            .getByRole("button", {name: "Permanently delete synced Builder data"}).click();
        await expect(homePage.getByRole("status").filter({
            hasText: "All synced Builder data was deleted."
        })).toBeVisible();
        expect(backend.profiles).toEqual([]);
        expect(backend.storageGeneration).toBe(2);

        await workPage.locator("#strInput").fill("55");
        await expect(workPage.getByRole("alert").filter({
            hasText: "Synced Builder data changed in another session."
        })).toBeVisible({timeout: 2500});
        await workPage.waitForTimeout(1000);
        expect(backend.profiles).toEqual([]);
        expect(backend.mutationLog.map(entry => entry.operation)).toContain("export");
        expect(backend.mutationLog.map(entry => entry.operation)).toContain("delete-all");
        expect(backend.mutationLog.filter(entry =>
            ["create", "update"].includes(entry.operation))).toEqual([]);
    }
    finally {
        await work.close();
        await home.close();
    }
});
