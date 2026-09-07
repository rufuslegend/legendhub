"use strict";

const {test, expect} = require("./support/fixtures");
const {signIn, renameCharacter, profiles, freshLogin} = require("./support/builder");

test("an incorrect password creates no authenticated session and cannot open account settings", async ({newDevice, account, stack}) => {
    const {page, context} = await newDevice();
    await page.goto("/login.html");
    await page.getByLabel("Username or email", {exact: true}).fill(account.username);
    await page.locator("#login_password").fill("incorrect-password");
    await page.locator('form[name="login"] button[type="submit"]').click();
    await expect(page.getByText("Invalid username or password.", {exact: true})).toBeVisible();
    expect((await context.cookies()).some(cookie => cookie.name === "loginToken")).toBe(false);
    await page.goto("/account/");
    await expect(page).toHaveURL(/\/login\.html\?returnUrl=/);
    expect(await stack.query("SELECT Id FROM AuthTokens WHERE MemberId = ?", [account.id])).toEqual([]);
});

test("verified email login reaches the same saved characters as username login", async ({signedIn: {page}, account, newDevice}) => {
    await renameCharacter(page, "Email Hero");
    const fresh = await newDevice();
    await signIn(fresh.page, account.email.toUpperCase());
    await expect(fresh.page.getByLabel("Character", {exact: true}).locator("option")).toHaveText(["Email Hero"]);
    await expect(fresh.page.getByRole("button", {name: account.username, exact: true})).toBeVisible();
});

test("an expired session cannot access account settings and a fresh login restores saved data", async ({signedIn: {page}, account, stack, newDevice}) => {
    await renameCharacter(page, "Session Hero");
    const before = await profiles(stack, account.id);
    await stack.query("UPDATE AuthTokens SET Expires = DATE_SUB(NOW(), INTERVAL 1 DAY) WHERE MemberId = ?", [account.id]);
    await page.goto("/account/");
    await expect(page).toHaveURL(/\/login\.html\?returnUrl=/);
    const fresh = await freshLogin(newDevice, account);
    await expect(fresh.page.getByLabel("Character", {exact: true}).locator("option")).toHaveText(["Session Hero"]);
    expect(await profiles(stack, account.id)).toEqual(before);
});
