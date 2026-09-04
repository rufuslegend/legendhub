"use strict";

const Module = require("node:module");
const AxeBuilder = require("@axe-core/playwright").default;
const {expect, test} = require("@playwright/test");
const fulfillLocalBrowserScript = require("./support/local-browser-scripts");
const publicPageData = require("./support/public-page-data");

const storedEntityName = '<img src="/missing-notification-image" onerror="__legendhubNotificationXss()"><svg onload="__legendhubNotificationXss()"></svg>';
const storedNotification = {
    actorName: "Fixture actor",
    count: 1,
    createdOn: "2026-08-23T12:00:00.000Z",
    id: 81,
    link: "/items/details.html?id=101",
    message: `Item <span class="text-info">${storedEntityName}</span> has been updated by Fixture actor.`,
    objectId: 101,
    objectName: storedEntityName,
    objectPage: "items",
    objectType: "item",
    read: false,
    verb: "updated"
};

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
        apiUtils.postAsync = async function(query) {
            if (query.includes("getNotifications(")) {
                return {
                    getNotifications: {
                        moreResults: false,
                        results: [storedNotification]
                    }
                };
            }
            return publicPageData(query);
        };
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
        {name: "cookie-consent", value: "true", url: baseUrl},
        {name: "emailPromptDismissed", value: "true", url: baseUrl}
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

// Catches duplicate mark-read mutations while the first request is pending and
// verifies that a failed attempt restores the control for an intentional retry.
test("notification marking is single-flight and restores its button after failure", async function({page}) {
    let releaseResponse;
    let requestCount = 0;
    const responseGate = new Promise(resolve => { releaseResponse = resolve; });
    await page.route(`${baseUrl}/api`, async function(route) {
        const body = route.request().postDataJSON();
        if (!body.query.includes("MarkNotificationAsRead"))
            return route.abort();
        requestCount += 1;
        await responseGate;
        return route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({errors: [{message: "Unable to update notifications."}]})
        });
    });

    await page.goto(`${baseUrl}/`);
    await page.locator("[data-notification-popover]").filter({visible: true}).click();
    const popover = page.locator(".popover");
    const button = popover.getByRole("button", {name: "Mark all as read"});

    try {
        await button.evaluate(function(element) {
            element.click();
            element.click();
        });
        await expect.poll(function() { return requestCount; }).toBe(1);
        await expect(button).toBeDisabled();
        await expect(button).toHaveAttribute("aria-busy", "true");
    }
    finally {
        releaseResponse();
    }

    await expect(popover.getByRole("status")).toHaveText("Unable to update notifications.");
    await expect(button).toBeEnabled();
    await expect(button).toHaveAttribute("aria-busy", "false");
});

// Catches stored entity names becoming executable HTML in either notification
// view or in the Bootstrap clone used by the header popover.
test("stored notification names remain text in the page and popover", async function({page}) {
    await page.addInitScript(function() {
        window.__legendhubNotificationXssCount = 0;
        window.__legendhubNotificationXss = function() {
            window.__legendhubNotificationXssCount += 1;
        };
    });

    await page.goto(`${baseUrl}/`);
    const source = page.locator("#notification-window");
    await expect(source).toContainText(storedEntityName);
    await expect(source.locator("img, svg")).toHaveCount(0);
    const trigger = page.locator("[data-notification-popover]").filter({visible: true});
    await trigger.click();
    const popover = page.locator(".popover");
    await expect(popover).toContainText(storedEntityName);
    await expect(popover.locator("img, svg")).toHaveCount(0);
    await expect(popover.locator("[onerror], [onload]")).toHaveCount(0);
    expect(await page.evaluate(() => window.__legendhubNotificationXssCount)).toBe(0);

    await page.goto(`${baseUrl}/notifications/`);
    const notificationList = page.locator("main, body").filter({hasText: "All Notifications"});
    await expect(notificationList).toContainText(storedEntityName);
    await expect(notificationList.locator("img, svg")).toHaveCount(0);
    await expect(notificationList.locator("[onerror], [onload]")).toHaveCount(0);
    expect(await page.evaluate(() => window.__legendhubNotificationXssCount)).toBe(0);
});

// Catches a role-only notification opener that can receive focus but does not
// activate with the native Enter and Space button gestures.
test("notification trigger opens and closes from both keyboard activation keys", async function({page}) {
    await page.goto(`${baseUrl}/`);
    const trigger = page.locator("[data-notification-popover]").filter({visible: true});
    expect(await trigger.evaluate(element => element.tagName)).toBe("BUTTON");
    await trigger.focus();
    await expect(trigger).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(page.locator(".popover")).toBeVisible();
    await expect(trigger).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator(".popover")).toBeHidden();

    await page.keyboard.press("Space");
    await expect(page.locator(".popover")).toBeVisible();
    await expect(trigger).toBeFocused();
    await page.keyboard.press("Space");
    await expect(page.locator(".popover")).toBeHidden();
});

// Catches the semantic mark-read button retaining its native pale fill instead
// of matching the popover in every theme.
test("middle notification action matches the popover in every theme", async function({context, page}) {
    for (const theme of [
        "glass-blue",
        "glass-emerald",
        "glass-ruby",
        "glass-amethyst",
        "glass-amber",
        "light",
        "dark",
        "solarized-dark",
        "high-contrast"
    ]) {
        await context.addCookies([{name: "theme", value: theme, url: baseUrl}]);
        await page.goto(`${baseUrl}/`);
        await expect(page.locator("link#theme")).toHaveAttribute(
            "href",
            new RegExp(`/css/bootstrap-${theme}\\.min\\.css`)
        );
        await page.locator("[data-notification-popover]").filter({visible: true}).click();
        const popover = page.locator(".popover");
        await expect(popover).toBeVisible();
        await expect.poll(async function() {
            return popover.evaluate(element => getComputedStyle(element).opacity);
        }).toBe("1");
        const markRead = popover.getByRole("button", {name: "Mark all as read"});
        await expect(markRead).toHaveCSS(
            "background-color",
            "rgba(0, 0, 0, 0)"
        );
    }
});

// Axe coverage is intentionally limited to high contrast, where the selected
// stylesheet is part of the accessibility contract.
test("notification action has no color-contrast violations in high contrast", async function({context, page}) {
    await context.addCookies([{name: "theme", value: "high-contrast", url: baseUrl}]);
    await page.goto(`${baseUrl}/`);
    await expect(page.locator("link#theme")).toHaveAttribute(
        "href",
        /\/css\/bootstrap-high-contrast\.min\.css/
    );
    await page.locator("[data-notification-popover]").filter({visible: true}).click();
    const popover = page.locator(".popover");
    await expect(popover).toBeVisible();
    await expect.poll(() => popover.evaluate(element =>
        getComputedStyle(element).opacity)).toBe("1");

    const results = await new AxeBuilder({page})
        .include(".popover [data-mark-notifications-read]")
        .withRules(["color-contrast"])
        .analyze();
    expect(results.violations, JSON.stringify(results.violations)).toEqual([]);
});
