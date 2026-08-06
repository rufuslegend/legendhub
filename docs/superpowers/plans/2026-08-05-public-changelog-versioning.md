# Public Changelog and Versioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the abandoned database-backed public changelog with a tracked root `CHANGELOG.md`, establish `2.6.0-beta` as the consistent application version, and create an immutable annotated prerelease tag before publishing the beta.

**Architecture:** A small release verifier enforces one version across the changelog, npm package metadata, lockfile, and README badge. The Express changelog router loads the root Markdown document once at application creation and renders safe server-side HTML without querying the database. The web image builds from the repository root so the same tracked file is present in local and registry images, while a separate tag command fails closed on dirty or duplicate releases.

**Tech Stack:** Node.js 22, CommonJS, Express 5, EJS, `markdown-it`, Node's built-in test runner, Bash 3.2-compatible shell, Docker Compose, Docker Buildx, Git annotated tags

## Global Constraints

- The initial exact version is `2.6.0-beta`; do not promote it to `2.6.0` without a later explicit instruction from the maintainer.
- Root `CHANGELOG.md` is the only changelog source of truth and begins at `2.6.0-beta`; do not backfill older database entries.
- Keep the legacy changelog tables, GraphQL schema/resolvers, permissions, and stored data intact; retirement is non-destructive.
- `/changelog` and `/changelog/index.html` render without a database request; legacy detail URLs permanently redirect to `/changelog`; add/edit URLs are no longer routed.
- Server-side Markdown rendering must disable embedded HTML.
- The root changelog must be copied into the immutable web image; do not add a generated second copy.
- Keep all release and test shell code compatible with macOS Bash 3.2.
- Git tags are annotated, named `v2.6.0-beta` and later `v2.6.0`, and are never moved or reused.
- GitHub Actions, GitHub Releases, npm publication, and automatic commit-message release notes remain out of scope.
- Do not alter the primary checkout's untracked `docker-compose-prod.yaml`.

---

## File Structure

- `CHANGELOG.md` — canonical public release notes, starting at `2.6.0-beta`.
- `scripts/verify-release-version.js` — pure version-consistency functions plus CLI entry point.
- `scripts/test/verify-release-version.test.js` — fixture-based release metadata validation.
- `www/src/changelog-document.js` — loads the Markdown file and converts it to safe server-rendered HTML.
- `www/src/routes/changelog.js` — public-only router factory with index rendering and legacy redirect.
- `www/src/views/changelog/index.ejs` — single public changelog document page.
- `www/test/changelog.test.js` — document loader and route behavior coverage.
- `www/src/create-app.js` — injects the changelog path into the router factory.
- `www/Dockerfile` and root `.dockerignore` — targeted root-context web image.
- `docker-compose.yaml` — explicit root context plus `www/Dockerfile` for local web builds.
- `scripts/publish-images.sh` — root-context web build, unchanged Python/MySQL contexts, changelog dirty-input guard.
- `scripts/test/publish-images.test.js` and `scripts/test/registry-compose.test.js` — publisher and Compose regressions.
- `scripts/tag-release.sh` — fail-closed annotated tag creation.
- `scripts/test/tag-release.test.js` — real temporary-Git-repository tag tests.
- `README.md` and `DEVELOPMENT.md` — current version badge and maintainer release instructions.

---

### Task 1: Establish the canonical beta version and consistency verifier

**Files:**
- Create: `CHANGELOG.md`
- Create: `scripts/verify-release-version.js`
- Create: `scripts/test/verify-release-version.test.js`
- Modify: `www/package.json`
- Modify: `www/package-lock.json`
- Modify: `README.md:1-5`

**Interfaces:**
- Produces: `verifyReleaseVersion(repoRoot: string): string`, returning the verified semantic version or throwing a contextual `Error`.
- Produces: CLI `node scripts/verify-release-version.js [repo-root]`, printing exactly the verified version and a newline on success.
- Consumes: the newest `## [VERSION]` heading in root `CHANGELOG.md`, npm package metadata, lock metadata, and README badge alt text/URL.

- [ ] **Step 1: Write fixture helpers and failing consistency tests**

Create `scripts/test/verify-release-version.test.js` with literal fixture content and cases for a consistent beta, a missing changelog, malformed SemVer, package/lock disagreement, and README disagreement:

```js
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {verifyReleaseVersion} = require("../verify-release-version");

function createFixture(overrides = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "legendhub-version-"));
    fs.mkdirSync(path.join(root, "www"));
    const version = overrides.version || "2.6.0-beta";
    const packageVersion = overrides.packageVersion || version;
    const lockVersion = overrides.lockVersion || version;
    const readmeVersion = overrides.readmeVersion || version;

    if (!overrides.omitChangelog) {
        fs.writeFileSync(path.join(root, "CHANGELOG.md"),
            `# Changelog\n\n${overrides.unreleased ? "## [Unreleased]\n\n- Pending change.\n\n" : ""}## [${version}] - 2026-08-05\n\n### Fixed\n\n- Safer startup.\n`);
    }
    fs.writeFileSync(path.join(root, "www/package.json"), JSON.stringify({
        name: "legendhub",
        version: packageVersion
    }));
    fs.writeFileSync(path.join(root, "www/package-lock.json"), JSON.stringify({
        name: "legendhub",
        version: lockVersion,
        packages: {"": {name: "legendhub", version: lockVersion}}
    }));
    const badgeVersion = readmeVersion.replaceAll("-", "--");
    fs.writeFileSync(path.join(root, "README.md"),
        `[![Version v=${readmeVersion}](https://img.shields.io/badge/version-v=${badgeVersion}-brightgreen.svg)]\n`);
    return root;
}

test("accepts one consistent semantic prerelease version", (t) => {
    const root = createFixture();
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    assert.equal(verifyReleaseVersion(root), "2.6.0-beta");
});

test("accepts an Unreleased section above the current version", (t) => {
    const root = createFixture({unreleased: true});
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    assert.equal(verifyReleaseVersion(root), "2.6.0-beta");
});

test("rejects missing changelog metadata", (t) => {
    const root = createFixture({omitChangelog: true});
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    assert.throws(() => verifyReleaseVersion(root), /CHANGELOG\.md/);
});

test("rejects malformed semantic versions", (t) => {
    for (const version of ["2.6-beta", "2.6.0-01"]) {
        const root = createFixture({version});
        t.after(() => fs.rmSync(root, {recursive: true, force: true}));
        assert.throws(() => verifyReleaseVersion(root), /semantic version/i);
    }
});

test("rejects package and lockfile disagreement", (t) => {
    const root = createFixture({lockVersion: "2.5.0"});
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    assert.throws(() => verifyReleaseVersion(root), /package-lock\.json.*2\.5\.0/i);
});

test("rejects README badge disagreement", (t) => {
    const root = createFixture({readmeVersion: "2.5.0"});
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    assert.throws(() => verifyReleaseVersion(root), /README\.md.*2\.5\.0/i);
});
```

- [ ] **Step 2: Run the focused tests to verify RED**

Run:

```bash
node --test scripts/test/verify-release-version.test.js
```

Expected: FAIL because `scripts/verify-release-version.js` does not exist.

- [ ] **Step 3: Implement the minimal consistency verifier**

Create `scripts/verify-release-version.js` with these exact validation boundaries:

```js
#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const semanticVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function readFile(file) {
    try {
        return fs.readFileSync(file, "utf8");
    }
    catch (error) {
        throw new Error(`Unable to read ${file}: ${error.message}`, {cause: error});
    }
}

function readJson(file) {
    try {
        return JSON.parse(readFile(file));
    }
    catch (error) {
        throw new Error(`Unable to parse ${file}: ${error.message}`, {cause: error});
    }
}

function verifyReleaseVersion(repoRoot) {
    const changelog = readFile(path.join(repoRoot, "CHANGELOG.md"));
    const packageJson = readJson(path.join(repoRoot, "www/package.json"));
    const packageLock = readJson(path.join(repoRoot, "www/package-lock.json"));
    const readme = readFile(path.join(repoRoot, "README.md"));
    const headings = [...changelog.matchAll(/^## \[([^\]]+)\](?: - \d{4}-\d{2}-\d{2})?$/gm)];
    const changelogMatch = headings[0]?.[1] === "Unreleased" ? headings[1] : headings[0];

    if (!changelogMatch || !semanticVersion.test(changelogMatch[1] || ""))
        throw new Error("CHANGELOG.md does not begin with a valid semantic version heading");

    const version = changelogMatch[1];
    const observed = [
        ["www/package.json", packageJson.version],
        ["www/package-lock.json", packageLock.version],
        ["www/package-lock.json root package", packageLock.packages?.[""]?.version],
        ["README.md", readme.match(/\[!\[Version v=([^\]]+)\]/)?.[1]],
    ];
    for (const [source, value] of observed) {
        if (value !== version)
            throw new Error(`${source} version ${String(value)} does not match ${version}`);
    }

    const badgeVersion = version.replaceAll("-", "--");
    if (!readme.includes(`/badge/version-v=${badgeVersion}-brightgreen.svg`))
        throw new Error(`README.md badge URL does not encode ${version}`);

    return version;
}

if (require.main === module) {
    const repoRoot = path.resolve(process.argv[2] || path.join(__dirname, ".."));
    process.stdout.write(`${verifyReleaseVersion(repoRoot)}\n`);
}

exports.verifyReleaseVersion = verifyReleaseVersion;
```

- [ ] **Step 4: Add the beta changelog and synchronize version metadata**

Create root `CHANGELOG.md` with public-facing notes:

```markdown
# Changelog

All notable user-facing changes to LegendHUB are documented here beginning
with version 2.6.0-beta.

## [2.6.0-beta] - 2026-08-05

### Added

- Added automated application and migration checks to make updates safer.
- Added repeatable database backups and a verified test-release process.

### Changed

- Updated the application platform and major server dependencies.
- Improved startup so the site waits for database updates before accepting traffic.
- Improved the reliability of builder stat calculations without intentionally changing their results.

### Fixed

- Fixed several form pages after the server framework upgrade.
- Fixed error responses so visitors receive the intended status and safe message.
- Fixed startup and database-update failures that could leave the site partially available.
```

From `www`, synchronize npm metadata without creating a tag:

```bash
npm version 2.6.0-beta --no-git-tag-version
```

Change the README badge to:

```markdown
[![Version v=2.6.0-beta](https://img.shields.io/badge/version-v=2.6.0--beta-brightgreen.svg?style=flat-square)](https://www.legendhub.org)
```

- [ ] **Step 5: Run the verifier and focused tests to verify GREEN**

Run:

```bash
node --test scripts/test/verify-release-version.test.js
node scripts/verify-release-version.js
```

Expected: all tests PASS and the CLI prints `2.6.0-beta`.

- [ ] **Step 6: Commit Task 1**

```bash
git add CHANGELOG.md README.md www/package.json www/package-lock.json \
  scripts/verify-release-version.js scripts/test/verify-release-version.test.js
git commit -m "Establish 2.6.0 beta release metadata"
```

---

### Task 2: Render the tracked changelog as a public server-side page

**Files:**
- Create: `www/src/changelog-document.js`
- Create: `www/test/changelog.test.js`
- Modify: `www/src/routes/changelog.js`
- Modify: `www/src/create-app.js:15-70`
- Modify: `www/src/routes/auth.js`
- Modify: `www/src/views/changelog/index.ejs`
- Delete: `www/src/views/changelog/display.ejs`
- Delete: `www/src/views/changelog/modify.ejs`
- Modify: `www/package.json`
- Modify: `www/package-lock.json`

**Interfaces:**
- Produces: `loadChangelog(filePath?: string): {source: string, html: string}` in `www/src/changelog-document.js`.
- Produces: `createChangelogRouter(options?: {changelogPath?: string}): express.Router` in `www/src/routes/changelog.js`.
- Produces: `authRouter.initializeLocals`, which supplies cookie, URL, version, and date-rendering locals without authentication or database/API work.
- Consumes: `createApp({changelogPath?: string})` to inject a fixture path in tests.
- Depends on: root `CHANGELOG.md` and version `2.6.0-beta` from Task 1.

- [ ] **Step 1: Write failing document-loader tests**

Create `www/test/changelog.test.js` with tests that use a temporary file and assert server-side output, disabled embedded HTML, and contextual missing/empty-file failures:

```js
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {loadChangelog} = require("../src/changelog-document");

function temporaryChangelog(t, content) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "legendhub-changelog-"));
    const file = path.join(directory, "CHANGELOG.md");
    fs.writeFileSync(file, content);
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    return file;
}

test("renders changelog Markdown while escaping embedded HTML", (t) => {
    const file = temporaryChangelog(t,
        "# Changelog\n\n## [2.6.0-beta]\n\n- Safer releases\n\n<script>alert(1)</script>\n");
    const document = loadChangelog(file);
    assert.match(document.html, /<h1>Changelog<\/h1>/);
    assert.match(document.html, /<li>Safer releases<\/li>/);
    assert.doesNotMatch(document.html, /<script>/);
    assert.match(document.html, /&lt;script&gt;/);
});

test("rejects missing and empty changelog files", (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "legendhub-changelog-"));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    assert.throws(() => loadChangelog(path.join(directory, "missing.md")), /Unable to read changelog/);
    const empty = path.join(directory, "empty.md");
    fs.writeFileSync(empty, " \n");
    assert.throws(() => loadChangelog(empty), /empty/i);
    const unreadable = path.join(directory, "unreadable.md");
    fs.writeFileSync(unreadable, "# Changelog\n");
    fs.chmodSync(unreadable, 0o000);
    assert.throws(() => loadChangelog(unreadable), /Unable to read changelog/);
    fs.chmodSync(unreadable, 0o600);
});
```

- [ ] **Step 2: Run the loader tests to verify RED**

Run:

```bash
cd www
node --test test/changelog.test.js
```

Expected: FAIL because `src/changelog-document.js` does not exist.

- [ ] **Step 3: Install the renderer and implement the loader**

Run:

```bash
cd www
npm install markdown-it
```

Create `www/src/changelog-document.js`:

```js
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const MarkdownIt = require("markdown-it");

const renderer = new MarkdownIt({html: false, linkify: true, typographer: false});

function defaultChangelogPath() {
    return process.env.CHANGELOG_PATH || path.resolve(__dirname, "../../CHANGELOG.md");
}

function loadChangelog(filePath = defaultChangelogPath()) {
    let source;
    try {
        source = fs.readFileSync(filePath, "utf8");
    }
    catch (error) {
        throw new Error(`Unable to read changelog at ${filePath}: ${error.message}`, {cause: error});
    }
    if (!source.trim())
        throw new Error(`Changelog at ${filePath} is empty`);
    return {source, html: renderer.render(source)};
}

exports.loadChangelog = loadChangelog;
```

- [ ] **Step 4: Run loader tests to verify GREEN**

Run:

```bash
cd www
node --test test/changelog.test.js
```

Expected: both loader tests PASS.

- [ ] **Step 5: Write failing HTTP behavior tests**

Extend `www/test/changelog.test.js` with a small real HTTP server around `createApp({changelogPath})`. Add the module shim and server lifecycle explicitly before the HTTP assertions:

```js
const Module = require("node:module");

function loadApplication(changelogPath) {
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (request === "sync-rpc")
            return () => () => [];
        const fromLegacyChangelog = parent?.filename.endsWith("/routes/changelog.js") &&
            (request === "./api/utils" || request === "./api/auth");
        if (fromLegacyChangelog)
            throw new Error(`Public changelog loaded legacy dependency ${request}`);
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        return require("../src/create-app")({
            changelogPath,
            logging: false
        });
    }
    finally {
        Module._load = originalLoad;
    }
}

test("serves the tracked changelog without legacy database routes", async (t) => {
    const changelogPath = temporaryChangelog(t,
        "# Changelog\n\n## [2.6.0-beta]\n\n- Safer releases\n");
    const app = loadApplication(changelogPath);
    const server = await new Promise((resolve) => {
        const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    t.after(() => new Promise((resolve, reject) => server.close(
        (error) => error ? reject(error) : resolve())));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    await t.test("renders the tracked changelog without legacy controls", async () => {
        const response = await fetch(`${baseUrl}/changelog`);
        const body = await response.text();
        assert.equal(response.status, 200);
        assert.match(body, /2\.6\.0-beta/);
        assert.match(body, /Safer releases/);
        assert.doesNotMatch(body, /changelog\/add\.html|changelog\/edit\.html/);
    });

    await t.test("redirects legacy details and retires editor routes", async () => {
        const detail = await fetch(`${baseUrl}/changelog/details.html?id=25`,
            {redirect: "manual"});
        assert.equal(detail.status, 301);
        assert.equal(detail.headers.get("location"), "/changelog");
        assert.equal((await fetch(`${baseUrl}/changelog/add.html`)).status, 404);
        assert.equal((await fetch(`${baseUrl}/changelog/edit.html?id=25`)).status, 404);
    });
});
```

Make the module shim replace the authentication API dependencies with stubs
that throw if called. Add a request to `/changelog/` carrying both
`loginToken` and theme cookies; require a successful rendered response and the
cookie-selected theme. This regression must fail while the changelog remains
behind global authentication and pass only when the public route performs no
authentication/database/API work.

- [ ] **Step 6: Run HTTP tests to verify RED**

Run:

```bash
cd www
node --test test/changelog.test.js
```

Expected: FAIL because the current router imports the legacy API/auth modules and does not accept `changelogPath`.

- [ ] **Step 7: Replace the router and public view**

Replace `www/src/routes/changelog.js` with a router factory:

```js
"use strict";

const express = require("express");
const {loadChangelog} = require("../changelog-document");

module.exports = function createChangelogRouter(options = {}) {
    const router = express.Router();
    const document = loadChangelog(options.changelogPath);

    router.get(["/", "/index.html"], function(req, res) {
        res.render("changelog/index", {
            title: "Changelog",
            vm: {html: document.html}
        });
    });

    router.get("/details.html", function(req, res) {
        res.redirect(301, "/changelog");
    });

    return router;
};
```

Split the safe template-local initialization at the start of
`www/src/routes/auth.js` into `authRouter.initializeLocals`. Change
`www/src/create-app.js` to import `createChangelogRouter` and mount it after
cookie parsing and safe local initialization, but before login authentication:

```js
app.use(cookieParser());
app.use(authRouter.initializeLocals);
app.use("/changelog", createChangelogRouter({
    changelogPath: options.changelogPath
}));
app.use(authRouter);
```

Replace `www/src/views/changelog/index.ejs` with the shared page shell and a single trusted renderer result:

```ejs
<!doctype html>
<html lang="en">
    <head>
        <%-include("../shared/meta")-%>
        <link href="https://www.legendhub.org/changelog/" rel="canonical">
    </head>
    <body>
        <%-include("../shared/header")-%>
        <main class="container">
            <div class="row">
                <article class="card col-12">
                    <div class="card-body changelog"><%-vm.html%></div>
                </article>
            </div>
        </main>
        <%-include("../shared/footer")-%>
        <%-include("../shared/scripts")-%>
    </body>
</html>
```

Delete the now-unrouted `display.ejs` and `modify.ejs` changelog views. Do not remove the GraphQL changelog module, schema fields, permissions, or database objects.

- [ ] **Step 8: Run changelog and application tests to verify GREEN**

Run:

```bash
cd www
node --test test/changelog.test.js
npm test
```

Expected: changelog tests PASS; the full suite has 0 failures and retains only the existing skipped migration integration test.

- [ ] **Step 9: Commit Task 2**

```bash
git add www/package.json www/package-lock.json www/src/changelog-document.js \
  www/src/create-app.js www/src/routes/auth.js www/src/routes/changelog.js \
  www/src/views/changelog \
  www/test/changelog.test.js
git commit -m "Render the tracked public changelog"
```

---

### Task 3: Include the root changelog in local and registry web images

**Files:**
- Create: `.dockerignore`
- Modify: `www/Dockerfile`
- Modify: `docker-compose.yaml:35-55`
- Modify: `scripts/publish-images.sh`
- Modify: `scripts/test/publish-images.test.js`
- Modify: `scripts/test/registry-compose.test.js`

**Interfaces:**
- Produces: a web build invoked as `docker build --file www/Dockerfile .` with `/app/CHANGELOG.md` and `CHANGELOG_PATH=/app/CHANGELOG.md`.
- Produces: publisher web build arguments `--file www/Dockerfile .`; Python remains context `python`; MySQL backup remains context `mysql`.
- Depends on: `CHANGELOG.md` from Task 1 and `CHANGELOG_PATH` support from Task 2.

- [ ] **Step 1: Write failing Compose and publisher assertions**

Extend `scripts/test/registry-compose.test.js` with this base-Compose renderer and assertion:

```js
function renderBase() {
    return spawnSync("docker", [
        "compose",
        "-f", "docker-compose.yaml",
        "config",
        "--format", "json",
    ], {
        cwd: root,
        env: baseEnvironment,
        encoding: "utf8",
    });
}

test("builds the web image from the repository root with its explicit Dockerfile", () => {
    const result = renderBase();
    assert.equal(result.status, 0, result.stderr);
    const build = JSON.parse(result.stdout).services.www.build;
    assert.equal(path.resolve(build.context), root);
    assert.equal(path.resolve(root, build.dockerfile), path.join(root, "www/Dockerfile"));
});
```

Extend `scripts/test/publish-images.test.js` so the successful-build test requires:

```js
assert.match(log,
    /buildx build --platform linux\/amd64 --push --tag tmckimmey\/legendhub-www:abcdef123456 --file www\/Dockerfile \./);
```

Add dirty-root-file cases for both canonical content and context filtering:

```js
test("refuses dirty root web-image inputs before invoking Docker", async (t) => {
    for (const dirtyPath of ["CHANGELOG.md", ".dockerignore"]) {
        await t.test(dirtyPath, () => {
            const result = runPublisher(` M ${dirtyPath}\n`);
            assert.notEqual(result.status, 0);
            assert.match(result.stderr, new RegExp(dirtyPath.replace(".", "\\.")));
            assert.equal(readDockerLog(), "");
        });
    }
});
```

- [ ] **Step 2: Run focused deployment tests to verify RED**

Run:

```bash
node --test scripts/test/registry-compose.test.js scripts/test/publish-images.test.js
```

Expected: FAIL because the web service and publisher still use context `www` and the dirty-input path omits root `CHANGELOG.md`.

- [ ] **Step 3: Change the web image to the targeted root context**

Create root `.dockerignore`:

```dockerignore
**
!CHANGELOG.md
!www/
!www/Dockerfile
!www/package.json
!www/package-lock.json
!www/src/
!www/src/**
```

Change `www/Dockerfile` to:

```dockerfile
FROM node:latest
WORKDIR /app
COPY www/package* ./
RUN npm ci --omit=dev
COPY www/src ./src
COPY CHANGELOG.md ./CHANGELOG.md
ENV CHANGELOG_PATH=/app/CHANGELOG.md
EXPOSE $PORT
ENTRYPOINT ["npm", "start"]
```

Change only the web build block in `docker-compose.yaml`:

```yaml
www:
    build:
        context: .
        dockerfile: www/Dockerfile
```

Keep the existing source bind mount for local development and all environment, network, health, and restart settings unchanged.

- [ ] **Step 4: Adjust the publisher without changing the other image contexts**

Represent the build metadata explicitly in `scripts/publish-images.sh`:

```bash
contexts=("." "python" "mysql")
dockerfiles=("www/Dockerfile" "" "")

dirty="$(git status --porcelain=v1 --untracked-files=all -- .dockerignore CHANGELOG.md www python mysql)"
```

Before `docker buildx build`, construct a Bash 3.2-compatible optional argument array:

```bash
dockerfile_args=()
if [[ -n "${dockerfiles[$index]}" ]]; then
  dockerfile_args=(--file "${dockerfiles[$index]}")
fi
docker buildx build \
  --platform linux/amd64 \
  --push \
  --tag "$ref" \
  "${dockerfile_args[@]}" \
  "$context"
```

- [ ] **Step 5: Run focused tests and real configuration validation to verify GREEN**

Run:

```bash
node --test scripts/test/registry-compose.test.js scripts/test/publish-images.test.js
bash -n scripts/publish-images.sh
env LEGENDHUB_IMAGE_TAG=abcdef123456 EXTERNAL_PORT=7001 PORT=3000 \
  NODE_ENV=test MYSQL_PORT=3306 MYSQL_ROOT_PASSWORD=validation \
  MYSQL_USER=validation MYSQL_PASSWORD=validation MYSQL_DATABASE=validation \
  GITHUB_TOKEN=validation GITHUB_REPOSITORY=validation/validation \
  RECAPTCHA_SITEKEY=validation RECAPTCHA_SECRET=validation \
  docker compose -f docker-compose.yaml -f docker-compose.registry.yaml config --quiet
```

Expected: all tests PASS, Bash syntax exits 0, and Compose configuration exits 0.

- [ ] **Step 6: Build and inspect the web image locally**

Run:

```bash
docker build --platform linux/amd64 --tag legendhub-www:2.6.0-beta-local \
  --file www/Dockerfile .
docker run --rm --entrypoint sh legendhub-www:2.6.0-beta-local \
  -c 'test -s /app/CHANGELOG.md && test "$CHANGELOG_PATH" = /app/CHANGELOG.md'
```

Expected: image build exits 0 and the container confirms a nonempty canonical changelog at the configured path.

- [ ] **Step 7: Commit Task 3**

```bash
git add .dockerignore www/Dockerfile docker-compose.yaml scripts/publish-images.sh \
  scripts/test/publish-images.test.js scripts/test/registry-compose.test.js
git commit -m "Package the public changelog in web images"
```

---

### Task 4: Create fail-closed annotated release tags

**Files:**
- Create: `scripts/tag-release.sh`
- Create: `scripts/test/tag-release.test.js`

**Interfaces:**
- Produces: `scripts/tag-release.sh`, which accepts no positional arguments, verifies the current metadata, rejects any dirty tracked or untracked file, rejects an existing `vVERSION` tag, and creates one annotated tag on `HEAD`.
- Consumes: CLI output from `scripts/verify-release-version.js` created in Task 1.
- Test seam: `LEGENDHUB_REPO_ROOT` may point to a temporary Git repository; production use omits it.

- [ ] **Step 1: Write failing tests against real temporary Git repositories**

Create `scripts/test/tag-release.test.js` with real temporary repositories and the actual command helpers:

```js
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const test = require("node:test");

const tagger = path.resolve(__dirname, "../tag-release.sh");

function run(repo, command, args, environment = {}) {
    return spawnSync(command, args, {
        cwd: repo,
        env: {...process.env, ...environment},
        encoding: "utf8"
    });
}

function git(repo, ...args) {
    const result = run(repo, "git", args);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
}

function createReleaseRepository(t) {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "legendhub-tag-"));
    t.after(() => fs.rmSync(repo, {recursive: true, force: true}));
    fs.mkdirSync(path.join(repo, "www"));
    fs.writeFileSync(path.join(repo, "CHANGELOG.md"),
        "# Changelog\n\n## [2.6.0-beta] - 2026-08-05\n\n- Safer releases\n");
    fs.writeFileSync(path.join(repo, "README.md"),
        "[![Version v=2.6.0-beta](https://img.shields.io/badge/version-v=2.6.0--beta-brightgreen.svg)]\n");
    fs.writeFileSync(path.join(repo, "www/package.json"), JSON.stringify({
        name: "legendhub", version: "2.6.0-beta"
    }));
    fs.writeFileSync(path.join(repo, "www/package-lock.json"), JSON.stringify({
        name: "legendhub",
        version: "2.6.0-beta",
        packages: {"": {name: "legendhub", version: "2.6.0-beta"}}
    }));
    git(repo, "init");
    git(repo, "config", "user.name", "LegendHUB Test");
    git(repo, "config", "user.email", "legendhub-test@example.invalid");
    git(repo, "add", ".");
    git(repo, "commit", "-m", "release fixture");
    return repo;
}

function runTagger(repo) {
    return run(repo, "bash", [tagger], {LEGENDHUB_REPO_ROOT: repo});
}

test("creates one annotated beta tag on HEAD", (t) => {
    const repo = createReleaseRepository(t);
    const result = runTagger(repo);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(git(repo, "tag", "--list", "v2.6.0-beta"), "v2.6.0-beta");
    assert.equal(git(repo, "cat-file", "-t", "v2.6.0-beta"), "tag");
    assert.equal(git(repo, "rev-list", "-n", "1", "v2.6.0-beta"), git(repo, "rev-parse", "HEAD"));
});

test("rejects dirty release inputs before creating a tag", (t) => {
    const repo = createReleaseRepository(t);
    fs.appendFileSync(path.join(repo, "CHANGELOG.md"), "\nchanged\n");
    const result = runTagger(repo);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /dirty/i);
    assert.equal(git(repo, "tag", "--list"), "");
});

test("rejects an existing release tag without moving it", (t) => {
    const repo = createReleaseRepository(t);
    assert.equal(runTagger(repo).status, 0);
    const original = git(repo, "rev-parse", "v2.6.0-beta^{}");
    fs.writeFileSync(path.join(repo, "extra.txt"), "next\n");
    git(repo, "add", ".");
    git(repo, "commit", "-m", "next");
    const result = runTagger(repo);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /already exists/i);
    assert.equal(git(repo, "rev-parse", "v2.6.0-beta^{}"), original);
});
```

- [ ] **Step 2: Run tag tests to verify RED**

Run:

```bash
node --test scripts/test/tag-release.test.js
```

Expected: FAIL because `scripts/tag-release.sh` does not exist.

- [ ] **Step 3: Implement the fail-closed tag command**

Create `scripts/tag-release.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="${LEGENDHUB_REPO_ROOT:-$(cd "$script_dir/.." && pwd -P)}"
version="$(node "$script_dir/verify-release-version.js" "$repo_root")"
tag="v$version"

cd "$repo_root"
dirty="$(git status --porcelain=v1 --untracked-files=all)"
[[ -z "$dirty" ]] || {
  printf 'Refusing to tag dirty release inputs:\n%s\n' "$dirty" >&2
  exit 1
}

if git show-ref --verify --quiet "refs/tags/$tag"; then
  printf 'Release tag already exists: %s\n' "$tag" >&2
  exit 1
fi

git tag -a "$tag" -m "LegendHUB $version"
printf '%s %s\n' "$tag" "$(git rev-parse HEAD)"
```

- [ ] **Step 4: Run tag and syntax tests to verify GREEN**

Run:

```bash
node --test scripts/test/tag-release.test.js
bash -n scripts/tag-release.sh
```

Expected: all tag tests PASS and Bash syntax exits 0.

- [ ] **Step 5: Commit Task 4 without creating the real tag yet**

```bash
git add scripts/tag-release.sh scripts/test/tag-release.test.js
git commit -m "Add fail-closed release tagging"
```

---

### Task 5: Document ongoing changelog and release maintenance

**Files:**
- Modify: `DEVELOPMENT.md`
- Modify: `README.md:115-130`

**Interfaces:**
- Consumes: `node scripts/verify-release-version.js`, `scripts/tag-release.sh`, `scripts/publish-images.sh`, and `scripts/deploy-test.sh` from prior tasks.
- Produces: one durable single-maintainer runbook for beta notes, final promotion, immutable tags, container publication, separately authorized deployment, and rollback.

- [ ] **Step 1: Replace the obsolete cache-busting-only version guidance**

Update README maintenance text to state:

```markdown
### Versioning and public changelog

The current application version is stored in `www/package.json`. Root
`CHANGELOG.md` is the public release record and is rendered at `/changelog`.
The package lock and README badge must carry the same version. Run
`node scripts/verify-release-version.js` before committing release metadata.

During the 2.6 beta, add public-facing changes under `2.6.0-beta`. Do not change
that version to `2.6.0` until the maintainer explicitly declares the release.
```

Remove the statement that a developer should independently change only
`www/package.json` for cache invalidation. The package version still supplies
the existing asset version local, but release metadata moves together.

- [ ] **Step 2: Add the exact beta and final release procedures to DEVELOPMENT.md**

Document these ordered beta commands after the image publishing section:

```bash
node scripts/verify-release-version.js
cd www && npm test && cd ..
node --test scripts/test/*.test.js
git status --short --branch
git push origin feat/public-changelog
git fetch --tags origin
./scripts/tag-release.sh
git push origin v2.6.0-beta
./scripts/publish-images.sh
```

Document the separately authorized beta deployment outside that procedure:

```bash
./scripts/deploy-test.sh "$(git rev-parse --short=12 HEAD)"
```

Document the final publication procedure with the same remote-tag guard:

```bash
node scripts/verify-release-version.js
cd www && npm test && cd ..
node --test scripts/test/*.test.js
git status --short --branch
git push origin feat/public-changelog
git fetch --tags origin
./scripts/tag-release.sh
git push origin v2.6.0
./scripts/publish-images.sh
```

State that the tag command must run only after the release commit is reviewed
and all verification is green, and fetch remote tags immediately before each
beta or final tag operation. For final promotion, document the exact metadata
transition from `2.6.0-beta` to `2.6.0`, rerun the same gates, create
`v2.6.0`, and never move or delete the beta tag. Document test deployment as a
separately labeled opt-in command that requires explicit maintainer
authorization every time; tagging or publishing never implies deployment. Keep
the existing private repository visibility gate and immutable-SHA
deployment/rollback rules.

- [ ] **Step 3: Verify documentation commands against current scripts**

Run:

```bash
node scripts/verify-release-version.js
bash -n scripts/tag-release.sh scripts/publish-images.sh scripts/deploy-test.sh
git diff --check
```

Expected: version verifier prints `2.6.0-beta`; all shell syntax and diff checks exit 0.

- [ ] **Step 4: Commit Task 5**

```bash
git add README.md DEVELOPMENT.md
git commit -m "Document changelog release maintenance"
```

---

### Task 6: Review, tag, publish, and explicitly authorized deployment of the `2.6.0-beta` release

**Files:**
- No planned tracked file changes; operational evidence belongs only in the ignored SDD workspace.

**Interfaces:**
- Consumes: all prior tasks, Docker Hub repositories under `tmckimmey`, and test host `dunwichmass` at `/home/rufus/legendhub`.
- Produces: pushed branch `feat/public-changelog`, immutable annotated tag `v2.6.0-beta`, three verified private `linux/amd64` images tagged with the 12-character Git SHA plus `test`, and—for this plan only, under the maintainer's explicit one-time authorization—a test deployment pinned to that SHA.

Tagging and publishing never imply deployment. The maintainer explicitly
authorized the deployment in this task only; every future test deployment must
receive fresh explicit authorization.

- [ ] **Step 1: Run the complete local verification gate**

Run from the repository root:

```bash
node scripts/verify-release-version.js
node --test scripts/test/*.test.js
cd www && npm test && cd ..
bash -n scripts/tag-release.sh scripts/publish-images.sh scripts/deploy-test.sh
env LEGENDHUB_IMAGE_TAG="$(git rev-parse --short=12 HEAD)" \
  EXTERNAL_PORT=7001 PORT=3000 NODE_ENV=test MYSQL_PORT=3306 \
  MYSQL_ROOT_PASSWORD=validation MYSQL_USER=validation MYSQL_PASSWORD=validation \
  MYSQL_DATABASE=validation GITHUB_TOKEN=validation \
  GITHUB_REPOSITORY=validation/validation RECAPTCHA_SITEKEY=validation \
  RECAPTCHA_SECRET=validation \
  docker compose -f docker-compose.yaml -f docker-compose.registry.yaml config --quiet
git diff --check
git status --short --branch
```

Expected: verifier prints `2.6.0-beta`; all tests and syntax/configuration checks pass; the branch is clean.

- [ ] **Step 2: Request whole-branch code review and fix all Critical or Important findings**

Review the range from `bf38eebd2c4d6af8bbfacf01bc9c055fd87044c9` to `HEAD` against the design and this plan. Required review focus:

- release version consistency and SemVer handling;
- Markdown safety and absence of database access on public routes;
- Docker root-context minimization and correct publisher arguments;
- dirty-input and immutable-tag fail-closed behavior;
- backward-compatible legacy URL redirects;
- adequacy and realism of tests.

Expected: final reviewer verdict `Ready to merge: Yes`, with every Critical and Important finding resolved and scoped rereviewed.

- [ ] **Step 3: Push the reviewed branch, create the tag, and push only that tag**

Run:

```bash
git push -u origin feat/public-changelog
git fetch --tags origin
./scripts/tag-release.sh
test "$(git rev-parse v2.6.0-beta^{})" = "$(git rev-parse HEAD)"
git push origin refs/tags/v2.6.0-beta
```

Expected: branch push succeeds; the annotated tag resolves to exact `HEAD`; tag push succeeds. If the tag already exists, stop and investigate rather than moving it.

- [ ] **Step 4: Confirm the private visibility gate and publish all three images**

Confirm these exact repositories still exist and are Private:

```text
tmckimmey/legendhub-www
tmckimmey/legendhub-python
tmckimmey/legendhub-mysql-backup
```

Then run with pipeline failure propagation:

```bash
release_sha="$(git rev-parse --short=12 HEAD)"
bash -o pipefail -c './scripts/publish-images.sh | tee /tmp/legendhub-2.6.0-beta-images.txt'
```

Expected: three repository/SHA/digest lines, every SHA equals `$release_sha`, each image verifies as exactly one runnable `linux/amd64` artifact, and no `latest` tag is created.

- [ ] **Step 5: Perform this plan's separately authorized test deployment**

This command is authorized for the current beta operation only. Do not carry
that authorization into any future deployment.

Run:

```bash
release_sha="$(git rev-parse --short=12 HEAD)"
./scripts/deploy-test.sh "$release_sha"
```

Expected: the server fetches and checks out the matching full Git commit, validates the preserved `.env` and test override, renders Compose configuration, pulls all three private images, and runs `up -d --no-build` without removing volumes.

- [ ] **Step 6: Verify the public changelog and deployed service health**

Run read-only verification:

```bash
ssh -A dunwichmass 'bash -s' <<'REMOTE'
set -euo pipefail
cd /home/rufus/legendhub
compose=(docker compose -f docker-compose.yaml -f docker-compose.test.yaml -f docker-compose.registry.yaml)
"${compose[@]}" ps
for route in / /changelog/ /items/ /mobs/ /quests/ /wiki/ /builder/ /login.html /api; do
  code="$(curl -sS -o /dev/null -w '%{http_code}' -H 'Accept: text/html' "http://127.0.0.1:7001$route")"
  printf '%s %s\n' "$code" "$route"
  test "$code" -ge 200
  test "$code" -lt 500
done
"${compose[@]}" logs --since=5m www python mysql-backup mysql
REMOTE

curl -fsS https://legendhub.dunwichmass.com/changelog/ | grep -F '2.6.0-beta'
```

Expected: all four services run, MySQL is healthy, every local route returns below 500, public HTTPS succeeds, and the rendered public page contains `2.6.0-beta`.

- [ ] **Step 7: Record the immutable release identifiers**

Record in the ignored SDD task report:

```bash
git rev-parse HEAD
git rev-parse v2.6.0-beta^{}
cat /tmp/legendhub-2.6.0-beta-images.txt
```

Expected: the commit and annotated tag resolve to the same full SHA, and the report contains all three registry digests plus the deployed 12-character SHA without credentials or `.env` values.
