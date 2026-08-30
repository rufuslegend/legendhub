import {initializeCookieConsent} from "../lib/cookie-consent.js";
import {initializeEmailVerificationPrompt} from "../lib/email-verification-prompt.js";
import {initializeNotifications} from "../lib/notifications.js";
import {initializeResponsiveCategoryLists} from "../lib/responsive-category-list.js";
import {initializeThemeMenu} from "../lib/theme-menu.js";
import {
    createAccountPreferencesStore,
    readAccountPreferenceContext,
    renderAccountPreferenceStatus,
    setPageAccountPreferencesStore
} from "../lib/account-preferences-store.js";
import {updateAccountPreferences} from "../features/builder/builder-account-api.js";

const accountPreferencesStore = createAccountPreferencesStore({
    initialState: readAccountPreferenceContext(),
    save: request => updateAccountPreferences({
        preferences: JSON.stringify(request.document),
        storageGeneration: request.storageGeneration
    }),
    onStatus: detail => {
        renderAccountPreferenceStatus(document, detail);
        document.dispatchEvent(new CustomEvent(
            "legendhub:account-preferences-status",
            {detail}
        ));
    }
});
setPageAccountPreferencesStore(accountPreferencesStore);

initializeThemeMenu(document, {accountPreferencesStore});
initializeEmailVerificationPrompt();
initializeNotifications();
initializeCookieConsent();
initializeResponsiveCategoryLists();

window.addEventListener("pagehide", function(event) {
    if (!event.persisted)
        accountPreferencesStore.dispose();
});
