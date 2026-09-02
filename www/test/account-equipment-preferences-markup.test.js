"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const {renderToStaticMarkup} = require("react-dom/server");

const root = path.resolve(__dirname, "..");

async function renderAccountPreferences(document, initialState = null) {
    const {createServer} = await import("vite");
    const vite = await createServer({
        appType: "custom",
        root,
        server: {hmr: false, middlewareMode: true, ws: false}
    });
    try {
        const storeModule = await vite.ssrLoadModule(
            "/client/lib/account-preferences-store.js"
        );
        const store = storeModule.createAccountPreferencesStore({
            initialState: initialState || {
                enabled: true,
                payload: document,
                revision: 2,
                storageGeneration: 1
            }
        });
        storeModule.setPageAccountPreferencesStore(store);
        const {default: AccountSettings} = await vite.ssrLoadModule(
            "/client/features/account/AccountSettings.jsx"
        );
        return renderToStaticMarkup(React.createElement(AccountSettings, {
            notificationSettings: {},
            emailStatus: {
                email: "player@example.test",
                verified: true,
                pendingEmail: null,
                canUseAccountStorage: true
            },
            builderStorage: {enabled: false}
        }));
    }
    finally {
        await vite.close();
    }
}

// Catches the Account page omitting either equipment preference or displaying
// defaults instead of the values saved in the account preference document.
test("Account exposes saved equipment display preferences in their own subsection", async function() {
    const markup = await renderAccountPreferences({
        version: 1,
        theme: "dark",
        itemsPerPage: 20,
        itemPreviews: false,
        hideEquipmentZeros: true,
        itemColumns: [],
        builderColumns: {},
        selectedProfileId: null,
        selectedVariant: null
    });

    assert.match(markup, /<h2[^>]*id="preferences-heading"[^>]*>Preferences<\/h2>/);
    assert.match(markup, /<label[^>]*for="itemPreviewsInput"[^>]*>Pop-up stat windows<\/label>/);
    assert.match(markup, /<select[^>]*id="itemPreviewsInput"[^>]*>.*<option value="false" selected="">Off<\/option>/s);
    assert.match(markup, /<label[^>]*for="hideEquipmentZerosInput"[^>]*>Hide zeros in equipment tables<\/label>/);
    assert.match(markup, /<select[^>]*id="hideEquipmentZerosInput"[^>]*>.*<option value="true" selected="">On<\/option>/s);
});

// Catches a failed account-preference bootstrap telling an already verified
// player to verify their email address again.
test("Account distinguishes unavailable preferences from unverified account storage", async function() {
    const markup = await renderAccountPreferences({}, {
        enabled: false,
        payload: {}
    });

    assert.match(markup, /Account preferences are temporarily unavailable\./);
    assert.doesNotMatch(markup, /Verify your email address to save account preferences\./);
});
