"use strict";

const nodemailer = require("nodemailer");

const REQUIRED_PRODUCTION_VARIABLES = Object.freeze([
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_SECURE",
    "SMTP_USER",
    "SMTP_PASSWORD",
    "SMTP_FROM",
    "APP_BASE_URL"
]);

function readMailConfig(environment) {
    const isProduction = environment.NODE_ENV === "production";
    if (isProduction) {
        for (const name of REQUIRED_PRODUCTION_VARIABLES) {
            if (typeof environment[name] !== "string" || environment[name].trim() === "")
                throw new Error(`${name} is required`);
        }
    }

    const port = readPort(environment.SMTP_PORT, isProduction);
    const secure = readSecure(environment.SMTP_SECURE, isProduction);
    const baseUrl = readBaseUrl(environment.APP_BASE_URL, isProduction);

    return {
        host: environment.SMTP_HOST,
        port,
        secure,
        auth: {user: environment.SMTP_USER, pass: environment.SMTP_PASSWORD},
        from: environment.SMTP_FROM,
        baseUrl
    };
}

function readPort(value, required) {
    if (value === undefined && !required)
        return undefined;
    if (typeof value !== "string" || !/^\d+$/.test(value))
        throw new Error("SMTP_PORT must be an integer between 1 and 65535");

    const port = Number(value);
    if (port < 1 || port > 65535)
        throw new Error("SMTP_PORT must be an integer between 1 and 65535");
    return port;
}

function readSecure(value, required) {
    if (value === undefined && !required)
        return undefined;
    if (value === "true")
        return true;
    if (value === "false")
        return false;
    throw new Error("SMTP_SECURE must be true or false");
}

function readBaseUrl(value, isProduction) {
    if (value === undefined && !isProduction)
        return undefined;

    let baseUrl;
    try {
        baseUrl = new URL(value);
    }
    catch {
        throw new Error("APP_BASE_URL must be a valid URL");
    }

    if (isProduction && baseUrl.protocol !== "https:")
        throw new Error("APP_BASE_URL must use HTTPS in production");
    return baseUrl.toString().replace(/\/$/, "");
}

function createMailer({transport, config}) {
    const mailTransport = transport || nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: config.auth
    });

    return {
        sendVerification: ({to, username, token}) => sendActionMail({
            transport: mailTransport,
            config,
            to,
            username,
            token,
            subject: "Verify your LegendHUB email address",
            path: "verify-email.html",
            action: "Verify your LegendHUB email address"
        }),
        sendEmailChanged: ({to, username, token}) => sendActionMail({
            transport: mailTransport,
            config,
            to,
            username,
            token,
            subject: "Confirm your new LegendHUB email address",
            path: "confirm-email-change.html",
            action: "Confirm your new LegendHUB email address"
        }),
        sendPasswordReset: ({to, username, token}) => sendActionMail({
            transport: mailTransport,
            config,
            to,
            username,
            token,
            subject: "Reset your LegendHUB password",
            path: "reset-password.html",
            action: "Reset your LegendHUB password"
        }),
        sendPasswordChanged: ({to, username}) => sendPasswordChangedMail({
            transport: mailTransport,
            config,
            to,
            username
        })
    };
}

function sendActionMail({transport, config, to, username, token, subject, path, action}) {
    const url = new URL(path, `${config.baseUrl}/`);
    url.searchParams.set("token", token);
    const link = url.toString();
    const greeting = `Hello ${username},`;

    return transport.sendMail({
        from: config.from,
        to,
        subject,
        text: `${greeting}\n\n${action}:\n${link}\n`,
        html: `<p>${escapeHtml(greeting)}</p><p><a href="${escapeHtml(link)}">${escapeHtml(action)}</a></p>`
    });
}

function sendPasswordChangedMail({transport, config, to, username}) {
    const greeting = `Hello ${username},`;
    return transport.sendMail({
        from: config.from,
        to,
        subject: "Your LegendHUB password was changed",
        text: `${greeting}\n\nYour LegendHUB password was changed. If you did not make this change, contact support immediately.\n`,
        html: `<p>${escapeHtml(greeting)}</p><p>Your LegendHUB password was changed. If you did not make this change, contact support immediately.</p>`
    });
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#39;"
    })[character]);
}

module.exports = {createMailer, readMailConfig};
