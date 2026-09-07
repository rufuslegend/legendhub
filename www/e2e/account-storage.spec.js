"use strict";

const fs = require("node:fs/promises");
const {test, expect} = require("./support/fixtures");
const {button, saveAction, profiles, renameCharacter, equipLight, expectCharacter,
    importLists, freshLogin} = require("./support/builder");

test("account settings download committed Builder data that can be imported into another account", async ({signedIn: {page}, account, stack, newDevice}) => {
    await renameCharacter(page, "Downloaded Hero");
    await saveAction(page, () => page.locator("#strInput").fill("46"));
    await equipLight(page, "Test brass lantern");
    await page.goto("/account/");
    await expect(page.getByText("1 synced Builder profile", {exact: true})).toBeVisible();
    const downloading = page.waitForEvent("download");
    await button(page, "Export all Builder data").click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/^legendhub-builder-\d{4}-\d{2}-\d{2}\.txt$/);
    const payload = await fs.readFile(await download.path(), "utf8");
    expect(payload).toBe((await profiles(stack, account.id))[0].Payload);
    const recipient = await stack.createAccount();
    const destination = await freshLogin(newDevice, recipient);
    await importLists(destination.page, payload);
    const fresh = await freshLogin(newDevice, recipient);
    await fresh.page.getByLabel("Character", {exact: true}).selectOption({label: "Downloaded Hero"});
    await expectCharacter(fresh.page, {name: "Downloaded Hero", strength: "46", item: "Test brass lantern"});
});

test("deleting all account data requires confirmation and stops a stale Builder tab from recreating it", async ({signedIn: {page}, account, stack, newDevice}) => {
    await renameCharacter(page, "Deleted Everywhere");
    const settings = await freshLogin(newDevice, account);
    await settings.page.goto("/account/");
    await button(settings.page, "Delete all synced Builder data").click();
    let dialog = settings.page.getByRole("dialog", {name: "Delete all synced Builder data"});
    await dialog.getByRole("button", {name: "Cancel deletion", exact: true}).click();
    expect(await profiles(stack, account.id)).toHaveLength(1);
    const [before] = await stack.query("SELECT StorageGeneration FROM AccountPreferences WHERE MemberId = ?", [account.id]);
    await button(settings.page, "Delete all synced Builder data").click();
    await dialog.getByRole("button", {name: "Permanently delete synced Builder data"}).click();
    await expect(settings.page.getByRole("status").filter({hasText: "All synced Builder data was deleted."})).toBeVisible();
    await page.locator("#strInput").fill("57");
    const alert = page.getByRole("alert").filter({hasText: "Synced Builder data changed in another session."});
    await expect(alert).toBeVisible();
    await expect(alert.getByRole("button", {name: "Export Builder data"})).toBeVisible();
    expect(await profiles(stack, account.id)).toEqual([]);
    const [after] = await stack.query("SELECT StorageGeneration FROM AccountPreferences WHERE MemberId = ?", [account.id]);
    expect(after.StorageGeneration).toBeGreaterThan(before.StorageGeneration);
    const fresh = await freshLogin(newDevice, account);
    await expect(fresh.page.getByLabel("Character", {exact: true}).locator("option")).toHaveText(["Untitled"]);
    expect(await profiles(stack, account.id)).toEqual([]);
});

test("theme and Builder column preferences survive a fresh browser without altering the character", async ({signedIn: {page}, account, stack, newDevice}) => {
    await renameCharacter(page, "Preference Hero");
    const before = await profiles(stack, account.id);
    await button(page, "Hide/Show Columns").click();
    const columns = page.getByRole("dialog", {name: "Select visible columns"});
    const rent = columns.getByRole("button", {name: "Rent", exact: true});
    await expect(rent).toHaveAttribute("aria-pressed", "true");
    await rent.click();
    await columns.getByRole("button", {name: "Close", exact: true}).click();
    await button(page, "Choose theme").click();
    await button(page, "Solarized Dark").click();
    await expect.poll(async () => {
        const [row] = await stack.query("SELECT Payload FROM AccountPreferences WHERE MemberId = ?", [account.id]);
        return JSON.parse(row.Payload).theme;
    }).toBe("solarized-dark");
    const fresh = await freshLogin(newDevice, account);
    await expect(fresh.page.locator("link#theme")).toHaveAttribute("href", /bootstrap-solarized-dark\.min\.css/);
    await button(fresh.page, "Hide/Show Columns").click();
    await expect(fresh.page.getByRole("dialog", {name: "Select visible columns"}).getByRole("button", {name: "Rent", exact: true})).toHaveAttribute("aria-pressed", "false");
    expect(await profiles(stack, account.id)).toEqual(before);
});

// These issue real requests from the second account's browser because the UI
// correctly provides no control for editing somebody else's profile ID.
for (const operation of ["update", "delete"]) {
    test(`another account cannot ${operation} a known Builder profile ID`, async ({signedIn: {page}, account, stack, newDevice}) => {
        await renameCharacter(page, "Private Target");
        const [target] = await profiles(stack, account.id);
        const attacker = await stack.createAccount();
        const other = await freshLogin(newDevice, attacker);
        const mutation = operation === "update"
            ? `mutation ($authToken: String!, $id: String!, $revision: Int!, $payload: String!) {
                updateBuilderProfile(authToken: $authToken, id: $id, revision: $revision,
                    name: "Private Target", payload: $payload, storageGeneration: 1) { status }
            }`
            : `mutation ($authToken: String!, $id: String!, $revision: Int!) {
                deleteBuilderProfile(authToken: $authToken, id: $id, revision: $revision, storageGeneration: 1) { status }
            }`;
        const result = await other.page.evaluate(async ({query, target, operation}) => {
            const authToken = decodeURIComponent(document.cookie.split("; ").find(value => value.startsWith("loginToken=")).slice("loginToken=".length));
            const variables = {authToken, id: target.PublicId, revision: target.Revision};
            if (operation === "update") variables.payload = target.Payload;
            const response = await fetch("/api", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({query, variables})});
            return response.json();
        }, {query: mutation, target, operation});
        expect(result.errors).toEqual([expect.objectContaining({message: "Profile not found.", code: 404})]);
        expect(await profiles(stack, account.id)).toEqual([target]);
        expect(await profiles(stack, attacker.id)).toEqual([]);
    });
}
