"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

async function loadModule() {
    try {
        return await import("../../client/lib/notifications.js");
    }
    catch (error) {
        assert.fail(`native notifications module is unavailable: ${error.message}`);
    }
}

function createNotificationsDocument() {
    const listeners = new Map();
    const popover = {innerHTML: "<button data-mark-notifications-read>Mark all as read</button>"};
    const triggers = [{id: "not-pop-1"}, {id: "not-pop-2"}];
    const error = {hidden: true, textContent: ""};
    return {
        cookie: "loginToken=member-token",
        error,
        triggers,
        querySelector(selector) {
            if (selector === "#notification-window") return popover;
            if (selector === ".popover [data-notification-error]") return error;
            return null;
        },
        querySelectorAll(selector) {
            assert.equal(selector, "[data-notification-popover]");
            return triggers;
        },
        addEventListener(type, listener) { listeners.set(type, listener); },
        clickMarkRead() {
            let prevented = false;
            listeners.get("click")({
                preventDefault() { prevented = true; },
                target: {closest(selector) {
                    return selector === "[data-mark-notifications-read]" ? {} : null;
                }}
            });
            return prevented;
        }
    };
}

test("native notifications initialize the existing popovers and reload only after a successful mark-read mutation", async function() {
    const {initializeNotifications} = await loadModule();
    const document = createNotificationsDocument();
    const popoverCalls = [];
    const requestCalls = [];
    let reloads = 0;

    initializeNotifications({
        document,
        graphqlRequest: async function(request) {
            requestCalls.push(request);
            return {markNotificationAsRead: true};
        },
        jquery: function(trigger) {
            return {popover(options) { popoverCalls.push({options, trigger}); }};
        },
        reload: function() { reloads++; }
    });

    assert.equal(popoverCalls.length, 2);
    assert.equal(popoverCalls[0].options.trigger, "manual");
    assert.equal(popoverCalls[0].options.content, "<button data-mark-notifications-read>Mark all as read</button>");
    assert.equal(document.clickMarkRead(), true);
    await new Promise(setImmediate);
    assert.equal(requestCalls.length, 1);
    assert.match(requestCalls[0].query, /markNotificationAsRead/);
    assert.deepEqual(requestCalls[0].variables, {authToken: "member-token"});
    assert.equal(reloads, 1);
});

test("a failed mark-read mutation stays in the popover and announces the error", async function() {
    const {initializeNotifications} = await loadModule();
    const document = createNotificationsDocument();
    let reloads = 0;

    initializeNotifications({
        document,
        graphqlRequest: async function() { throw new Error("Unable to update notifications."); },
        jquery: function() { return {popover() {}}; },
        reload: function() { reloads++; }
    });

    document.clickMarkRead();
    await new Promise(setImmediate);
    assert.equal(reloads, 0);
    assert.equal(document.error.hidden, false);
    assert.equal(document.error.textContent, "Unable to update notifications.");
});

test("a false mark-read result stays in the popover without reloading", async function() {
    const {initializeNotifications} = await loadModule();
    const document = createNotificationsDocument();
    let reloads = 0;

    initializeNotifications({
        document,
        graphqlRequest: async function() { return {markNotificationAsRead: false}; },
        jquery: function() { return {popover() {}}; },
        reload: function() { reloads++; }
    });

    document.clickMarkRead();
    await new Promise(setImmediate);
    assert.equal(reloads, 0);
    assert.equal(document.error.hidden, false);
    assert.equal(document.error.textContent, "Unable to update notifications.");
});
