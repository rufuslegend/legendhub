import {formatCookie, parseCookieHeader} from "./cookies.js";

const CONSENT_COOKIE = "cookie-consent";
const THEME_COOKIE = "theme";
const TIMEZONE_COOKIE = "tzoffset";
const LONG_LIVED_EXPIRY = new Date(2144232732000);

function persistTheme(document, theme, now) {
    const cookies = parseCookieHeader(document.cookie);
    if (!cookies[CONSENT_COOKIE])
        return;

    const expires = new Date(now);
    expires.setFullYear(expires.getFullYear() + 20);
    document.cookie = formatCookie(THEME_COOKIE, theme, {expires});
}

function applyThemeStylesheet(themeLink, theme) {
    const current = themeLink.getAttribute("href") || "";
    const suffix = current.match(/[?#].*$/)?.[0] || "";
    const next = `/css/bootstrap-${theme}.min.css${suffix}`;
    if (current !== next)
        themeLink.setAttribute("href", next);
}

function setGlassChoicesOpen({glassChoices, glassToggle, caret}, open) {
    glassToggle.setAttribute("aria-expanded", String(open));
    if (open)
        glassChoices.removeAttribute("hidden");
    else
        glassChoices.setAttribute("hidden", "");
    caret.classList.toggle("fa-caret-down", open);
    caret.classList.toggle("fa-caret-right", !open);
}

export function initializeThemeMenu(document = globalThis.document, {
    now = new Date(),
    accountPreferencesStore = null
} = {}) {
    const glassToggle = document?.querySelector("#glassThemeToggle");
    const glassChoices = document?.querySelector("#glassThemeChoices");
    const caret = document?.querySelector("#glassThemeToggle .theme-menu-caret");
    const themeLink = document?.querySelector("link#theme");
    if (!glassToggle || !glassChoices || !caret || !themeLink)
        return;

    const menu = {glassChoices, glassToggle, caret};
    setGlassChoicesOpen(menu, false);
    const accountPreferences = accountPreferencesStore?.get?.();
    if (accountPreferences?.account && accountPreferences.document?.theme)
        applyThemeStylesheet(themeLink, accountPreferences.document.theme);
    document.cookie = formatCookie(
        TIMEZONE_COOKIE,
        String(now.getTimezoneOffset()),
        {expires: LONG_LIVED_EXPIRY}
    );

    glassToggle.addEventListener("click", function(event) {
        event.preventDefault();
        event.stopPropagation();
        setGlassChoicesOpen(menu, glassToggle.getAttribute("aria-expanded") !== "true");
    });

    for (const choice of document.querySelectorAll("[data-theme]")) {
        choice.addEventListener("click", function(event) {
            event.preventDefault();
            const theme = choice.getAttribute("data-theme");
            applyThemeStylesheet(themeLink, theme);
            const preferences = accountPreferencesStore?.get?.();
            if (preferences?.account) {
                if (preferences.enabled)
                    accountPreferencesStore.patch({theme});
            }
            else {
                persistTheme(document, theme, now);
            }
        });
    }

    return accountPreferencesStore?.subscribe?.(function(value) {
        if (value?.account && value.document?.theme)
            applyThemeStylesheet(themeLink, value.document.theme);
    });
}
