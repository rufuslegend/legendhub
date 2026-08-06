"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {createFeedbackIssue} = require("../src/github-issues-client");

test("creates a triaged and assigned feedback issue with JSON", async () => {
    let request;
    const fetchImpl = async (url, options) => {
        request = {url, options};
        return {
            ok: true,
            status: 201,
            async json() {
                return {
                    html_url: "https://github.com/rufuslegend/legendhub/issues/42"
                };
            }
        };
    };
    const title = "Quotes \" and slash \\ stay data";
    const body = "Line one\nLine two } mutation {";

    const url = await createFeedbackIssue({title, body}, {
        fetchImpl,
        repository: "rufuslegend/legendhub",
        token: "test-token"
    });

    assert.equal(request.url,
        "https://api.github.com/repos/rufuslegend/legendhub/issues");
    assert.equal(request.options.method, "POST");
    assert.equal(request.options.headers.Authorization, "Bearer test-token");
    assert.deepEqual(JSON.parse(request.options.body), {
        title,
        body: "Feedback submitted through https://www.legendhub.org/feedback.html\n\n" + body,
        labels: ["triage"],
        assignees: ["rufuslegend"]
    });
    assert.equal(url,
        "https://github.com/rufuslegend/legendhub/issues/42");
});

test("requires an owner/repository configuration before calling GitHub", async () => {
    await assert.rejects(
        createFeedbackIssue({title: "x", body: ""}, {
            fetchImpl: async () => { throw new Error("must not fetch"); },
            repository: "not-a-repository",
            token: "test-token"
        }),
        /GITHUB_REPOSITORY must use owner\/repository format/
    );
});

test("requires a token before calling GitHub", async () => {
    await assert.rejects(createFeedbackIssue({title: "x", body: ""}, {
        fetchImpl: async () => { throw new Error("must not fetch"); },
        repository: "rufuslegend/legendhub",
        token: ""
    }), /GITHUB_TOKEN is required/);
});

test("rejects GitHub failures without exposing the token", async () => {
    await assert.rejects(createFeedbackIssue({title: "x", body: ""}, {
        fetchImpl: async () => ({ok: false, status: 403}),
        repository: "rufuslegend/legendhub",
        token: "test-token"
    }), (error) => {
        assert.match(error.message, /status 403/);
        assert.doesNotMatch(error.message, /test-token/);
        return true;
    });
});

test("rejects malformed GitHub responses", async (t) => {
    const cases = [
        {
            name: "invalid JSON",
            response: {ok: true, status: 201, json: async () => { throw new SyntaxError("bad json"); }},
            pattern: /invalid Issue response/
        },
        {
            name: "missing URL",
            response: {ok: true, status: 201, json: async () => ({})},
            pattern: /invalid Issue URL/
        },
        {
            name: "foreign URL",
            response: {ok: true, status: 201, json: async () => ({html_url: "https://example.com/issues/42"})},
            pattern: /unexpected Issue URL/
        },
        {
            name: "non-numeric Issue URL",
            response: {ok: true, status: 201, json: async () => ({html_url: "https://github.com/rufuslegend/legendhub/issues/not-a-number"})},
            pattern: /unexpected Issue URL/
        }
    ];

    for (const testCase of cases) {
        await t.test(testCase.name, async () => {
            await assert.rejects(createFeedbackIssue({title: "x", body: ""}, {
                fetchImpl: async () => testCase.response,
                repository: "rufuslegend/legendhub",
                token: "test-token"
            }), testCase.pattern);
        });
    }
});
