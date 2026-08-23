"use strict";

const Module = require("node:module");
const AxeBuilder = require("@axe-core/playwright").default;
const {expect, test} = require("@playwright/test");
const fulfillLocalBrowserScript = require("./support/local-browser-scripts");
const publicPageData = require("./support/public-page-data");

const editableNotifications = {
    itemAdded: true,
    itemUpdated: false,
    mobAdded: false,
    mobUpdated: true,
    questAdded: true,
    questUpdated: false,
    wikiPageAdded: false,
    wikiPageUpdated: true
};
const routeNotificationSettings = {
    ...editableNotifications,
    changelogAdded: true
};

let baseUrl;
let restoreDependencies;
let server;

function loadAppWithAccountFixture() {
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (request === "sync-rpc") {
            return function() {
                return function() {
                    return [];
                };
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
            return {memberId: 7, username: "Account Tester"};
        };
        authApi.utils.getPermissions = async function() {
            return {};
        };
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
    const app = loadAppWithAccountFixture();
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
            if (error)
                reject(error);
            else
                resolve();
        });
    });
});

test.beforeEach(async function({context, page}) {
    await context.addCookies([
        {name: "loginToken", value: "initial-token", url: baseUrl},
        {name: "cookie-consent", value: "true", url: baseUrl},
        {name: "theme", value: "high-contrast", url: baseUrl}
    ]);
    await page.route(/^https?:\/\//, function(route) {
        if (route.request().url().startsWith(baseUrl))
            return route.continue();
        return fulfillLocalBrowserScript(route);
    });
});

async function openAccount(page) {
    const response = await page.goto(`${baseUrl}/account/`);
    expect(response).not.toBeNull();
    expect(response.status()).toBe(200);
    await expect(page.locator('[data-react-root="account-settings"]'))
        .toContainText("Account Settings");
    await expect(page.locator("body")).toHaveAttribute("ng-app", "legendwiki-app");
    expect(await page.locator('[data-react-root="account-settings"]').evaluate(function(root) {
        return Array.from(root.querySelectorAll("*")).some(function(element) {
            return Array.from(element.attributes).some(function(attribute) {
                return attribute.name.startsWith("ng-");
            });
        });
    })).toBe(false);
}

async function pressButton(page, name) {
    const button = page.getByRole("button", {name, exact: true});
    await button.focus();
    await expect(button).toBeFocused();
    await page.keyboard.press("Enter");
    return button;
}

test("account notification settings mount from props and save once with keyboard controls", async function({context, page}) {
    let releaseSave;
    let notificationRequests = 0;
    let submittedBody;
    await page.route(`${baseUrl}/api`, async function(route) {
        const body = route.request().postDataJSON();
        if (!body.query.includes("UpdateNotificationSettings"))
            return route.abort();

        notificationRequests += 1;
        submittedBody = body;
        if (notificationRequests === 1) {
            await new Promise(function(resolve) {
                releaseSave = resolve;
            });
        }
        return route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({
                data: {
                    updateNotificationSettings: {
                        token: notificationRequests === 1
                            ? "notification-renewed-token"
                            : "renewal-without-consent",
                        expires: notificationRequests === 1
                            ? "2030-01-01T00:00:00.000Z"
                            : null
                    }
                }
            })
        });
    });

    await openAccount(page);
    expect(await page.locator('[data-react-props="account-settings"]').evaluate(function(element) {
        return JSON.parse(element.textContent).notificationSettings;
    })).toEqual(routeNotificationSettings);
    await pressButton(page, "Edit notification settings");

    const expectedLabels = [
        ["Item Added", "On"],
        ["Item Updated", "Off"],
        ["Mob Added", "Off"],
        ["Mob Updated", "On"],
        ["Quest Added", "On"],
        ["Quest Updated", "Off"],
        ["Wiki Page Added", "Off"],
        ["Wiki Page Updated", "On"]
    ];
    for (const [label, value] of expectedLabels)
        await expect(page.getByLabel(label, {exact: true})).toHaveValue(value === "On" ? "true" : "false");

    await page.getByLabel("Item Updated", {exact: true}).selectOption("true");
    await pressButton(page, "Cancel notification changes");
    await pressButton(page, "Edit notification settings");
    await expect(page.getByLabel("Item Updated", {exact: true})).toHaveValue("false");

    await page.getByLabel("Item Updated", {exact: true}).selectOption("true");
    await pressButton(page, "Save notification settings");
    await expect.poll(function() { return notificationRequests; }).toBe(1);
    const savingButton = page.getByRole("button", {name: "Saving notification settings"});
    await expect(savingButton).toBeDisabled();
    await expect(savingButton).toBeVisible();
    await savingButton.press("Enter");
    expect(notificationRequests).toBe(1);

    expect(submittedBody.query).toContain("mutation UpdateNotificationSettings");
    expect(submittedBody.variables).toEqual({
        authToken: "initial-token",
        ...editableNotifications,
        itemUpdated: true
    });

    releaseSave();
    await expect(page.getByRole("button", {name: "Edit notification settings"})).toBeVisible();
    await expect.poll(async function() {
        const cookies = await context.cookies(baseUrl);
        return cookies.find(function(cookie) { return cookie.name === "loginToken"; })?.value;
    }).toBe("notification-renewed-token");

    await page.evaluate(function() {
        document.cookie = "cookie-consent=; Path=/; Max-Age=0; SameSite=Lax; Secure";
    });
    await pressButton(page, "Edit notification settings");
    await page.getByLabel("Item Added", {exact: true}).selectOption("false");
    await pressButton(page, "Save notification settings");
    await expect.poll(function() { return notificationRequests; }).toBe(2);
    await expect(page.getByRole("button", {name: "Edit notification settings"})).toBeVisible();
    const cookies = await context.cookies(baseUrl);
    expect(cookies.find(function(cookie) { return cookie.name === "loginToken"; })?.value)
        .toBe("notification-renewed-token");
});

test("password editing announces validation and request failures before saving a renewed token", async function({context, page}) {
    let passwordRequests = 0;
    const submittedBodies = [];
    const responses = [
        {success: false, token: "invalid-password-renewal"},
        {networkError: true},
        {success: true, token: "password-renewed-token"}
    ];
    await page.route(`${baseUrl}/api`, async function(route) {
        const body = route.request().postDataJSON();
        if (!body.query.includes("UpdatePassword"))
            return route.abort();
        passwordRequests += 1;
        submittedBodies.push(body);
        const response = responses.shift();
        if (response.networkError)
            return route.abort("failed");
        return route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({
                data: {
                    updatePassword: {
                        success: response.success,
                        tokenRenewal: {token: response.token, expires: null}
                    }
                }
            })
        });
    });

    await openAccount(page);
    await pressButton(page, "Change password");
    await page.getByLabel("Current Password", {exact: true}).fill("discard-me");
    await pressButton(page, "Cancel password changes");
    await pressButton(page, "Change password");
    await expect(page.getByLabel("Current Password", {exact: true})).toHaveValue("");
    await page.getByLabel("Current Password", {exact: true}).fill("current-secret");
    await page.getByLabel("New Password", {exact: true}).fill("new-secret");
    await page.getByLabel("Confirm Password", {exact: true}).fill("different-secret");
    await pressButton(page, "Save password");
    await expect(page.getByRole("alert")).toHaveText("New passwords do not match.");
    expect(passwordRequests).toBe(0);

    await page.getByLabel("Confirm Password", {exact: true}).fill("new-secret");
    await pressButton(page, "Save password");
    await expect(page.getByRole("alert")).toHaveText("Current password is invalid.");
    expect(passwordRequests).toBe(1);
    expect(submittedBodies[0].query).toContain("mutation UpdatePassword");
    expect(submittedBodies[0].variables).toEqual({
        authToken: "initial-token",
        currentPassword: "current-secret",
        newPassword: "new-secret"
    });

    await pressButton(page, "Save password");
    await expect(page.getByRole("alert")).toHaveText("Password could not be saved. Try again.");
    expect(passwordRequests).toBe(2);

    await pressButton(page, "Save password");
    await expect(page.getByRole("button", {name: "Change password"})).toBeVisible();
    expect(passwordRequests).toBe(3);
    expect(submittedBodies[2].variables).toEqual({
        authToken: "invalid-password-renewal",
        currentPassword: "current-secret",
        newPassword: "new-secret"
    });
    await expect.poll(async function() {
        const cookies = await context.cookies(baseUrl);
        return cookies.find(function(cookie) { return cookie.name === "loginToken"; })?.value;
    }).toBe("password-renewed-token");
});

test("mounted account settings have no detectable WCAG A or AA violations in High Contrast", async function({page}) {
    await openAccount(page);
    await expect(page.locator("link#theme")).toHaveAttribute(
        "href",
        /\/css\/bootstrap-high-contrast\.min\.css/
    );
    await pressButton(page, "Edit notification settings");
    await pressButton(page, "Change password");
    await page.getByLabel("Current Password", {exact: true}).fill("current-secret");
    await page.getByLabel("New Password", {exact: true}).fill("new-secret");
    await page.getByLabel("Confirm Password", {exact: true}).fill("different-secret");
    await pressButton(page, "Save password");
    await expect(page.getByRole("alert")).toHaveText("New passwords do not match.");

    const results = await new AxeBuilder({page})
        .include('[data-react-root="account-settings"]')
        .withTags([
            "wcag2a",
            "wcag2aa",
            "wcag21a",
            "wcag21aa",
            "wcag22a",
            "wcag22aa"
        ])
        .analyze();
    expect(results.violations).toEqual([]);
});
