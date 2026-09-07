"use strict";

const {test, expect} = require("./support/fixtures");

async function signIn(page, username) {
    await page.goto("/login.html?returnUrl=%2Fbuilder%2F");
    await page.getByLabel("Username or email", {exact: true}).fill(username);
    await page.locator("#login_password").fill("disposable-builder-password");
    await page.locator('form[name="login"] button[type="submit"]').click();
    await expect(page).toHaveURL(/\/builder\/$/);
    await expect(page.getByLabel("Character", {exact: true})).toBeVisible();
    await expect(page.getByText("Saved in this browser", {exact: true})).toHaveCount(0);
}

async function renameCharacter(page, name) {
    await page.getByRole("button", {name: "Edit Character", exact: true}).click();
    const dialog = page.getByRole("dialog", {name: "Edit Character"});
    await dialog.getByLabel("Name", {exact: true}).fill(name);
    await dialog.getByRole("button", {name: "Save", exact: true}).click();
    await expect(page.getByText("Saved to account", {exact: true})).toBeVisible();
}

function lightRow(page) {
    return page.locator(".builder-equipment-table tbody tr").filter({
        has: page.getByRole("cell", {name: "Light", exact: true})
    });
}

async function equipLight(page, name) {
    await lightRow(page).locator('th[scope="row"] button').click();
    const picker = page.getByRole("dialog", {name: "Choose Item"});
    await picker.getByLabel("Search items").fill(name);
    await picker.getByRole("button", {name, exact: true}).click();
    await expect(lightRow(page)).toContainText(name);
    await expect(page.getByText("Saved to account", {exact: true})).toBeVisible();
}

async function expectCharacter(page, {name, strength, item}) {
    await expect(page.getByLabel("Character", {exact: true}).locator("option:checked")).toHaveText(name);
    await expect(page.locator("#strInput")).toHaveValue(strength);
    await expect(lightRow(page)).toContainText(item);
}

// Catches a save that only updates browser state, a missing SQL commit, broken
// fresh login, or a load that loses encoded stats/equipment.
test("a character survives fresh logins, an app restart, and edits from another device", async ({stack, newDevice}) => {
    const work = await newDevice();
    await signIn(work.page, "BuilderTester");
    await renameCharacter(work.page, "MariaDB Hero");
    await work.page.locator("#strInput").fill("40");
    await equipLight(work.page, "Test brass lantern");

    const saved = await stack.query(
        "SELECT PublicId, Payload, Revision FROM BuilderProfiles WHERE MemberId = 1 AND DeletedOn IS NULL"
    );
    expect(saved).toHaveLength(1);
    expect(saved[0].Payload).toContain("MariaDB Hero");
    // No browser storage/session state is copied to the next device, and a new
    // application process must read the committed data from MariaDB.
    await work.context.close();
    await stack.restartApp();

    const home = await newDevice();
    await signIn(home.page, "BuilderTester");
    await expectCharacter(home.page, {name: "MariaDB Hero", strength: "40", item: "Test brass lantern"});
    await home.page.locator("#strInput").fill("45");
    await equipLight(home.page, "Test silver lantern");

    const reopenedWork = await newDevice();
    await signIn(reopenedWork.page, "BuilderTester");
    await expectCharacter(reopenedWork.page, {name: "MariaDB Hero", strength: "45", item: "Test silver lantern"});
    await reopenedWork.page.reload();
    await expectCharacter(reopenedWork.page, {name: "MariaDB Hero", strength: "45", item: "Test silver lantern"});

    const updated = await stack.query(
        "SELECT PublicId, Payload, Revision FROM BuilderProfiles WHERE MemberId = 1 AND DeletedOn IS NULL"
    );
    expect(updated).toHaveLength(1);
    expect(updated[0].PublicId).toBe(saved[0].PublicId);
    expect(updated[0].Revision).toBeGreaterThan(saved[0].Revision);
    expect(updated[0].Payload).not.toBe(saved[0].Payload);
});

// Catches unscoped character lists, cached data surviving an account switch,
// or an independent save overwriting the first account's character.
test("switching accounts keeps saved characters private", async ({stack, newDevice}) => {
    const device = await newDevice();
    await signIn(device.page, "IsolationOwner");
    await renameCharacter(device.page, "Private Owner Hero");
    await device.page.locator("#strInput").fill("48");
    await equipLight(device.page, "Test brass lantern");

    await device.page.getByRole("button", {name: "IsolationOwner", exact: true}).click();
    await device.page.getByRole("button", {name: "Logout", exact: true}).click();
    await signIn(device.page, "IsolationOther");
    await expect(device.page.getByLabel("Character", {exact: true})).not.toContainText("Private Owner Hero");
    await expect(device.page.getByLabel("Character", {exact: true})).toContainText("Untitled");
    await renameCharacter(device.page, "Other Players Hero");
    await equipLight(device.page, "Test silver lantern");

    const owner = await newDevice();
    await signIn(owner.page, "IsolationOwner");
    await expectCharacter(owner.page, {name: "Private Owner Hero", strength: "48", item: "Test brass lantern"});
    await expect(owner.page.getByLabel("Character", {exact: true})).not.toContainText("Other Players Hero");
    const rows = await stack.query(
        "SELECT MemberId, Name FROM BuilderProfiles WHERE MemberId IN (2, 3) AND DeletedOn IS NULL ORDER BY MemberId"
    );
    expect(rows.map(row => ({memberId: row.MemberId, name: row.Name}))).toEqual([
        {memberId: 2, name: "Private Owner Hero"},
        {memberId: 3, name: "Other Players Hero"}
    ]);
});
