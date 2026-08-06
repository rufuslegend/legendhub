"use strict";

const GITHUB_API = "https://api.github.com";
const ISSUE_BODY_PREFIX =
    "Feedback submitted through https://www.legendhub.org/feedback.html\n\n";

function requireConfiguration(repository, token) {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || ""))
        throw new Error("GITHUB_REPOSITORY must use owner/repository format");
    if (repository !== "rufuslegend/legendhub")
        throw new Error("GITHUB_REPOSITORY must be rufuslegend/legendhub");
    if (typeof token !== "string" || token.length === 0)
        throw new Error("GITHUB_TOKEN is required to create feedback issues");
}

function validateIssueUrl(value, repository) {
    let issueUrl;
    try {
        issueUrl = new URL(value);
    }
    catch {
        throw new Error("GitHub returned an invalid Issue URL");
    }
    const expectedPrefix = `/${repository}/issues/`;
    const issueNumber = issueUrl.pathname.slice(expectedPrefix.length);
    if (issueUrl.origin !== "https://github.com" ||
        !issueUrl.pathname.startsWith(expectedPrefix) ||
        !/^[1-9]\d*$/.test(issueNumber)) {
        throw new Error("GitHub returned an unexpected Issue URL");
    }
    return issueUrl.href;
}

async function createFeedbackIssue(feedback, options = {}) {
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    const repository = options.repository === undefined ?
        process.env.GITHUB_REPOSITORY : options.repository;
    const token = options.token === undefined ?
        process.env.GITHUB_TOKEN : options.token;
    requireConfiguration(repository, token);

    let response;
    try {
        response = await fetchImpl(
            `${GITHUB_API}/repos/${repository}/issues`, {
                method: "POST",
                headers: {
                    Accept: "application/vnd.github+json",
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                    "User-Agent": "LegendHUB",
                    "X-GitHub-Api-Version": "2022-11-28"
                },
                body: JSON.stringify({
                    title: feedback.title,
                    body: ISSUE_BODY_PREFIX + (feedback.body || ""),
                    labels: ["triage"],
                    assignees: ["rufuslegend"]
                })
            });
    }
    catch {
        throw new Error("GitHub Issue request failed");
    }

    if (!response.ok)
        throw new Error(`GitHub Issue creation failed with status ${response.status}`);

    let result;
    try {
        result = await response.json();
    }
    catch {
        throw new Error("GitHub returned an invalid Issue response");
    }
    return validateIssueUrl(result && result.html_url, repository);
}

module.exports = {createFeedbackIssue};
