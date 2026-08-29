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
let builderStorageState;
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
                    },
                    ...(query.includes("getBuilderAccountState") && emailVerified
                        ? {getBuilderAccountState: builderStorageState}
                        : {})
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
    builderStorageState = {
        profiles: [{
            id: "profile-1",
            name: "Hero",
            payload: "6*private-builder-payload*",
            payloadVersion: 6,
            payloadBytes: 4096,
            revision: 4,
            createdOn: "2026-08-26T00:00:00.000Z",
            updatedOn: "2026-08-28T00:00:00.000Z",
            deletedOn: null
        }],
        preferences: "{\"privatePreference\":\"must-not-render\"}",
        preferenceRevision: 3,
        preferencesUpdatedOn: "2026-08-28T00:00:00.000Z",
        storageGeneration: 7,
        usedBytes: 4096,
        quotaBytes: 10_485_760,
        memberId: 7,
        storageNamespace: "private-storage-namespace"
    };
    await context.addCookies([{name: "loginToken", value: "initial-session", url: baseUrl}]);
    await page.route(/^https?:\/\//, function(route) {
        if (route.request().url().startsWith(baseUrl))
            return route.continue();
        return fulfillLocalBrowserScript(route);
    });
});

// Catches stale-prop export, destructive action without a second explicit
// confirmation, payload retention, broken modal focus, generation omission,
// or delete-all modifying this browser's anonymous source/acknowledgement.
test("Builder storage exports fresh data and separately confirms generation-safe deletion", async function({context, page}) {
    emailVerified = true;
    await context.addCookies([{
        name: "anonymous-builder-preference",
        value: "keep-cookie",
        url: baseUrl
    }]);
    await page.addInitScript(function() {
        localStorage.setItem("cln", "6*Anonymous~Original~keep-local*");
        localStorage.setItem(
            "legendhub-builder-import:private-storage-namespace",
            "a".repeat(64)
        );
        window.__builderDownloadEvents = [];
        window.URL.createObjectURL = function(blob) {
            window.__builderDownloadEvents.push({
                type: "create",
                blobType: blob.type,
                size: blob.size
            });
            return "blob:builder-export";
        };
        window.URL.revokeObjectURL = function(value) {
            window.__builderDownloadEvents.push({type: "revoke", value});
        };
        const click = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function() {
            if (this.download) {
                window.__builderDownloadEvents.push({
                    type: "click",
                    download: this.download,
                    href: this.href
                });
                return;
            }
            return click.call(this);
        };
    });

    let deleteCalls = 0;
    let exportCalls = 0;
    let releaseDelete;
    const requestBodies = [];
    await page.route(`${baseUrl}/api`, async function(route) {
        const body = route.request().postDataJSON();
        requestBodies.push(body);
        if (body.query.includes("ExportBuilderData")) {
            exportCalls += 1;
            return route.fulfill({
                contentType: "application/json",
                body: JSON.stringify({data: {
                    exportBuilderData: "6*Fresh~Original~protected-current*"
                }})
            });
        }
        if (body.query.includes("DeleteAllBuilderData")) {
            deleteCalls += 1;
            await new Promise(resolve => { releaseDelete = resolve; });
            return route.fulfill({
                contentType: "application/json",
                body: JSON.stringify({data: {deleteAllBuilderData: {
                    status: "deleted",
                    storageGeneration: 8,
                    usedBytes: 0,
                    quotaBytes: 10_485_760
                }}})
            });
        }
        return route.abort();
    });

    await page.goto(`${baseUrl}/account/`);
    const propsText = await page.locator('[data-react-props="account-settings"]')
        .textContent();
    const props = JSON.parse(propsText);
    expect(props.builderStorage).toEqual({
        enabled: true,
        profiles: [{
            id: "profile-1",
            name: "Hero",
            revision: 4,
            updatedOn: "2026-08-28T00:00:00.000Z"
        }],
        usedBytes: 4096,
        quotaBytes: 10_485_760,
        storageGeneration: 7
    });
    for (const privateValue of [
        "private-builder-payload", "privatePreference", "memberId",
        "private-storage-namespace", "initial-session"
    ])
        expect(propsText).not.toContain(privateValue);

    await expect(page.getByRole("heading", {name: "Builder storage"})).toBeVisible();
    await expect(page.getByText("4 KB of 10 MB used", {exact: true})).toBeVisible();
    await page.getByRole("button", {name: "Export all Builder data"}).click();
    await expect.poll(() => exportCalls).toBe(1);
    expect(await page.evaluate(() => window.__builderDownloadEvents)).toEqual([
        {type: "create", blobType: "text/plain;charset=utf-8", size: 35},
        {
            type: "click",
            download: expect.stringMatching(/^legendhub-builder-\d{4}-\d{2}-\d{2}\.txt$/),
            href: "blob:builder-export"
        },
        {type: "revoke", value: "blob:builder-export"}
    ]);
    await expect(page.locator("body")).not.toContainText("protected-current");

    const deleteTrigger = page.getByRole("button", {
        name: "Delete all synced Builder data",
        exact: true
    });
    await deleteTrigger.click();
    expect(deleteCalls).toBe(0);
    let dialog = page.getByRole("dialog", {name: "Delete all synced Builder data"});
    await expect(dialog.getByRole("button", {name: "Cancel deletion"})).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(deleteTrigger).toBeFocused();

    await deleteTrigger.click();
    dialog = page.getByRole("dialog", {name: "Delete all synced Builder data"});
    await dialog.getByRole("button", {
        name: "Permanently delete synced Builder data"
    }).click();
    await expect.poll(() => deleteCalls).toBe(1);
    await expect(dialog.getByRole("button", {
        name: "Permanently deleting synced Builder data"
    })).toBeDisabled();
    await expect(dialog.getByRole("button", {name: "Cancel deletion"})).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    releaseDelete();

    await expect(dialog).toHaveCount(0);
    await expect(deleteTrigger).toBeFocused();
    await expect(page.getByRole("status").filter({
        hasText: "All synced Builder data was deleted."
    })).toBeVisible();
    await expect(page.getByText("0 B of 10 MB used", {exact: true})).toBeVisible();
    await expect(page.getByText("Storage version: 8", {exact: true})).toBeVisible();
    await expect(page.getByText("0 synced Builder profiles", {exact: true})).toBeVisible();

    const deleteBody = requestBodies.find(body => body.query.includes("DeleteAllBuilderData"));
    expect(deleteBody.variables).toEqual({
        authToken: "initial-session",
        storageGeneration: 7
    });
    expect(await page.evaluate(function() {
        return {
            lists: localStorage.getItem("cln"),
            acknowledgement: localStorage.getItem(
                "legendhub-builder-import:private-storage-namespace"
            )
        };
    })).toEqual({
        lists: "6*Anonymous~Original~keep-local*",
        acknowledgement: "a".repeat(64)
    });
    const anonymousCookie = (await context.cookies(baseUrl)).find(
        cookie => cookie.name === "anonymous-builder-preference"
    );
    expect(anonymousCookie?.value).toBe("keep-cookie");
    await expectNoAxeViolations(page, '[data-react-root="account-settings"]');
});

// Catches optimistic deletion or raw server diagnostics reaching the dialog;
// the account snapshot and independent export recovery must remain available.
test("Builder storage delete failure retains data and focuses a fixed safe error", async function({page}) {
    emailVerified = true;
    let exportCalls = 0;
    let deleteCalls = 0;
    await page.route(`${baseUrl}/api`, async function(route) {
        const body = route.request().postDataJSON();
        if (body.query.includes("DeleteAllBuilderData")) {
            deleteCalls += 1;
            return route.fulfill({
                contentType: "application/json",
                body: JSON.stringify({
                    data: {deleteAllBuilderData: null},
                    errors: [{
                        message: "private database diagnostic 6*secret-payload*",
                        code: 500
                    }]
                })
            });
        }
        if (body.query.includes("ExportBuilderData")) {
            exportCalls += 1;
            return route.fulfill({
                contentType: "application/json",
                body: JSON.stringify({data: {exportBuilderData: "6*Recovery*"}})
            });
        }
        return route.abort();
    });

    await page.goto(`${baseUrl}/account/`);
    const deleteTrigger = page.getByRole("button", {
        name: "Delete all synced Builder data",
        exact: true
    });
    await deleteTrigger.click();
    const dialog = page.getByRole("dialog", {name: "Delete all synced Builder data"});
    expect(deleteCalls).toBe(0);
    await dialog.getByRole("button", {
        name: "Permanently delete synced Builder data"
    }).click();

    const error = dialog.getByRole("alert");
    await expect(error).toBeFocused();
    await expect(error).toHaveText(
        "Synced Builder data could not be deleted. Nothing was removed. Try again."
    );
    await expect(dialog).not.toContainText("private database diagnostic");
    await expect(page.getByText("4 KB of 10 MB used", {exact: true})).toBeAttached();
    await expect(page.getByText("1 synced Builder profile", {exact: true})).toBeAttached();

    await dialog.getByRole("button", {name: "Cancel deletion"}).click();
    await expect(deleteTrigger).toBeFocused();
    await page.getByRole("button", {name: "Export all Builder data"}).click();
    await expect.poll(() => exportCalls).toBe(1);
    expect(deleteCalls).toBe(1);
    await expectNoAxeViolations(page, '[data-react-root="account-settings"]');
});

// Catches export failure leaking diagnostics, triggering deletion, or leaving
// the destructive confirmation inaccessible. Anonymous/unverified contexts
// must expose neither protected metadata nor controls.
test("Builder storage failures stay independent and unverified accounts expose no controls", async function({page}) {
    await page.goto(`${baseUrl}/account/`);
    const props = JSON.parse(await page.locator(
        '[data-react-props="account-settings"]'
    ).textContent());
    expect(props.builderStorage).toEqual({
        enabled: false,
        profiles: [],
        usedBytes: 0,
        quotaBytes: 0,
        storageGeneration: 0
    });
    await expect(page.getByRole("heading", {name: "Builder storage"})).toHaveCount(0);
    await expect(page.getByRole("button", {name: "Export all Builder data"})).toHaveCount(0);
    await expect(page.getByRole("button", {
        name: "Delete all synced Builder data",
        exact: true
    })).toHaveCount(0);

    emailVerified = true;
    let deleteCalls = 0;
    await page.route(`${baseUrl}/api`, async function(route) {
        const body = route.request().postDataJSON();
        if (body.query.includes("ExportBuilderData")) {
            return route.fulfill({
                contentType: "application/json",
                body: JSON.stringify({
                    data: {exportBuilderData: null},
                    errors: [{message: "private export diagnostic 6*secret*"}]
                })
            });
        }
        if (body.query.includes("DeleteAllBuilderData")) {
            deleteCalls += 1;
            return route.abort();
        }
        return route.abort();
    });
    await page.reload();
    await page.getByRole("button", {name: "Export all Builder data"}).click();
    const error = page.getByRole("alert").filter({
        hasText: "Builder data could not be exported. Try again."
    });
    await expect(error).toBeFocused();
    await expect(page.locator('[data-react-root="account-settings"]'))
        .not.toContainText("private export diagnostic");
    expect(deleteCalls).toBe(0);

    await page.getByRole("button", {
        name: "Delete all synced Builder data",
        exact: true
    }).click();
    await expect(page.getByRole("dialog", {
        name: "Delete all synced Builder data"
    })).toBeVisible();
    expect(deleteCalls).toBe(0);
    await expectNoAxeViolations(page, '[data-react-root="account-settings"]');
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
    await expect(page.getByRole("status").filter({
        hasText: /You can resend verification in \d+ seconds\./
    })).toBeVisible();
    await expect(page.getByRole("button", {
        name: /Resend email verification in \d+ seconds/
    })).toBeDisabled();

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

test("rate-limited resend starts an accessible cooldown instead of a generic error", async function({page}) {
    await page.route(`${baseUrl}/api`, async function(route) {
        const body = route.request().postDataJSON();
        if (!body.query.includes("ResendVerification"))
            return route.abort();
        return route.fulfill({
            contentType: "application/json",
            body: JSON.stringify({
                data: {resendVerification: null},
                errors: [{
                    message: "Try again later.",
                    path: ["resendVerification"],
                    code: 429
                }]
            })
        });
    });

    await page.goto(`${baseUrl}/account/`);
    await page.getByRole("button", {name: "Resend email verification"}).click();

    const cooldown = page.getByRole("status").filter({
        hasText: /The resend limit was reached\. You can resend verification in \d+ seconds\./
    });
    await expect(cooldown).toBeVisible();
    await expect(page.getByRole("button", {
        name: /Resend email verification in \d+ seconds/
    })).toBeDisabled();
    await expect(page.getByRole("alert").filter({
        hasText: "Email settings could not be saved"
    })).toHaveCount(0);
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
