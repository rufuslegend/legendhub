"use strict";

const assert = require("node:assert/strict");
const Module = require("node:module");
const test = require("node:test");
const httpFetch = globalThis.fetch;

function loadAppWithoutDatabaseMetadataQuery(options = {}) {
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (request === "sync-rpc") {
            return function() {
                return function() {
                    return [];
                };
            };
        }

        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        return require("../src/create-app")({
            ...options,
            logging: false,
            logError: function() {}
        });
    }
    finally {
        Module._load = originalLoad;
    }
}

async function startFeedbackApp(t, options = {}) {
    const fallbackFetch = globalThis.fetch;
    const bypassedFetches = [];
    globalThis.fetch = async function(url) {
        bypassedFetches.push(url);
        if (url === "https://www.google.com/recaptcha/api/siteverify") {
            return {
                ok: true,
                async json() { return {success: true}; }
            };
        }
        return {
            ok: true,
            async json() {
                return {
                    data: {
                        createIssue: {
                            issue: {url: "https://github.com/rufuslegend/legendhub/issues/99"}
                        }
                    }
                };
            }
        };
    };

    const app = loadAppWithoutDatabaseMetadataQuery(options);
    const server = await new Promise(function(resolve) {
        const listeningServer = app.listen(0, "127.0.0.1", function() {
            resolve(listeningServer);
        });
    });
    t.after(async function() {
        globalThis.fetch = fallbackFetch;
        await new Promise(function(resolve, reject) {
            server.close(function(error) {
                if (error)
                    reject(error);
                else
                    resolve();
            });
        });
    });

    return {
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        bypassedFetches
    };
}

function postFeedback(baseUrl, fields) {
    return httpFetch(`${baseUrl}/feedback.html`, {
        method: "POST",
        headers: {"Content-Type": "application/x-www-form-urlencoded"},
        body: new URLSearchParams(fields)
    });
}

function createDependencies(overrides = {}) {
    const calls = {recaptcha: 0, issues: 0};
    return {
        calls,
        fetchImpl: async function(url) {
            calls.recaptcha++;
            assert.equal(url, "https://www.google.com/recaptcha/api/siteverify");
            return {
                ok: true,
                async json() { return overrides.recaptcha || {success: true}; }
            };
        },
        createFeedbackIssue: async function(feedback) {
            calls.issues++;
            if (overrides.createFeedbackIssue)
                return overrides.createFeedbackIssue(feedback);
            return "https://github.com/rufuslegend/legendhub/issues/42";
        }
    };
}

test("GET /feedback.html explains that submitted content is public", async function(t) {
    const dependencies = createDependencies();
    const {baseUrl} = await startFeedbackApp(t, dependencies);

    const response = await httpFetch(`${baseUrl}/feedback.html`);
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(body, /title and description will be publicly visible on GitHub/);
});

test("POST /feedback.html rejects missing and whitespace-only titles before external calls", async function(t) {
    for (const title of ["", "   \t"]) {
        await t.test(JSON.stringify(title), async function(t) {
            const dependencies = createDependencies();
            const {baseUrl, bypassedFetches} = await startFeedbackApp(t, dependencies);
            const response = await postFeedback(baseUrl, {
                feedbackTitle: title,
                feedbackBody: "Description",
                "g-recaptcha-response": "token"
            });
            const body = await response.text();

            assert.equal(response.status, 200);
            assert.match(body, /Title must be between 1 and 256 characters/);
            assert.equal(dependencies.calls.recaptcha, 0);
            assert.equal(dependencies.calls.issues, 0);
            assert.deepEqual(bypassedFetches, []);
        });
    }
});

test("POST /feedback.html rejects overlong title and description before external calls", async function(t) {
    const cases = [
        {
            name: "title",
            fields: {feedbackTitle: "x".repeat(257), feedbackBody: "", "g-recaptcha-response": "token"},
            message: /Title must be between 1 and 256 characters/
        },
        {
            name: "description",
            fields: {feedbackTitle: "Valid", feedbackBody: "x".repeat(60001), "g-recaptcha-response": "token"},
            message: /Description must be 60,000 characters or fewer/
        }
    ];

    for (const testCase of cases) {
        await t.test(testCase.name, async function(t) {
            const dependencies = createDependencies();
            const {baseUrl, bypassedFetches} = await startFeedbackApp(t, dependencies);
            const response = await postFeedback(baseUrl, testCase.fields);
            const body = await response.text();

            assert.equal(response.status, 200);
            assert.match(body, testCase.message);
            assert.equal(dependencies.calls.recaptcha, 0);
            assert.equal(dependencies.calls.issues, 0);
            assert.deepEqual(bypassedFetches, []);
        });
    }
});

test("POST /feedback.html requires reCAPTCHA before external calls", async function(t) {
    const dependencies = createDependencies();
    const {baseUrl, bypassedFetches} = await startFeedbackApp(t, dependencies);
    const response = await postFeedback(baseUrl, {
        feedbackTitle: "Valid title",
        feedbackBody: "Description"
    });
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(body, /The reCAPTCHA must be filled out/);
    assert.equal(dependencies.calls.recaptcha, 0);
    assert.equal(dependencies.calls.issues, 0);
    assert.deepEqual(bypassedFetches, []);
});

test("POST /feedback.html rejects invalid reCAPTCHA without creating an Issue", async function(t) {
    const dependencies = createDependencies({recaptcha: {success: false}});
    const {baseUrl, bypassedFetches} = await startFeedbackApp(t, dependencies);
    const response = await postFeedback(baseUrl, {
        feedbackTitle: "Valid title",
        feedbackBody: "Description",
        "g-recaptcha-response": "token"
    });
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(body, /Invalid reCAPTCHA\./);
    assert.equal(dependencies.calls.recaptcha, 1);
    assert.equal(dependencies.calls.issues, 0);
    assert.deepEqual(bypassedFetches, []);
});

test("POST /feedback.html trims the title and passes the original description to GitHub", async function(t) {
    let capturedFeedback;
    const dependencies = createDependencies({
        createFeedbackIssue: async function(feedback) {
            capturedFeedback = feedback;
            return "https://github.com/rufuslegend/legendhub/issues/42";
        }
    });
    const {baseUrl, bypassedFetches} = await startFeedbackApp(t, dependencies);
    const description = "  Preserve this description\nverbatim.  ";
    const response = await postFeedback(baseUrl, {
        feedbackTitle: "  Trim this title  ",
        feedbackBody: description,
        "g-recaptcha-response": "token"
    });
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.deepEqual(capturedFeedback, {
        title: "Trim this title",
        body: description
    });
    assert.equal(dependencies.calls.recaptcha, 1);
    assert.equal(dependencies.calls.issues, 1);
    assert.deepEqual(bypassedFetches, []);
    assert.match(body, /Feedback Sent!/);
    assert.match(body, /href="https:\/\/github\.com\/rufuslegend\/legendhub\/issues\/42"/);
});

test("POST /feedback.html sends Issue creation failures to the safe 500 boundary", async function(t) {
    const dependencies = createDependencies({
        createFeedbackIssue: async function() {
            throw new Error("GitHub is unavailable");
        }
    });
    const {baseUrl, bypassedFetches} = await startFeedbackApp(t, dependencies);
    const response = await postFeedback(baseUrl, {
        feedbackTitle: "Valid title",
        feedbackBody: "Description",
        "g-recaptcha-response": "token"
    });
    const body = await response.text();

    assert.equal(response.status, 500);
    assert.match(body, /Server Error/);
    assert.doesNotMatch(body, /Feedback Sent!/);
    assert.equal(dependencies.calls.recaptcha, 1);
    assert.equal(dependencies.calls.issues, 1);
    assert.deepEqual(bypassedFetches, []);
});

test("POST /feedback.html escapes the returned Issue URL", async function(t) {
    const maliciousUrl = "https://github.com/rufuslegend/legendhub/issues/42\"><script>alert(1)</script>";
    const dependencies = createDependencies({
        createFeedbackIssue: async function() { return maliciousUrl; }
    });
    const {baseUrl, bypassedFetches} = await startFeedbackApp(t, dependencies);
    const response = await postFeedback(baseUrl, {
        feedbackTitle: "Valid title",
        feedbackBody: "Description",
        "g-recaptcha-response": "token"
    });
    const body = await response.text();

    assert.equal(response.status, 200);
    assert.match(body, /href="https:\/\/github\.com\/rufuslegend\/legendhub\/issues\/42(?:&#34;|&quot;)&gt;&lt;script&gt;/);
    assert.doesNotMatch(body, /<script>alert\(1\)<\/script>/);
    assert.equal(dependencies.calls.recaptcha, 1);
    assert.equal(dependencies.calls.issues, 1);
    assert.deepEqual(bypassedFetches, []);
});
