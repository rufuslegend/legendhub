"use strict";

const {test, expect} = require("./support/fixtures");
const {saveAction, equipLight, freshLogin, importLists} = require("./support/builder");

async function totalCell(page, short) {
    const table = page.locator(".builder-equipment-table");
    await expect(table.locator("thead").getByRole("columnheader", {name: short, exact: true})).toBeVisible();
    const headers = await table.locator("thead th").allTextContents();
    const index = headers.findIndex(text => text.trim() === short);
    expect(index).toBeGreaterThan(-1);
    return table.locator("tbody tr").first().locator("th, td").nth(index);
}

test("editable mitigation cap modifiers survive item saves, equipment selection and a new device", async ({signedIn: {page}, account, stack, newDevice}) => {
    await stack.query("UPDATE Items SET Mitigation = 28 WHERE Id = 101");
    await stack.query("INSERT INTO Items (Id, Name, Slot, SlotMask, Mitigation) VALUES (103, 'Test cap penalty', 21, 2097152, 2)");
    for (const [id, modifier] of [[101, 5], [103, -3]]) {
        await page.goto(`/items/edit.html?id=${id}`);
        await page.getByLabel("MitCap", {exact: true}).fill(String(modifier));
        await page.getByRole("button", {name: "Save", exact: true}).click();
        await expect(page).toHaveURL(new RegExp(`/items/details.html\\?id=${id}$`));
        await expect.poll(async () => (await stack.query("SELECT MitigationCap FROM Items WHERE Id = ?", [id]))[0].MitigationCap).toBe(modifier);
        expect((await stack.query("SELECT MitigationCap FROM Items_AuditTrail WHERE ItemId = ? ORDER BY Id DESC LIMIT 1", [id]))[0].MitigationCap).toBe(0);
        await page.goto(`/items/edit.html?id=${id}`);
        await expect(page.getByLabel("MitCap", {exact: true})).toHaveValue(String(modifier));
    }

    await page.goto("/builder/");
    await saveAction(page, async () => {
        for (const [stat, value] of Object.entries({str: 50, min: 44, dex: 30, con: 70, per: 25, spi: 25}))
            await page.locator(`#${stat}Input`).fill(String(value));
    });
    await equipLight(page, "Test brass lantern");
    await page.getByRole("button", {name: "Hide/Show Columns", exact: true}).click();
    const columns = page.getByRole("dialog", {name: "Select visible columns"});
    await columns.getByRole("button", {name: "Mitigation", exact: true}).click();
    await columns.getByRole("button", {name: "Mitigation Cap", exact: true}).click();
    await columns.getByRole("button", {name: "Close", exact: true}).click();
    await expect(await totalCell(page, "MitCap")).toHaveText("25");
    await expect(await totalCell(page, "Mit")).toHaveText("25Cap: 25");

    const other = page.locator(".builder-equipment-table tbody tr").filter({has: page.getByRole("cell", {name: "Other", exact: true})}).first();
    await other.locator('th[scope="row"] button').click();
    const picker = page.getByRole("dialog", {name: "Choose Item"});
    await picker.getByLabel("Search items").fill("MitCap < 0");
    await saveAction(page, () => picker.getByRole("button", {name: "Test cap penalty", exact: true}).click());
    await expect(await totalCell(page, "MitCap")).toHaveText("22");
    await expect(await totalCell(page, "Mit")).toHaveText("24Cap: 22");
    await expect.poll(async () => (await stack.query("SELECT Payload FROM AccountPreferences WHERE MemberId = ?", [account.id]))[0].Payload).toContain("MitCap");

    const fresh = await freshLogin(newDevice, account);
    await expect(await totalCell(fresh.page, "MitCap")).toHaveText("22");
    await expect(await totalCell(fresh.page, "Mit")).toHaveText("24Cap: 22");
    await equipLight(fresh.page, "-");
    await expect(await totalCell(fresh.page, "MitCap")).toHaveText("17");
    await expect(await totalCell(fresh.page, "Mit")).toHaveText("2Cap: 17");
});

test("adding a skill object's mitigation cap preserves its existing mitigation bonus", async ({signedIn: {page}, account, stack, newDevice}) => {
    const {createDefaultVariant} = require("../client/features/builder/builder-reducer.js");
    const {encodeBuilderLists} = require("../shared/builder-codec.mjs");
    await stack.query("UPDATE Items SET Mitigation = 23, MitigationCap = 0, Strength = 16, StrengthCap = 6 WHERE Id = 101");
    await stack.query("INSERT INTO Items (Id, Name, Slot, SlotMask, Mitigation) VALUES (1144, 'Battle Training', 21, 2097152, 0), (1772, 'Test Bastion', 21, 2097152, 2), (1675, 'Test Convergence', 21, 2097152, 3)");
    const variant = createDefaultVariant("Training");
    Object.assign(variant.baseStats, {strength: 90, constitution: 73, mind: 81});
    for (const [index, id] of [[0, 101], [28, 1144], [32, 1772], [34, 1675]])
        variant.items[index].id = id;
    await importLists(page, encodeBuilderLists([{name: "Skill Cap Test", variants: [variant]}]));
    await page.getByRole("button", {name: "Hide/Show Columns", exact: true}).click();
    const columns = page.getByRole("dialog", {name: "Select visible columns"});
    await columns.getByRole("button", {name: "Mitigation", exact: true}).click();
    await columns.getByRole("button", {name: "Mitigation Cap", exact: true}).click();
    await columns.getByRole("button", {name: "Close", exact: true}).click();
    await expect(await totalCell(page, "Mit")).toHaveText("35Cap: 30");
    await expect.poll(async () => (await stack.query("SELECT Payload FROM AccountPreferences WHERE MemberId = ?", [account.id]))[0].Payload).toContain("MitCap");

    await page.goto("/items/edit.html?id=1772");
    await page.getByLabel("MitCap", {exact: true}).fill("2");
    await page.getByRole("button", {name: "Save", exact: true}).click();
    await expect(page).toHaveURL(/\/items\/details.html\?id=1772$/);
    expect((await stack.query("SELECT Mitigation, MitigationCap FROM Items WHERE Id = 1772"))[0])
        .toMatchObject({Mitigation: 2, MitigationCap: 2});
    await page.goto("/builder/");
    await expect(await totalCell(page, "Mit")).toHaveText("35Cap: 32");
    await expect(await totalCell(page, "MitCap")).toHaveText("32");
    const fresh = await freshLogin(newDevice, account);
    await expect(await totalCell(fresh.page, "Mit")).toHaveText("35Cap: 32");
    await expect(await totalCell(fresh.page, "MitCap")).toHaveText("32");
});
