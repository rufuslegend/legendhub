"use strict";

const Module = require("node:module");
const AxeBuilder = require("@axe-core/playwright").default;
const {expect, test} = require("@playwright/test");
const {Kind, parse} = require("graphql");
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
    await expect(page.locator("body")).not.toHaveAttribute("ng-app");
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

function graphqlType(node) {
    if (node.kind === Kind.NON_NULL_TYPE)
        return `${graphqlType(node.type)}!`;
    if (node.kind === Kind.LIST_TYPE)
        return `[${graphqlType(node.type)}]`;
    return node.name.value;
}

function responseSelection(selectionSet) {
    const names = selectionSet.selections.map(function(field) {
        expect(field.kind).toBe(Kind.FIELD);
        expect(field.alias).toBeUndefined();
        expect(field.arguments).toHaveLength(0);
        return field.name.value;
    });
    expect(new Set(names).size).toBe(names.length);
    return Object.fromEntries(selectionSet.selections.map(function(field) {
        return [
            field.name.value,
            field.selectionSet ? responseSelection(field.selectionSet) : true
        ];
    }));
}

function expectGraphqlContract(body, expected) {
    const document = parse(body.query);
    expect(document.definitions).toHaveLength(1);
    const operation = document.definitions[0];
    expect(operation.kind).toBe(Kind.OPERATION_DEFINITION);
    expect(operation.operation).toBe("mutation");
    expect(operation.name.value).toBe(expected.operationName);
    expect(operation.variableDefinitions).toHaveLength(
        Object.keys(expected.variableDefinitions).length
    );
    expect(Object.fromEntries(operation.variableDefinitions.map(function(definition) {
        return [definition.variable.name.value, graphqlType(definition.type)];
    }))).toEqual(expected.variableDefinitions);
    expect(operation.selectionSet.selections).toHaveLength(1);

    const mutation = operation.selectionSet.selections[0];
    expect(mutation.kind).toBe(Kind.FIELD);
    expect(mutation.alias).toBeUndefined();
    expect(mutation.name.value).toBe(expected.fieldName);
    expect(mutation.arguments).toHaveLength(Object.keys(expected.arguments).length);
    expect(Object.fromEntries(mutation.arguments.map(function(argument) {
        expect(argument.value.kind).toBe(Kind.VARIABLE);
        return [argument.name.value, argument.value.name.value];
    }))).toEqual(expected.arguments);
    expect(responseSelection(mutation.selectionSet)).toEqual(expected.response);
}

// Catches the Email action drifting into the summary column instead of lining
// up with the other Account Settings actions.
test("account email summary aligns its action with notification and password actions", async function({page}) {
    await openAccount(page);

    const emailSection = page.locator('section[aria-labelledby="email-heading"]');
    const current = emailSection.locator("p").filter({hasText: "Current:"}).first();
    const add = emailSection.getByRole("button", {name: "Add email address"});
    const edit = page.getByRole("button", {name: "Edit notification settings"});
    const change = page.getByRole("button", {name: "Change password"});
    const [currentBox, addBox, editBox, changeBox] = await Promise.all([
        current.boundingBox(),
        add.boundingBox(),
        edit.boundingBox(),
        change.boundingBox()
    ]);

    expect(currentBox).not.toBeNull();
    expect(addBox).not.toBeNull();
    expect(editBox).not.toBeNull();
    expect(changeBox).not.toBeNull();
    expect(currentBox.x + currentBox.width).toBeLessThanOrEqual(addBox.x + 1);
    expect(Math.abs(addBox.x - editBox.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(addBox.x - changeBox.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(addBox.width - editBox.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(addBox.width - changeBox.width)).toBeLessThanOrEqual(1);
    expect(Math.min(currentBox.y + currentBox.height, addBox.y + addBox.height) -
        Math.max(currentBox.y, addBox.y)).toBeGreaterThan(0);
});

test("account notification settings mount from props and save once with keyboard controls", async function({context, page}) {
    let releaseSave;
    let notificationRequests = 0;
    const submittedBodies = [];
    await page.route(`${baseUrl}/api`, async function(route) {
        const body = route.request().postDataJSON();
        if (!body.query.includes("UpdateNotificationSettings"))
            return route.abort();

        notificationRequests += 1;
        submittedBodies.push(body);
        if (notificationRequests === 4)
            return route.abort("failed");
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
                            : notificationRequests === 2
                                ? "renewal-without-consent"
                                : "second-renewal-without-consent",
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
    expect(await page.evaluate(function() {
        return {tagName: document.activeElement.tagName, id: document.activeElement.id};
    })).toEqual({tagName: "SELECT", id: "itemAddedInput"});

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
    await expect(page.getByRole("button", {name: "Edit notification settings"})).toBeFocused();
    await pressButton(page, "Edit notification settings");
    await expect(page.getByLabel("Item Added", {exact: true})).toBeFocused();
    await expect(page.getByLabel("Item Updated", {exact: true})).toHaveValue("false");

    await page.getByLabel("Item Updated", {exact: true}).selectOption("true");
    await pressButton(page, "Save notification settings");
    await expect.poll(function() { return notificationRequests; }).toBe(1);
    const savingButton = page.getByRole("button", {name: "Saving notification settings"});
    await expect(savingButton).toBeDisabled();
    await expect(savingButton).toBeVisible();
    await expect(page.getByRole("status", {name: "Saving notification settings"})).toBeFocused();
    await page.locator('section[aria-labelledby="notifications-heading"] form')
        .evaluate(function(form) { form.requestSubmit(); });
    expect(notificationRequests).toBe(1);

    expectGraphqlContract(submittedBodies[0], {
        operationName: "UpdateNotificationSettings",
        fieldName: "updateNotificationSettings",
        variableDefinitions: {
            authToken: "String!",
            itemAdded: "Boolean!",
            itemUpdated: "Boolean!",
            mobAdded: "Boolean!",
            mobUpdated: "Boolean!",
            questAdded: "Boolean!",
            questUpdated: "Boolean!",
            wikiPageAdded: "Boolean!",
            wikiPageUpdated: "Boolean!"
        },
        arguments: {
            authToken: "authToken",
            itemAdded: "itemAdded",
            itemUpdated: "itemUpdated",
            mobAdded: "mobAdded",
            mobUpdated: "mobUpdated",
            questAdded: "questAdded",
            questUpdated: "questUpdated",
            wikiPageAdded: "wikiPageAdded",
            wikiPageUpdated: "wikiPageUpdated"
        },
        response: {token: true, expires: true}
    });
    expect(submittedBodies[0].variables).toEqual({
        authToken: "initial-token",
        ...editableNotifications,
        itemUpdated: true
    });

    releaseSave();
    await expect(page.getByRole("button", {name: "Edit notification settings"})).toBeVisible();
    await expect(page.getByRole("button", {name: "Edit notification settings"})).toBeFocused();
    await expect.poll(async function() {
        const cookies = await context.cookies(baseUrl);
        return cookies.find(function(cookie) { return cookie.name === "loginToken"; })?.value;
    }).toBe("notification-renewed-token");

    await page.evaluate(function() {
        document.cookie = "cookie-consent=; Path=/; Max-Age=0; SameSite=Lax; Secure";
    });
    await pressButton(page, "Edit notification settings");
    await expect(page.getByLabel("Item Added", {exact: true})).toBeFocused();
    await page.getByLabel("Item Added", {exact: true}).selectOption("false");
    await pressButton(page, "Save notification settings");
    await expect.poll(function() { return notificationRequests; }).toBe(2);
    await expect(page.getByRole("button", {name: "Edit notification settings"})).toBeVisible();
    await expect(page.getByRole("button", {name: "Edit notification settings"})).toBeFocused();
    const cookies = await context.cookies(baseUrl);
    expect(cookies.find(function(cookie) { return cookie.name === "loginToken"; })?.value)
        .toBe("renewal-without-consent");

    await pressButton(page, "Edit notification settings");
    await page.getByLabel("Mob Added", {exact: true}).selectOption("true");
    await pressButton(page, "Save notification settings");
    await expect.poll(function() { return notificationRequests; }).toBe(3);
    expect(submittedBodies[2].variables.authToken).toBe("renewal-without-consent");
    await expect.poll(async function() {
        const currentCookies = await context.cookies(baseUrl);
        return currentCookies.find(function(cookie) { return cookie.name === "loginToken"; })?.value;
    }).toBe("second-renewal-without-consent");

    await pressButton(page, "Edit notification settings");
    await page.getByLabel("Quest Added", {exact: true}).selectOption("false");
    await pressButton(page, "Save notification settings");
    await expect(page.getByRole("alert"))
        .toHaveText("Notification settings could not be saved. Try again.");
    await expect(page.getByRole("alert")).toBeFocused();
    expect(notificationRequests).toBe(4);
});

test("password editing announces validation and request failures before saving a renewed token", async function({context, page}) {
    let releasePasswordSave;
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
        if (passwordRequests === 1) {
            await new Promise(function(resolve) {
                releasePasswordSave = resolve;
            });
        }
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
    expect(await page.evaluate(function() {
        return {tagName: document.activeElement.tagName, id: document.activeElement.id};
    })).toEqual({tagName: "INPUT", id: "oldPasswordInput"});
    await page.getByLabel("Current Password", {exact: true}).fill("discard-me");
    await pressButton(page, "Cancel password changes");
    await expect(page.getByRole("button", {name: "Change password"})).toBeFocused();
    await pressButton(page, "Change password");
    await expect(page.getByLabel("Current Password", {exact: true})).toBeFocused();
    await expect(page.getByLabel("Current Password", {exact: true})).toHaveValue("");
    await page.getByLabel("Current Password", {exact: true}).fill("current-secret");
    await page.getByLabel("New Password", {exact: true}).fill("new-secret");
    await page.getByLabel("Confirm Password", {exact: true}).fill("different-secret");
    await pressButton(page, "Save password");
    await expect(page.getByRole("alert")).toHaveText("New passwords do not match.");
    await expect(page.getByRole("alert")).toBeFocused();
    expect(passwordRequests).toBe(0);

    await page.getByLabel("Confirm Password", {exact: true}).fill("new-secret");
    await pressButton(page, "Save password");
    await expect.poll(function() { return passwordRequests; }).toBe(1);
    const savingButton = page.getByRole("button", {name: "Saving password"});
    await expect(savingButton).toBeVisible();
    await expect(savingButton).toBeDisabled();
    await expect(page.getByRole("status", {name: "Saving password"})).toBeFocused();
    await page.locator('section[aria-labelledby="password-heading"] form')
        .evaluate(function(form) { form.requestSubmit(); });
    expect(passwordRequests).toBe(1);
    releasePasswordSave();
    await expect(page.getByRole("alert")).toHaveText("Current password is invalid.");
    await expect(page.getByRole("alert")).toBeFocused();
    expect(passwordRequests).toBe(1);
    expectGraphqlContract(submittedBodies[0], {
        operationName: "UpdatePassword",
        fieldName: "updatePassword",
        variableDefinitions: {
            authToken: "String!",
            currentPassword: "String!",
            newPassword: "String!"
        },
        arguments: {
            authToken: "authToken",
            currentPassword: "currentPassword",
            newPassword: "newPassword"
        },
        response: {
            success: true,
            tokenRenewal: {token: true, expires: true}
        }
    });
    expect(submittedBodies[0].variables).toEqual({
        authToken: "initial-token",
        currentPassword: "current-secret",
        newPassword: "new-secret"
    });

    await pressButton(page, "Save password");
    await expect(page.getByRole("alert")).toHaveText("Password could not be saved. Try again.");
    await expect(page.getByRole("alert")).toBeFocused();
    expect(passwordRequests).toBe(2);

    await pressButton(page, "Save password");
    await expect(page.getByRole("button", {name: "Change password"})).toBeVisible();
    await expect(page.getByRole("button", {name: "Change password"})).toBeFocused();
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

test("account page error boundary offers an accessible reload action", async function({page}) {
    let documentRequests = 0;
    page.on("request", function(request) {
        if (request.isNavigationRequest() && request.url() === `${baseUrl}/account/`)
            documentRequests += 1;
    });
    await page.addInitScript(function() {
        const originalParse = JSON.parse;
        JSON.parse = function(text, reviver) {
            const value = originalParse.call(this, text, reviver);
            if (value && typeof value === "object" && value.notificationSettings) {
                value.notificationSettings = new Proxy(value.notificationSettings, {
                    ownKeys: function() {
                        throw new Error("Injected account render failure");
                    }
                });
            }
            return value;
        };
    });

    const response = await page.goto(`${baseUrl}/account/`);
    expect(response).not.toBeNull();
    expect(response.status()).toBe(200);
    const fallback = page.getByRole("alert");
    await expect(fallback.getByRole("heading", {name: "Something went wrong"})).toBeVisible();
    await expect(fallback).toContainText("We could not load this page. Reload and try again.");
    const reloadButton = fallback.getByRole("button", {name: "Reload page"});
    await expect(reloadButton).toBeVisible();

    await Promise.all([
        page.waitForEvent("load"),
        reloadButton.click()
    ]);
    await expect.poll(function() { return documentRequests; }).toBe(2);
    await expect(page.getByRole("alert").getByRole("button", {name: "Reload page"})).toBeVisible();
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
