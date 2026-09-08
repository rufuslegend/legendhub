"use strict";

const {test, expect} = require("./support/fixtures");
const {button, saveAction, profiles, renameCharacter, namedDialog, confirm, equipLight,
    expectCharacter, freshLogin} = require("./support/builder");

test("multiple characters keep their own six base stats across fresh logins", async ({signedIn: {page}, account, stack, newDevice}) => {
    await renameCharacter(page, "Warrior");
    const stats = {str: "40", min: "25", dex: "35", con: "38", per: "30", spi: "30"};
    await saveAction(page, async () => {
        for (const [stat, value] of Object.entries(stats))
            await page.locator(`#${stat}Input`).fill(value);
    });
    await namedDialog(page, "Add Character", "Mage");
    await saveAction(page, () => page.locator("#minInput").fill("60"));
    expect((await profiles(stack, account.id)).map(row => row.Name)).toEqual(["Warrior", "Mage"]);

    const fresh = await freshLogin(newDevice, account);
    await fresh.page.getByLabel("Character", {exact: true}).selectOption({label: "Warrior"});
    for (const [stat, value] of Object.entries(stats))
        await expect(fresh.page.locator(`#${stat}Input`)).toHaveValue(value);
    await fresh.page.getByLabel("Character", {exact: true}).selectOption({label: "Mage"});
    await expect(fresh.page.locator("#minInput")).toHaveValue("60");
});

test("renaming a character updates the existing database row and preserves equipment", async ({signedIn: {page}, account, stack, newDevice}) => {
    await renameCharacter(page, "Old Name");
    await equipLight(page, "Test brass lantern");
    const [before] = await profiles(stack, account.id);
    await renameCharacter(page, "New Name");
    const [after] = await profiles(stack, account.id);
    expect(after.PublicId).toBe(before.PublicId);
    expect(after.Revision).toBeGreaterThan(before.Revision);
    const fresh = await freshLogin(newDevice, account);
    await expect(fresh.page.getByLabel("Character", {exact: true}).locator("option")).toHaveText(["New Name"]);
    await expect(fresh.page.getByRole("button", {name: "Test brass lantern", exact: true})).toBeVisible();
});

test("invalid and duplicate character names cannot change committed characters", async ({signedIn: {page}, account, stack}) => {
    await renameCharacter(page, "Valid Hero");
    const before = await profiles(stack, account.id);
    await button(page, "Add Character").click();
    const dialog = page.getByRole("dialog", {name: "Add Character"});
    for (const [name, error] of [["Bad!", "Invalid characters."], ["Valid Hero", "Duplicate entry."]]) {
        await dialog.getByLabel("Name", {exact: true}).fill(name);
        await dialog.getByRole("button", {name: "Add", exact: true}).click();
        await expect(dialog.getByRole("alert")).toHaveText(error);
    }
    await dialog.getByRole("button", {name: "Close", exact: true}).click();
    await page.reload();
    await expect(page.getByLabel("Character", {exact: true}).locator("option")).toHaveText(["Valid Hero"]);
    expect(await profiles(stack, account.id)).toEqual(before);
});

test("character deletion can be cancelled and confirmation deletes only the selected character", async ({signedIn: {page}, account, stack, newDevice}) => {
    await renameCharacter(page, "Keep Me");
    await saveAction(page, () => page.locator("#strInput").fill("42"));
    await equipLight(page, "Test brass lantern");
    await namedDialog(page, "Add Character", "Delete Me");
    await button(page, "Delete Character").click();
    await page.getByRole("dialog", {name: "Are you sure?"}).getByRole("button", {name: "Close", exact: true}).click();
    expect(await profiles(stack, account.id)).toHaveLength(2);
    await confirm(page, "Delete Character");
    expect((await profiles(stack, account.id)).map(row => row.Name)).toEqual(["Keep Me"]);
    const fresh = await freshLogin(newDevice, account);
    await expectCharacter(fresh.page, {name: "Keep Me", strength: "42", item: "Test brass lantern"});
    const [deleted] = await stack.query("SELECT DeletedOn, Payload FROM BuilderProfiles WHERE MemberId = ? AND Name = 'Delete Me'", [account.id]);
    expect(deleted.DeletedOn).not.toBeNull();
    expect(deleted.Payload).toBeNull();
});

test("deleting the last character leaves an unsaved placeholder without recreating its database row", async ({signedIn: {page}, account, stack, newDevice}) => {
    await renameCharacter(page, "Last Hero");
    await confirm(page, "Delete Character");
    const fresh = await freshLogin(newDevice, account);
    await expect(fresh.page.getByLabel("Character", {exact: true}).locator("option")).toHaveText(["Untitled"]);
    expect(await profiles(stack, account.id)).toEqual([]);
});

test("numbered variant copies need no dialog and preserve independent builds after renaming", async ({signedIn: {page}, account, newDevice}) => {
    await renameCharacter(page, "Variant Hero");
    await saveAction(page, () => page.locator("#strInput").fill("40"));
    await equipLight(page, "Test brass lantern");
    await saveAction(page, () => button(page, "Add Variant").click());
    const variants = page.getByLabel("Variant", {exact: true});
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(variants.locator("option:checked")).toHaveText("Variant 1");
    await expect(page.locator("#strInput")).toHaveValue("40");
    await saveAction(page, () => page.locator("#strInput").fill("50"));
    await equipLight(page, "Test silver lantern");
    for (const name of ["Variant 2", "Variant 3"]) {
        await saveAction(page, () => button(page, "Add Variant").click());
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await expect(variants.locator("option:checked")).toHaveText(name);
        await expectCharacter(page, {name: "Variant Hero", strength: "50", item: "Test silver lantern"});
    }
    await namedDialog(page, "Edit Variant", "Raiding");
    await saveAction(page, () => page.locator("#strInput").fill("55"));

    const fresh = await freshLogin(newDevice, account);
    await expect(fresh.page.getByLabel("Variant", {exact: true}).locator("option")).toHaveText(["Original", "Variant 1", "Variant 2", "Raiding"]);
    await fresh.page.getByLabel("Variant", {exact: true}).selectOption({label: "Original"});
    await expectCharacter(fresh.page, {name: "Variant Hero", strength: "40", item: "Test brass lantern"});
    for (const name of ["Variant 1", "Variant 2"]) {
        await fresh.page.getByLabel("Variant", {exact: true}).selectOption({label: name});
        await expectCharacter(fresh.page, {name: "Variant Hero", strength: "50", item: "Test silver lantern"});
    }
    await fresh.page.getByLabel("Variant", {exact: true}).selectOption({label: "Raiding"});
    await expectCharacter(fresh.page, {name: "Variant Hero", strength: "55", item: "Test silver lantern"});
});

test("setting a variant as primary persists its order without losing the original", async ({signedIn: {page}, account, newDevice}) => {
    await renameCharacter(page, "Primary Hero");
    await saveAction(page, () => button(page, "Add Variant").click());
    await saveAction(page, () => page.locator("#strInput").fill("51"));
    await saveAction(page, () => button(page, "Set Variant as Primary").click());
    const fresh = await freshLogin(newDevice, account);
    await expect(fresh.page.getByLabel("Variant", {exact: true}).locator("option")).toHaveText(["Variant 1", "Original"]);
    await fresh.page.getByLabel("Variant", {exact: true}).selectOption("0");
    await expect(fresh.page.locator("#strInput")).toHaveValue("51");
});

test("deleting a variant preserves its character and remaining variant", async ({signedIn: {page}, account, stack, newDevice}) => {
    await renameCharacter(page, "Surviving Hero");
    await saveAction(page, () => page.locator("#strInput").fill("43"));
    await saveAction(page, () => button(page, "Add Variant").click());
    await saveAction(page, () => page.locator("#strInput").fill("59"));
    await confirm(page, "Delete Variant");
    const fresh = await freshLogin(newDevice, account);
    await expect(fresh.page.getByLabel("Variant", {exact: true}).locator("option")).toHaveText(["Original"]);
    await expect(fresh.page.locator("#strInput")).toHaveValue("43");
    expect(await profiles(stack, account.id)).toHaveLength(1);
});
