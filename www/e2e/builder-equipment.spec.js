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

test("reopening a paged item picker restores the empty choice and unequipping persists", async ({signedIn: {page}, account, stack, newDevice}) => {
    const extraItems = Array.from({length: 21}, (_, index) => [1000 + index, `Paging lantern ${index + 1}`, 0, 1]);
    await stack.query("INSERT INTO Items (Id, Name, Slot, SlotMask) VALUES ?", [extraItems]);
    try {
        await renameCharacter(page, "Empty Hands");
        await equipLight(page, "Test brass lantern");
        const open = () => lightRow(page).locator('th[scope="row"] button').click();
        const picker = page.getByRole("dialog", {name: "Choose Item"});
        const firstChoice = picker.locator(".builder-picker-results tbody tr").first().getByRole("button");

        // Closing from a later page must not hide the empty choice on reopening.
        await open();
        await picker.getByRole("button", {name: "Next", exact: true}).click();
        await expect(picker.getByRole("button", {name: "2", exact: true})).toHaveAttribute("aria-current", "page");
        await picker.getByRole("button", {name: "Close", exact: true}).click();
        await open();
        await expect(firstChoice).toHaveText("-");
        await expect(picker.getByRole("button", {name: "Previous", exact: true})).toBeDisabled();

        // Selecting from a later page closes the picker through a different path.
        await picker.getByRole("button", {name: "Next", exact: true}).click();
        await saveAction(page, () => firstChoice.click());
        await open();
        await expect(firstChoice).toHaveText("-");
        await saveAction(page, () => firstChoice.click());
        const fresh = await freshLogin(newDevice, account);
        await expect(lightRow(fresh.page).locator('th[scope="row"] button')).toHaveText("-");
    } finally {
        await stack.query("DELETE FROM Items WHERE Id IN (?)", [extraItems.map(item => item[0])]);
    }
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
