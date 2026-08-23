"use strict";

const Module = require("node:module");
const {expect, test} = require("@playwright/test");
const fulfillLocalBrowserScript = require("./support/local-browser-scripts");
const publicPageData = require("./support/public-page-data");

const encodedLists = "6*Hero~Tank~1c0K0K0K0J0J1-10000___00H00N00T00000100.00s00o00o-BHKAA_00t00u00v00w_______00p00q01b________________*Hero~Caster~0U0m0U0U0U0U000000___0000000000000000000f__00g_______________________________*Scout~Original~0X0X0X0X0X0X000000___0000000000000000000f__________________________________*";
const currentHeroExport = "6*Hero~Tank~1c0K0K0K0J0J1-10000___00H00N00T00000100.00s00o00o-BHKAA_00t00u00v00w_______00p00q01b________________*Hero~Caster~0U0m0U0U0U0U000000___0000000000000000000f__00g_______________________________*";
const currentTankExport = "6*Hero~Tank~1c0K0K0K0J0J1-10000___00H00N00T00000100.00s00o00o-BHKAA_00t00u00v00w_______00p00q01b________________*";
const guestImport = "6*Guest~Imported~0X0X0X0X0X0X000000___0000000000000000000f__-BHKAA_______________________________*";
const duplicateTankImport = "6*Hero~Tank~0X0X0X0X0X0X000000___0000000000000000000f__________________________________*";
const newHeroVariantImport = "6*Hero~Newcomer~0i0X0X0X0X0X000000___0000000000000000000g__________________________________*";
const itemFragment = "fragment ItemAll on Item { id name slot strength strengthCap hit dam hp ma mv ac rent weight uniqueWear isLimited twoHanded fauxObject isLight alignRestriction weaponStat }";
const itemStatInfo = [
    {display: "Name", short: "Name", var: "name", type: "string", showColumnDefault: true},
    {display: "Strength", short: "Str", var: "strength", type: "int", showColumnDefault: true},
    {display: "Hit", short: "Hit", var: "hit", type: "int", showColumnDefault: true},
    {display: "Damage", short: "Dam", var: "dam", type: "int", showColumnDefault: true},
    {display: "Hit Points", short: "HP", var: "hp", type: "int", showColumnDefault: true},
    {display: "Mana", short: "Ma", var: "ma", type: "int", showColumnDefault: true},
    {display: "Movement", short: "Mv", var: "mv", type: "int", showColumnDefault: true},
    {display: "Armor Class", short: "AC", var: "ac", type: "int", showColumnDefault: true},
    {display: "Rent", short: "Rent", var: "rent", type: "int", showColumnDefault: true},
    {display: "Light", short: "Light", var: "isLight", type: "bool", showColumnDefault: true}
];
const itemStatCategories = [
    {name: "Basic", getItemStatInfo: [itemStatInfo[0]]},
    {name: "Main", getItemStatInfo: [itemStatInfo[1]]},
    {name: "Limits", getItemStatInfo: [itemStatInfo[2]]},
    {name: "Ranged", getItemStatInfo: [itemStatInfo[3]]},
    {name: "Regen", getItemStatInfo: [itemStatInfo[4]]},
    {name: "Tank", getItemStatInfo: [itemStatInfo[5]]},
    {name: "Melee", getItemStatInfo: [itemStatInfo[6]]},
    {name: "Mage", getItemStatInfo: [itemStatInfo[7]]},
    {name: "Weapon", getItemStatInfo: [itemStatInfo[8]]},
    {name: "Future", getItemStatInfo: [itemStatInfo[9]]}
];
const hydratedItems = [
    {id: 41, name: "Brass lantern", slot: 0, strength: 2, isLight: 1},
    {id: 42, name: "Faux moonlight", slot: 0, strength: 4, hp: 20, fauxObject: 1, isLight: 1},
    {id: 50, name: "Singular ring", slot: 1, uniqueWear: 1},
    {id: 51, name: "Massive greatsword", slot: 14, strength: 10, strengthCap: 4, weight: 30, twoHanded: 1, weaponStat: 1},
    {id: 52, name: "Tower shield", slot: 10, twoHanded: 1},
    {id: 54, name: "Limited light", slot: 0, isLimited: 1},
    {id: 55, name: "Limited body", slot: 3, isLimited: 1},
    {id: 56, name: "Limited head", slot: 4, isLimited: 1},
    {id: 57, name: "Limited face", slot: 5, isLimited: 1},
    {id: 58, name: "Limited legs", slot: 6, isLimited: 1}
];

function pickerItems(slotId) {
    if (slotId === 14) {
        return [
            hydratedItems.find(item => item.id === 51),
            {id: 61, name: "Balanced blade", slot: 14, strength: 3, weight: 4, twoHanded: 0},
            {id: 62, name: "Offhand focus", slot: 15, strength: 7, twoHanded: 0},
            {id: 63, name: "Defender shield", slot: 10, strength: 5, twoHanded: 0}
        ];
    }
    return [
        hydratedItems.find(item => item.id === 41),
        hydratedItems.find(item => item.id === 42),
        ...Array.from({length: 19}, (_, index) => ({id: 200 + index, name: `Fixture light ${String(index + 1).padStart(2, "0")}`, slot: 0, strength: index % 8}))
    ];
}

function equipmentTable(page) {
    return page.locator("main > section table").first();
}

async function totalFor(page, shortName) {
    await expect(equipmentTable(page)).toBeVisible();
    const headers = (await equipmentTable(page).locator("thead").first().getByRole("columnheader").allTextContents()).map(value => value.trim());
    const column = headers.indexOf(shortName);
    expect(column).toBeGreaterThan(-1);
    return equipmentTable(page).locator("tbody tr").first().locator("th, td").nth(column).innerText();
}
let baseUrl;
let restorePostAsync;
let server;

function loadAppWithoutDatabaseMetadataQuery() {
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (request === "sync-rpc")
            return function() { return function() { return []; }; };
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
    apiUtils.postAsync = function(query) {
        if (query.includes("getItemStatCategories"))
            return Promise.resolve({getItemStatCategories: itemStatCategories, getItemStatInfo: itemStatInfo});
        return publicPageData(query);
    };
    restorePostAsync = function() { apiUtils.postAsync = originalPostAsync; };
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
    if (server)
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

test.beforeEach(async function({context, page}) {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {origin: baseUrl});
    await context.addCookies([{name: "cookie-consent", value: "true", url: baseUrl}]);
    await page.addInitScript(function(value) {
        if (!localStorage.getItem("cln"))
            localStorage.setItem("cln", value);
        if (!localStorage.getItem("scl"))
            localStorage.setItem("scl", "Hero!Tank");
    }, encodedLists);
    await page.route(`${baseUrl}/api`, async function(route) {
        const request = route.request().postDataJSON();
        const query = request.query;
        if (query.includes("getItemStatInfo")) {
            return route.fulfill({contentType: "application/json", body: JSON.stringify({data: {
                getItemStatInfo: itemStatInfo,
                getItemFragment: itemFragment
            }})});
        }
        if (query.includes("getItemsBySlotId"))
            return route.fulfill({contentType: "application/json", body: JSON.stringify({data: {getItemsBySlotId: pickerItems(request.variables.slotId)}})});
        if (query.includes("getItemsInIds"))
            return route.fulfill({contentType: "application/json", body: JSON.stringify({data: {getItemsInIds: hydratedItems.filter(item => request.variables.ids.includes(item.id))}})});
        return route.abort();
    });
    await context.route(/^https?:\/\//, function(route) {
        if (route.request().url().startsWith(baseUrl))
            return route.continue();
        return fulfillLocalBrowserScript(route);
    });
});

// Catches migration regressions that lose persisted variants, calculated stats, collapsed modifiers, exports, or consent-gated saving.
test("Builder preserves persisted characters, variants, totals, panels, and export workflow", async function({page}) {
    await page.setViewportSize({width: 1280, height: 720});
    const response = await page.goto(`${baseUrl}/builder/`);
    expect(response).not.toBeNull();
    expect(response.status()).toBe(200);

    await expect(page.locator('[data-react-root="builder"]')).toHaveCount(1);
    await expect(page.getByLabel("Character", {exact: true})).toHaveValue("0");
    await expect(page.getByLabel("Variant", {exact: true})).toHaveValue("0");
    await expect(page.getByLabel("Variant", {exact: true})).toContainText("Tank Variant");
    await page.getByLabel("Variant", {exact: true}).selectOption("1");
    await expect(page.locator("#strInput")).toHaveValue("30");

    const ksm = page.getByRole("button", {name: "KSM Swap/Quest Mods", exact: true});
    await expect(ksm).toHaveAttribute("aria-expanded", "false");
    await expect(ksm.locator(".collapse-caret")).toHaveCount(1);
    await ksm.click();
    await expect(ksm).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByLabel("Longhouse", {exact: true})).toBeVisible();
    await expect(page.getByLabel("Quest HP", {exact: true})).toBeVisible();
    const era = page.getByRole("button", {name: "Era Abilities", exact: true});
    await era.click();
    await expect(era).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".era-abilities-table")).toHaveCount(3);

    await page.locator("#strInput").fill("44");
    await page.locator("#strInput").blur();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("scl"))).toBe("Hero!Caster");
    await expect.poll(() => page.evaluate(() => localStorage.getItem("cln")?.startsWith("6*"))).toBe(true);

    await page.getByRole("button", {name: "Export", exact: true}).click();
    await expect(page.getByRole("dialog", {name: "Export Lists"})).toBeVisible();
    await expect(page.locator("#allListsExport")).toHaveValue(/^6\*/);
    await expect(page.getByRole("button", {name: /^Copy /})).toHaveCount(3);
    await page.getByRole("button", {name: "Copy All Lists", exact: true}).click();
    await expect(page.getByRole("status")).toHaveText("All Lists copied.");
    await expect(page.evaluate(() => navigator.clipboard.readText())).resolves.toMatch(/^6\*Hero~Tank~/);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", {name: "Export", exact: true})).toBeFocused();
});

// Catches the long equipment table losing its repeated footer navigation or
// making a stat value clickable only through a non-semantic table-cell handler.
test("Builder equipment footer repeats totals and stat cells use real controls", async function({page}) {
    await page.goto(`${baseUrl}/builder/`);
    const table = equipmentTable(page);
    await expect(table).toBeVisible();
    const expectedHeaders = ["Slot", "Lock", "Name", "Str", "Hit", "Dam", "HP", "Ma", "Mv", "AC", "Rent", "Light"];
    expect((await table.locator("thead").getByRole("columnheader").allTextContents()).map(value => value.trim())).toEqual(expectedHeaders);
    const footer = table.locator("tfoot");
    await expect(footer).toBeVisible();
    await expect(footer.getByRole("row").first()).toHaveClass(/bg-dark text-white/);
    expect((await footer.getByRole("columnheader").allTextContents()).map(value => value.trim())).toEqual(expectedHeaders);
    await expect(footer.getByRole("rowheader", {name: "Total", exact: true})).toBeVisible();
    await expect(footer.getByRole("row").nth(1).locator("th, td").nth(3)).toContainText("104");

    const itemRow = table.locator("tbody tr").nth(1);
    const strengthCell = itemRow.locator("td").nth(2);
    await expect(strengthCell).toHaveRole("cell");
    await strengthCell.getByRole("button", {name: "Choose Limited light by Strength", exact: true}).click();
    await expect(page.getByRole("dialog", {name: "Choose Item"})).toBeVisible();
});

// Catches the Glass theme turning compact equipment-table actions into
// rounded, bordered buttons inside already-bordered cells.
test("Builder Glass table actions stay visually integrated and keyboard visible", async function({context, page}) {
    await context.addCookies([{name: "theme", value: "glass-blue", url: baseUrl}]);
    await page.goto(`${baseUrl}/builder/`);
    const table = equipmentTable(page);
    const row = table.locator("tbody tr").nth(1);
    const actions = [
        table.getByRole("button", {name: "Lock all items", exact: true}).first(),
        row.getByRole("button", {name: /^Toggle lock for /}),
        row.getByRole("button", {name: "Limited light", exact: true}),
        row.getByRole("button", {name: "Choose Limited light by Strength", exact: true})
    ];

    for (const action of actions) {
        await expect(action).toHaveClass(/builder-table-action/);
        expect(await action.evaluate(element => {
            const style = getComputedStyle(element);
            return {
                backgroundImage: style.backgroundImage,
                borderTopWidth: style.borderTopWidth,
                borderRadius: style.borderRadius,
                boxShadow: style.boxShadow,
                textShadow: style.textShadow
            };
        })).toEqual({
            backgroundImage: "none",
            borderTopWidth: "0px",
            borderRadius: "0px",
            boxShadow: "none",
            textShadow: "none"
        });
    }

    await actions[1].focus();
    await expect(actions[1]).toHaveCSS("outline-style", "solid");
    await expect(actions[1].locator(".fa-lock, .fa-unlock")).toHaveCount(1);
});

// Catches either total-row bulk control changing every lock without the legacy
// confirmation, or using stale wording after all items become locked.
test("Builder bulk lock controls confirm cancel and apply for both lock states", async function({page}) {
    await page.goto(`${baseUrl}/builder/`);
    const table = equipmentTable(page);
    const itemLocks = table.getByRole("button", {name: /^Toggle lock for /});
    await expect(itemLocks).toHaveCount(35);
    expect((await itemLocks.evaluateAll(buttons => buttons.map(button => button.getAttribute("aria-pressed")))).some(value => value === "false")).toBe(true);

    let bulk = table.getByRole("button", {name: "Lock all items", exact: true});
    await expect(bulk).toHaveCount(2);
    await bulk.first().click();
    let dialog = page.getByRole("dialog", {name: "Confirm lock all items"});
    await expect(dialog).toContainText("Are you sure you want to lock all items?");
    await dialog.getByRole("button", {name: "Close"}).click();
    expect((await itemLocks.evaluateAll(buttons => buttons.map(button => button.getAttribute("aria-pressed")))).some(value => value === "false")).toBe(true);

    await bulk.nth(1).click();
    dialog = page.getByRole("dialog", {name: "Confirm lock all items"});
    await dialog.getByRole("button", {name: "Yes", exact: true}).click();
    expect((await itemLocks.evaluateAll(buttons => buttons.map(button => button.getAttribute("aria-pressed")))).every(value => value === "true")).toBe(true);

    bulk = table.getByRole("button", {name: "Unlock all items", exact: true});
    await expect(bulk).toHaveCount(2);
    await bulk.first().click();
    dialog = page.getByRole("dialog", {name: "Confirm unlock all items"});
    await expect(dialog).toContainText("Are you sure you want to unlock all items?");
    await dialog.getByRole("button", {name: "Close"}).click();
    expect((await itemLocks.evaluateAll(buttons => buttons.map(button => button.getAttribute("aria-pressed")))).every(value => value === "true")).toBe(true);

    await bulk.nth(1).click();
    dialog = page.getByRole("dialog", {name: "Confirm unlock all items"});
    await dialog.getByRole("button", {name: "Yes", exact: true}).click();
    expect((await itemLocks.evaluateAll(buttons => buttons.map(button => button.getAttribute("aria-pressed")))).every(value => value === "false")).toBe(true);
});

// Catches a React dialog that only looks modal: keyboard users must stay in it,
// close it with Escape, and return to the control that opened it.
test("Builder dialogs contain focus and restore their trigger", async function({page}) {
    await page.goto(`${baseUrl}/builder/`);
    const trigger = page.getByRole("button", {name: "Import", exact: true});
    await trigger.click();
    const dialog = page.getByRole("dialog", {name: "Import Lists"});
    await expect(dialog).toBeVisible();
    await expect(page.locator("#builder-import")).toBeFocused();
    expect(await page.getByLabel("Character", {exact: true}).evaluate(element => element.closest("[inert]") != null)).toBe(true);
    await page.getByLabel("Character", {exact: true}).evaluate(element => element.focus());
    await expect(page.locator("#builder-import")).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("button", {name: "Close", exact: true})).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("button", {name: "Import", exact: true})).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", {name: "Close", exact: true})).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
});

// Catches long Builder dialogs leaving wheel scrolling on the page or clipping
// item results instead of scrolling the dialog body within a short viewport.
test("Builder picker scrolls within the viewport and locks the page behind it", async function({page}) {
    await page.setViewportSize({width: 900, height: 420});
    await page.goto(`${baseUrl}/builder/`);
    await equipmentTable(page).locator("tbody tr").nth(1).getByRole("button", {name: "Limited light", exact: true}).click();

    const dialog = page.getByRole("dialog", {name: "Choose Item"});
    const dialogBody = dialog.locator(".modal-body");
    await expect(dialog.locator(".modal-dialog")).toHaveClass(/modal-dialog-scrollable/);
    await expect(page.locator("body")).toHaveClass(/modal-open/);
    expect(await dialogBody.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);

    const pageScroll = await page.evaluate(() => scrollY);
    await dialogBody.hover();
    await page.mouse.wheel(0, 500);
    await expect.poll(() => dialogBody.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    expect(await page.evaluate(() => scrollY)).toBe(pageScroll);

    await dialog.getByRole("button", {name: "Close", exact: true}).click();
    await expect(page.locator("body")).not.toHaveClass(/modal-open/);
});

// Catches hydration that loses representative normal, faux, missing, or rune
// equipment as lists reload, switch, and enter through the import workflow.
test("Builder hydrates persisted and imported equipment without changing its encoding", async function({page}) {
    await page.goto(`${baseUrl}/builder/`);
    const rows = equipmentTable(page).locator("tbody tr");
    await expect(rows.nth(2)).toContainText("Singular ring");
    await expect(rows.nth(4)).toContainText("Runecharm (Uruz/Eihwaz/Gebo)");
    await expect(rows.nth(19)).toContainText("DELETED");

    await page.getByLabel("Variant", {exact: true}).selectOption("1");
    await expect(rows.nth(1)).toContainText("Brass lantern");
    await expect(rows.nth(4)).toContainText("Faux moonlight");
    await page.getByLabel("Character", {exact: true}).selectOption({label: "Scout"});
    await expect(rows.nth(1)).toContainText("Brass lantern");
    await expect.poll(() => page.evaluate(() => localStorage.getItem("scl"))).toBe("Scout!Original");
    await page.reload();
    await expect(page.getByLabel("Character", {exact: true})).toHaveValue("1");
    await expect.poll(() => page.evaluate(() => localStorage.getItem("cln"))).toBe(encodedLists);
    await page.getByLabel("Character", {exact: true}).selectOption({label: "Hero"});
    await page.getByLabel("Variant", {exact: true}).selectOption({label: "Caster Variant"});
    await expect(rows.nth(4)).toContainText("Faux moonlight");
    await page.getByLabel("Variant", {exact: true}).selectOption({label: "Tank Variant"});
    await expect(rows.nth(4)).toContainText("Runecharm (Uruz/Eihwaz/Gebo)");
    await expect(rows.nth(19)).toContainText("DELETED");

    await page.getByRole("button", {name: "Import", exact: true}).click();
    await page.locator("#builder-import").fill(guestImport);
    await page.getByRole("dialog", {name: "Import Lists"}).getByRole("button", {name: "Import", exact: true}).click();
    await page.getByLabel("Character", {exact: true}).selectOption({label: "Guest"});
    await expect(rows.nth(1)).toContainText("Brass lantern");
    await expect(rows.nth(4)).toContainText("Runecharm (Uruz/Eihwaz/Gebo)");
});

// Catches a transient hydration outage rewriting the exact saved bytes before
// the player can retry and recover the corresponding item metadata.
test("Builder preserves exact saved data through failed hydration and visible retry", async function({page}) {
    let hydrationAttempts = 0;
    await page.route(`${baseUrl}/api`, async function(route) {
        const request = route.request().postDataJSON();
        if (request.query.includes("getItemStatInfo")) {
            return route.fulfill({contentType: "application/json", body: JSON.stringify({data: {getItemStatInfo: itemStatInfo, getItemFragment: itemFragment}})});
        }
        if (request.query.includes("getItemsInIds")) {
            hydrationAttempts++;
            if (hydrationAttempts === 1)
                return route.fulfill({status: 503, contentType: "application/json", body: JSON.stringify({errors: [{message: "Database temporarily unavailable"}]})});
            return route.fulfill({contentType: "application/json", body: JSON.stringify({data: {getItemsInIds: hydratedItems.filter(item => request.variables.ids.includes(item.id))}})});
        }
        return route.fallback();
    });

    await page.goto(`${baseUrl}/builder/`);
    const alert = page.getByRole("alert").filter({hasText: "Saved builder data could not be hydrated"});
    await expect(alert).toBeVisible();
    await expect(alert.getByRole("button", {name: "Retry", exact: true})).toBeVisible();
    expect(await page.getByLabel("Character", {exact: true}).locator("option").allTextContents()).toEqual(["Hero", "Scout"]);
    await expect.poll(() => page.evaluate(() => localStorage.getItem("cln"))).toBe(encodedLists);
    await alert.getByRole("button", {name: "Retry", exact: true}).click();
    await expect(equipmentTable(page).locator("tbody tr").nth(4)).toContainText("Runecharm (Uruz/Eihwaz/Gebo)");
    await expect.poll(() => hydrationAttempts).toBe(2);
    await expect.poll(() => page.evaluate(() => localStorage.getItem("cln"))).toBe(encodedLists);
});

// Catches an initial metadata outage enabling persistence and replacing valid
// saved character bytes with the temporary Untitled fallback.
test("Builder leaves saved character bytes untouched when initial metadata fails", async function({page}) {
    await page.route(`${baseUrl}/api`, async function(route) {
        const request = route.request().postDataJSON();
        if (request.query.includes("getItemStatInfo")) {
            return route.fulfill({
                status: 503,
                contentType: "application/json",
                body: JSON.stringify({errors: [{message: "Metadata temporarily unavailable"}]})
            });
        }
        return route.fallback();
    });

    await page.goto(`${baseUrl}/builder/`);
    await expect(page.getByRole("alert")).toContainText("The request could not be completed");
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => ({
        lists: localStorage.getItem("cln"),
        selected: localStorage.getItem("scl")
    }))).toEqual({lists: encodedLists, selected: "Hero!Tank"});
});

// Catches malformed or future-version saved data being treated as a blank,
// successfully hydrated Builder and persisted over the original bytes.
test("Builder leaves malformed and unsupported saved character bytes untouched", async function({page}) {
    for (const savedLists of ["6*malformed", "7*Future~Original~opaque*"]) {
        await page.goto(`${baseUrl}/cookies.html`);
        await page.evaluate(function(value) {
            localStorage.setItem("cln", value);
            localStorage.setItem("scl", "Future!Original");
        }, savedLists);

        await page.goto(`${baseUrl}/builder/`);
        await expect(page.getByRole("alert")).toBeVisible();
        await page.waitForTimeout(100);
        expect(await page.evaluate(() => ({
            lists: localStorage.getItem("cln"),
            selected: localStorage.getItem("scl")
        }))).toEqual({lists: savedLists, selected: "Future!Original"});
    }
});

// Catches a picker that accepts only placeholder data or drops the established
// comparison, wield, sort, pagination, detail, unlock, and rune workflows.
test("Builder picker selects schema-shaped normal, faux, wield, and rune choices", async function({context, page}) {
    await context.addCookies([{name: "ipp", value: "2", url: baseUrl}]);
    await page.goto(`${baseUrl}/builder/`);
    const rows = equipmentTable(page).locator("tbody tr");
    await page.getByLabel("Variant", {exact: true}).selectOption("1");
    await rows.nth(1).getByRole("button", {name: "Brass lantern", exact: true}).click();
    let dialog = page.getByRole("dialog", {name: "Choose Item"});
    await expect(dialog.getByRole("link", {name: "Open details for Brass lantern in a new tab"}).first()).toHaveAttribute("href", "/items/details.html?id=41");
    await dialog.getByLabel("Search items").fill("Faux moonlight");
    await dialog.getByRole("button", {name: "Faux moonlight", exact: true}).click();
    await expect(rows.nth(1)).toContainText("Faux moonlight");
    await rows.nth(1).getByRole("button", {name: "Faux moonlight", exact: true}).click();
    dialog = page.getByRole("dialog", {name: "Choose Item"});
    await dialog.getByLabel("Search items").fill("");
    await expect(dialog.getByRole("navigation", {name: "Item result navigation"})).toBeVisible();
    await dialog.getByRole("button", {name: "Next", exact: true}).click();
    await expect(dialog.getByRole("button", {name: "2", exact: true})).toHaveAttribute("aria-current", "page");
    await page.keyboard.press("Escape");

    await page.getByLabel("Variant", {exact: true}).selectOption("0");
    await rows.nth(17).getByRole("button", {name: "Massive greatsword", exact: true}).click();
    dialog = page.getByRole("dialog", {name: "Choose Item"});
    await dialog.getByLabel("Slot Filter").selectOption("1");
    const resultTable = dialog.locator("table.mt-3");
    await expect(resultTable.getByRole("link", {name: "Open details for Balanced blade in a new tab", exact: true})).toHaveAttribute("href", "/items/details.html?id=61");
    await expect(dialog.getByRole("button", {name: "Offhand focus", exact: true})).toHaveCount(0);
    await expect(dialog.getByRole("button", {name: "Defender shield", exact: true})).toHaveCount(0);
    await dialog.getByLabel("Slot Filter").selectOption("2");
    await expect(dialog.getByRole("button", {name: "Offhand focus", exact: true})).toBeVisible();
    await expect(dialog.getByRole("button", {name: "Balanced blade", exact: true})).toHaveCount(0);
    await dialog.getByLabel("Search items").fill("Str>6");
    await expect(dialog.getByRole("button", {name: "Offhand focus", exact: true})).toBeVisible();
    await dialog.getByLabel("Slot Filter").selectOption("3");
    await expect(dialog.getByRole("button", {name: "Defender shield", exact: true})).toHaveCount(0);
    await dialog.getByLabel("Search items").fill("");
    await expect(dialog.getByRole("button", {name: "Defender shield", exact: true})).toBeVisible();
    await dialog.getByRole("button", {name: /Name/}).click();
    await expect(dialog.getByRole("button", {name: "Name descending", exact: true})).toBeVisible();
    await dialog.getByRole("button", {name: "Defender shield", exact: true}).click();
    await expect(rows.nth(17)).toContainText("Defender shield");

    await rows.nth(1).getByRole("button", {name: "Limited light", exact: true}).click();
    dialog = page.getByRole("dialog", {name: "Choose Item"});
    await expect(dialog.getByRole("button", {name: "Brass lantern", exact: true})).toBeDisabled();
    await dialog.getByRole("button", {name: "Unlock current item", exact: true}).click();
    await expect(dialog.getByRole("button", {name: "Brass lantern", exact: true})).toBeEnabled();
    await dialog.getByRole("button", {name: "Brass lantern", exact: true}).click();
    await expect(rows.nth(1)).toContainText("Brass lantern");

    await rows.nth(4).getByRole("button", {name: "Runecharm (Uruz\/Eihwaz\/Gebo)", exact: true}).click();
    dialog = page.getByRole("dialog", {name: "Choose Item"});
    await expect(dialog.getByLabel("Rune charm 1")).toHaveValue("B");
    await expect(dialog.getByLabel("Rune charm 2")).toHaveValue("H");
    await expect(dialog.getByLabel("Rune charm 3")).toHaveValue("K");
    await dialog.getByRole("button", {name: "Save Runecharm", exact: true}).click();
    await expect(rows.nth(4)).toContainText("Runecharm (Uruz/Eihwaz/Gebo)");
});

// Catches list dialogs that scope duplicate checks to the wrong entity type,
// lose multi-character typing, or omit add/rename/delete variant behavior.
test("Builder character and variant dialogs validate, duplicate, rename, and delete", async function({page}) {
    await page.goto(`${baseUrl}/builder/`);
    await page.getByRole("button", {name: "Add Character", exact: true}).click();
    let dialog = page.getByRole("dialog", {name: "Add Character"});
    await dialog.getByLabel("Name").fill("Bad!");
    await dialog.getByRole("button", {name: "Add", exact: true}).click();
    await expect(dialog.getByRole("alert")).toHaveText("Invalid characters.");
    await dialog.getByLabel("Name").fill("Hero");
    await dialog.getByRole("button", {name: "Add", exact: true}).click();
    await expect(dialog.getByRole("alert")).toHaveText("Duplicate entry.");
    await dialog.getByLabel("Name").fill("Tank");
    await dialog.getByRole("button", {name: "Add", exact: true}).click();
    await expect(page.getByLabel("Character", {exact: true})).toContainText("Tank");

    await page.getByRole("button", {name: "Edit Character", exact: true}).click();
    dialog = page.getByRole("dialog", {name: "Edit Character"});
    await dialog.getByLabel("Name").pressSequentially("Bravo Team");
    await expect(dialog.getByLabel("Name")).toHaveValue("TankBravo Team");
    await dialog.getByLabel("Name").fill("Bravo Team");
    await dialog.getByRole("button", {name: "Save", exact: true}).click();
    await expect(page.getByLabel("Character", {exact: true})).toContainText("Bravo Team");

    await page.getByRole("button", {name: "Add Variant", exact: true}).click();
    dialog = page.getByRole("dialog", {name: "Add Variant"});
    await dialog.getByLabel("Name").fill("Bravo Team");
    await dialog.getByRole("button", {name: "Add", exact: true}).click();
    await expect(page.getByLabel("Variant", {exact: true})).toContainText("Bravo Team Variant");
    await page.getByRole("button", {name: "Add Variant", exact: true}).click();
    dialog = page.getByRole("dialog", {name: "Add Variant"});
    await dialog.getByLabel("Name").fill("Bravo Team");
    await dialog.getByRole("button", {name: "Add", exact: true}).click();
    const variantError = dialog.getByRole("alert");
    await expect(variantError).toHaveText("Duplicate entry.");
    await expect(dialog.getByLabel("Name")).toHaveAttribute("aria-invalid", "true");
    await expect(dialog.getByLabel("Name")).toHaveAttribute("aria-describedby", await variantError.getAttribute("id"));
    await page.keyboard.press("Escape");
    await page.getByRole("button", {name: "Edit Variant", exact: true}).click();
    dialog = page.getByRole("dialog", {name: "Edit Variant"});
    await dialog.getByLabel("Name").fill("Field Build");
    await dialog.getByRole("button", {name: "Save", exact: true}).click();
    await expect(page.getByLabel("Variant", {exact: true})).toContainText("Field Build Variant");
    await page.getByRole("button", {name: "Delete Variant", exact: true}).click();
    await page.getByRole("dialog", {name: "Are you sure?"}).getByRole("button", {name: "Yes", exact: true}).click();
    await expect(page.getByLabel("Variant", {exact: true})).toContainText("Original Variant");
    await page.getByRole("button", {name: "Delete Character", exact: true}).click();
    await page.getByRole("dialog", {name: "Are you sure?"}).getByRole("button", {name: "Yes", exact: true}).click();
    await expect(page.getByLabel("Character", {exact: true})).not.toContainText("Bravo Team");
});

// Catches import branches that conflate empty, malformed, skip, overwrite, and
// successful new-list behavior.
test("Builder import handles empty, invalid, duplicate, overwrite, and success paths", async function({page}) {
    await page.goto(`${baseUrl}/builder/`);
    await page.getByRole("button", {name: "Import", exact: true}).click();
    let dialog = page.getByRole("dialog", {name: "Import Lists"});
    await dialog.getByRole("button", {name: "Import", exact: true}).click();
    await expect(dialog.getByRole("alert")).toHaveText("Invalid list import string.");
    await dialog.getByLabel("Builder list import string").fill("not-a-list");
    await expect(dialog.getByRole("alert")).toHaveText("Invalid list import string.");
    await dialog.getByLabel("Builder list import string").fill(duplicateTankImport);
    await expect(dialog.getByRole("alert")).toContainText("already exist");
    const overwrite = dialog.getByLabel("Overwrite Hero Tank");
    await expect(overwrite).toBeChecked();
    await overwrite.uncheck();
    await dialog.getByRole("button", {name: "Import", exact: true}).click();
    await expect(page.locator("#strInput")).toHaveValue("100");

    await page.getByRole("button", {name: "Import", exact: true}).click();
    dialog = page.getByRole("dialog", {name: "Import Lists"});
    await dialog.getByLabel("Builder list import string").fill(duplicateTankImport);
    await dialog.getByRole("button", {name: "Import", exact: true}).click();
    await expect(page.locator("#strInput")).toHaveValue("33");
    await page.getByRole("button", {name: "Import", exact: true}).click();
    dialog = page.getByRole("dialog", {name: "Import Lists"});
    await dialog.getByLabel("Builder list import string").fill(newHeroVariantImport);
    await dialog.getByRole("button", {name: "Import", exact: true}).click();
    await page.getByLabel("Variant", {exact: true}).selectOption({label: "Newcomer Variant"});
    await expect(equipmentTable(page).locator("tbody tr").nth(1)).toContainText("Faux moonlight");
    await page.getByRole("button", {name: "Import", exact: true}).click();
    dialog = page.getByRole("dialog", {name: "Import Lists"});
    await dialog.getByLabel("Builder list import string").fill(guestImport);
    await dialog.getByRole("button", {name: "Import", exact: true}).click();
    await expect(page.getByLabel("Character", {exact: true})).toContainText("Guest");
});

// Catches calculated resource/ability totals or warning text that is visible
// but not programmatically associated with the affected item/stat cell.
test("Builder renders literal totals, modifiers, abilities, and associated warnings", async function({page}) {
    await page.goto(`${baseUrl}/builder/`);
    expect(await totalFor(page, "Str")).toContain("104");
    expect(await totalFor(page, "Hit")).toContain("14 (2)");
    expect(await totalFor(page, "Dam")).toContain("39 (0)");
    expect(await totalFor(page, "HP")).toContain("358");
    expect(await totalFor(page, "Ma")).toContain("429");
    expect(await totalFor(page, "Mv")).toContain("490");
    expect(await totalFor(page, "AC")).toContain("98");
    expect(await totalFor(page, "Rent")).toContain("1553");
    expect(await totalFor(page, "Light")).toBe("");

    const heavyCell = equipmentTable(page).locator("tbody tr").nth(17).locator("td").first();
    await expect(heavyCell).toHaveClass(/bg-danger/);
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await heavyCell.hover();
    let tooltip = page.getByRole("tooltip");
    await expect(tooltip).toHaveText("You need 120 strength to wield this. You do not have enough hands to hold this item.");
    await expect(heavyCell).toHaveAttribute("aria-describedby", await tooltip.getAttribute("id"));
    await page.mouse.move(0, 0);
    await expect(tooltip).toHaveCount(0);
    await heavyCell.focus();
    tooltip = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible();
    await expect(heavyCell).toHaveAttribute("aria-describedby", await tooltip.getAttribute("id"));
    await heavyCell.evaluate(element => element.blur());
    await expect(tooltip).toHaveCount(0);

    const statCell = equipmentTable(page).locator("tbody tr").first().locator("th, td").nth(3);
    await expect(statCell).toHaveClass(/bg-danger/);
    await statCell.hover();
    await expect(page.getByRole("tooltip")).toHaveText("The overall limit for this stat is 104. You currently have 115.");

    await page.getByRole("button", {name: "KSM Swap/Quest Mods", exact: true}).click();
    await expect(page.getByLabel("Quest HP", {exact: true})).toHaveValue("17");
    await expect(page.getByLabel("Quest Mana", {exact: true})).toHaveValue("23");
    await expect(page.getByLabel("Quest Mv", {exact: true})).toHaveValue("29");
    await page.getByLabel("Quest HP", {exact: true}).fill("18");
    expect(await totalFor(page, "HP")).toContain("359");
    await page.locator("#ksm-strength").fill("2");
    await expect(page.getByText("Total KSM stats must equal zero.", {exact: true})).toBeVisible();
    await page.locator("#ksm-mind").fill("-2");
    await page.locator("#ksm-strength").fill("4");
    await page.locator("#ksm-mind").fill("-4");
    await expect(page.getByText("You can only swap stats a maximum of three times.", {exact: true})).toBeVisible();

    await page.getByRole("button", {name: "Era Abilities", exact: true}).click();
    await page.getByLabel("Weapon Focus", {exact: true}).selectOption("0");
    expect(await totalFor(page, "Hit")).toContain("9 (2)");
    expect(await totalFor(page, "Dam")).toContain("34 (0)");
});

// Catches export controls copying the wrong scope or sharing an ambiguous name.
test("Builder exports and copies all three exact values", async function({page}) {
    await page.goto(`${baseUrl}/builder/`);
    await page.getByRole("button", {name: "Export", exact: true}).click();
    const dialog = page.getByRole("dialog", {name: "Export Lists"});
    const cases = [
        ["Copy All Lists", "#allListsExport", encodedLists],
        ["Copy Current List (w/ all variants): Hero", "#curListExport", currentHeroExport],
        ["Copy Current List Variant: Tank", "#curVariantExport", currentTankExport]
    ];
    for (const [buttonName, input, expected] of cases) {
        await expect(dialog.locator(input)).toHaveValue(expected);
        await dialog.getByRole("button", {name: buttonName, exact: true}).click();
        await expect(page.evaluate(() => navigator.clipboard.readText())).resolves.toBe(expected);
    }
});

// Catches Builder falling back to its former flat checkbox list instead of the
// same categorized, themed Columns picker used by Item Search.
test("Builder Columns preserves the shared visual and interaction contract in every theme", async function({context, page}) {
    const themes = ["light", "dark", "solarized-dark", "high-contrast", "glass-blue", "glass-emerald", "glass-ruby", "glass-amethyst", "glass-amber"];
    for (const theme of themes) {
        await context.addCookies([
            {name: "theme", value: theme, url: baseUrl},
            {name: "sc-Hero", value: "Name-Str-Hit", url: baseUrl}
        ]);
        await page.goto(`${baseUrl}/builder/`);
        await expect(page.locator("link#theme")).toHaveAttribute("href", new RegExp(`bootstrap-${theme}\\.min\\.css`));
        const trigger = page.getByRole("button", {name: "Hide/Show Columns", exact: true});
        await trigger.focus();
        await trigger.press("Enter");

        const dialog = page.getByRole("dialog", {name: "Select visible columns"});
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole("heading", {name: "Select visible columns", exact: true})).toBeVisible();
        await expect(dialog.locator(".modal-dialog")).toHaveClass(/modal-xl/);
        await expect(dialog.locator(".columns-picker-toolbar")).toContainText("Select columns to show and hide from the following:");
        await expect(dialog.getByRole("button", {name: "Reset to defaults", exact: true})).toHaveClass(/columns-picker-reset/);
        await expect(dialog.locator(".columns-picker-grid")).toHaveCount(1);
        await expect(dialog.locator(".columns-picker-stack")).toHaveCount(5);
        await expect(dialog.locator(".columns-picker-category")).toHaveCount(10);
        expect(await dialog.locator(".columns-picker-category-title").allTextContents()).toEqual(["Basic", "Main", "Limits", "Ranged", "Regen", "Tank", "Melee", "Mage", "Weapon", "Future"]);
        expect(await dialog.locator(".columns-picker-option").allTextContents()).toEqual(["Name", "Strength", "Hit", "Damage", "Hit Points", "Mana", "Movement", "Armor Class", "Rent", "Light"]);
        expect(await dialog.locator(".columns-picker-option").evaluateAll(options => options.map(option => option.tagName))).toEqual(["BUTTON", "BUTTON", "BUTTON", "BUTTON", "BUTTON", "BUTTON", "BUTTON", "BUTTON", "BUTTON", "BUTTON"]);
        await expect(dialog.getByRole("checkbox")).toHaveCount(0);

        const name = dialog.getByRole("button", {name: "Name", exact: true});
        const hitPoints = dialog.getByRole("button", {name: "Hit Points", exact: true});
        await expect(name).toHaveClass(/columns-picker-option/);
        await expect(name).toHaveAttribute("aria-pressed", "true");
        await expect(name.locator("svg.columns-picker-visibility-icon.text-success")).toBeVisible();
        await expect(hitPoints).toHaveAttribute("aria-pressed", "false");
        await expect(hitPoints.locator("svg.columns-picker-visibility-icon.text-danger")).toBeVisible();
        expect(await page.getByLabel("Character", {exact: true}).evaluate(element => element.closest("[inert]") != null)).toBe(true);

        await name.click();
        await expect(name).toHaveAttribute("aria-pressed", "false");
        await expect(name.locator("svg.columns-picker-visibility-icon.text-danger")).toBeVisible();
        await expect.poll(async () => (await context.cookies()).find(cookie => cookie.name === "sc-Hero")?.value).toBe("Str-Hit-");
        await dialog.getByRole("button", {name: "Reset to defaults", exact: true}).click();
        await expect(name).toHaveAttribute("aria-pressed", "true");
        await expect(name.locator("svg.columns-picker-visibility-icon.text-success")).toBeVisible();
        await expect.poll(async () => (await context.cookies()).find(cookie => cookie.name === "sc-Hero")?.value).toBe("Name-Str-Hit-Dam-HP-Ma-Mv-AC-Rent-Light-");

        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        await expect(trigger).toBeFocused();
    }
});

// Catches per-character column state falling back, migrating, deleting, or
// reloading through the wrong cookie key.
test("Builder preserves global and per-character columns across lifecycle changes", async function({context, page}) {
    await context.addCookies([
        {name: "sc2", value: "Name-HP", url: baseUrl},
        {name: "sc-Hero", value: "Name-Str-Hit", url: baseUrl}
    ]);
    await page.goto(`${baseUrl}/builder/`);
    await expect.poll(async () => (await context.cookies()).find(cookie => cookie.name === "sc-Hero")?.value).toBe("Name-Str-Hit-");
    await page.getByRole("button", {name: "Hide/Show Columns", exact: true}).click();
    let dialog = page.getByRole("dialog", {name: "Select visible columns"});
    await expect(dialog.getByRole("button", {name: "Strength", exact: true})).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.getByRole("button", {name: "Hit", exact: true})).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.getByRole("button", {name: "Hit Points", exact: true})).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("Escape");
    await page.getByLabel("Character", {exact: true}).selectOption({label: "Scout"});
    await page.getByRole("button", {name: "Hide/Show Columns", exact: true}).click();
    dialog = page.getByRole("dialog", {name: "Select visible columns"});
    await expect(dialog.getByRole("button", {name: "Strength", exact: true})).toHaveAttribute("aria-pressed", "false");
    await expect(dialog.getByRole("button", {name: "Hit Points", exact: true})).toHaveAttribute("aria-pressed", "true");
    await dialog.getByRole("button", {name: "Strength", exact: true}).click();
    await page.keyboard.press("Escape");
    await expect.poll(() => page.evaluate(() => document.cookie)).toContain("sc-Scout=");
    await expect.poll(async () => (await context.cookies()).find(cookie => cookie.name === "sc-Scout")?.value).toContain("Str");
    await page.getByRole("button", {name: "Edit Character", exact: true}).click();
    dialog = page.getByRole("dialog", {name: "Edit Character"});
    await dialog.getByLabel("Name").fill("Ranger");
    await dialog.getByRole("button", {name: "Save", exact: true}).click();
    await expect.poll(async () => (await context.cookies()).find(cookie => cookie.name === "sc-Ranger")?.value).toContain("Str");
    expect((await context.cookies()).find(cookie => cookie.name === "sc-Scout")).toBeUndefined();
    await page.reload();
    await expect(page.getByLabel("Character", {exact: true})).toHaveValue("1");
    await page.getByRole("button", {name: "Delete Character", exact: true}).click();
    await page.getByRole("dialog", {name: "Are you sure?"}).getByRole("button", {name: "Yes", exact: true}).click();
    await expect.poll(async () => (await context.cookies()).find(cookie => cookie.name === "sc-Ranger")).toBeUndefined();
    await expect(page.getByLabel("Character", {exact: true})).toHaveValue("0");
    await page.getByRole("button", {name: "Hide/Show Columns", exact: true}).click();
    dialog = page.getByRole("dialog", {name: "Select visible columns"});
    await expect(dialog.getByRole("button", {name: "Strength", exact: true})).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.getByRole("button", {name: "Hit", exact: true})).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.getByRole("button", {name: "Hit Points", exact: true})).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await context.cookies()).find(cookie => cookie.name === "sc-Hero")?.value).toBe("Name-Str-Hit-");
    await page.reload();
    await page.getByRole("button", {name: "Hide/Show Columns", exact: true}).click();
    dialog = page.getByRole("dialog", {name: "Select visible columns"});
    await expect(dialog.getByRole("button", {name: "Strength", exact: true})).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.getByRole("button", {name: "Hit", exact: true})).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.getByRole("button", {name: "Hit Points", exact: true})).toHaveAttribute("aria-pressed", "false");
    await expect.poll(async () => (await context.cookies()).find(cookie => cookie.name === "sc-Hero")?.value).toBe("Name-Str-Hit-");
});

// Catches responsive grouping, glass spacing, caret state, or reduced-motion
// behavior diverging in any of the nine shipped themes.
test("Builder controls and collapsible layout remain responsive in every theme", async function({context, page}) {
    const themes = ["light", "dark", "solarized-dark", "high-contrast", "glass-blue", "glass-emerald", "glass-ruby", "glass-amethyst", "glass-amber"];
    for (const theme of themes) {
        await context.addCookies([{name: "theme", value: theme, url: baseUrl}]);
        await page.emulateMedia({reducedMotion: "reduce"});
        const geometry = {};
        for (const viewport of [{width: 1280, height: 800}, {width: 375, height: 812}]) {
            await page.setViewportSize(viewport);
            await page.goto(`${baseUrl}/builder/`);
            await expect(page.locator("link#theme")).toHaveAttribute("href", new RegExp(`bootstrap-${theme}\\.min\\.css`));
            await expect(page.getByRole("button", {name: "Add Character", exact: true})).toBeVisible();
            await expect(page.getByRole("button", {name: "Add Variant", exact: true})).toBeVisible();
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
            const [character, stats] = await Promise.all([
                page.locator("main > .row > section").nth(0).boundingBox(),
                page.locator("main > .row > section").nth(1).boundingBox()
            ]);
            expect(character).not.toBeNull();
            expect(stats).not.toBeNull();
            if (viewport.width >= 992) {
                expect(Math.abs(character.y - stats.y)).toBeLessThan(2);
                expect(stats.x).toBeGreaterThan(character.x + character.width - 2);
            }
            else {
                expect(Math.abs(character.x - stats.x)).toBeLessThan(2);
                expect(stats.y).toBeGreaterThan(character.y + character.height - 2);
            }
            const characterCard = await page.locator("main > .row > section").first().locator(".card").boundingBox();
            const actions = page.getByRole("group", {name: "Character Options"});
            const actionBox = await actions.boundingBox();
            const actionButtons = await actions.getByRole("button").evaluateAll(buttons => buttons.map(button => {
                const box = button.getBoundingClientRect();
                return {x: box.x, y: box.y, width: box.width, height: box.height};
            }));
            expect(characterCard).not.toBeNull();
            expect(actionBox).not.toBeNull();
            expect(actionButtons).toHaveLength(4);
            geometry[viewport.width] = {characterCard, actionBox};
            if (viewport.width >= 768) {
                expect(actionBox.height).toBeLessThan(70);
                expect(actionButtons.every(button => Math.abs(button.y - actionButtons[0].y) < 2)).toBe(true);
                expect(actionButtons.every(button => Math.abs(button.width - actionButtons[0].width) < 2)).toBe(true);
                expect(Math.abs(
                    actionButtons[0].x - actionBox.x -
                    (actionBox.x + actionBox.width - actionButtons.at(-1).x - actionButtons.at(-1).width)
                )).toBeLessThan(2);
            }
            else {
                expect(actionBox.height).toBeGreaterThan(120);
                expect(actionButtons.every(button => Math.abs(button.x - actionButtons[0].x) < 2)).toBe(true);
                expect(actionButtons.every(button => Math.abs(button.height - actionBox.height / 4) < 2)).toBe(true);
            }
            await page.getByRole("button", {name: "Era Abilities", exact: true}).click();
            const eraColumns = page.locator("#eraAbilities > div");
            await expect(eraColumns).toHaveCount(3);
            const eraBoxes = await eraColumns.evaluateAll(columns => columns.map(column => {
                const box = column.getBoundingClientRect();
                const cells = column.querySelector("tbody tr").children;
                const key = cells[0].getBoundingClientRect();
                const value = cells[1].getBoundingClientRect();
                return {x: box.x, y: box.y, width: box.width, keyWidth: key.width, valueWidth: value.width};
            }));
            expect(eraBoxes.every(box => Math.abs(box.keyWidth / (box.keyWidth + box.valueWidth) - 0.7) < 0.03)).toBe(true);
            if (viewport.width >= 768) {
                expect(eraBoxes.every(box => Math.abs(box.y - eraBoxes[0].y) < 2)).toBe(true);
                expect(eraBoxes[1].x).toBeGreaterThan(eraBoxes[0].x + eraBoxes[0].width - 2);
            }
            else {
                expect(eraBoxes.every(box => Math.abs(box.x - eraBoxes[0].x) < 2)).toBe(true);
                expect(eraBoxes[1].y).toBeGreaterThan(eraBoxes[0].y);
            }
            const toggle = page.getByRole("button", {name: "KSM Swap/Quest Mods", exact: true});
            await expect(toggle).toHaveClass(/collapsed/);
            await expect(toggle.locator(".collapse-caret")).toHaveCSS("transition-duration", "0s");
            await toggle.click();
            await expect(toggle).not.toHaveClass(/collapsed/);
            await expect(toggle).toHaveAttribute("aria-expanded", "true");
            if (theme.startsWith("glass-")) {
                const spacing = await page.locator("main > .row > section").first().evaluate(element => ({
                    marginBottom: parseFloat(getComputedStyle(element).marginBottom),
                    rootFontSize: parseFloat(getComputedStyle(document.documentElement).fontSize)
                }));
                expect(spacing.marginBottom).toBeCloseTo(spacing.rootFontSize * 0.75, 1);
            }
        }
        expect(geometry[1280].characterCard.width).toBeGreaterThan(600);
        expect(geometry[1280].characterCard.height).toBeLessThan(260);
        expect(geometry[375].characterCard.width).toBeGreaterThan(340);
        expect(geometry[375].characterCard.height).toBeGreaterThan(geometry[1280].characterCard.height + 100);
    }
});
