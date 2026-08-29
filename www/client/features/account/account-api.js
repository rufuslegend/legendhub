import {formatCookie, parseCookieHeader} from "../../lib/cookies.js";
import {graphqlRequest} from "../../lib/graphql-request.js";

export {
    deleteAllAccountBuilderData,
    exportAccountBuilderData
} from "../builder/builder-account-api.js";

export const NOTIFICATION_FIELDS = [
    "itemAdded",
    "itemUpdated",
    "mobAdded",
    "mobUpdated",
    "questAdded",
    "questUpdated",
    "wikiPageAdded",
    "wikiPageUpdated",
    "changelogAdded"
];

export const EDITABLE_NOTIFICATION_FIELDS = NOTIFICATION_FIELDS.slice(0, 8);

const updateNotificationSettingsMutation = `
    mutation UpdateNotificationSettings(
        $authToken: String!
        $itemAdded: Boolean!
        $itemUpdated: Boolean!
        $mobAdded: Boolean!
        $mobUpdated: Boolean!
        $questAdded: Boolean!
        $questUpdated: Boolean!
        $wikiPageAdded: Boolean!
        $wikiPageUpdated: Boolean!
    ) {
        updateNotificationSettings(
            authToken: $authToken
            itemAdded: $itemAdded
            itemUpdated: $itemUpdated
            mobAdded: $mobAdded
            mobUpdated: $mobUpdated
            questAdded: $questAdded
            questUpdated: $questUpdated
            wikiPageAdded: $wikiPageAdded
            wikiPageUpdated: $wikiPageUpdated
        ) {
            token
            expires
        }
    }
`;

const updatePasswordMutation = `
    mutation UpdatePassword(
        $authToken: String!
        $currentPassword: String!
        $newPassword: String!
    ) {
        updatePassword(
            authToken: $authToken
            currentPassword: $currentPassword
            newPassword: $newPassword
        ) {
            success
            tokenRenewal {
                token
                expires
            }
        }
    }
`;

const requestEmailChangeMutation = `
    mutation RequestEmailChange(
        $authToken: String!
        $currentPassword: String!
        $email: String!
    ) {
        requestEmailChange(
            authToken: $authToken
            currentPassword: $currentPassword
            email: $email
        ) {
            success
            pendingEmail
            tokenRenewal {
                token
                expires
            }
        }
    }
`;

const resendVerificationMutation = `
    mutation ResendVerification($authToken: String!) {
        resendVerification(authToken: $authToken) {
            accepted
            tokenRenewal {
                token
                expires
            }
        }
    }
`;

function currentCookies(document) {
    return parseCookieHeader(document.cookie);
}

function persistTokenRenewal(document, tokenRenewal) {
    if (!tokenRenewal?.token)
        return;

    const options = tokenRenewal.expires
        ? {expires: new Date(tokenRenewal.expires)}
        : {};
    document.cookie = formatCookie("loginToken", tokenRenewal.token, options);
}

export async function updateNotificationSettings(settings, document = window.document) {
    const cookies = currentCookies(document);
    const variables = {authToken: cookies.loginToken};
    for (const field of EDITABLE_NOTIFICATION_FIELDS)
        variables[field] = settings[field];

    const data = await graphqlRequest({
        query: updateNotificationSettingsMutation,
        variables
    });
    persistTokenRenewal(document, data.updateNotificationSettings);
    return data.updateNotificationSettings;
}

export async function updatePassword(passwords, document = window.document) {
    const cookies = currentCookies(document);
    const data = await graphqlRequest({
        query: updatePasswordMutation,
        variables: {
            authToken: cookies.loginToken,
            currentPassword: passwords.oldPassword,
            newPassword: passwords.newPassword
        }
    });
    persistTokenRenewal(document, data.updatePassword.tokenRenewal);
    return data.updatePassword;
}

export async function requestEmailChange(emailEditor, document = window.document) {
    const cookies = currentCookies(document);
    const data = await graphqlRequest({
        query: requestEmailChangeMutation,
        variables: {
            authToken: cookies.loginToken,
            currentPassword: emailEditor.password,
            email: emailEditor.draftEmail ?? emailEditor.email
        }
    });
    persistTokenRenewal(document, data.requestEmailChange.tokenRenewal);
    return data.requestEmailChange;
}

export async function resendVerification(document = window.document) {
    const cookies = currentCookies(document);
    const data = await graphqlRequest({
        query: resendVerificationMutation,
        variables: {authToken: cookies.loginToken}
    });
    persistTokenRenewal(document, data.resendVerification.tokenRenewal);
    return data.resendVerification;
}
