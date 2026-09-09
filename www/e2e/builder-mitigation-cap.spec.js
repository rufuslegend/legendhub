"use strict";

const {test, expect} = require("./support/fixtures");
const {saveAction, equipLight, freshLogin} = require("./support/builder");

async function totalCell(page, short) {
    const table = page.locator(".builder-equipment-table");
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
