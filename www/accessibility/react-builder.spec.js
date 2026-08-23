"use strict";

const Module = require("node:module");
const {expect, test} = require("@playwright/test");
const fulfillLocalBrowserScript = require("./support/local-browser-scripts");
const publicPageData = require("./support/public-page-data");

const encodedLists = "6*Hero~Tank~0U0U0U0U0U0U000000___00000000000000000___________________________________*Hero~Caster~0V0U0U0U0U0U000000___00000000000000000___________________________________*";
let baseUrl;
let restorePostAsync;
let server;

function loadAppWithoutDatabaseMetadataQuery() {
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (request === "sync-rpc")
            return function() { return function() { return []; }; };
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
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
    apiUtils.postAsync = publicPageData;
    restorePostAsync = function() { apiUtils.postAsync = originalPostAsync; };
    server = await new Promise(function(resolve) {
        const listeningServer = app.listen(0, "127.0.0.1", function() {
            resolve(listeningServer);
        });
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async function() {
    if (restorePostAsync)
        restorePostAsync();
    if (server)
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

test.beforeEach(async function({context, page}) {
    await context.addCookies([{name: "cookie-consent", value: "true", url: baseUrl}]);
    await page.addInitScript(function(value) {
        localStorage.setItem("cln", value);
        localStorage.setItem("scl", "Hero!Tank");
    }, encodedLists);
    await page.route(`${baseUrl}/api`, async function(route) {
        const query = route.request().postDataJSON().query;
        if (query.includes("getItemStatInfo")) {
            return route.fulfill({contentType: "application/json", body: JSON.stringify({data: {
                getItemStatInfo: [
                    {display: "Name", short: "Name", var: "name", type: "string", showColumnDefault: true},
                    {display: "Strength", short: "Str", var: "strength", type: "int", showColumnDefault: true}
                ],
                getItemFragment: ""
            }})});
        }
        if (query.includes("getItemsBySlotId"))
            return route.fulfill({contentType: "application/json", body: JSON.stringify({data: {getItemsBySlotId: []}})});
        if (query.includes("getItemsInIds"))
            return route.fulfill({contentType: "application/json", body: JSON.stringify({data: {getItemsInIds: []}})});
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
    await expect(page.getByLabel("Character", {exact: true})).toHaveValue("0");
    await expect(page.getByLabel("Variant", {exact: true})).toHaveValue("0");
    await expect(page.getByLabel("Variant", {exact: true})).toContainText("Tank Variant");
    await page.getByLabel("Variant", {exact: true}).selectOption("1");
    await expect(page.locator("#strInput")).toHaveValue("31");

    const ksm = page.getByRole("button", {name: "KSM Swap/Quest Mods", exact: true});
    await expect(ksm).toHaveAttribute("aria-expanded", "false");
    await ksm.click();
    await expect(ksm).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByLabel("Longhouse", {exact: true})).toBeVisible();

    await page.locator("#strInput").fill("44");
    await page.locator("#strInput").blur();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("scl"))).toBe("Hero!Caster");
    await expect.poll(() => page.evaluate(() => localStorage.getItem("cln")?.startsWith("6*"))).toBe(true);

    await page.getByRole("button", {name: "Export", exact: true}).click();
    await expect(page.getByRole("dialog", {name: "Export Lists"})).toBeVisible();
    await expect(page.locator("#allListsExport")).toHaveValue(/^6\*/);
});
