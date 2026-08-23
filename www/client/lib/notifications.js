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
    if (content && jquery) {
        for (const trigger of document.querySelectorAll("[data-notification-popover]")) {
            jquery(trigger).popover({
                container: "header",
                content: content.innerHTML,
                html: true,
                trigger: "focus",
                placement: "bottom",
                sanitize: false
            });
        }
    }

    document.addEventListener("click", async function(event) {
        const button = event.target.closest("[data-mark-notifications-read]");
        if (!button)
            return;

        event.preventDefault();
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
            announceError(document, event.target, error);
        }
    });
}
