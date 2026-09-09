"use strict";

const {test, expect} = require("./support/fixtures");
const {button, saveAction, profiles, signIn, renameCharacter, namedDialog, equipLight,
    expectCharacter, exportLists, importLists, freshLogin} = require("./support/builder");

test("exported characters and variants import into another account and survive a fresh login", async ({signedIn: {page}, account, stack, newDevice}) => {
    await renameCharacter(page, "Portable Hero");
    await saveAction(page, () => page.locator("#strInput").fill("40"));
    await equipLight(page, "Test brass lantern");
    await saveAction(page, () => button(page, "Add Variant").click());
    await saveAction(page, () => page.locator("#strInput").fill("45"));
    await equipLight(page, "Test silver lantern");
    const payload = await exportLists(page);
    expect(payload).toMatch(/^7\*/);
    const source = await profiles(stack, account.id);
    const recipient = await stack.createAccount();
    const destination = await freshLogin(newDevice, recipient);
    await importLists(destination.page, payload);
    await expectCharacter(destination.page, {name: "Portable Hero", strength: "40", item: "Test brass lantern"});
    await expect(destination.page.getByLabel("Variant", {exact: true}).locator("option:checked")).toHaveText("Original");
    const fresh = await freshLogin(newDevice, recipient);
    await expectCharacter(fresh.page, {name: "Portable Hero", strength: "40", item: "Test brass lantern"});
    await expect(fresh.page.getByLabel("Variant", {exact: true}).locator("option:checked")).toHaveText("Original");
    await fresh.page.getByLabel("Variant", {exact: true}).selectOption({label: "Variant 1"});
    await expectCharacter(fresh.page, {name: "Portable Hero", strength: "45", item: "Test silver lantern"});
    expect(await profiles(stack, account.id)).toEqual(source);
    const imported = (await profiles(stack, recipient.id)).filter(row => row.Name === "Portable Hero");
    expect(imported).toHaveLength(1);
    expect(imported[0].PublicId).not.toBe(source[0].PublicId);
});

test("malformed imports leave the saved character unchanged", async ({signedIn: {page}, account, stack}) => {
    await renameCharacter(page, "Safe Hero");
    await saveAction(page, () => page.locator("#strInput").fill("47"));
    await equipLight(page, "Test brass lantern");
    const before = await profiles(stack, account.id);
    await button(page, "Import").click();
    const dialog = page.getByRole("dialog", {name: "Import Lists"});
    for (const value of ["", "not-a-builder-list", "999*unsupported"]) {
        await dialog.getByLabel("Builder list import string").fill(value);
        await dialog.getByRole("button", {name: "Import", exact: true}).click();
        await expect(dialog.getByRole("alert")).toHaveText("Invalid list import string.");
    }
    await dialog.getByRole("button", {name: "Close", exact: true}).click();
    await page.reload();
    await expectCharacter(page, {name: "Safe Hero", strength: "47", item: "Test brass lantern"});
    expect(await profiles(stack, account.id)).toEqual(before);
});

test("duplicate imports honor skip and overwrite choices without duplicating the database profile", async ({signedIn: {page}, account, stack, newDevice}) => {
    await renameCharacter(page, "Duplicate Hero");
    await saveAction(page, () => page.locator("#strInput").fill("40"));
    const payload = await exportLists(page);
    const [original] = await profiles(stack, account.id);
    await saveAction(page, () => page.locator("#strInput").fill("55"));
    const beforeSkip = await profiles(stack, account.id);
    await button(page, "Import").click();
    const dialog = page.getByRole("dialog", {name: "Import Lists"});
    await dialog.getByLabel("Builder list import string").fill(payload);
    await dialog.getByLabel("Overwrite Duplicate Hero Original").uncheck();
    await dialog.getByRole("button", {name: "Import", exact: true}).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator("#strInput")).toHaveValue("55");
    expect(await profiles(stack, account.id)).toEqual(beforeSkip);
    await page.reload();
    await expect(page.locator("#strInput")).toHaveValue("55");
    await importLists(page, payload);
    const fresh = await freshLogin(newDevice, account);
    await expect(fresh.page.locator("#strInput")).toHaveValue("40");
    const rows = await profiles(stack, account.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].PublicId).toBe(original.PublicId);
});

test("anonymous Builder data is copied only after confirmation and the browser original is retained", async ({newDevice, account, stack}) => {
    const {page} = await newDevice();
    await page.goto("/builder/");
    await expect(page.getByText("Saved in this browser", {exact: true})).toBeVisible();
    await page.getByRole("button", {name: "Agree", exact: true}).click();
    await renameCharacter(page, "Local Hero", false);
    await page.locator("#strInput").fill("44");
    await equipLight(page, "Test brass lantern", false);
    const localPayload = await exportLists(page);
    await expect.poll(() => page.evaluate(() => localStorage.getItem("cln"))).toBe(localPayload);
    await page.reload();
    await expectCharacter(page, {name: "Local Hero", strength: "44", item: "Test brass lantern"});
    await signIn(page, account.username);
    expect(await profiles(stack, account.id)).toEqual([]);
    const offer = page.getByRole("region", {name: "Local Builder data"});
    await offer.getByRole("button", {name: "Review local Builder data"}).click();
    const dialog = page.getByRole("dialog", {name: "Copy local Builder data"});
    await expect(dialog).toBeVisible();
    expect(await profiles(stack, account.id)).toEqual([]);
    await dialog.getByRole("button", {name: "Copy all to my account"}).click();
    await expect(dialog.getByRole("button", {name: "Close results"})).toBeVisible();
    await dialog.getByRole("button", {name: "Close results"}).click();
    const fresh = await freshLogin(newDevice, account);
    await fresh.page.getByLabel("Character", {exact: true}).selectOption({label: "Local Hero"});
    await expectCharacter(fresh.page, {name: "Local Hero", strength: "44", item: "Test brass lantern"});
    expect(await page.evaluate(() => localStorage.getItem("cln"))).toBe(localPayload);
    expect((await profiles(stack, account.id)).map(row => row.Name)).toEqual(["Local Hero"]);
});
