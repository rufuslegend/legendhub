import DOMPurify from "dompurify";
import {parseCookieHeader} from "./cookies.js";
import {graphqlRequest as defaultGraphqlRequest} from "./graphql-request.js";

const markNotificationsReadMutation = `
    mutation MarkNotificationAsRead($authToken: String!) {
        markNotificationAsRead(authToken: $authToken)
    }
`;

function notificationError(document, target) {
    const popover = target.closest(".popover");
    return popover?.querySelector("[data-notification-error]")
        || document.querySelector(".popover [data-notification-error]");
}

function announceError(document, target, error) {
    const element = notificationError(document, target);
    if (!element)
        return;

    element.textContent = error?.message || "Unable to update notifications.";
    element.hidden = false;
}

export function initializeNotifications({
    document = globalThis.document,
    graphqlRequest = defaultGraphqlRequest,
    jquery = globalThis.jQuery || globalThis.$,
    reload = function() { globalThis.location.reload(); }
} = {}) {
    if (!document)
        return;

    const content = document.querySelector("#notification-window");
    let activeTrigger;
    let markingNotifications = false;

    function hidePopover() {
        if (!activeTrigger)
            return;
        jquery(activeTrigger).popover("hide");
        activeTrigger = undefined;
    }

    function togglePopover(trigger) {
        if (activeTrigger === trigger) {
            hidePopover();
            return;
        }
        hidePopover();
        jquery(trigger).popover("show");
        activeTrigger = trigger;
    }

    if (content && jquery) {
        for (const trigger of document.querySelectorAll("[data-notification-popover]")) {
            jquery(trigger).popover({
                container: "header",
                content: content.innerHTML,
                html: true,
                trigger: "manual",
                placement: "bottom",
                sanitize: true,
                sanitizeFn: value => DOMPurify.sanitize(value)
            });
        }
    }

    document.addEventListener("click", async function(event) {
        const trigger = event.target.closest("[data-notification-popover]");
        if (trigger && jquery) {
            event.preventDefault();
            togglePopover(trigger);
            return;
        }

        const button = event.target.closest("[data-mark-notifications-read]");
        if (!button) {
            if (!event.target.closest(".popover"))
                hidePopover();
            return;
        }

        event.preventDefault();
        if (markingNotifications)
            return;

        markingNotifications = true;
        button.disabled = true;
        button.setAttribute("aria-busy", "true");
        try {
            const data = await graphqlRequest({
                query: markNotificationsReadMutation,
                variables: {authToken: parseCookieHeader(document.cookie).loginToken}
            });
            if (!data.markNotificationAsRead)
                throw new Error("Unable to update notifications.");
            reload();
        }
        catch (error) {
            announceError(document, button, error);
        }
        finally {
            markingNotifications = false;
            button.disabled = false;
            button.setAttribute("aria-busy", "false");
        }
    });
}
