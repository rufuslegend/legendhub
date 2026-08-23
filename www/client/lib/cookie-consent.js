import {formatCookie} from "./cookies.js";

const LONG_LIVED_EXPIRY = new Date(2144232732000);

export function initializeCookieConsent(document = globalThis.document) {
    if (!document)
        return;

    for (const button of document.querySelectorAll("[data-cookie-consent]")) {
        button.addEventListener("click", function() {
            document.cookie = formatCookie("cookie-consent", "true", {
                expires: LONG_LIVED_EXPIRY
            });
            button.closest(".cookie-consent-banner")?.remove();
        });
    }
}
