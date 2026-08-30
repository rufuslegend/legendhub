"use strict";

const Module = require("node:module");
const {expect, test} = require("@playwright/test");
const fulfillLocalBrowserScript = require("./support/local-browser-scripts");
const publicPageData = require("./support/public-page-data");

const pages = [
    {
        categoryLabel: "Areas",
        categoryName: "Ancient",
        categoryQuery: "search=sentry&eraId=1",
        detailsPath: "/mobs/details.html?id=201",
        heading: "Mobs",
        name: "Test sentry",
        path: "/mobs/index.html?search=sentry&eraId=1&areaId=11",
        sort: "Name",
        sortedQuery: "search=sentry&eraId=1&areaId=11&sortBy=name&sortAsc=true"
    },
    {
        categoryLabel: "Areas",
        categoryName: "Ancient",
        categoryQuery: "search=quest&stat=true&eraId=1",
        detailsPath: "/quests/details.html?id=301",
        heading: "Quests",
        name: "A representative quest",
        path: "/quests/index.html?search=quest&stat=true&eraId=1&areaId=11",
        sort: "Title",
        sortedQuery: "search=quest&stat=true&eraId=1&areaId=11&sortBy=title&sortAsc=true"
    },
    {
        categoryLabel: "Categories",
        categoryName: "Guides",
        categoryQuery: "search=guide&categoryId=4",
        detailsPath: "/wiki/details.html?id=401",
        heading: "Wiki",
        name: "A representative wiki page",
        path: "/wiki/index.html?search=guide&categoryId=4&subcategoryId=41",
        sort: "Title",
        sortedQuery: "search=guide&categoryId=4&subcategoryId=41&sortBy=title&sortAsc=true"
    }
];

let baseUrl;
let graphqlCalls = [];
let restorePostAsync;
let server;

function loadAppWithoutDatabaseMetadataQuery() {
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
    apiUtils.postAsync = async function(query, ip, variables) {
        graphqlCalls.push({query, ip, variables});
        if (query.includes("authLogin"))
            throw new Error("Invalid credentials.");
        return publicPageData(query);
    };
    restorePostAsync = function() {
        apiUtils.postAsync = originalPostAsync;
    };
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
    graphqlCalls = [];
    await context.addCookies([{
        name: "cookie-consent",
        value: "true",
        url: baseUrl
    }]);
    await context.route(/^https?:\/\//, function(route) {
        if (route.request().url().startsWith(baseUrl))
            return route.continue();
        return fulfillLocalBrowserScript(route);
    });
});

const reflectedPayload = '\\" autofocus onfocus=__legendhubReflectedXss() x=\\"';

for (const routeCase of [{
    heading: "Mobs",
    operation: "getMobs",
    path: "/mobs/index.html",
    params: {eraId: "1", areaId: "11"},
    variables: {eraId: 1, areaId: 11}
}, {
    heading: "Quests",
    operation: "getQuests",
    path: "/quests/index.html",
    params: {eraId: "1", areaId: "11", stat: "true"},
    variables: {eraId: 1, areaId: 11, stat: true}
}, {
    heading: "Wiki",
    operation: "getWikiPages",
    path: "/wiki/index.html",
    params: {categoryId: "4", subcategoryId: "41"},
    variables: {categoryId: 4, subcategoryId: 41}
}]) {
    // Catches request text being executable in an attribute while remaining a
    // syntactically valid interpolated GraphQL string.
    test(`${routeCase.heading} keeps hostile list parameters in variables and inert markup`, async function({page}) {
        await page.addInitScript(function() {
            window.__legendhubReflectedXssCount = 0;
            window.__legendhubReflectedXss = function() {
                window.__legendhubReflectedXssCount += 1;
            };
        });
        const target = new URL(`${baseUrl}${routeCase.path}`);
        target.searchParams.set("search", reflectedPayload);
        target.searchParams.set("sortBy", reflectedPayload);
        target.searchParams.set("sortAsc", "true");
        target.searchParams.set("page", "not-an-integer");
        for (const [name, value] of Object.entries(routeCase.params))
            target.searchParams.set(name, value);

        const response = await page.goto(target.href);
        expect(response).not.toBeNull();
        expect(response.status()).toBe(200);
        await expect(page.getByRole("textbox")).toHaveValue(reflectedPayload);
        expect(await page.locator("[onfocus], [onerror], [onload]").count()).toBe(0);
        expect(await page.evaluate(() => window.__legendhubReflectedXssCount)).toBe(0);

        const call = graphqlCalls.find(entry => entry.query.includes(routeCase.operation));
        expect(call).toBeDefined();
        expect(call.query).not.toContain(reflectedPayload);
        expect(call.query).toContain("$searchString");
        expect(call.variables).toEqual({
            searchString: reflectedPayload,
            ...routeCase.variables,
            sortBy: null,
            sortAsc: true,
            page: 1,
            rows: 20
        });
        const sortHref = await page.getByRole("columnheader").first().getByRole("link").getAttribute("href");
        expect(new URL(sortHref, baseUrl).searchParams.get("search")).toBe(reflectedPayload);
    });
}

// Catches failed authentication reflecting a GraphQL-safe attribute breakout
// and repopulating the submitted password into the response document.
test("failed login keeps credentials in variables and never repopulates the password", async function({page}) {
    await page.addInitScript(function() {
        window.__legendhubReflectedXssCount = 0;
        window.__legendhubReflectedXss = function() {
            window.__legendhubReflectedXssCount += 1;
        };
    });
    const password = `secret-${reflectedPayload}`;
    await page.goto(`${baseUrl}/login.html`);
    await page.locator("#login_username").fill(reflectedPayload);
    await page.locator("#login_password").fill(password);
    await Promise.all([
        page.waitForURL(`${baseUrl}/login.html`),
        page.locator('form[name="login"] button[type="submit"]').click()
    ]);

    await expect(page.locator("#login_username")).toHaveValue(reflectedPayload);
    await expect(page.locator("#login_password")).toHaveValue("");
    expect(await page.locator("[onfocus], [onerror], [onload]").count()).toBe(0);
    expect(await page.evaluate(() => window.__legendhubReflectedXssCount)).toBe(0);
    const call = graphqlCalls.find(entry => entry.query.includes("authLogin"));
    expect(call).toBeDefined();
    expect(call.query).not.toContain(reflectedPayload);
    expect(call.variables).toEqual({
        identity: reflectedPayload,
        password,
        stayLoggedIn: false
    });
});

async function openListPage(page, pageUnderTest, viewport) {
    await page.setViewportSize(viewport);
    const response = await page.goto(`${baseUrl}${pageUnderTest.path}`);
    expect(response).not.toBeNull();
    expect(response.status()).toBe(200);
    await expect(page.getByRole("heading", {name: pageUnderTest.heading, exact: true})).toBeVisible();
}

function expectQuery(url, expectedQuery) {
    expect(new URL(url, baseUrl).searchParams.toString()).toBe(expectedQuery);
}

for (const pageUnderTest of pages) {
    test(`${pageUnderTest.heading} has semantic list navigation that preserves its query`, async function({context, page}) {
        await openListPage(page, pageUnderTest, {width: 1280, height: 720});
        await context.route(`${baseUrl}${pageUnderTest.detailsPath}`, function(route) {
            return route.fulfill({
                body: "<!doctype html><title>Details</title>",
                contentType: "text/html"
            });
        });

        const search = page.getByRole("textbox");
        await expect(search).toBeFocused();

        const sort = page.getByRole("link", {name: pageUnderTest.sort, exact: true});
        await expect(sort).toBeVisible();
        expectQuery(await sort.getAttribute("href"), pageUnderTest.sortedQuery);
        const category = page.locator(`#${pageUnderTest.heading.toLowerCase()}-categories`)
            .getByRole("link", {name: pageUnderTest.categoryName, exact: true});
        expectQuery(await category.getAttribute("href"), pageUnderTest.categoryQuery);

        const details = page.getByRole("link", {name: pageUnderTest.name, exact: true});
        await expect(details).toHaveAttribute("href", pageUnderTest.detailsPath);
        await expect(details).not.toHaveAttribute("target");

        const external = page.getByRole("link", {
            name: `Open details for ${pageUnderTest.name} in a new tab`
        });
        await expect(external).toHaveAttribute("href", pageUnderTest.detailsPath);
        await expect(external).toHaveAttribute("target", "_blank");
        await external.focus();
        await expect(external).toBeFocused();
        const externalPagePromise = context.waitForEvent("page");
        await page.keyboard.press("Enter");
        const externalPage = await externalPagePromise;
        await externalPage.waitForURL(`${baseUrl}${pageUnderTest.detailsPath}`);
        await externalPage.close();

        await details.focus();
        await expect(details).toBeFocused();
        await Promise.all([
            page.waitForURL(`${baseUrl}${pageUnderTest.detailsPath}`),
            page.keyboard.press("Enter")
        ]);
    });

    test(`${pageUnderTest.heading} category navigation opens and restores focus from the keyboard`, async function({page}) {
        await openListPage(page, pageUnderTest, {width: 600, height: 720});

        const open = page.getByRole("button", {name: `Open ${pageUnderTest.categoryLabel.toLowerCase()}`});
        const categoryList = page.locator(`#${pageUnderTest.heading.toLowerCase()}-categories`);
        await expect(open).toHaveAttribute("aria-controls", await categoryList.getAttribute("id"));
        await expect(open).toHaveAttribute("aria-expanded", "false");
        await open.focus();
        await page.keyboard.press("Enter");
        await expect(categoryList).toHaveClass(/(^|\s)active(\s|$)/);
        await expect(open).toHaveAttribute("aria-expanded", "true");

        const close = categoryList.getByRole("button", {name: `Close ${pageUnderTest.categoryLabel.toLowerCase()}`});
        const category = categoryList.getByRole("link", {name: pageUnderTest.categoryName, exact: true});
        await expect(close).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(category).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(categoryList).not.toHaveClass(/(^|\s)active(\s|$)/);
        await expect(open).toHaveAttribute("aria-expanded", "false");
        await expect(open).toBeFocused();

        await page.keyboard.press("Space");
        await expect(categoryList).toHaveClass(/(^|\s)active(\s|$)/);
        await expect(close).toBeFocused();
        await page.keyboard.press("Tab");
        await expect(category).toBeFocused();
        await page.keyboard.press("Shift+Tab");
        await expect(close).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(categoryList).not.toHaveClass(/(^|\s)active(\s|$)/);
        await expect(open).toBeFocused();
    });
}
