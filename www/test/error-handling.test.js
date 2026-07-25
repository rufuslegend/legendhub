const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const express = require("express");
const createErrorHandlers = require("../src/error-handlers");

function listen(app) {
    return new Promise(function(resolve) {
        const server = app.listen(0, "127.0.0.1", function() {
            resolve(server);
        });
    });
}

function close(server) {
    return new Promise(function(resolve, reject) {
        server.close(function(error) {
            if (error)
                reject(error);
            else
                resolve();
        });
    });
}

test("error boundary preserves safe statuses and hides server details", async function(t) {
    const loggedErrors = [];
    const handlers = createErrorHandlers({
        logError: function(error) {
            loggedErrors.push(error);
        }
    });
    const app = express();
    app.set("views", path.join(__dirname, "../src/views"));
    app.set("view engine", "ejs");

    app.get("/api/internal", function(req, res, next) {
        next(new Error("private database details"));
    });
    app.get("/api/invalid-status", function(req, res, next) {
        const error = new Error("invalid public status");
        error.status = 200;
        next(error);
    });
    app.get("/page/client-error", function(req, res, next) {
        const error = new Error("<b>unsafe message</b>");
        error.status = 422;
        error.expose = true;
        next(error);
    });
    app.get("/page/private-error", function(req, res, next) {
        const error = new Error("private client details");
        error.status = 400;
        error.expose = false;
        next(error);
    });
    app.get("/page/internal", function(req, res, next) {
        next(new Error("private page details"));
    });

    app.use(handlers.notFound);
    app.use(handlers.handleError);
    app.use(handlers.handleFatalError);

    const server = await listen(app);
    t.after(function() {
        return close(server);
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    await t.test("redacts internal API errors", async function() {
        const response = await fetch(`${baseUrl}/api/internal`);
        assert.equal(response.status, 500);
        assert.deepEqual(await response.json(), {
            errors: [{
                message: "An unexpected server error occurred.",
                code: 500
            }]
        });
    });

    await t.test("normalizes invalid status codes", async function() {
        const response = await fetch(`${baseUrl}/api/invalid-status`);
        assert.equal(response.status, 500);
        assert.equal((await response.json()).errors[0].code, 500);
    });

    await t.test("escapes exposed HTML error messages", async function() {
        const response = await fetch(`${baseUrl}/page/client-error`);
        const body = await response.text();

        assert.equal(response.status, 422);
        assert.match(body, /&lt;b&gt;unsafe message&lt;\/b&gt;/);
        assert.doesNotMatch(body, /<b>unsafe message<\/b>/);
    });

    await t.test("does not expose private client errors", async function() {
        const response = await fetch(`${baseUrl}/page/private-error`);
        const body = await response.text();

        assert.equal(response.status, 400);
        assert.match(body, /The request could not be completed/);
        assert.doesNotMatch(body, /private client details/);
    });

    await t.test("falls back when the primary error page cannot render", async function() {
        const response = await fetch(`${baseUrl}/page/internal`);
        const body = await response.text();

        assert.equal(response.status, 500);
        assert.match(body, /A fatal error has occurred/);
        assert.doesNotMatch(body, /private page details/);
    });

    assert.equal(loggedErrors.length, 4);
});
