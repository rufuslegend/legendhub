# Docker Registry Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish all three LegendHUB-built services as private `linux/amd64` Docker Hub images and deploy immutable Git-SHA releases through a registry-only Compose override.

**Architecture:** Make each service image self-contained, validate remote image manifests with a small Node CLI, and drive builds and tag promotion through one repository-owned Bash publisher. Keep local Compose development unchanged; a final registry override removes build directives and the web source bind mount for server deployments.

**Tech Stack:** Docker Buildx, Docker Compose 2.24.4+, Bash, Node.js 22+ built-in test runner, Docker Hub

## Global Constraints

- Publish exactly `tmckimmey/legendhub-www`, `tmckimmey/legendhub-python`, and `tmckimmey/legendhub-mysql-backup`.
- Build and publish only the `linux/amd64` runnable platform.
- Tag every release with the 12-character Git commit ID for `HEAD` and the movable `test` tag.
- Never publish `latest`.
- Do not republish MySQL; the test environment continues using upstream `mysql:5.7.44`.
- Keep all three Docker Hub repositories private.
- Use the existing `tmckimmey` Docker Hub identity for publishing and server pulls.
- Refuse to publish dirty build inputs under `www`, `python`, or `mysql`.
- Do not overwrite an existing valid SHA-tagged image.
- Do not promote any `test` tag until all three SHA tags exist and pass manifest verification.
- Deploy and roll back with an explicit SHA tag, never with `test`.
- Never remove the database, backup, or log volumes during deployment or rollback.
- Keep publishing and deployment manual; GitHub Actions integration is deferred.
- Keep the publishing script compatible with macOS Bash 3.2; do not use associative arrays.

---

### Task 1: Make the service images self-contained and bounded

**Files:**
- Modify: `www/Dockerfile:1-6`
- Create: `www/.dockerignore`
- Create: `python/.dockerignore`
- Create: `mysql/.dockerignore`

**Interfaces:**
- Consumes: the existing service build contexts `./www`, `./python`, and `./mysql`
- Produces: three loadable `linux/amd64` images; the web image guarantees `/app/src/app.js` exists

- [ ] **Step 1: Build the current web image and demonstrate that it lacks application source**

Run:

```bash
docker buildx build \
  --platform linux/amd64 \
  --load \
  --tag legendhub-www:registry-plan-test \
  ./www

docker run --rm \
  --platform linux/amd64 \
  --entrypoint test \
  legendhub-www:registry-plan-test \
  -f /app/src/app.js
```

Expected: the build succeeds and the `test` command exits 1 because the current
image relies on the Compose bind mount for `/app/src`.

- [ ] **Step 2: Copy the web source into the image**

Add the source copy after dependency installation in `www/Dockerfile`:

```dockerfile
FROM node:latest
WORKDIR /app
COPY package* ./
RUN npm ci --omit=dev
COPY src ./src
EXPOSE $PORT
ENTRYPOINT ["npm", "start"]
```

- [ ] **Step 3: Add narrow build-context exclusions**

Create `www/.dockerignore`:

```dockerignore
node_modules
test
test-fixtures
npm-debug.log*
```

Create `python/.dockerignore`:

```dockerignore
__pycache__
*.py[cod]
.pytest_cache
```

Create `mysql/.dockerignore`:

```dockerignore
conf
dev-baseline.sql
init
```

These exclusions do not hide any file copied by the corresponding Dockerfile.

- [ ] **Step 4: Build and inspect all three x86_64 images**

Run:

```bash
docker buildx build --platform linux/amd64 --load --tag legendhub-www:registry-plan-test ./www
docker buildx build --platform linux/amd64 --load --tag legendhub-python:registry-plan-test ./python
docker buildx build --platform linux/amd64 --load --tag legendhub-mysql-backup:registry-plan-test ./mysql

docker run --rm --platform linux/amd64 --entrypoint test \
  legendhub-www:registry-plan-test -f /app/src/app.js

for image in \
  legendhub-www:registry-plan-test \
  legendhub-python:registry-plan-test \
  legendhub-mysql-backup:registry-plan-test
do
  test "$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image")" = "linux/amd64"
done
```

Expected: all commands exit 0 and each image reports `linux/amd64`.

- [ ] **Step 5: Run the existing application tests**

Run:

```bash
cd www
npm test
```

Expected: all non-database tests pass and the database-gated integration test is
skipped under its existing condition.

- [ ] **Step 6: Commit the self-contained images**

```bash
git add www/Dockerfile www/.dockerignore python/.dockerignore mysql/.dockerignore
git commit -m "Package application source in service images"
```

---

### Task 2: Add a testable remote-platform verifier

**Files:**
- Create: `scripts/verify-image-platform.js`
- Create: `scripts/test/verify-image-platform.test.js`

**Interfaces:**
- Consumes: JSON on stdin from `docker buildx imagetools inspect --format '{{json .}}' IMAGE`
- Produces: the verified `sha256:...` manifest digest on stdout; exit 0 only when the sole runnable platform is `linux/amd64`

- [ ] **Step 1: Write verifier tests for indexes, attestations, and single manifests**

Create `scripts/test/verify-image-platform.test.js`:

```javascript
"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const test = require("node:test");

const verifier = path.resolve(__dirname, "../verify-image-platform.js");
const digest = `sha256:${"a".repeat(64)}`;

function verify(document) {
    return spawnSync(process.execPath, [verifier], {
        input: JSON.stringify(document),
        encoding: "utf8",
    });
}

test("accepts one linux/amd64 image plus a BuildKit attestation", () => {
    const result = verify({
        manifest: {
            digest,
            manifests: [
                {platform: {os: "linux", architecture: "amd64"}},
                {
                    annotations: {"vnd.docker.reference.type": "attestation-manifest"},
                    platform: {os: "unknown", architecture: "unknown"},
                },
            ],
        },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), digest);
});

test("rejects an additional runnable platform", () => {
    const result = verify({
        manifest: {
            digest,
            manifests: [
                {platform: {os: "linux", architecture: "amd64"}},
                {platform: {os: "linux", architecture: "arm64"}},
            ],
        },
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /linux\/arm64/);
});

test("accepts a single linux/amd64 image manifest", () => {
    const result = verify({
        manifest: {digest},
        image: {os: "linux", architecture: "amd64"},
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), digest);
});

test("rejects malformed inspection output", () => {
    const result = verify({manifest: {}});

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /digest|platform/i);
});
```

- [ ] **Step 2: Run the verifier tests and confirm they fail**

Run:

```bash
node --test scripts/test/verify-image-platform.test.js
```

Expected: FAIL because `scripts/verify-image-platform.js` does not exist.

- [ ] **Step 3: Implement the verifier CLI**

Create `scripts/verify-image-platform.js`:

```javascript
#!/usr/bin/env node
"use strict";

const fs = require("node:fs");

function fail(message) {
    process.stderr.write(`${message}\n`);
    process.exit(1);
}

let inspection;
try {
    inspection = JSON.parse(fs.readFileSync(0, "utf8"));
} catch (error) {
    fail(`Invalid image inspection JSON: ${error.message}`);
}

const manifest = inspection.manifest;
const digest = manifest && manifest.digest;
if (!/^sha256:[a-f0-9]{64}$/.test(digest || "")) {
    fail("Image inspection did not contain a sha256 manifest digest");
}

let runnablePlatforms;
if (Array.isArray(manifest.manifests)) {
    runnablePlatforms = manifest.manifests
        .map((descriptor) => descriptor.platform || {})
        .filter((platform) =>
            platform.os !== "unknown" || platform.architecture !== "unknown");
} else {
    runnablePlatforms = [inspection.image || {}];
}

const names = runnablePlatforms.map(
    (platform) => `${platform.os || "missing"}/${platform.architecture || "missing"}`);
if (names.length !== 1 || names[0] !== "linux/amd64") {
    fail(`Expected only linux/amd64; found ${names.join(", ") || "no runnable platform"}`);
}

process.stdout.write(`${digest}\n`);
```

Make it executable:

```bash
chmod 0755 scripts/verify-image-platform.js
```

- [ ] **Step 4: Run the verifier tests**

Run:

```bash
node --test scripts/test/verify-image-platform.test.js
```

Expected: 4 tests pass.

- [ ] **Step 5: Exercise the verifier against a known public amd64 image**

Run:

```bash
docker buildx imagetools inspect \
  --format '{{json .}}' \
  mysql:5.7.44 \
  | node scripts/verify-image-platform.js
```

The upstream tag is multi-platform, so derive and inspect its amd64 descriptor:

```bash
amd64_digest="$(docker buildx imagetools inspect \
  --format '{{json .Manifest}}' mysql:5.7.44 \
  | node -e '
      let input = "";
      process.stdin.on("data", (chunk) => input += chunk);
      process.stdin.on("end", () => {
          const manifest = JSON.parse(input);
          const match = manifest.manifests.find((entry) =>
              entry.platform?.os === "linux" &&
              entry.platform?.architecture === "amd64");
          if (!match) process.exit(1);
          process.stdout.write(match.digest);
      });')"

docker buildx imagetools inspect \
  --format '{{json .}}' \
  "mysql:5.7.44@$amd64_digest" \
  | node scripts/verify-image-platform.js
```

Expected: exit 0 and one `sha256:...` digest. This command tests the verifier
without changing LegendHUB's MySQL tag.

- [ ] **Step 6: Commit the verifier**

```bash
git add scripts/verify-image-platform.js scripts/test/verify-image-platform.test.js
git commit -m "Add amd64 registry manifest verifier"
```

---

### Task 3: Add the manual three-image publisher

**Files:**
- Create: `scripts/publish-images.sh`
- Create: `scripts/test/publish-images.test.js`

**Interfaces:**
- Consumes: clean committed inputs under `www`, `python`, and `mysql`; the verifier from Task 2; the existing Docker Hub login
- Produces: verified `<12-char-sha>` and `test` tags for all three fixed `tmckimmey` repositories; prints `repository sha-tag digest` lines

- [ ] **Step 1: Write publisher integration tests with fake Git and Docker CLIs**

Create `scripts/test/publish-images.test.js`. The test must create a temporary
`bin` directory containing executable `git` and `docker` fakes, prepend it to
`PATH`, and run the real publisher. Use this Git fake:

```bash
#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  rev-parse)
    printf '%s\n' 'abcdef123456'
    ;;
  status)
    printf '%s' "${FAKE_GIT_STATUS:-}"
    ;;
  *)
    printf 'unexpected git command: %s\n' "$*" >&2
    exit 64
    ;;
esac
```

Use a stateful Docker fake with these exact behaviors:

```bash
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$FAKE_DOCKER_LOG"

encode_ref() { printf '%s' "$1" | tr '/:' '__'; }

if [[ "$1 $2" == "buildx version" || "$1 $2" == "buildx inspect" ]]; then
  exit 0
fi

if [[ "$1 $2 $3" == "buildx imagetools inspect" ]]; then
  ref="${!#}"
  test -f "$FAKE_DOCKER_STATE/$(encode_ref "$ref")" || exit 1
  cat <<JSON
{"manifest":{"digest":"sha256:${FAKE_DIGEST}","manifests":[{"platform":{"os":"linux","architecture":"amd64"}},{"platform":{"os":"unknown","architecture":"unknown"},"annotations":{"vnd.docker.reference.type":"attestation-manifest"}}]}}
JSON
  exit 0
fi

if [[ "$1 $2" == "buildx build" ]]; then
  shift 2
  while (($#)); do
    if [[ "$1" == "--tag" ]]; then
      ref="$2"
      touch "$FAKE_DOCKER_STATE/$(encode_ref "$ref")"
      break
    fi
    shift
  done
  exit 0
fi

if [[ "$1 $2 $3" == "buildx imagetools create" ]]; then
  shift 3
  while (($#)); do
    if [[ "$1" == "--tag" ]]; then
      ref="$2"
      touch "$FAKE_DOCKER_STATE/$(encode_ref "$ref")"
      exit 0
    fi
    shift
  done
fi

printf 'unexpected docker command\n' >&2
exit 64
```

The Node test file must contain these assertions:

```javascript
test("publishes three amd64 SHA images before promoting test tags", () => {
    const result = runPublisher("");
    assert.equal(result.status, 0, result.stderr);

    const log = readDockerLog();
    assert.equal((log.match(/buildx build/g) || []).length, 3);
    assert.match(log, /--platform linux\/amd64 --push --tag tmckimmey\/legendhub-www:abcdef123456/);
    assert.match(log, /--tag tmckimmey\/legendhub-python:abcdef123456/);
    assert.match(log, /--tag tmckimmey\/legendhub-mysql-backup:abcdef123456/);
    assert.equal((log.match(/imagetools create/g) || []).length, 3);
    assert.ok(log.lastIndexOf("buildx build") < log.indexOf("imagetools create"));
    assert.doesNotMatch(log, /:latest/);
});

test("refuses dirty service build inputs before invoking Docker", () => {
    const result = runPublisher("?? www/local-only.js\n");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /dirty/i);
    assert.equal(readDockerLog(), "");
});

test("reuses verified SHA images instead of overwriting them", () => {
    seedShaImageState("abcdef123456");
    const result = runPublisher("");
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(readDockerLog(), /buildx build/);
    assert.equal((readDockerLog().match(/imagetools create/g) || []).length, 3);
});
```

`runPublisher`, `readDockerLog`, and `seedShaImageState` are test harness helpers:

- `runPublisher(status)` invokes `bash scripts/publish-images.sh` with
  `FAKE_GIT_STATUS=status`, a 64-character lowercase hexadecimal `FAKE_DIGEST`,
  and the temporary fake CLI paths.
- `readDockerLog()` returns the log file or `""` before it exists.
- `seedShaImageState(sha)` creates the encoded state files for all three
  `tmckimmey/...:<sha>` references.

Wrap the two exact Bash blocks above in `gitFake` and `dockerFake` JavaScript
template strings and implement the harness with:

```javascript
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const {afterEach, beforeEach} = require("node:test");

const publisher = path.resolve(__dirname, "../publish-images.sh");
let workspace;
let fakeBin;
let dockerState;
let dockerLog;

function writeExecutable(file, content) {
    fs.writeFileSync(file, content, {mode: 0o755});
}

beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "legendhub-publisher-"));
    fakeBin = path.join(workspace, "bin");
    dockerState = path.join(workspace, "docker-state");
    dockerLog = path.join(workspace, "docker.log");
    fs.mkdirSync(fakeBin);
    fs.mkdirSync(dockerState);
    writeExecutable(path.join(fakeBin, "git"), gitFake);
    writeExecutable(path.join(fakeBin, "docker"), dockerFake);
});

afterEach(() => fs.rmSync(workspace, {recursive: true, force: true}));

function runPublisher(gitStatus) {
    return spawnSync("bash", [publisher], {
        cwd: path.resolve(__dirname, "../.."),
        env: {
            ...process.env,
            PATH: `${fakeBin}:${process.env.PATH}`,
            FAKE_DIGEST: "b".repeat(64),
            FAKE_DOCKER_LOG: dockerLog,
            FAKE_DOCKER_STATE: dockerState,
            FAKE_GIT_STATUS: gitStatus,
        },
        encoding: "utf8",
    });
}

function readDockerLog() {
    return fs.existsSync(dockerLog) ? fs.readFileSync(dockerLog, "utf8") : "";
}

function seedShaImageState(sha) {
    for (const repository of [
        "tmckimmey/legendhub-www",
        "tmckimmey/legendhub-python",
        "tmckimmey/legendhub-mysql-backup",
    ]) {
        const encoded = `${repository}:${sha}`.replace(/[/:]/g, "_");
        fs.closeSync(fs.openSync(path.join(dockerState, encoded), "w"));
    }
}
```

Import `node:assert/strict` and `node:test` for the three tests, and declare the
exact preceding fake scripts as `const gitFake = String.raw\`...\`` and
`const dockerFake = String.raw\`...\`` so backslashes reach Bash unchanged.

- [ ] **Step 2: Run the publisher tests and confirm they fail**

Run:

```bash
node --test scripts/test/publish-images.test.js
```

Expected: FAIL because `scripts/publish-images.sh` does not exist.

- [ ] **Step 3: Implement the publisher**

Create `scripts/publish-images.sh` with this structure and fixed image table:

```bash
#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd "$script_dir/.." && pwd -P)"
cd "$repo_root"

repositories=(
  "tmckimmey/legendhub-www"
  "tmckimmey/legendhub-python"
  "tmckimmey/legendhub-mysql-backup"
)
contexts=("www" "python" "mysql")

sha="$(git rev-parse --short=12 HEAD)"
[[ "$sha" =~ ^[a-f0-9]{12}$ ]] || {
  printf 'Invalid Git SHA: %s\n' "$sha" >&2
  exit 1
}

dirty="$(git status --porcelain=v1 --untracked-files=all -- www python mysql)"
[[ -z "$dirty" ]] || {
  printf 'Refusing to publish dirty image inputs:\n%s\n' "$dirty" >&2
  exit 1
}

docker buildx version >/dev/null
docker buildx inspect --bootstrap >/dev/null

verify_image() {
  local ref="$1"
  docker buildx imagetools inspect --format '{{json .}}' "$ref" \
    | node "$script_dir/verify-image-platform.js"
}

sha_digests=()
for index in "${!repositories[@]}"; do
  repository="${repositories[$index]}"
  context="${contexts[$index]}"
  ref="$repository:$sha"

  if verify_image "$ref" >/dev/null 2>&1; then
    printf 'Reusing verified %s\n' "$ref"
  else
    docker buildx build \
      --platform linux/amd64 \
      --push \
      --tag "$ref" \
      "$context"
  fi

  sha_digests[$index]="$(verify_image "$ref")"
done

for index in "${!repositories[@]}"; do
  repository="${repositories[$index]}"
  sha_ref="$repository:$sha"
  test_ref="$repository:test"

  docker buildx imagetools create \
    --prefer-index=false \
    --tag "$test_ref" \
    "$sha_ref"

  test_digest="$(verify_image "$test_ref")"
  [[ "$test_digest" == "${sha_digests[$index]}" ]] || {
    printf 'Digest mismatch: %s != %s\n' "$test_ref" "$sha_ref" >&2
    exit 1
  }

  printf '%s %s %s\n' "$repository" "$sha" "$test_digest"
done
```

Make it executable:

```bash
chmod 0755 scripts/publish-images.sh
```

- [ ] **Step 4: Run the publisher and verifier tests**

Run:

```bash
node --test scripts/test/verify-image-platform.test.js scripts/test/publish-images.test.js
```

Expected: all tests pass; no real Docker image is built or pushed because the
publisher test prepends fake CLIs to `PATH`.

- [ ] **Step 5: Perform non-mutating publisher preflight checks**

Run:

```bash
bash -n scripts/publish-images.sh
node --check scripts/verify-image-platform.js
git status --porcelain=v1 --untracked-files=all -- www python mysql
docker buildx inspect --bootstrap
```

Expected: both syntax checks exit 0, the scoped Git status is empty, and the
builder lists `linux/amd64` support.

- [ ] **Step 6: Commit the publisher**

```bash
git add scripts/publish-images.sh scripts/test/publish-images.test.js
git commit -m "Add manual amd64 image publisher"
```

---

### Task 4: Add and test the registry Compose override

**Files:**
- Create: `docker-compose.registry.yaml`
- Create: `scripts/test/registry-compose.test.js`

**Interfaces:**
- Consumes: required environment variable `LEGENDHUB_IMAGE_TAG`; base `docker-compose.yaml`; optional environment override such as `docker-compose.test.yaml`
- Produces: a merged Compose model with registry images, no application builds, and no `/app/src` host mount

- [ ] **Step 1: Write failing Compose-model tests**

Create `scripts/test/registry-compose.test.js`:

```javascript
"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const baseEnvironment = {
    ...process.env,
    EXTERNAL_PORT: "127.0.0.1:7001",
    GITHUB_REPOSITORY: "",
    GITHUB_TOKEN: "",
    MYSQL_DATABASE: "legendhub",
    MYSQL_PASSWORD: "test-app-password",
    MYSQL_PORT: "3306",
    MYSQL_ROOT_PASSWORD: "test-root-password",
    MYSQL_USER: "legendhub",
    NODE_ENV: "production",
    PORT: "80",
    RECAPTCHA_SECRET: "",
    RECAPTCHA_SITEKEY: "",
};

function render(extraEnvironment = {}) {
    return spawnSync("docker", [
        "compose",
        "-f", "docker-compose.yaml",
        "-f", "docker-compose.registry.yaml",
        "config",
        "--format", "json",
    ], {
        cwd: root,
        env: {...baseEnvironment, ...extraEnvironment},
        encoding: "utf8",
    });
}

test("requires an explicit registry image tag", () => {
    const result = render({LEGENDHUB_IMAGE_TAG: ""});
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /LEGENDHUB_IMAGE_TAG/);
});

test("uses immutable registry images without builds or the web source mount", () => {
    const result = render({LEGENDHUB_IMAGE_TAG: "abcdef123456"});
    assert.equal(result.status, 0, result.stderr);

    const services = JSON.parse(result.stdout).services;
    assert.equal(services.www.image, "tmckimmey/legendhub-www:abcdef123456");
    assert.equal(services.python.image, "tmckimmey/legendhub-python:abcdef123456");
    assert.equal(services["mysql-backup"].image,
        "tmckimmey/legendhub-mysql-backup:abcdef123456");

    for (const name of ["www", "python", "mysql-backup"]) {
        assert.equal("build" in services[name], false);
    }
    assert.equal((services.www.volumes || []).some(
        (volume) => volume.target === "/app/src"), false);
    assert.equal(services.mysql.image, "mysql:5");
    assert.equal(services.mysql.platform, "linux/amd64");
});
```

- [ ] **Step 2: Run the Compose tests and confirm they fail**

Run:

```bash
node --test scripts/test/registry-compose.test.js
```

Expected: the missing-tag test may fail for the wrong reason and the rendered
model test fails because `docker-compose.registry.yaml` does not exist.

- [ ] **Step 3: Implement the registry override**

Create `docker-compose.registry.yaml`:

```yaml
services:
    mysql-backup:
        image: tmckimmey/legendhub-mysql-backup:${LEGENDHUB_IMAGE_TAG:?set LEGENDHUB_IMAGE_TAG}
        build: !reset null
    www:
        image: tmckimmey/legendhub-www:${LEGENDHUB_IMAGE_TAG:?set LEGENDHUB_IMAGE_TAG}
        build: !reset null
        volumes: !reset []
    python:
        image: tmckimmey/legendhub-python:${LEGENDHUB_IMAGE_TAG:?set LEGENDHUB_IMAGE_TAG}
        build: !reset null
```

- [ ] **Step 4: Run the Compose tests**

Run:

```bash
node --test scripts/test/registry-compose.test.js
```

Expected: 2 tests pass.

- [ ] **Step 5: Render the real local test override combination**

The ignored test override exists locally at
`data/deploy/docker-compose.test.yaml`. Run:

```bash
LEGENDHUB_IMAGE_TAG=abcdef123456 docker compose \
  -f docker-compose.yaml \
  -f data/deploy/docker-compose.test.yaml \
  -f docker-compose.registry.yaml \
  config --format json \
  | node -e '
      let input = "";
      process.stdin.on("data", (chunk) => input += chunk);
      process.stdin.on("end", () => {
          const services = JSON.parse(input).services;
          for (const name of ["www", "python", "mysql-backup"]) {
              if (services[name].build) process.exit(1);
          }
          if ((services.www.volumes || []).some((v) => v.target === "/app/src")) {
              process.exit(1);
          }
          if (services.mysql.image !== "mysql:5.7.44") process.exit(1);
      });'
```

Expected: exit 0. This confirms the committed registry override composes with the
existing ignored test-environment override. Do not add `data/` to Git.

- [ ] **Step 6: Commit the registry override**

```bash
git add docker-compose.registry.yaml scripts/test/registry-compose.test.js
git commit -m "Add registry deployment Compose override"
```

---

### Task 5: Document publishing, deployment, and rollback

**Files:**
- Modify: `DEVELOPMENT.md:36-53`
- Modify: `DEVELOPMENT.md:65-120`

**Interfaces:**
- Consumes: `scripts/publish-images.sh`, `docker-compose.registry.yaml`, and a chosen 12-character SHA
- Produces: one operator runbook covering publishing, first-time private-registry login, test deployment, verification, and rollback

- [ ] **Step 1: Add the registry test suite to the documented verification commands**

Add this repository-root command after the existing application test section:

````markdown
Validate the registry publishing and Compose tooling from the repository root:

```sh
node --test scripts/test/*.test.js
```
````

- [ ] **Step 2: Document manual publishing**

Add a `## Publish x86_64 images` section containing:

````markdown
The publisher requires clean committed inputs under `www`, `python`, and `mysql`,
an authenticated `tmckimmey` Docker Hub session, and a Buildx builder with
`linux/amd64` support.

```sh
./scripts/publish-images.sh
```

The script publishes all three service images with the 12-character `HEAD` SHA,
verifies their remote manifests, and then moves their `test` tags to those same
digests. Deployments use the printed SHA, not `test`. The script never publishes
`latest`.
````

- [ ] **Step 3: Document test deployment and rollback**

Add a `## Deploy registry images to test` section with the one-time private
registry login and exact deployment commands:

````markdown
Authenticate the server once for private pulls:

```sh
ssh -A dunwichmass
docker login --username tmckimmey
```

From `/home/rufus/legendhub`, select the immutable release SHA:

```sh
export LEGENDHUB_IMAGE_TAG=<12-character-sha>

docker compose \
  -f docker-compose.yaml \
  -f docker-compose.test.yaml \
  -f docker-compose.registry.yaml \
  pull www python mysql-backup

docker compose \
  -f docker-compose.yaml \
  -f docker-compose.test.yaml \
  -f docker-compose.registry.yaml \
  up -d --no-build
```

Check `docker compose ... ps`, recent logs, `http://127.0.0.1:7001`, and
`https://legendhub.dunwichmass.com/`. Roll back by exporting the previous SHA and
repeating `pull` and `up -d --no-build`. Never use `down --volumes` during a
deployment or rollback.
````

- [ ] **Step 4: Run all local verification**

Run:

```bash
node --test scripts/test/*.test.js

cd www
npm test
```

Expected: the registry tests pass; all non-database web tests pass; the existing
database-gated test is skipped when its opt-in environment variable is absent.

- [ ] **Step 5: Check the documentation and working tree**

Run:

```bash
git diff --check
git diff -- DEVELOPMENT.md
git status --short
```

Expected: no whitespace errors; only the intended implementation files and the
pre-existing untracked `docker-compose-prod.yaml` appear. Do not stage that
untracked file.

- [ ] **Step 6: Commit the runbook**

```bash
git add DEVELOPMENT.md
git commit -m "Document registry release operations"
```

---

### Task 6: Publish the first release and deploy it to the test server

**Files:**
- No repository files should change in this task

**Interfaces:**
- Consumes: the final clean committed `HEAD`, the existing local `tmckimmey` Docker login, three private Docker Hub repositories, and the test server's one-time Docker login
- Produces: three SHA tags, three matching `test` tags, and a healthy test deployment pinned to the SHA

- [ ] **Step 1: Verify the release commit and branch are recoverable**

Run:

```bash
git status --short --branch
git rev-parse --short=12 HEAD
git push origin HEAD
```

Expected: only the pre-existing untracked `docker-compose-prod.yaml` remains;
the branch push succeeds. Record the printed 12-character SHA as
`LEGENDHUB_IMAGE_TAG` without editing any tracked file.

- [ ] **Step 2: Ensure all three Docker Hub repositories are private**

In Docker Hub, confirm these exact repositories exist with visibility `Private`:

```text
tmckimmey/legendhub-www
tmckimmey/legendhub-python
tmckimmey/legendhub-mysql-backup
```

Create any missing repository as private before publishing. Do not rely on the
account's default repository visibility.

- [ ] **Step 3: Publish and capture the verified digests**

Run:

```bash
./scripts/publish-images.sh | tee /tmp/legendhub-published-images.txt
```

Expected: three output lines naming the repositories, the same 12-character SHA,
and three `sha256:...` digests. Every build command targets `linux/amd64`; no
`latest` tag is created.

- [ ] **Step 4: Verify each remote SHA and test tag resolves to the same digest**

Run this with `LEGENDHUB_IMAGE_TAG` set to the release SHA:

```bash
for repository in \
  tmckimmey/legendhub-www \
  tmckimmey/legendhub-python \
  tmckimmey/legendhub-mysql-backup
do
  sha_digest="$(docker buildx imagetools inspect --format '{{json .}}' \
    "$repository:$LEGENDHUB_IMAGE_TAG" | node scripts/verify-image-platform.js)"
  test_digest="$(docker buildx imagetools inspect --format '{{json .}}' \
    "$repository:test" | node scripts/verify-image-platform.js)"
  test "$sha_digest" = "$test_digest"
  printf '%s %s\n' "$repository" "$sha_digest"
done
```

Expected: three repository/digest lines and exit 0.

- [ ] **Step 5: Complete the server's one-time private-registry login**

The operator runs this interactively so the Docker Hub credential is never sent
through agent logs or committed files:

```bash
ssh -A dunwichmass
docker login --username tmckimmey
```

Expected: `Login Succeeded`. Exit the interactive shell after login.

- [ ] **Step 6: Update the server checkout without disturbing local deployment files**

Run:

```bash
ssh -A dunwichmass '
  set -e
  cd /home/rufus/legendhub
  git fetch origin
  git checkout --detach '"$(git rev-parse HEAD)"'
  test -f .env
  test -f docker-compose.test.yaml
  test -f docker-compose.registry.yaml
'
```

Expected: the checkout reaches the exact release commit and retains the ignored
`.env` and `docker-compose.test.yaml` files.

- [ ] **Step 7: Render, pull, and deploy the immutable release**

Run:

```bash
ssh -A dunwichmass '
  set -e
  cd /home/rufus/legendhub
  export LEGENDHUB_IMAGE_TAG='"$LEGENDHUB_IMAGE_TAG"'
  compose="docker compose -f docker-compose.yaml -f docker-compose.test.yaml -f docker-compose.registry.yaml"
  $compose config --quiet
  $compose pull www python mysql-backup
  $compose up -d --no-build
  $compose ps
'
```

Expected: all four services are running and MySQL becomes healthy. The command
does not run `down` and does not remove any named volume.

- [ ] **Step 8: Verify image selection, routes, and logs**

Run:

```bash
ssh -A dunwichmass '
  set -e
  cd /home/rufus/legendhub
  export LEGENDHUB_IMAGE_TAG='"$LEGENDHUB_IMAGE_TAG"'
  compose="docker compose -f docker-compose.yaml -f docker-compose.test.yaml -f docker-compose.registry.yaml"

  $compose ps
  $compose images
  for service in www python mysql-backup; do
    container_id="$($compose ps -q "$service")"
    docker inspect --format "{{.Config.Image}}" "$container_id" \
      | grep -F ":$LEGENDHUB_IMAGE_TAG$"
  done

  for route in / /items/ /mobs/ /quests/ /wiki/ /builder/ /login.html /api; do
    code="$(curl -sS -o /dev/null -w "%{http_code}" \
      -H "Accept: text/html" "http://127.0.0.1:7001$route")"
    printf "%s %s\n" "$code" "$route"
    test "$code" -ge 200
    test "$code" -lt 500
  done

  $compose logs --since=5m www python mysql-backup mysql
'

curl -fsS -o /dev/null https://legendhub.dunwichmass.com/
```

Expected: every published container reports the requested SHA tag, all local
routes return below 500, the public HTTPS request succeeds, and recent logs show
no startup or migration failure.

- [ ] **Step 9: Record the deployed release in the handoff**

Report the release SHA and the three verified digests from
`/tmp/legendhub-published-images.txt`. Also report that the test server is pinned
to that SHA, MySQL stayed healthy, and the named volumes were preserved. Do not
create another repository commit for deployment state.
