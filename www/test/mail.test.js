"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {createMailer, readMailConfig} = require("../src/mail");

test("production mail configuration returns the validated SMTP settings", function() {
    const config = readMailConfig({
        NODE_ENV: "production",
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: "465",
        SMTP_SECURE: "true",
        SMTP_USER: "mailer",
        SMTP_PASSWORD: "not-a-real-password",
        SMTP_FROM: "LegendHUB <noreply@example.com>",
        APP_BASE_URL: "https://legendhub.org"
    });

    assert.deepEqual(config, {
        host: "smtp.example.com",
        port: 465,
        secure: true,
        auth: {user: "mailer", pass: "not-a-real-password"},
        from: "LegendHUB <noreply@example.com>",
        baseUrl: "https://legendhub.org"
    });
});

test("production mail configuration rejects a missing credential without exposing it", function() {
    assert.throws(
        () => readMailConfig({
            NODE_ENV: "production",
            SMTP_HOST: "smtp.example.com",
            SMTP_PORT: "465",
            SMTP_SECURE: "true",
            SMTP_USER: "mailer",
            SMTP_FROM: "LegendHUB <noreply@example.com>",
            APP_BASE_URL: "https://legendhub.org"
        }),
        (error) => {
            assert.match(error.message, /SMTP_PASSWORD is required/);
            assert.doesNotMatch(error.message, /not-a-real-password/);
            return true;
        }
    );
});

test("production mail configuration requires an HTTPS public base URL", function() {
    assert.throws(
        () => readMailConfig({
            NODE_ENV: "production",
            SMTP_HOST: "smtp.example.com",
            SMTP_PORT: "587",
            SMTP_SECURE: "false",
            SMTP_USER: "mailer",
            SMTP_PASSWORD: "not-a-real-password",
            SMTP_FROM: "LegendHUB <noreply@example.com>",
            APP_BASE_URL: "http://legendhub.org"
        }),
        /APP_BASE_URL must use HTTPS in production/
    );
});

test("verification mail contains the public HTTPS link without logging its token", async function() {
    const sent = [];
    const mailer = createMailer({
        transport: {sendMail: async message => sent.push(message)},
        config: {from: "LegendHUB <noreply@example.com>", baseUrl: "https://legendhub.org"}
    });

    await mailer.sendVerification({
        to: "player@example.com",
        username: "Player",
        token: "selector-validator"
    });

    assert.equal(sent[0].subject, "Verify your LegendHUB email address");
    assert.match(sent[0].text, /https:\/\/legendhub\.org\/verify-email\.html\?token=selector-validator/);
    assert.match(sent[0].html, /Verify your LegendHUB email address/);
    assert.doesNotMatch(JSON.stringify(sent[0]), /SMTP_PASSWORD/);
});

test("email-change mail uses its purpose-specific confirmation link", async function() {
    const sent = [];
    const mailer = createMailer({
        transport: {sendMail: async message => sent.push(message)},
        config: {from: "LegendHUB <noreply@example.com>", baseUrl: "https://legendhub.org"}
    });

    await mailer.sendEmailChanged({
        to: "player@example.com",
        username: "Player",
        token: "selector-validator"
    });

    assert.equal(sent[0].subject, "Confirm your new LegendHUB email address");
    assert.match(sent[0].text, /https:\/\/legendhub\.org\/confirm-email-change\.html\?token=selector-validator/);
});

test("password-reset mail uses its purpose-specific reset link", async function() {
    const sent = [];
    const mailer = createMailer({
        transport: {sendMail: async message => sent.push(message)},
        config: {from: "LegendHUB <noreply@example.com>", baseUrl: "https://legendhub.org"}
    });

    await mailer.sendPasswordReset({
        to: "player@example.com",
        username: "Player",
        token: "selector-validator"
    });

    assert.equal(sent[0].subject, "Reset your LegendHUB password");
    assert.match(sent[0].text, /https:\/\/legendhub\.org\/reset-password\.html\?token=selector-validator/);
});

test("password-changed mail confirms the completed security action", async function() {
    const sent = [];
    const mailer = createMailer({
        transport: {sendMail: async message => sent.push(message)},
        config: {from: "LegendHUB <noreply@example.com>", baseUrl: "https://legendhub.org"}
    });

    await mailer.sendPasswordChanged({to: "player@example.com", username: "Player"});

    assert.equal(sent[0].subject, "Your LegendHUB password was changed");
    assert.match(sent[0].text, /password was changed/i);
    assert.doesNotMatch(sent[0].text, /token=/);
});
