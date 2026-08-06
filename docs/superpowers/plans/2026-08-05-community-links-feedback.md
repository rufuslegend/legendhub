# Community Links and Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove obsolete community links and the active Discord display while safely routing anonymous website feedback into the maintained GitHub repository.

**Architecture:** Server-render the retained Discord iframe blocks behind a source-level false flag, remove Vote links, and update every stale repository URL. Extract feedback handling from the large index router into a focused router and send validated submissions through a small REST Issues client with injected network dependencies for deterministic tests.

**Tech Stack:** Node.js 22, Express 5, EJS, Node's built-in test runner, GitHub REST API, reCAPTCHA v2, Docker Compose.

## Global Constraints

- The maintained repository is exactly `https://github.com/rufuslegend/legendhub`.
- Discord iframe source stays in `www/src/views/index.ejs`, but production rendering is hard-disabled in source with no environment or runtime toggle.
- Remove every TopMUDSites Vote link from active and retained legacy UI code.
- `/feedback.html` remains usable by visitors without GitHub accounts.
- Feedback issues are public, labeled exactly `triage`, and assigned exactly `rufuslegend`.
- The form must warn that the submitted title and description become public on GitHub.
- `GITHUB_REPOSITORY` becomes the readable slug `rufuslegend/legendhub`; `GITHUB_TOKEN` remains server-only and requires Issues write permission.
- Do not print, commit, or expose any existing token or environment secret.
- Keep version metadata at exact `2.6.0-beta`; never move, reuse, or delete `v2.6.0-beta`.
- Do not publish images or deploy to test without a separate explicit maintainer request.
- Preserve the user-owned untracked `docker-compose-prod.yaml` in the primary checkout.

---

### Task 1: Correct public links and hard-disable the Discord widget

**Files:**
- Create: `www/test/community-links.test.js`
- Modify: `www/test/smoke.test.js`
- Modify: `www/src/routes/index.js:5-8`
- Modify: `www/src/views/index.ejs:15-56`
- Modify: `www/src/views/shared/footer.ejs:4-10`
- Modify: `www/src/public/js/apps/legendwiki-app.js:30-76`
- Modify: `README.md:43-48`
- Modify: `www/package.json:14-34`
- Modify: `css/package.json:16-37`

**Interfaces:**
- Consumes: the existing `GET /` route and EJS `index` view.
- Produces: `showDiscordWidget: false` in the home render model; no Vote or obsolete repository URL in tracked UI/package sources; retained but non-rendered Discord iframe source.

- [ ] **Step 1: Write failing static-source and HTTP tests**

Create `www/test/community-links.test.js` with source-level assertions that cover all maintained URL locations and the explicit code-retention requirement:

```js
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");

function read(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("all LegendHUB repository metadata points to rufuslegend", () => {
    const files = [
        "README.md",
        "www/package.json",
        "css/package.json",
        "www/src/views/shared/footer.ejs",
        "www/src/public/js/apps/legendwiki-app.js"
    ];

    for (const file of files) {
        const source = read(file);
        assert.doesNotMatch(source,
            /github\.com\/(?:www\.)?(?:steventhorne|SvarturH)\/legendhub/i,
            file);
    }

    const webPackage = JSON.parse(read("www/package.json"));
    const cssPackage = JSON.parse(read("css/package.json"));
    for (const metadata of [webPackage, cssPackage]) {
        assert.equal(metadata.repository.url,
            "git+https://github.com/rufuslegend/legendhub.git");
        assert.equal(metadata.bugs.url,
            "https://github.com/rufuslegend/legendhub/issues");
        assert.equal(metadata.homepage,
            "https://github.com/rufuslegend/legendhub#readme");
    }
    assert.match(read("README.md"),
        /https:\/\/github\.com\/rufuslegend\/legendhub\//);
    assert.match(read("www/src/public/js/apps/legendwiki-app.js"),
        /https:\/\/github\.com\/rufuslegend\/legendhub\/issues/);
});

test("Vote links are absent while Discord source remains behind a false flag", () => {
    const uiSource = [
        read("www/src/views/shared/footer.ejs"),
        read("www/src/public/js/apps/legendwiki-app.js")
    ].join("\n");
    assert.doesNotMatch(uiSource, /topmudsites|>Vote!?<|Vote!<\/a>/i);

    const home = read("www/src/views/index.ejs");
    assert.match(home, /showDiscordWidget/);
    assert.equal((home.match(/discordapp\.com\/widget/g) || []).length, 2);
});
```

Extend the existing home-page smoke subtest in `www/test/smoke.test.js` after reading the response once:

```js
const body = await response.text();
assert.match(body, /Welcome to LegendHUB!/);
assert.match(body, /https:\/\/github\.com\/rufuslegend\/legendhub/);
assert.doesNotMatch(body, /topmudsites|>Vote!?<|discordapp\.com\/widget/i);
```

- [ ] **Step 2: Run the focused tests to verify RED**

Run:

```bash
cd www
node --test test/community-links.test.js test/smoke.test.js
```

Expected: FAIL because stale repository/Vote URLs remain, the home view lacks `showDiscordWidget`, and the rendered response still contains Discord iframes.

- [ ] **Step 3: Implement the link cleanup and source-level Discord flag**

Change the home route to render the source-level false flag:

```js
router.get(["/", "/index.html"], function(req, res) {
    return res.render("index", {
        title: "Home",
        showDiscordWidget: false
    });
});
```

Wrap both existing responsive iframe columns in `www/src/views/index.ejs` without deleting or changing either iframe:

```ejs
<%if (showDiscordWidget) {%>
<div class="col-12 col-md-auto mb-3 mb-md-0 d-none d-md-block">
    <iframe style="width:100%;min-height:500px;height:100%" src="https://discordapp.com/widget?id=323745721461374977&theme=dark" allowtransparency="true" frameborder="0"></iframe>
</div>
<%}%>
```

and:

```ejs
<%if (showDiscordWidget) {%>
<div class="col-12 col-md-auto mb-3 mb-md-0 d-block d-md-none">
    <iframe style="width:100%;min-height:500px;height:100%" src="https://discordapp.com/widget?id=323745721461374977&theme=dark" allowtransparency="true" frameborder="0"></iframe>
</div>
<%}%>
```

Remove the complete Vote anchor/list item from the active footer and cached Angular header. Change the active repository link and legacy `Report an Issue` link to `rufuslegend/legendhub`. Update README download URL and both package manifests to these exact metadata values:

```json
"repository": {
    "type": "git",
    "url": "git+https://github.com/rufuslegend/legendhub.git"
},
"bugs": {
    "url": "https://github.com/rufuslegend/legendhub/issues"
},
"homepage": "https://github.com/rufuslegend/legendhub#readme"
```

Do not change copyright attribution or author metadata; those are historical attribution, not repository links.

- [ ] **Step 4: Run focused tests to verify GREEN**

Run:

```bash
cd www
node --test test/community-links.test.js test/smoke.test.js
```

Expected: all community-link and smoke tests pass; the rendered homepage contains the new repository link and no Vote or Discord URL.

- [ ] **Step 5: Commit Task 1**

```bash
git add README.md css/package.json www/package.json \
  www/src/routes/index.js www/src/views/index.ejs \
  www/src/views/shared/footer.ejs \
  www/src/public/js/apps/legendwiki-app.js \
  www/test/community-links.test.js www/test/smoke.test.js
git commit -m "Correct public community links"
```

---

### Task 2: Add a safe GitHub REST Issues client

**Files:**
- Create: `www/src/github-issues-client.js`
- Create: `www/test/github-issues-client.test.js`

**Interfaces:**
- Consumes: `{title: string, body: string}` plus optional `{fetchImpl, repository, token}` dependencies.
- Produces: `createFeedbackIssue(feedback, options): Promise<string>`, resolving to a validated GitHub Issue URL or rejecting with a token-free error.

- [ ] **Step 1: Write failing REST-client tests**

Create `www/test/github-issues-client.test.js`. The success test must capture the complete request and prove user text remains JSON data:

```js
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
```

Add tests with throwing `fetchImpl` sentinels for malformed configuration:

```js
await assert.rejects(
    createFeedbackIssue({title: "x", body: ""}, {
        fetchImpl: async () => { throw new Error("must not fetch"); },
        repository: "not-a-repository",
        token: "test-token"
    }),
    /GITHUB_REPOSITORY must use owner\/repository format/
);
```

Add these concrete failure cases (use the same valid feedback and configuration shown in the success test):

```js
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
```

- [ ] **Step 2: Run the client tests to verify RED**

Run:

```bash
cd www
node --test test/github-issues-client.test.js
```

Expected: FAIL with `Cannot find module '../src/github-issues-client'`.

- [ ] **Step 3: Implement the minimal isolated client**

Create `www/src/github-issues-client.js` with this public contract:

```js
"use strict";

const GITHUB_API = "https://api.github.com";
const ISSUE_BODY_PREFIX =
    "Feedback submitted through https://www.legendhub.org/feedback.html\n\n";

function requireConfiguration(repository, token) {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || ""))
        throw new Error("GITHUB_REPOSITORY must use owner/repository format");
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

    const response = await fetchImpl(
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
```

Keep response bodies out of thrown errors because GitHub error payloads can contain implementation details. Do not add logging in this client.

- [ ] **Step 4: Run client tests to verify GREEN**

Run:

```bash
cd www
node --test test/github-issues-client.test.js
```

Expected: all REST-client success, configuration, response, and URL-validation tests pass.

- [ ] **Step 5: Commit Task 2**

```bash
git add www/src/github-issues-client.js www/test/github-issues-client.test.js
git commit -m "Add safe GitHub feedback client"
```

---

### Task 3: Route anonymous feedback through the new client

**Files:**
- Create: `www/src/routes/feedback.js`
- Create: `www/test/feedback.test.js`
- Modify: `www/src/create-app.js:8-65`
- Modify: `www/src/routes/index.js:1-180`
- Modify: `www/src/views/feedback.ejs:20-65`
- Modify: `.env_example:9-13`
- Modify: `README.md:35-42`
- Modify: `DEVELOPMENT.md`
- Modify: `scripts/test/registry-compose.test.js:8-25,54-75`

**Interfaces:**
- Consumes: `createFeedbackIssue({title, body}): Promise<string>` from Task 2 and an injectable `fetchImpl` for reCAPTCHA.
- Produces: `createFeedbackRouter(options): express.Router`, where `options.fetchImpl` verifies reCAPTCHA and `options.createFeedbackIssue` creates the GitHub Issue; public `GET/POST /feedback.html` behavior remains stable.

- [ ] **Step 1: Write failing feedback HTTP tests**

Create `www/test/feedback.test.js` using the existing `Module._load` pattern from `www/test/smoke.test.js` to stub `sync-rpc`, then call `createApp` with injected dependencies:

```js
const app = loadAppWithoutDatabaseMetadataQuery({
    fetchImpl: async (url) => {
        assert.equal(url, "https://www.google.com/recaptcha/api/siteverify");
        return {
            ok: true,
            async json() { return {success: true}; }
        };
    },
    createFeedbackIssue: async (feedback) => {
        capturedFeedback = feedback;
        return "https://github.com/rufuslegend/legendhub/issues/42";
    }
});
```

Use `URLSearchParams` with `Content-Type: application/x-www-form-urlencoded`
to test these exact HTTP cases:

1. `GET /feedback.html` returns 200 and states that the title and description will be publicly visible on GitHub.
2. Missing or whitespace-only title returns the feedback error view and calls neither reCAPTCHA nor GitHub.
3. A title longer than 256 characters and a description longer than 60,000 characters each fail before external calls.
4. Missing `g-recaptcha-response` returns the existing reCAPTCHA-required error and calls neither external dependency.
5. A reCAPTCHA `{success: false}` result returns `Invalid reCAPTCHA.` and does not call GitHub.
6. A valid submission trims the title, preserves the description verbatim, passes exactly `{title, body}` to `createFeedbackIssue`, and renders the returned Issue link.
7. A rejected `createFeedbackIssue` reaches the safe 500 boundary and does not render `Feedback Sent!`.
8. An injected URL containing `\"><script>` is escaped in the rendered link and never produces a script element.

- [ ] **Step 2: Run feedback tests to verify RED**

Run:

```bash
cd www
node --test test/feedback.test.js
```

Expected: FAIL because `createApp` does not inject feedback dependencies, the route is still embedded in `index.js`, and the public-warning/validation behavior is absent.

- [ ] **Step 3: Extract and implement the feedback router**

Create `www/src/routes/feedback.js` as a factory. Define exact limits and a reusable error renderer:

```js
"use strict";

const express = require("express");
const githubIssues = require("../github-issues-client");

const MAX_TITLE_LENGTH = 256;
const MAX_BODY_LENGTH = 60000;

function renderError(res, message, values) {
    return res.render("feedback", {
        title: "Feedback Error",
        vm: {type: "error", message, values}
    });
}

module.exports = function createFeedbackRouter(options = {}) {
    const router = express.Router();
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    const createFeedbackIssue = options.createFeedbackIssue ||
        githubIssues.createFeedbackIssue;

    router.get("/feedback.html", function(req, res) {
        return res.render("feedback", {
            title: "Send Feedback",
            vm: {type: "normal", values: {title: "", body: ""}}
        });
    });

    router.post("/feedback.html", async function(req, res, next) {
        const submitted = req.body || {};
        const title = typeof submitted.feedbackTitle === "string" ?
            submitted.feedbackTitle.trim() : "";
        const body = typeof submitted.feedbackBody === "string" ?
            submitted.feedbackBody : "";
        const values = {title, body};

        if (title.length === 0 || title.length > MAX_TITLE_LENGTH)
            return renderError(res,
                "Title must be between 1 and 256 characters.", values);
        if (body.length > MAX_BODY_LENGTH)
            return renderError(res,
                "Description must be 60,000 characters or fewer.", values);

        const recaptcha = submitted["g-recaptcha-response"];
        if (typeof recaptcha !== "string" || recaptcha.length === 0)
            return renderError(res, "The reCAPTCHA must be filled out.", values);

        try {
            const response = await fetchImpl(
                "https://www.google.com/recaptcha/api/siteverify", {
                    method: "POST",
                    body: new URLSearchParams({
                        secret: process.env.RECAPTCHA_SECRET,
                        response: recaptcha
                    })
                });
            if (!response.ok)
                throw new Error(`reCAPTCHA verification failed with status ${response.status}`);
            const result = await response.json();
            if (!result.success)
                return renderError(res, "Invalid reCAPTCHA.", values);

            const issueUrl = await createFeedbackIssue({title, body});
            return res.render("feedback", {
                title: "Feedback Sent",
                vm: {type: "success", url: issueUrl}
            });
        }
        catch (error) {
            return next(error);
        }
    });

    return router;
};
```

Delete both feedback handlers and their GitHub/reCAPTCHA logic from
`www/src/routes/index.js`. In `www/src/create-app.js`, create and mount the
focused router before the remaining index router:

```js
const createFeedbackRouter = require("./routes/feedback");

app.use("/", createFeedbackRouter({
    fetchImpl: options.fetchImpl,
    createFeedbackIssue: options.createFeedbackIssue
}));
app.use("/", indexRouter);
```

- [ ] **Step 4: Add public-warning and safe-link rendering**

In the non-success form section of `www/src/views/feedback.ejs`, render this copy for normal and validation-error states:

```ejs
<p>Your feedback title and description will be publicly visible in the
<a href="https://github.com/rufuslegend/legendhub/issues" target="_blank"
rel="noopener noreferrer">LegendHUB GitHub Issues</a>.</p>
```

Change the success link from raw to escaped EJS output:

```ejs
<a href="<%=vm.url%>" class="col-auto btn btn-outline-primary mr-3">Go to feedback</a>
```

Keep the existing form action, reCAPTCHA widget, success buttons, and visitor-facing layout otherwise unchanged.

- [ ] **Step 5: Update configuration documentation and Compose coverage**

Set the example repository value in `.env_example`:

```dotenv
GITHUB_TOKEN=<fine-grained-token-with-issues-write-permission>
GITHUB_REPOSITORY=rufuslegend/legendhub
```

Update README prerequisites and add a short `DEVELOPMENT.md` feedback section stating that the token must have Issues write permission only for `rufuslegend/legendhub`, the repository slug is not a GraphQL node ID, and anonymous form content becomes a public Issue. Do not edit the ignored local `.env` or the user-owned `docker-compose-prod.yaml`.

Change `baseEnvironment.GITHUB_REPOSITORY` in `scripts/test/registry-compose.test.js` to `rufuslegend/legendhub`, then add:

```js
test("passes the readable feedback repository slug to the web service", () => {
    const result = renderBase();
    assert.equal(result.status, 0, result.stderr);
    const environment = JSON.parse(result.stdout).services.www.environment;
    assert.equal(environment.GITHUB_REPOSITORY, "rufuslegend/legendhub");
});
```

- [ ] **Step 6: Run focused route and configuration tests to verify GREEN**

Run:

```bash
cd www
node --test test/feedback.test.js test/github-issues-client.test.js test/smoke.test.js
cd ..
node --test scripts/test/registry-compose.test.js
```

Expected: all feedback, client, smoke, and Compose tests pass; no live Google or GitHub request is made by the feedback tests.

- [ ] **Step 7: Commit Task 3**

```bash
git add .env_example README.md DEVELOPMENT.md \
  scripts/test/registry-compose.test.js \
  www/src/create-app.js www/src/routes/index.js \
  www/src/routes/feedback.js www/src/views/feedback.ejs \
  www/test/feedback.test.js
git commit -m "Route anonymous feedback to GitHub Issues"
```

---

### Task 4: Record the fixes and run the complete verification gate

**Files:**
- Modify: `CHANGELOG.md:7-22`

**Interfaces:**
- Consumes: all behavior and tests from Tasks 1-3.
- Produces: public `2.6.0-beta` release notes and evidence that the complete branch is ready for review, without publication or deployment.

- [ ] **Step 1: Add the public-facing beta changelog entries**

Under `## [2.6.0-beta] - 2026-08-05`, add these bullets to the existing sections rather than creating duplicate headings:

```markdown
### Changed

- Updated project and issue links to the maintained LegendHUB repository.
- Temporarily hid the Discord widget and removed obsolete voting links.

### Fixed

- Fixed anonymous feedback delivery so submissions create public, triaged GitHub Issues in the maintained repository.
```

Do not change the release version or date.

- [ ] **Step 2: Run focused verification**

Run:

```bash
cd www
node --test test/community-links.test.js test/github-issues-client.test.js test/feedback.test.js test/smoke.test.js
cd ..
```

Expected: all focused tests pass.

- [ ] **Step 3: Prove obsolete links are gone and retained Discord code is inert**

Run:

```bash
if rg -n 'github\.com/(www\.)?(steventhorne|SvarturH)/legendhub|topmudsites' README.md css/package.json www/package.json www/src; then exit 1; fi
test "$(rg -o 'discordapp\.com/widget' www/src/views/index.ejs | wc -l | tr -d ' ')" = 2
```

Expected: the stale-link search prints nothing; exactly two retained Discord iframe sources remain in the EJS template. The HTTP test from Task 1 proves neither appears in the rendered homepage.

- [ ] **Step 4: Run all local suites and release checks**

Run:

```bash
node scripts/verify-release-version.js
node --test scripts/test/*.test.js
cd www && npm test && cd ..
cd css && npm test && cd ..
bash -n scripts/tag-release.sh scripts/publish-images.sh scripts/deploy-test.sh
env LEGENDHUB_IMAGE_TAG="$(git rev-parse --short=12 HEAD)" EXTERNAL_PORT=7001 PORT=3000 NODE_ENV=test MYSQL_PORT=3306 MYSQL_ROOT_PASSWORD=validation MYSQL_USER=validation MYSQL_PASSWORD=validation MYSQL_DATABASE=validation GITHUB_TOKEN=validation GITHUB_REPOSITORY=rufuslegend/legendhub RECAPTCHA_SITEKEY=validation RECAPTCHA_SECRET=validation docker compose -f docker-compose.yaml -f docker-compose.registry.yaml config --quiet
git diff --check
git status --short --branch
```

Expected: verifier prints `2.6.0-beta`; every test, syntax, and Compose check passes. In an isolated execution worktree, status contains only the intended Task 4 changelog edit before its commit. No tag, image, or remote server command is run.

- [ ] **Step 5: Reconfirm the public repository prerequisites read-only**

Run:

```bash
curl --fail --silent --show-error -H 'Accept: application/vnd.github+json' https://api.github.com/repos/rufuslegend/legendhub | jq -e '.has_issues == true'
curl --fail --silent --show-error -H 'Accept: application/vnd.github+json' 'https://api.github.com/repos/rufuslegend/legendhub/labels?per_page=100' | jq -e 'any(.name == "triage")'
```

Expected: both commands print `true` and exit 0. These checks do not create,
edit, or delete any GitHub Issue or repository setting.

- [ ] **Step 6: Commit Task 4**

```bash
git add CHANGELOG.md
git commit -m "Record community link and feedback fixes"
```

- [ ] **Step 7: Request final whole-branch review**

Review the range from the design commit `fba8641` through `HEAD` against `docs/superpowers/specs/2026-08-05-community-links-feedback-design.md` and this plan. Required review focus:

- no Discord request or Vote link can reach visitors;
- all repository URLs are current without changing historical attribution;
- anonymous input is JSON data, not executable query text;
- token and GitHub error details remain private;
- reCAPTCHA/input failures cause no GitHub call;
- public-feedback warning, `triage` label, and `rufuslegend` assignment match the approved behavior;
- `2.6.0-beta` metadata and immutable tag policy remain intact.

Expected: no open Critical or Important findings. Stop after review and report the verified branch. Publishing images and deploying to test require a new, explicit maintainer request.
