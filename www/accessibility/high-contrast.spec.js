"use strict";

const Module = require("node:module");
const AxeBuilder = require("@axe-core/playwright").default;
const { expect, test } = require("@playwright/test");
const fulfillLocalBrowserScript = require("./support/local-browser-scripts");
const publicPageData = require("./support/public-page-data");

const pages = [
    { heading: "Welcome to LegendHUB!", name: "home", path: "/" },
    { heading: "Login", name: "login", path: "/login.html" },
    { heading: "Send Feedback", name: "feedback", path: "/feedback.html" },
    { name: "builder", path: "/builder/", title: "Builder | LegendHUB" },
    { fixtureText: "Brass lantern", heading: "Items", name: "items", path: "/items/" },
    { fixtureText: "Test sentry", heading: "Mobs", name: "mobs", path: "/mobs/" },
    { fixtureText: "A representative quest", heading: "Quests", name: "quests", path: "/quests/" },
    { fixtureText: "A representative wiki page", heading: "Wiki", name: "wiki", path: "/wiki/" }
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
        return require("../src/create-app")({ logging: false });
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

async function expectHighContrastPage(page, pageUnderTest) {
    const response = await page.goto(`${baseUrl}${pageUnderTest.path}`);
    expect(response).not.toBeNull();
    expect(response.status()).toBe(200);
    if (pageUnderTest.heading) {
        await expect(page.getByRole("heading", {
            name: pageUnderTest.heading,
            exact: true
        })).toBeVisible();
    }
    else {
        await expect(page).toHaveTitle(pageUnderTest.title);
    }

    if (pageUnderTest.fixtureText)
        await expect(page.getByText(pageUnderTest.fixtureText, { exact: true })).toBeVisible();

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

async function expectKeyboardModal(page, trigger, dialog, controlled = true) {
    await trigger.focus();
    await expect(trigger).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(dialog).toBeVisible();
    await expect(dialog).toBeFocused();
    if (controlled) {
        await expect(trigger).toHaveAttribute("aria-expanded", "true");
        expect(await trigger.evaluate(element => element.closest("[inert]") != null)).toBe(true);
    }
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
    await expectNoWcagViolations(page);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    if (controlled) {
        await expect(trigger).toHaveAttribute("aria-expanded", "false");
        expect(await trigger.evaluate(element => element.closest("[inert]") == null)).toBe(true);
    }
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

        return fulfillLocalBrowserScript(route);
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

test("browser runtime preserves self-closing HTML during jQuery prefiltering", async function({ page }) {
    const response = await page.goto(`${baseUrl}/`);
    expect(response).not.toBeNull();
    expect(response.status()).toBe(200);

    const filteredHtml = await page.evaluate(function() {
        return window.jQuery.htmlPrefilter("<div/>");
    });
    expect(filteredHtml).toBe("<div/>");
});

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

test("theme chooser supports keyboard access to the Glass theme submenu", async function({ page }) {
    const homePage = pages.find(function(pageUnderTest) {
        return pageUnderTest.name === "home";
    });
    await expectHighContrastPage(page, homePage);

    const themeButton = page.getByRole("button", { name: "Choose theme" });
    await themeButton.focus();
    await expect(themeButton).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(themeButton).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator('.dropdown-menu[aria-labelledby="themeDropdown"]')).toBeVisible();

    await page.keyboard.press("Tab");
    const glassButton = page.getByRole("button", { name: "Glass", exact: true });
    await expect(glassButton).toBeFocused();
    const glassThemes = page.getByRole("group", { name: "Glass themes" });
    await expect(glassThemes).toBeHidden();
    await page.keyboard.press("Enter");

    await expect(glassButton).toHaveAttribute("aria-expanded", "true");
    await expect(glassThemes).toBeVisible();
    await expect(glassThemes.getByRole("button")).toHaveCount(5);
    await expectNoWcagViolations(page);

    await page.keyboard.press("Tab");
    const glassBlue = glassThemes.getByRole("button", { name: "Blue", exact: true });
    await expect(glassBlue).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("link#theme")).toHaveAttribute(
        "href",
        /\/css\/bootstrap-glass-blue\.min\.css/
    );
});

test("Items Columns dialog supports keyboard access without detectable violations", async function({ page }) {
    const itemsPage = pages.find(function(pageUnderTest) {
        return pageUnderTest.name === "items";
    });
    await expectHighContrastPage(page, itemsPage);

    await expectKeyboardModal(
        page,
        page.getByRole("button", { name: "Columns", exact: true }),
        page.getByRole("dialog", { name: "Select visible columns" })
    );
});

test("Items Filters dialog supports keyboard access without detectable violations", async function({ page }) {
    const itemsPage = pages.find(function(pageUnderTest) {
        return pageUnderTest.name === "items";
    });
    await expectHighContrastPage(page, itemsPage);

    await expectKeyboardModal(
        page,
        page.getByRole("button", { name: "Filters", exact: true }),
        page.getByRole("dialog", { name: "Select search filters" })
    );
});

test("Items Columns dialog keeps the selected option focused while changing visibility", async function({ page }) {
    const itemsPage = pages.find(function(pageUnderTest) { return pageUnderTest.name === "items"; });
    await expectHighContrastPage(page, itemsPage);
    await page.getByRole("button", {name: "Columns", exact: true}).click();
    const option = page.getByRole("button", {name: "Name", exact: true});
    await option.click();
    await expect(option).toBeFocused();
});

// Catches a pending search that prevents a newer query, or an older response that overwrites it.
test("Items search aborts obsolete requests and renders only the newest results", async function({ page }) {
    const itemsPage = pages.find(function(pageUnderTest) { return pageUnderTest.name === "items"; });
    let count = 0;
    let releaseFirst;
    const firstStarted = new Promise(resolve => { releaseFirst = resolve; });
    let started;
    const firstRequest = new Promise(resolve => { started = resolve; });
    await page.route(`${baseUrl}/api`, async function(route) {
        count++;
        if (count === 1) {
            started();
            await firstStarted;
            await route.fulfill({contentType: "application/json", body: JSON.stringify({data: {getItems: {items: [{id: 11, name: "Old result"}], moreResults: false}}})});
            return;
        }
        await route.fulfill({contentType: "application/json", body: JSON.stringify({data: {getItems: {items: [{id: 12, name: "New result"}], moreResults: false}}})});
    });
    await expectHighContrastPage(page, itemsPage);
    const input = page.getByPlaceholder("Search by name...");
    await input.fill("old");
    await input.press("Enter");
    await firstRequest;
    await input.fill("new");
    await page.getByRole("button", {name: /Search/}).click();
    await expect.poll(() => count).toBe(2);
    releaseFirst();
    await expect(page.getByText("New result", {exact: true})).toBeVisible();
    await expect(page.getByText("Old result", {exact: true})).toHaveCount(0);
});

// Catches history traversal that changes the URL but leaves React displaying the newer query.
test("Items search keeps Back and Forward results synchronized with canonical URLs", async function({ page }) {
    const itemsPage = pages.find(pageUnderTest => pageUnderTest.name === "items");
    await page.route(`${baseUrl}/api`, async route => {
        const search = JSON.parse(route.request().postData()).variables.searchString;
        await route.fulfill({contentType: "application/json", body: JSON.stringify({data: {getItems: {moreResults: false, items: [{id: search === "alpha" ? 21 : 22, name: search === "alpha" ? "Alpha result" : "Beta result", slot: 0, isLight: true}]}}})});
    });
    await expectHighContrastPage(page, itemsPage);
    const input = page.getByPlaceholder("Search by name...");
    await input.fill("alpha"); await input.press("Enter"); await expect(page.getByText("Alpha result", {exact: true})).toBeVisible();
    await input.fill("beta"); await input.press("Enter"); await expect(page.getByText("Beta result", {exact: true})).toBeVisible();
    await page.goBack(); await expect(page).toHaveURL(/search=alpha/); await expect(page.getByText("Alpha result", {exact: true})).toBeVisible();
    await page.goForward(); await expect(page).toHaveURL(/search=beta/); await expect(page.getByText("Beta result", {exact: true})).toBeVisible();
});

// Catches React Columns preferences that write without consent or drift from the established sc2 cookie contract.
test("Items Columns persists consented toggle and reset choices through the real cookie path", async function({context, page}) {
    const itemsPage = pages.find(pageUnderTest => pageUnderTest.name === "items");
    await expectHighContrastPage(page, itemsPage);
    await page.getByRole("button", {name: "Columns", exact: true}).click();
    await page.getByRole("button", {name: "Slot", exact: true}).click();
    expect((await context.cookies(baseUrl)).find(cookie => cookie.name === "sc2")).toBeUndefined();
    await page.keyboard.press("Escape");
    await context.addCookies([{name: "cookie-consent", value: "true", url: baseUrl}]);
    await page.reload();
    await page.waitForTimeout(50);
    expect(await page.evaluate(() => document.cookie.includes("cookie-consent=true"))).toBe(true);
    await page.getByRole("button", {name: "Columns", exact: true}).click();
    await page.getByRole("button", {name: "Slot", exact: true}).click();
    await page.getByRole("button", {name: "Reset to defaults", exact: true}).click();
    await expect(page.getByRole("button", {name: "Slot", exact: true}).locator("svg.text-danger")).toBeVisible();
    await context.addCookies([{name: "sc2", value: "Name-Slot", domain: "127.0.0.1", path: "/", sameSite: "Lax", secure: true, expires: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365 * 20}]);
    await page.getByRole("button", {name: "Slot", exact: true}).click();
    await page.reload(); await page.getByRole("button", {name: "Columns", exact: true}).click();
    await expect(page.getByRole("button", {name: "Slot", exact: true}).locator("svg.text-success")).toBeVisible();
});

// Catches missing React modal behavior for reset/defaults, filter buttons, filter selections, and filter reset.
test("Items Columns and Filters dialogs preserve picker controls and ordering", async function({page}) {
    const itemsPage = pages.find(pageUnderTest => pageUnderTest.name === "items");
    await expectHighContrastPage(page, itemsPage);
    await page.getByRole("button", {name: "Columns", exact: true}).click();
    await expect(page.getByRole("heading", {name: "Select visible columns"})).toBeVisible();
    await page.getByRole("button", {name: "Slot", exact: true}).click(); await page.getByRole("button", {name: "Reset to defaults", exact: true}).click();
    await expect(page.getByRole("button", {name: "Slot", exact: true}).locator("svg.text-danger")).toBeVisible();
    await page.keyboard.press("Escape"); await page.getByRole("button", {name: "Filters", exact: true}).click();
    await expect(page.getByRole("heading", {name: "Select search filters"})).toBeVisible();
    const filtersDialog = page.getByRole("dialog", {name: "Select search filters"});
    const light = filtersDialog.getByRole("button", {name: "Light", exact: true}); await light.click(); await expect(light).toHaveAttribute("aria-pressed", "true");
    await page.getByLabel("Slot").selectOption("0"); await expect(page.getByLabel("Slot")).toHaveValue("0");
    await page.getByRole("button", {name: "Reset to defaults", exact: true}).click(); await expect(light).toHaveAttribute("aria-pressed", "false"); await expect(page.getByLabel("Slot")).toHaveValue("");
});

test("Builder collapsible section supports keyboard access without detectable violations", async function({ page }) {
    const builderPage = pages.find(function(pageUnderTest) {
        return pageUnderTest.name === "builder";
    });
    await expectHighContrastPage(page, builderPage);

    await expect(page.locator('select[ng-model="selectedListIndex"]'))
        .toHaveAccessibleName("Character");
    await expect(page.locator('select[ng-model="selectedListVariantIndex"]'))
        .toHaveAccessibleName("Variant");

    const toggle = page.getByRole("button", { name: "KSM Swap/Quest Mods" });
    await toggle.focus();
    await expect(toggle).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#ksmQuestMods")).toHaveClass(/(^|\s)show(\s|$)/);
    await expect(toggle).toBeFocused();
    await expectNoWcagViolations(page);

    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#ksmQuestMods")).toBeHidden();
    await expect(toggle).toBeFocused();
});

test("Builder Columns dialog supports keyboard access without detectable violations", async function({ page }) {
    const builderPage = pages.find(function(pageUnderTest) {
        return pageUnderTest.name === "builder";
    });
    await expectHighContrastPage(page, builderPage);

    await expectKeyboardModal(
        page,
        page.getByRole("button", { name: "Hide/Show Columns", exact: true }).filter({ visible: true }),
        page.getByRole("dialog", { name: "Select visible columns" }),
        false
    );
});
