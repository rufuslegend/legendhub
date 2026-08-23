"use strict";

const Module = require("node:module");
const {expect, test} = require("@playwright/test");
const fulfillLocalBrowserScript = require("./support/local-browser-scripts");
const publicPageData = require("./support/public-page-data");

let baseUrl;
let restoreDependencies;
let server;

function loadAppWithAuthenticatedFixture() {
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (request === "sync-rpc") {
            return function() {
                return function() { return []; };
            };
        }
        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        const authApi = require("../src/routes/api/auth");
        const apiUtils = require("../src/routes/api/utils");
        const originalAuthToken = authApi.utils.authToken;
        const originalGetPermissions = authApi.utils.getPermissions;
        const originalPostAsync = apiUtils.postAsync;
        authApi.utils.authToken = async function() {
            return {memberId: 7, username: "Notification Tester"};
        };
        authApi.utils.getPermissions = async function() { return {}; };
        apiUtils.postAsync = publicPageData;
        restoreDependencies = function() {
            authApi.utils.authToken = originalAuthToken;
            authApi.utils.getPermissions = originalGetPermissions;
            apiUtils.postAsync = originalPostAsync;
        };
        return require("../src/create-app")({logging: false});
    }
    finally {
        Module._load = originalLoad;
    }
}

test.beforeAll(async function() {
    const app = loadAppWithAuthenticatedFixture();
    server = await new Promise(function(resolve) {
        const listeningServer = app.listen(0, "127.0.0.1", function() {
            resolve(listeningServer);
        });
    });
    baseUrl = `http://localhost:${server.address().port}`;
});

test.afterAll(async function() {
    if (restoreDependencies)
        restoreDependencies();
    if (!server)
        return;
    await new Promise(function(resolve, reject) {
        server.close(function(error) {
            if (error) reject(error);
            else resolve();
        });
    });
});

test.beforeEach(async function({context, page}) {
    await context.addCookies([
        {name: "loginToken", value: "initial-token", url: baseUrl},
        {name: "cookie-consent", value: "true", url: baseUrl}
    ]);
    await page.route(/^https?:\/\//, function(route) {
        if (route.request().url().startsWith(baseUrl))
            return route.continue();
        return fulfillLocalBrowserScript(route);
    });
});

test("rejected notification marking remains visible in the real Bootstrap popover", async function({page}) {
    await page.route(`${baseUrl}/api`, async function(route) {
        const body = route.request().postDataJSON();
        if (!body.query.includes("MarkNotificationAsRead"))
            return route.abort();
        return route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({errors: [{message: "Unable to update notifications."}]})
        });
    });

    const response = await page.goto(`${baseUrl}/`);
    expect(response).not.toBeNull();
    expect(response.status()).toBe(200);
    const trigger = page.locator("[data-notification-popover]").filter({visible: true});
    await trigger.click();
    const popover = page.locator(".popover");
    await expect(popover).toBeVisible();

    await popover.getByRole("button", {name: "Mark all as read"}).click();
    await expect(popover).toBeVisible();
    await expect(popover.getByRole("status")).toHaveText("Unable to update notifications.");
});
