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
    apiUtils.postAsync = publicPageData;
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
        await close.focus();
        await expect(close).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(categoryList).not.toHaveClass(/(^|\s)active(\s|$)/);
        await expect(open).toHaveAttribute("aria-expanded", "false");
        await expect(open).toBeFocused();

        await page.keyboard.press("Space");
        await expect(categoryList).toHaveClass(/(^|\s)active(\s|$)/);
        await close.click();
        await expect(categoryList).not.toHaveClass(/(^|\s)active(\s|$)/);
        await expect(open).toBeFocused();
    });
}
