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

test("shared-shell server-rendered pages never load or expose AngularJS", async function({ page }) {
    const angularScriptRequests = [];
    const runtimeSurfaces = [];
    page.on("request", function(request) {
        if (/\bangular(?:-cookies|-sanitize)?(?:\.min)?\.js(?:[?#]|$)/i.test(request.url()))
            angularScriptRequests.push(request.url());
    });

    for (const pageUnderTest of [
        {name: "login", path: "/login.html"},
        {name: "home", path: "/"},
        {name: "feedback", path: "/feedback.html"}
    ]) {
        const response = await page.goto(`${baseUrl}${pageUnderTest.path}`);
        expect(response).not.toBeNull();
        expect(response.status(), pageUnderTest.name).toBe(200);
        await expect(page.locator("body")).toHaveCount(1);
        runtimeSurfaces.push({
            name: pageUnderTest.name,
            ...(await page.evaluate(function() {
                return {
                    angularType: typeof window.angular,
                    directiveAttributes: Array.from(document.querySelectorAll("*")).flatMap(function(element) {
                        return Array.from(element.attributes).map(function(attribute) {
                            return attribute.name;
                        }).filter(function(name) {
                            return name.startsWith("ng-");
                        });
                    })
                };
            }))
        });
    }

    expect({angularScriptRequests, runtimeSurfaces}).toEqual({
        angularScriptRequests: [],
        runtimeSurfaces: [
            {name: "login", angularType: "undefined", directiveAttributes: []},
            {name: "home", angularType: "undefined", directiveAttributes: []},
            {name: "feedback", angularType: "undefined", directiveAttributes: []}
        ]
    });
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

// Catches sort ownership on a non-interactive heading and an item name that is
// only navigable through a mouse-only row click.
test("Items sort and primary result navigation work from the keyboard", async function({page}) {
    const itemsPage = pages.find(pageUnderTest => pageUnderTest.name === "items");
    let sortRequest;
    await page.route(`${baseUrl}/api`, async function(route) {
        sortRequest = route.request().postDataJSON();
        await route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({data: {getItems: {items: [{id: 101, name: "Brass lantern", slot: 0, isLight: true}], moreResults: false}}})
        });
    });
    await expectHighContrastPage(page, itemsPage);

    const sort = page.getByRole("button", {name: "Sort by Name", exact: true});
    await expect(sort).toHaveCount(1);
    await sort.focus();
    await expect(sort).toBeFocused();
    await page.keyboard.press("Enter");
    await expect.poll(() => sortRequest?.variables.sortBy).toBe("name");
    expect(sortRequest.variables.sortAsc).toBe(false);
    await expect(page).toHaveURL(/sortBy=name/);

    await page.route(`${baseUrl}/items/details.html?id=101`, function(route) {
        return route.fulfill({body: "<!doctype html><title>Item details</title>", contentType: "text/html"});
    });
    const details = page.getByRole("link", {name: "Brass lantern", exact: true});
    await expect(details).not.toHaveAttribute("target");
    await details.focus();
    await expect(details).toBeFocused();
    await Promise.all([
        page.waitForURL(`${baseUrl}/items/details.html?id=101`),
        page.keyboard.press("Enter")
    ]);
});

// Catches an uncaught render failure that otherwise replaces the Items page
// with an empty React root and no recovery action.
test("Items page error boundary offers an accessible reload action", async function({page}) {
    let documentRequests = 0;
    page.on("request", function(request) {
        if (request.isNavigationRequest() && request.url() === `${baseUrl}/items/`)
            documentRequests += 1;
    });
    await page.addInitScript(function() {
        const originalParse = JSON.parse;
        JSON.parse = function(text, reviver) {
            const value = originalParse.call(this, text, reviver);
            if (value && typeof value === "object" && Array.isArray(value.results)) {
                value.results = new Proxy(value.results, {
                    get: function(target, property, receiver) {
                        if (property === "map")
                            throw new Error("Injected items render failure");
                        return Reflect.get(target, property, receiver);
                    }
                });
            }
            return value;
        };
    });

    const response = await page.goto(`${baseUrl}/items/`);
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

// Catches a pending search that prevents a newer query, or an older response that overwrites it.
test("Items search aborts obsolete requests and renders only the newest results", async function({ page }) {
    const itemsPage = pages.find(function(pageUnderTest) { return pageUnderTest.name === "items"; });
    let count = 0;
    let obsoleteRequestFailure;
    let releaseFirst;
    const firstStarted = new Promise(resolve => { releaseFirst = resolve; });
    let started;
    const firstRequest = new Promise(resolve => { started = resolve; });
    page.on("requestfailed", function(request) {
        if (request.url() !== `${baseUrl}/api`)
            return;
        const body = request.postDataJSON();
        if (body?.variables?.searchString === "old")
            obsoleteRequestFailure = request.failure()?.errorText;
    });
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
    await expect.poll(() => obsoleteRequestFailure).toContain("ERR_ABORTED");
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
    await page.getByRole("button", {name: "Agree", exact: true}).click();
    await page.reload();
    await page.waitForTimeout(50);
    expect(await page.evaluate(() => document.cookie.includes("cookie-consent=true"))).toBe(true);
    await page.getByRole("button", {name: "Columns", exact: true}).click();
    await page.getByRole("button", {name: "Slot", exact: true}).click();
    const toggleWrittenAt = Date.now() / 1000;
    await expect.poll(async () => (await context.cookies(baseUrl)).find(cookie => cookie.name === "sc2")?.value).toBe("Name-Slot");
    const toggled = (await context.cookies(baseUrl)).find(cookie => cookie.name === "sc2");
    expect(toggled.path).toBe("/"); expect(toggled.sameSite).toBe("Lax"); expect(toggled.secure).toBe(true); expect(toggled.expires).toBeGreaterThan(toggleWrittenAt + 399 * 24 * 60 * 60); expect(toggled.expires).toBeLessThan(toggleWrittenAt + 401 * 24 * 60 * 60);
    const resetWrittenAt = Date.now() / 1000;
    await page.getByRole("button", {name: "Reset to defaults", exact: true}).click();
    await expect(page.getByRole("button", {name: "Slot", exact: true}).locator("svg.text-danger")).toBeVisible();
    await expect.poll(async () => (await context.cookies(baseUrl)).find(cookie => cookie.name === "sc2")?.value).toBe("Name");
    const saved = (await context.cookies(baseUrl)).find(cookie => cookie.name === "sc2");
    // Chromium clamps persistent-cookie lifetime to 400 days, after the production serializer requested its twenty-year expiry.
    expect(saved.path).toBe("/"); expect(saved.sameSite).toBe("Lax"); expect(saved.secure).toBe(true); expect(saved.expires).toBeGreaterThan(resetWrittenAt + 399 * 24 * 60 * 60); expect(saved.expires).toBeLessThan(resetWrittenAt + 401 * 24 * 60 * 60);
    await page.getByRole("button", {name: "Slot", exact: true}).click();
    await expect.poll(async () => (await context.cookies(baseUrl)).find(cookie => cookie.name === "sc2")?.value).toBe("Name-Slot");
    await page.reload(); await page.getByRole("button", {name: "Columns", exact: true}).click();
    await expect(page.getByRole("button", {name: "Slot", exact: true}).locator("svg.text-success")).toBeVisible();
});

// Catches missing React modal behavior for reset/defaults, filter buttons, filter selections, and filter reset.
test("Items Columns and Filters dialogs preserve picker controls and ordering", async function({page}) {
    const itemsPage = pages.find(pageUnderTest => pageUnderTest.name === "items");
    await expectHighContrastPage(page, itemsPage);
    await page.getByRole("button", {name: "Columns", exact: true}).click();
    await expect(page.getByRole("heading", {name: "Select visible columns"})).toBeVisible();
    expect(await page.getByRole("dialog", {name: "Select visible columns"}).locator("h6").allTextContents()).toEqual(["Basic", "Main", "Limits", "Ranged", "Regen", "Tank", "Melee", "Mage", "Weapon", "Future"]);
    expect(await page.getByRole("dialog", {name: "Select visible columns"}).locator(".columns-picker-option").allTextContents()).toEqual(["Name", "Slot", "Light", "Main Stat", "Limits Stat", "Ranged Stat", "Regen Stat", "Tank Stat", "Melee Stat", "Mage Stat", "Weapon Stat", "Future Stat"]);
    const slotColumn = page.getByRole("button", {name: "Slot", exact: true});
    await expect(slotColumn).toHaveAttribute("aria-pressed", "false");
    await slotColumn.click(); await expect(slotColumn).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", {name: "Reset to defaults", exact: true}).click();
    await expect(slotColumn).toHaveAttribute("aria-pressed", "false");
    await expect(slotColumn.locator("svg.text-danger")).toBeVisible();
    await page.keyboard.press("Escape"); await page.getByRole("button", {name: "Filters", exact: true}).click();
    await expect(page.getByRole("heading", {name: "Select search filters"})).toBeVisible();
    expect(await page.getByRole("dialog", {name: "Select search filters"}).locator("h6").allTextContents()).toEqual(["Basic", "Main", "Limits", "Ranged", "Regen", "Tank", "Melee", "Mage", "Weapon", "Future"]);
    expect(await page.getByRole("dialog", {name: "Select search filters"}).locator(".filters-picker-option").evaluateAll(elements => elements.map(element => element.tagName === "SELECT" ? element.getAttribute("aria-label") : element.textContent.trim()))).toEqual(["Name", "Slot", "Light", "Main Stat", "Limits Stat", "Ranged Stat", "Regen Stat", "Tank Stat", "Melee Stat", "Mage Stat", "Weapon Stat", "Future Stat"]);
    const filtersDialog = page.getByRole("dialog", {name: "Select search filters"});
    const light = filtersDialog.getByRole("button", {name: "Light", exact: true}); await light.click(); await expect(light).toHaveAttribute("aria-pressed", "true");
    await page.getByLabel("Slot").selectOption("0"); await expect(page.getByLabel("Slot")).toHaveValue("0");
    await page.getByRole("button", {name: "Reset to defaults", exact: true}).click(); await expect(light).toHaveAttribute("aria-pressed", "false"); await expect(page.getByLabel("Slot")).toHaveValue("");
});

test("Items React dialogs retain their interaction classes in every supported theme", async function({context, page}) {
    const itemsPage = pages.find(pageUnderTest => pageUnderTest.name === "items");
    for (const theme of ["light", "dark", "solarized-dark", "high-contrast", "glass-blue", "glass-emerald", "glass-ruby", "glass-amethyst", "glass-amber"]) {
        await context.addCookies([{name: "theme", value: theme, url: baseUrl}]);
        await page.goto(`${baseUrl}${itemsPage.path}`);
        await expect(page.locator("link#theme")).toHaveAttribute("href", new RegExp(`bootstrap-${theme}\\.min\\.css`));
        const columnsTrigger = page.getByRole("button", {name: "Columns", exact: true});
        await columnsTrigger.click();
        const columns = page.getByRole("dialog", {name: "Select visible columns"}); const slot = columns.getByRole("button", {name: "Slot", exact: true});
        expect(await columns.locator("h6").allTextContents()).toEqual(["Basic", "Main", "Limits", "Ranged", "Regen", "Tank", "Melee", "Mage", "Weapon", "Future"]);
        expect(await columns.locator(".columns-picker-option").allTextContents()).toEqual(["Name", "Slot", "Light", "Main Stat", "Limits Stat", "Ranged Stat", "Regen Stat", "Tank Stat", "Melee Stat", "Mage Stat", "Weapon Stat", "Future Stat"]);
        await expect(columns).toBeVisible(); await expect(slot).toHaveClass(/columns-picker-option/); await slot.click(); await expect(slot.locator("svg.text-success")).toBeVisible(); await columns.getByRole("button", {name: "Reset to defaults", exact: true}).click(); await expect(slot.locator("svg.text-danger")).toBeVisible(); await page.keyboard.press("Escape"); await expect(columns).not.toBeVisible(); await expect(columnsTrigger).toBeFocused();
        const filtersTrigger = page.getByRole("button", {name: "Filters", exact: true});
        await filtersTrigger.click(); const filters = page.getByRole("dialog", {name: "Select search filters"}); const light = filters.getByRole("button", {name: "Light", exact: true});
        expect(await filters.locator("h6").allTextContents()).toEqual(["Basic", "Main", "Limits", "Ranged", "Regen", "Tank", "Melee", "Mage", "Weapon", "Future"]);
        expect(await filters.locator(".filters-picker-option").evaluateAll(elements => elements.map(element => element.tagName === "SELECT" ? element.getAttribute("aria-label") : element.textContent.trim()))).toEqual(["Name", "Slot", "Light", "Main Stat", "Limits Stat", "Ranged Stat", "Regen Stat", "Tank Stat", "Melee Stat", "Mage Stat", "Weapon Stat", "Future Stat"]);
        await expect(filters).toBeVisible(); await expect(light).toHaveClass(/filters-picker-option/); await light.click(); await expect(light).toHaveAttribute("aria-pressed", "true"); await filters.getByLabel("Slot").selectOption("0"); await expect(filters.getByLabel("Slot")).toHaveValue("0"); await filters.getByRole("button", {name: "Reset to defaults", exact: true}).click(); await expect(light).toHaveAttribute("aria-pressed", "false"); await expect(filters.getByLabel("Slot")).toHaveValue(""); await page.keyboard.press("Escape"); await expect(filters).not.toBeVisible(); await expect(filtersTrigger).toBeFocused();
    }
});

// Catches either shared Item Search picker clipping its lower choices or
// sending wheel input to the page behind the modal on a short mobile screen.
test("Items Columns and Filters scroll as modals and lock the page behind them", async function({page}) {
    await page.setViewportSize({width: 375, height: 420});
    const itemsPage = pages.find(pageUnderTest => pageUnderTest.name === "items");
    await expectHighContrastPage(page, itemsPage);

    for (const name of ["Columns", "Filters"]) {
        const iconClass = name === "Columns" ? ".fa-columns" : ".fa-filter";
        const trigger = page.locator("button", {has: page.locator(iconClass)});
        await trigger.click();
        const dialogName = name === "Columns" ? "Select visible columns" : "Select search filters";
        const dialog = page.getByRole("dialog", {name: dialogName});
        await expect(dialog).toBeVisible();
        await expect(page.locator("body")).toHaveClass(/modal-open/);
        await expect(dialog).toHaveCSS("overflow-y", "auto");
        expect(await dialog.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);

        const pageScroll = await page.evaluate(() => scrollY);
        await dialog.locator(".modal-content").hover({position: {x: 10, y: 200}});
        await page.mouse.wheel(0, 500);
        await expect.poll(() => dialog.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
        expect(await page.evaluate(() => scrollY)).toBe(pageScroll);

        await dialog.getByRole("button", {name: "Close", exact: true}).click();
        await expect(page.locator("body")).not.toHaveClass(/modal-open/);
        await expect(trigger).toBeFocused();
    }
});

test("Builder collapsible section supports keyboard access without detectable violations", async function({ page }) {
    const builderPage = pages.find(function(pageUnderTest) {
        return pageUnderTest.name === "builder";
    });
    await expectHighContrastPage(page, builderPage);

    await expect(page.getByLabel("Character", {exact: true})).toBeVisible();
    await expect(page.getByLabel("Variant", {exact: true})).toBeVisible();

    const toggle = page.getByRole("button", { name: "KSM Swap/Quest Mods" });
    await toggle.focus();
    await expect(toggle).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#ksmQuestMods")).toBeVisible();
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
