"use strict";

const Module = require("node:module");
const {expect, test} = require("@playwright/test");
const fulfillLocalBrowserScript = require("./support/local-browser-scripts");
const publicPageData = require("./support/public-page-data");

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
        const listeningServer = app.listen(0, "localhost", function() {
            resolve(listeningServer);
        });
    });
    baseUrl = `http://localhost:${server.address().port}`;
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
        name: "theme",
        value: "high-contrast",
        url: baseUrl
    }]);
    await page.route(/^https?:\/\//, function(route) {
        if (route.request().url().startsWith(baseUrl))
            return route.continue();

        return fulfillLocalBrowserScript(route);
    });
});

for (const viewport of [
    {width: 1280, height: 900},
    {width: 375, height: 812}
]) {
    test(`Manual contents work at ${viewport.width}px`,
        async function({page}) {
            await page.setViewportSize(viewport);
            const response = await page.goto(baseUrl + "/manual/");
            expect(response).not.toBeNull();
            expect(response.status()).toBe(200);

            await expect(page.getByRole("heading", {
                level: 1,
                name: "LegendHUB User Manual"
            })).toHaveCount(1);
            const contents = page.getByRole("navigation", {
                name: "Manual contents"
            });
            await expect(contents).toBeVisible();

            const builderLink = contents.getByRole("link", {
                name: "Using the Character Builder",
                exact: true
            });
            await builderLink.focus();
            await expect(builderLink).toBeFocused();
            await builderLink.press("Enter");
            await expect(page).toHaveURL(
                /#using-the-character-builder$/
            );
            await expect(
                page.locator("#using-the-character-builder")
            ).toBeVisible();

            const overflows = await page.evaluate(function() {
                return document.documentElement.scrollWidth >
                    document.documentElement.clientWidth;
            });
            expect(overflows).toBe(false);
        });
}
