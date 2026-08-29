"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

async function loadModule() {
    try {
        return await import("../../client/lib/theme-menu.js");
    }
    catch (error) {
        assert.fail(`native theme menu module is unavailable: ${error.message}`);
    }
}

function createElement(attributes = {}) {
    const listeners = new Map();
    const values = new Map(Object.entries(attributes));
    const classes = new Set((attributes.class || "").split(" ").filter(Boolean));
    return {
        addEventListener(type, listener) { listeners.set(type, listener); },
        classList: {
            contains(name) { return classes.has(name); },
            toggle(name, enabled) {
                if (enabled) classes.add(name);
                else classes.delete(name);
            }
        },
        click() {
            let prevented = false;
            let stopped = false;
            listeners.get("click")?.({
                currentTarget: this,
                preventDefault() { prevented = true; },
                stopPropagation() { stopped = true; }
            });
            return {prevented, stopped};
        },
        getAttribute(name) { return values.get(name) ?? null; },
        hasAttribute(name) { return values.has(name); },
        removeAttribute(name) { values.delete(name); },
        setAttribute(name, value) { values.set(name, String(value)); },
        values
    };
}

function createThemeDocument(cookie = "") {
    const glassToggle = createElement({"aria-expanded": "false"});
    const glassChoices = createElement({hidden: ""});
    const caret = createElement({class: "fas ml-auto fa-caret-right"});
    const theme = createElement({href: "/css/bootstrap-glass-blue.min.css"});
    const glassBlue = createElement({"data-theme": "glass-blue"});
    const solarizedDark = createElement({"data-theme": "solarized-dark"});
    const document = {
        querySelector(selector) {
            return new Map([
                ["#glassThemeToggle", glassToggle],
                ["#glassThemeChoices", glassChoices],
                ["#glassThemeToggle .theme-menu-caret", caret],
                ["link#theme", theme]
            ]).get(selector) ?? null;
        },
        querySelectorAll(selector) {
            assert.equal(selector, "[data-theme]");
            return [glassBlue, solarizedDark];
        }
    };
    let cookieValue = cookie;
    Object.defineProperty(document, "cookie", {
        get() { return cookieValue; },
        set(value) {
            const name = value.slice(0, value.indexOf("="));
            cookieValue = cookieValue.split("; ").filter(function(segment) {
                return segment && !segment.startsWith(`${name}=`);
            }).concat(value).join("; ");
        }
    });
    return {document, glassBlue, glassChoices, glassToggle, caret, solarizedDark, theme};
}

test("native theme menu exposes Glass choices in focus order and preserves all theme selections", async function() {
    const {initializeThemeMenu} = await loadModule();
    const menu = createThemeDocument();

    initializeThemeMenu(menu.document);
    const toggleResult = menu.glassToggle.click();
    assert.equal(toggleResult.prevented, true);
    assert.equal(toggleResult.stopped, true);
    assert.equal(menu.glassToggle.getAttribute("aria-expanded"), "true");
    assert.equal(menu.glassChoices.hasAttribute("hidden"), false);
    assert.equal(menu.caret.classList.contains("fa-caret-down"), true);
    assert.equal(menu.caret.classList.contains("fa-caret-right"), false);

    menu.glassBlue.click();
    assert.equal(menu.theme.getAttribute("href"), "/css/bootstrap-glass-blue.min.css");
    menu.solarizedDark.click();
    assert.equal(menu.theme.getAttribute("href"), "/css/bootstrap-solarized-dark.min.css");
});

test("native theme menu sets tzoffset and persists a choice only after cookie consent", async function() {
    const {initializeThemeMenu} = await loadModule();
    const withoutConsent = createThemeDocument();
    const now = new Date("2026-08-22T12:00:00Z");

    initializeThemeMenu(withoutConsent.document, {now});
    assert.match(withoutConsent.document.cookie, new RegExp(
        `^tzoffset=${now.getTimezoneOffset()}; Path=/; SameSite=Lax; Secure; Expires=`
    ));
    withoutConsent.solarizedDark.click();
    assert.doesNotMatch(withoutConsent.document.cookie, /theme=solarized-dark/);

    const withConsent = createThemeDocument("cookie-consent=true");
    initializeThemeMenu(withConsent.document, {now});
    withConsent.solarizedDark.click();
    assert.match(withConsent.document.cookie, /theme=solarized-dark; Path=\/; SameSite=Lax; Secure; Expires=/);
});

// Catches an account theme choice being mirrored into the anonymous cookie or
// failing to patch the one shared account preference store.
test("native theme menu patches account storage without changing anonymous theme cookies", async function() {
    const {initializeThemeMenu} = await loadModule();
    const menu = createThemeDocument("cookie-consent=true; theme=light");
    const patches = [];
    const subscribers = [];
    const accountPreferencesStore = {
        get() { return {enabled: true, document: {theme: "dark"}}; },
        patch(value) { patches.push(value); },
        subscribe(listener) { subscribers.push(listener); return function() {}; }
    };

    initializeThemeMenu(menu.document, {
        now: new Date("2026-08-28T12:00:00.000Z"),
        accountPreferencesStore
    });
    menu.solarizedDark.click();

    assert.equal(menu.theme.getAttribute("href"), "/css/bootstrap-solarized-dark.min.css");
    assert.deepEqual(patches, [{theme: "solarized-dark"}]);
    assert.match(menu.document.cookie, /theme=light/);
    assert.doesNotMatch(menu.document.cookie, /theme=solarized-dark/);

    subscribers[0]({enabled: true, document: {theme: "high-contrast"}});
    assert.equal(menu.theme.getAttribute("href"), "/css/bootstrap-high-contrast.min.css");
});
