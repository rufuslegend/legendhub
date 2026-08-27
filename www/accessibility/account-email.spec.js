"use strict";

const Module = require("node:module");
const AxeBuilder = require("@axe-core/playwright").default;
const {expect, test} = require("@playwright/test");
const fulfillLocalBrowserScript = require("./support/local-browser-scripts");

const notificationSettings = {
    itemAdded: true,
    itemUpdated: false,
    mobAdded: false,
    mobUpdated: true,
    questAdded: true,
    questUpdated: false,
    wikiPageAdded: false,
    wikiPageUpdated: true,
    changelogAdded: true
};

let baseUrl;
let emailVerified;
let restoreDependencies;
let server;

function loadAppWithAccountJourneys() {
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (request === "sync-rpc")
            return function() { return function() { return []; }; };
        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        const authApi = require("../src/routes/api/auth");
        const apiUtils = require("../src/routes/api/utils");
        const originals = {
            authToken: authApi.utils.authToken,
            getPermissions: authApi.utils.getPermissions,
            logout: authApi.utils.logout,
            postAsync: apiUtils.postAsync
        };

        authApi.utils.authToken = async function() {
            return {
                memberId: 7,
                username: "Account Tester",
                email: "current@example.test",
                emailVerified,
                pendingEmail: null,
                storageNamespace: "0123456789abcdef0123456789abcdef"
            };
        };
        authApi.utils.getPermissions = async function() { return {}; };
        authApi.utils.logout = function() {};
        apiUtils.postAsync = async function(query) {
            if (query.includes("authLogin"))
                return {authLogin: {token: "signed-in-session", expires: null}};
            if (query.includes("getNotifications(")) {
                return {getNotifications: {moreResults: false, results: []}};
            }
            if (query.includes("getNotificationSettings")) {
                return {
                    getNotificationSettings: notificationSettings,
                    getAccountEmailStatus: {
                        email: "current@example.test",
                        verified: emailVerified,
                        pendingEmail: null,
                        canUseAccountStorage: emailVerified
                    }
                };
            }
            throw new Error("No account-email accessibility fixture matches the GraphQL query.");
        };

        restoreDependencies = function() {
            authApi.utils.authToken = originals.authToken;
            authApi.utils.getPermissions = originals.getPermissions;
            authApi.utils.logout = originals.logout;
            apiUtils.postAsync = originals.postAsync;
        };

        return require("../src/create-app")({
            logging: false,
            accountEmailService: {
                async verifyEmailToken() {
                    emailVerified = true;
                    return {success: true, message: "Your email address has been verified."};
                }
            },
            passwordRecoveryService: {
                async requestRecovery() { return {accepted: true}; },
                async resetPassword() { return {success: true}; }
            }
        });
    }
    finally {
        Module._load = originalLoad;
    }
}

test.beforeAll(async function() {
    const app = loadAppWithAccountJourneys();
    server = await new Promise(function(resolve) {
        const listeningServer = app.listen(0, "127.0.0.1", function() {
            resolve(listeningServer);
        });
    });
    baseUrl = `http://localhost:${server.address().port}`;
});

test.afterAll(async function() {
    if (restoreDependencies)
        restoreDependencies();
    if (!server)
        return;
    await new Promise(function(resolve, reject) {
        server.close(function(error) { return error ? reject(error) : resolve(); });
    });
});

test.beforeEach(async function({context, page}) {
    emailVerified = false;
    await context.addCookies([{name: "loginToken", value: "initial-session", url: baseUrl}]);
    await page.route(/^https?:\/\//, function(route) {
        if (route.request().url().startsWith(baseUrl))
            return route.continue();
        return fulfillLocalBrowserScript(route);
    });
});

async function expectNoAxeViolations(page, selector = "main") {
    const results = await new AxeBuilder({page})
        .include(selector)
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"])
        .analyze();
    expect(results.violations).toEqual([]);
}

test("email prompt dismissal resets on login and email settings announce both resend states", async function({context, page}) {
    await page.goto(`${baseUrl}/`);
    const prompt = page.getByRole("status", {name: "Verify your email address"});
    await expect(prompt).toContainText("Existing LegendHUB features remain available");
    await expect(prompt.getByRole("link", {name: "Enter and verify your email address now"}))
        .toBeVisible();

    const dismiss = prompt.getByRole("button", {name: "Dismiss for this login"});
    await dismiss.focus();
    await expect(dismiss).toBeFocused();
    await Promise.all([
        page.waitForResponse(response =>
            response.url() === `${baseUrl}/dismiss-email-prompt` &&
            response.request().method() === "POST"),
        page.keyboard.press("Enter")
    ]);
    await expect(page.getByRole("status", {name: "Verify your email address"})).toHaveCount(0);
    const dismissal = (await context.cookies(baseUrl))
        .find(cookie => cookie.name === "emailPromptDismissed");
    expect(dismissal).toMatchObject({httpOnly: true, secure: true, sameSite: "Lax"});
    expect(dismissal.expires).toBe(-1);

    await page.getByRole("button", {name: "Account Tester"}).click();
    await Promise.all([
        page.waitForResponse(response =>
            response.url() === `${baseUrl}/logout.html` &&
            response.request().method() === "POST"),
        page.getByRole("button", {name: "Logout"}).click()
    ]);
    expect((await context.cookies(baseUrl)).some(cookie =>
        cookie.name === "emailPromptDismissed")).toBe(false);

    await page.goto(`${baseUrl}/login.html`);
    const loginForm = page.locator('form[name="login"]');
    await loginForm.getByLabel("Username or email").fill("Account Tester");
    await loginForm.getByLabel("Password", {exact: true}).fill("test-password");
    await Promise.all([
        page.waitForURL(`${baseUrl}/`),
        loginForm.locator('button[type="submit"]').click()
    ]);
    await expect(page.getByRole("status", {name: "Verify your email address"})).toBeVisible();

    await page.getByRole("link", {name: "Enter and verify your email address now"}).click();
    await expect(page.getByRole("heading", {name: "Account Settings"})).toBeVisible();

    let releaseResend;
    await page.route(`${baseUrl}/api`, async function(route) {
        const body = route.request().postDataJSON();
        if (body.query.includes("ResendVerification")) {
            await new Promise(resolve => { releaseResend = resolve; });
            return route.fulfill({
                contentType: "application/json",
                body: JSON.stringify({data: {resendVerification: {
                    accepted: true,
                    tokenRenewal: {token: "resend-session", expires: null}
                }}})
            });
        }
        if (body.query.includes("RequestEmailChange")) {
            return route.fulfill({
                contentType: "application/json",
                body: JSON.stringify({data: {requestEmailChange: {
                    success: true,
                    pendingEmail: "replacement@example.test",
                    tokenRenewal: {token: "change-session", expires: null}
                }}})
            });
        }
        return route.abort();
    });

    await page.getByRole("button", {name: "Resend email verification"}).click();
    const resendStatus = page.getByRole("status", {name: "Resending email verification"});
    await expect(resendStatus).toBeFocused();
    releaseResend();
    const activeAddressStatus = page.getByRole("status").filter({
        hasText: "Your current address remains unverified until you use the link."
    });
    await expect(activeAddressStatus).toBeVisible();
    await expect(activeAddressStatus).not.toContainText("new address remains pending");

    await page.getByRole("button", {name: "Change email address"}).click();
    const emailInput = page.getByRole("textbox", {name: "Email address", exact: true});
    await expect(emailInput).toBeFocused();
    await emailInput.fill("replacement@example.test");
    await page.getByLabel("Current Password", {exact: true}).fill("test-password");
    await page.getByRole("button", {name: "Save email address"}).click();
    await expect(page.getByRole("button", {name: "Change email address"})).toBeFocused();
    await expect(page.getByRole("status").filter({
        hasText: "The pending address remains inactive until verified."
    })).toBeVisible();
    await expectNoAxeViolations(page, '[data-react-root="account-settings"]');
});

test("email verification confirmation is keyboard operable and exposes a status result", async function({page}) {
    await page.goto(`${baseUrl}/verify-email.html?token=test-selector-test-validator`);
    const verifyButton = page.getByRole("button", {name: "Verify email"});
    await expect(verifyButton).toBeFocused();
    await expectNoAxeViolations(page);

    await Promise.all([
        page.waitForURL(`${baseUrl}/verify-email.html`),
        page.keyboard.press("Enter")
    ]);
    await expect(page.getByRole("heading", {name: "Email Verified"})).toBeVisible();
    await expect(page.getByRole("status").filter({
        hasText: "Your email address has been verified."
    })).toHaveText("Your email address has been verified.");
    await expectNoAxeViolations(page);

    await page.goto(`${baseUrl}/`);
    await expect(page.getByRole("status", {name: "Verify your email address"})).toHaveCount(0);
});

test("password recovery forms focus their first field and announce generic and reset results", async function({page}) {
    await page.goto(`${baseUrl}/forgot-password.html`);
    const identity = page.getByLabel("Username or email");
    await expect(identity).toBeFocused();
    await identity.fill("Account Tester");
    await Promise.all([
        page.waitForURL(`${baseUrl}/forgot-password.html`),
        page.keyboard.press("Enter")
    ]);
    const genericRecoveryStatus = page.getByRole("status").filter({
        hasText: "If that account has a verified email address"
    });
    await expect(genericRecoveryStatus).toHaveText(
        "If that account has a verified email address, password reset instructions have been sent."
    );
    await expectNoAxeViolations(page);

    await page.goto(`${baseUrl}/reset-password.html?token=test-selector-test-validator`);
    await expect(page.getByLabel("New password", {exact: true})).toBeFocused();
    await page.getByLabel("New password", {exact: true}).fill("replacement-password");
    await page.getByLabel("Confirm new password", {exact: true}).fill("different-password");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status").filter({hasText: "Passwords must match."}))
        .toHaveText("Passwords must match.");
    await expect(page.getByLabel("New password", {exact: true})).toBeFocused();

    await page.getByLabel("New password", {exact: true}).fill("replacement-password");
    await page.getByLabel("Confirm new password", {exact: true}).fill("replacement-password");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status").filter({
        hasText: "Your password has been changed. Sign in again to continue."
    })).toHaveText("Your password has been changed. Sign in again to continue.");
    await expect(page.getByRole("link", {name: "Sign in"})).toBeVisible();
    await expectNoAxeViolations(page);
});
