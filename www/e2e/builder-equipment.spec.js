"use strict";

const {test, expect} = require("./support/fixtures");
const {saveAction, profiles, renameCharacter, lightRow, equipLight, confirm, freshLogin} = require("./support/builder");

test("item search uses database results and cancelling a search preserves equipped gear", async ({signedIn: {page}, account, stack}) => {
    await renameCharacter(page, "Searching Hero");
    await equipLight(page, "Test brass lantern");
    const before = await profiles(stack, account.id);
    await lightRow(page).locator('th[scope="row"] button').click();
    const picker = page.getByRole("dialog", {name: "Choose Item"});
    await picker.getByLabel("Search items").fill("silver");
    await expect(picker.getByRole("button", {name: "Test silver lantern", exact: true})).toBeVisible();
    await expect(picker.locator("table").nth(1).getByRole("button", {name: "Test brass lantern", exact: true})).toHaveCount(0);
    await picker.getByLabel("Search items").fill("itemthatdoesnotexist");
    await expect(picker.locator("table").nth(1).getByRole("button", {name: /Test .* lantern/})).toHaveCount(0);
    await picker.getByRole("button", {name: "Close", exact: true}).click();
    await page.reload();
    await expect(lightRow(page)).toContainText("Test brass lantern");
    expect(await profiles(stack, account.id)).toEqual(before);
});

test("unequipping an item persists the empty slot", async ({signedIn: {page}, account, newDevice}) => {
    await renameCharacter(page, "Empty Hands");
    await equipLight(page, "Test brass lantern");
    await lightRow(page).locator('th[scope="row"] button').click();
    await saveAction(page, () => page.getByRole("dialog", {name: "Choose Item"}).getByRole("button", {name: "-", exact: true}).click());
    const fresh = await freshLogin(newDevice, account);
    await expect(lightRow(fresh.page).locator('th[scope="row"] button')).toHaveText("-");
});

test("locked equipment survives clear and reload while unlocked equipment is cleared", async ({signedIn: {page}, account, newDevice}) => {
    await renameCharacter(page, "Locked Hero");
    await equipLight(page, "Test brass lantern");
    await saveAction(page, () => lightRow(page).getByRole("button", {name: /^Toggle lock for /}).click());
    await confirm(page, "Clear Items", false);
    await expect(lightRow(page)).toContainText("Test brass lantern");
    const fresh = await freshLogin(newDevice, account);
    await expect(lightRow(fresh.page)).toContainText("Test brass lantern");
    const lock = lightRow(fresh.page).getByRole("button", {name: /^Toggle lock for /});
    await expect(lock).toHaveAttribute("aria-pressed", "true");
    await saveAction(fresh.page, () => lock.click());
    await confirm(fresh.page, "Clear Items");
    await fresh.page.reload();
    await expect(lightRow(fresh.page).locator('th[scope="row"] button')).toHaveText("-");
    await expect(lightRow(fresh.page).getByRole("button", {name: /^Toggle lock for /})).toHaveAttribute("aria-pressed", "false");
});
