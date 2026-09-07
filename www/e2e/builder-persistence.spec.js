"use strict";

const {test, expect} = require("./support/fixtures");

const {saveAction, signIn, renameCharacter, equipLight, expectCharacter} = require("./support/builder");

// Catches a save that only updates browser state, a missing SQL commit, broken
// fresh login, or a load that loses encoded stats/equipment.
test("a character survives fresh logins, an app restart, and edits from another device", async ({stack, newDevice, account}) => {
    const work = await newDevice();
    await signIn(work.page, account.username);
    await renameCharacter(work.page, "MariaDB Hero");
    await saveAction(work.page, () => work.page.locator("#strInput").fill("40"));
    await equipLight(work.page, "Test brass lantern");

    const saved = await stack.query(
        "SELECT PublicId, Payload, Revision FROM BuilderProfiles WHERE MemberId = ? AND DeletedOn IS NULL", [account.id]
    );
    expect(saved).toHaveLength(1);
    expect(saved[0].Payload).toContain("MariaDB Hero");
    // No browser storage/session state is copied to the next device, and a new
    // application process must read the committed data from MariaDB.
    await work.context.close();
    await stack.restartApp();

    const home = await newDevice();
    await signIn(home.page, account.username);
    await expectCharacter(home.page, {name: "MariaDB Hero", strength: "40", item: "Test brass lantern"});
    await saveAction(home.page, () => home.page.locator("#strInput").fill("45"));
    await equipLight(home.page, "Test silver lantern");

    const reopenedWork = await newDevice();
    await signIn(reopenedWork.page, account.username);
    await expectCharacter(reopenedWork.page, {name: "MariaDB Hero", strength: "45", item: "Test silver lantern"});
    await reopenedWork.page.reload();
    await expectCharacter(reopenedWork.page, {name: "MariaDB Hero", strength: "45", item: "Test silver lantern"});

    const updated = await stack.query(
        "SELECT PublicId, Payload, Revision FROM BuilderProfiles WHERE MemberId = ? AND DeletedOn IS NULL", [account.id]
    );
    expect(updated).toHaveLength(1);
    expect(updated[0].PublicId).toBe(saved[0].PublicId);
    expect(updated[0].Revision).toBeGreaterThan(saved[0].Revision);
    expect(updated[0].Payload).not.toBe(saved[0].Payload);
});

// Catches unscoped character lists, cached data surviving an account switch,
// or an independent save overwriting the first account's character.
test("switching accounts keeps saved characters private", async ({stack, newDevice, account}) => {
    const otherAccount = await stack.createAccount();
    const device = await newDevice();
    await signIn(device.page, account.username);
    await renameCharacter(device.page, "Private Owner Hero");
    await saveAction(device.page, () => device.page.locator("#strInput").fill("48"));
    await equipLight(device.page, "Test brass lantern");

    await device.page.getByRole("button", {name: account.username, exact: true}).click();
    await device.page.getByRole("button", {name: "Logout", exact: true}).click();
    await signIn(device.page, otherAccount.username);
    await expect(device.page.getByLabel("Character", {exact: true})).not.toContainText("Private Owner Hero");
    await expect(device.page.getByLabel("Character", {exact: true})).toContainText("Untitled");
    await renameCharacter(device.page, "Other Players Hero");
    await equipLight(device.page, "Test silver lantern");

    const owner = await newDevice();
    await signIn(owner.page, account.username);
    await expectCharacter(owner.page, {name: "Private Owner Hero", strength: "48", item: "Test brass lantern"});
    await expect(owner.page.getByLabel("Character", {exact: true})).not.toContainText("Other Players Hero");
    const rows = await stack.query(
        "SELECT MemberId, Name FROM BuilderProfiles WHERE MemberId IN (?, ?) AND DeletedOn IS NULL ORDER BY MemberId", [account.id, otherAccount.id]
    );
    expect(rows.map(row => ({memberId: row.MemberId, name: row.Name}))).toEqual([
        {memberId: account.id, name: "Private Owner Hero"},
        {memberId: otherAccount.id, name: "Other Players Hero"}
    ]);
});
