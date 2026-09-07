"use strict";

const {test: base, expect} = require("@playwright/test");
const {startStack} = require("./stack");
const {freshLogin} = require("./builder");
const fulfillLocalBrowserScript = require("../../accessibility/support/local-browser-scripts");

const test = base.extend({
    stack: [async ({}, use) => {
        const stack = await startStack();
        try {
            await use(stack);
        }
        finally {
            await stack.close();
        }
    }, {scope: "worker", timeout: 300_000}],
    account: async ({stack}, use) => {
        await use(await stack.createAccount());
    },
    signedIn: async ({newDevice, account}, use) => {
        await use(await freshLogin(newDevice, account));
    },
    newDevice: async ({browser, stack}, use, testInfo) => {
        const contexts = [];
        const pageErrors = [];
        await use(async () => {
            const context = await browser.newContext({baseURL: stack.url});
            contexts.push(context);
            // Only CDN scripts are served locally. Every application request,
            // including authentication and GraphQL, reaches the real server.
            await context.route(/^https?:\/\//, route => {
                if (new URL(route.request().url()).origin === stack.url)
                    return route.continue();
                return fulfillLocalBrowserScript(route);
            });
            const page = await context.newPage();
            page.on("pageerror", error => pageErrors.push(error.message));
            return {context, page};
        });
        for (const context of contexts)
            await context.close();
        if (testInfo.status !== testInfo.expectedStatus)
            await testInfo.attach("application-log", {body: stack.output, contentType: "text/plain"});
        expect(pageErrors, "uncaught browser exceptions").toEqual([]);
    }
});

module.exports = {test, expect};
