"use strict";

const Module = require("node:module");
const AxeBuilder = require("@axe-core/playwright").default;
const { expect, test } = require("@playwright/test");

const pages = [
    { heading: "Welcome to LegendHUB!", name: "home", path: "/" },
    { heading: "Login", name: "login", path: "/login.html" },
    { heading: "Send Feedback", name: "feedback", path: "/feedback.html" }
];

let baseUrl;
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
        return require("../src/create-app")({ logging: false });
    }
    finally {
        Module._load = originalLoad;
    }
}

test.beforeAll(async function() {
    const app = loadAppWithoutDatabaseMetadataQuery();
    server = await new Promise(function(resolve) {
        const listeningServer = app.listen(0, "127.0.0.1", function() {
            resolve(listeningServer);
        });
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.afterAll(async function() {
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

async function expectHighContrastPage(page, pageUnderTest) {
    const response = await page.goto(`${baseUrl}${pageUnderTest.path}`);
    expect(response).not.toBeNull();
    expect(response.status()).toBe(200);
    await expect(page.getByRole("heading", {
        name: pageUnderTest.heading,
        exact: true
    })).toBeVisible();
    await expect(page.locator("link#theme")).toHaveAttribute(
        "href",
        /\/css\/bootstrap-high-contrast\.min\.css/
    );
}

async function expectNoWcagViolations(page) {
    const results = await new AxeBuilder({ page })
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
}

test.beforeEach(async function({ context, page }) {
    await context.addCookies([{
        name: "theme",
        value: "high-contrast",
        url: baseUrl
    }]);
    await page.route(/^https?:\/\//, function(route) {
        if (route.request().url().startsWith(baseUrl))
            return route.continue();

        return route.abort();
    });
});

for (const pageUnderTest of pages) {
    test(`${pageUnderTest.name} has no detectable WCAG A or AA violations in High Contrast`, async function({ page }) {
        await expectHighContrastPage(page, pageUnderTest);
        if (pageUnderTest.name === "login") {
            await expect(page.locator("#login_username")).toHaveAccessibleName("Username");
            await expect(page.locator("#login_username")).toHaveAccessibleDescription("");
            await expect(page.locator("#login_password")).toHaveAccessibleName("Password");
            await expect(page.locator("#login_password")).toHaveAccessibleDescription("");
        }
        await expectNoWcagViolations(page);
    });
}

test("registration error state has no detectable WCAG A or AA violations in High Contrast", async function({ page }) {
    const loginPage = pages.find(function(pageUnderTest) {
        return pageUnderTest.name === "login";
    });
    await expectHighContrastPage(page, loginPage);

    const [response] = await Promise.all([
        page.waitForNavigation(),
        page.locator('form[name="register"]').evaluate(function(form) {
            form.elements.register_username.value = "accessibility-check";
            form.elements.register_password.value = "test-password";
            form.elements.register_confirmPassword.value = "test-password";
            form.submit();
        })
    ]);

    expect(response).not.toBeNull();
    expect(response.status()).toBe(200);
    await expect(page.getByText("Error: Please fill out reCAPTCHA.", { exact: true })).toBeVisible();
    await expect(page.locator("#registerCollapse")).toHaveClass(/(^|\s)show(\s|$)/);
    await expect(page.locator("link#theme")).toHaveAttribute(
        "href",
        /\/css\/bootstrap-high-contrast\.min\.css/
    );
    await expect(page.locator("#register_username")).toHaveAccessibleName("Username");
    await expect(page.locator("#register_username")).toHaveAccessibleDescription("");
    await expect(page.locator("#register_password")).toHaveAccessibleName("Password");
    await expect(page.locator("#register_password")).toHaveAccessibleDescription("");
    await expect(page.locator("#register_confirmPassword")).toHaveAccessibleName("Confirm");
    await expect(page.locator("#register_confirmPassword")).toHaveAccessibleDescription("");
    await expectNoWcagViolations(page);
});
