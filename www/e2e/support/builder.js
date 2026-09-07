"use strict";

const {expect} = require("@playwright/test");
const button = (page, name) => page.getByRole("button", {name, exact: true}).filter({visible: true});
const saved = page => expect(page.getByText("Saved to account", {exact: true})).toBeVisible();
async function saveAction(page, action) {
    // Install the listener before interacting: the previous render can still
    // say Saved while React queues the next debounced mutation.
    const responsePromise = page.waitForResponse(response => {
        if (new URL(response.url()).pathname !== "/api" || response.request().method() !== "POST")
            return false;
        return /mutation (?:CreateBuilderProfile|UpdateBuilderProfile|DeleteBuilderProfile|ImportBuilderProfiles)\b/
            .test(response.request().postDataJSON()?.query || "");
    });
    const [response] = await Promise.all([responsePromise, action()]);
    const result = await response.json();
    expect(result.errors, "the real Builder save must succeed").toBeUndefined();
    await saved(page);
}
const profiles = (stack, memberId) => stack.query(
    "SELECT PublicId, Name, Payload, Revision FROM BuilderProfiles WHERE MemberId = ? AND DeletedOn IS NULL ORDER BY Id",
    [memberId]
);

async function signIn(page, username) {
    await page.goto("/login.html?returnUrl=%2Fbuilder%2F");
    await page.getByLabel("Username or email", {exact: true}).fill(username);
    await page.locator("#login_password").fill("disposable-builder-password");
    await page.locator('form[name="login"] button[type="submit"]').click();
    await expect(page).toHaveURL(/\/builder\/$/);
    await expect(page.getByLabel("Character", {exact: true})).toBeVisible();
    await expect(page.getByText("Saved in this browser", {exact: true})).toHaveCount(0);
}

async function renameCharacter(page, name, account = true) {
    await page.getByRole("button", {name: "Edit Character", exact: true}).click();
    const dialog = page.getByRole("dialog", {name: "Edit Character"});
    await dialog.getByLabel("Name", {exact: true}).fill(name);
    const submit = () => dialog.getByRole("button", {name: "Save", exact: true}).click();
    if (account) await saveAction(page, submit);
    else await submit();
}

function lightRow(page) {
    return page.locator(".builder-equipment-table tbody tr").filter({
        has: page.getByRole("cell", {name: "Light", exact: true})
    });
}

async function equipLight(page, name, account = true) {
    await lightRow(page).locator('th[scope="row"] button').click();
    const picker = page.getByRole("dialog", {name: "Choose Item"});
    await picker.getByLabel("Search items").fill(name);
    const pick = () => picker.getByRole("button", {name, exact: true}).click();
    if (account) await saveAction(page, pick);
    else await pick();
    await expect(lightRow(page)).toContainText(name);
}

async function expectCharacter(page, {name, strength, item}) {
    await expect(page.getByLabel("Character", {exact: true}).locator("option:checked")).toHaveText(name);
    await expect(page.locator("#strInput")).toHaveValue(strength);
    await expect(lightRow(page)).toContainText(item);
}


async function namedDialog(page, title, name) {
    await button(page, title).click();
    const dialog = page.getByRole("dialog", {name: title, exact: true});
    await dialog.getByLabel("Name", {exact: true}).fill(name);
    await saveAction(page, () => dialog.getByRole("button", {name: title.startsWith("Add") ? "Add" : "Save", exact: true}).click());
    await expect(dialog).toHaveCount(0);
}

async function confirm(page, action, changesData = true) {
    await button(page, action).click();
    const submit = () => page.getByRole("dialog", {name: "Are you sure?"}).getByRole("button", {name: "Yes", exact: true}).click();
    if (changesData) await saveAction(page, submit);
    else await submit();
    await expect(page.getByRole("dialog")).toHaveCount(0);
}

async function exportLists(page) {
    await button(page, "Export").click();
    const payload = await page.locator("#allListsExport").inputValue();
    await page.getByRole("dialog", {name: "Export Lists"}).getByRole("button", {name: "Close", exact: true}).click();
    return payload;
}

async function importLists(page, payload) {
    await button(page, "Import").click();
    const dialog = page.getByRole("dialog", {name: "Import Lists"});
    await dialog.getByLabel("Builder list import string").fill(payload);
    await saveAction(page, () => dialog.getByRole("button", {name: "Import", exact: true}).click());
    await expect(dialog).toHaveCount(0);
}

async function freshLogin(newDevice, account) {
    const device = await newDevice();
    await signIn(device.page, account.username);
    return device;
}

module.exports = {button, saved, saveAction, profiles, signIn, renameCharacter, lightRow, equipLight,
    expectCharacter, namedDialog, confirm, exportLists, importLists, freshLogin};
