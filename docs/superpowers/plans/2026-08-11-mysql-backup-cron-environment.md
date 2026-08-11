# MySQL Backup Cron Environment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the containerized daily MySQL backup job receive its required database environment securely and report verifiable success or failure through Docker logs.

**Architecture:** A small Bash entrypoint validates and serializes the container's required database variables into a root-only runtime file before replacing itself with foreground cron. The static cron command uses Bash to source that file and run the existing backup script, whose completion checks and secret-free success record provide operational evidence.

**Tech Stack:** Bash, Debian bookworm cron, Docker/Buildx, Node.js built-in test runner, Docker Compose

## Global Constraints

- Keep the daily schedule at exactly 06:11 UTC.
- Do not commit, bake into an image, place on a command line, or print any secret value.
- Keep `/run/legendhub-backup.env` mode `0600` and create it only at container runtime.
- Preserve the existing `database-backups` volume and `/backups/private` and `/backups/public` paths.
- Do not change database schemas, backup contents, retention rules, or volume names.
- Do not add a third-party scheduler or production-host cron entry.
- Test and deployment images must remain `linux/amd64`.
- Publish all three private LegendHUB image repositories under one immutable 12-character Git SHA only after separate publication authorization.
- Do not push, publish, deploy, tag, or mutate production during implementation without authorization for that specific action.
- Do not modify the user-owned untracked root `docker-compose-prod.yaml` or the user-owned production planning files in the primary checkout.

---

## File Structure

- Create `mysql/backup-entrypoint`: validate required environment, write the root-only Bash environment file atomically, and execute the Docker command.
- Modify `mysql/Dockerfile`: install the entrypoint and use `ENTRYPOINT` plus the existing foreground-cron command as `CMD`.
- Modify `mysql/cron-mysql`: select Bash, source the fixed runtime environment, and route job output to PID 1.
- Create `scripts/test/mysql-backup-cron.test.js`: image-level regression coverage for startup, quoting, permissions, cron wiring, backup completion, and secret handling.
- Modify `mysql/backup-mysql`: require nonempty artifacts and emit a secret-free success record.
- Modify `DEVELOPMENT.md`: document manual execution, artifact verification, and Docker-log inspection.

---

### Task 1: Securely bridge the container environment into cron

**Files:**
- Create: `mysql/backup-entrypoint`
- Modify: `mysql/Dockerfile:7-16`
- Modify: `mysql/cron-mysql:1`
- Create: `scripts/test/mysql-backup-cron.test.js`

**Interfaces:**
- Consumes: nonempty container variables `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, and `MYSQL_DATABASE`; Docker command arguments supplied through `CMD` or `docker run IMAGE COMMAND...`.
- Produces: `/run/legendhub-backup.env`, containing Bash-safe exports at mode `0600`; a cron child command that sources that exact file; exit code `64` for a missing command and exit code `1` for missing environment.

- [ ] **Step 1: Write the failing image-level entrypoint tests**

Create `scripts/test/mysql-backup-cron.test.js` with a single cached image build and helpers that never print the test password:

```js
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const {after, before, test} = require("node:test");

const root = path.resolve(__dirname, "../..");
const image = `legendhub-mysql-backup-cron-test:${process.pid}`;
const requiredEnvironment = {
    MYSQL_DATABASE: "legendhub",
    MYSQL_PASSWORD: "space '$dollar%back\\slash",
    MYSQL_PORT: "3306",
    MYSQL_USER: "legendhub",
};

function docker(args) {
    return spawnSync("docker", args, {
        cwd: root,
        encoding: "utf8",
    });
}

function environmentArguments(environment = requiredEnvironment) {
    return Object.entries(environment).flatMap(
        ([name, value]) => ["--env", `${name}=${value}`]);
}

before(() => {
    const result = docker(["build", "--tag", image, "mysql"]);
    assert.equal(result.status, 0, result.stderr);
});

after(() => {
    docker(["image", "rm", "--force", image]);
});

test("backup image wires the entrypoint to foreground cron", () => {
    const result = docker(["image", "inspect", "--format", "{{json .Config}}", image]);
    assert.equal(result.status, 0, result.stderr);
    const config = JSON.parse(result.stdout);
    assert.deepEqual(config.Entrypoint, ["/usr/local/bin/backup-entrypoint"]);
    assert.deepEqual(config.Cmd, ["cron", "-f", "-L", "15"]);

    const cron = fs.readFileSync(path.join(root, "mysql/cron-mysql"), "utf8");
    assert.match(cron, /^SHELL=\/bin\/bash$/m);
    assert.match(cron,
        /^11 6 \* \* \* root source \/run\/legendhub-backup\.env && exec \/usr\/local\/bin\/backup-mysql >> \/proc\/1\/fd\/1 2>> \/proc\/1\/fd\/2$/m);
    assert.doesNotMatch(cron, /MYSQL_PASSWORD|\$\{MYSQL_/);
});

for (const variable of Object.keys(requiredEnvironment)) {
    for (const state of ["missing", "empty"]) {
        test(`entrypoint fails closed when ${variable} is ${state}`, () => {
            const environment = {...requiredEnvironment};
            if (state === "missing")
                delete environment[variable];
            else
                environment[variable] = "";
            const result = docker(["run", "--rm", ...environmentArguments(environment),
                image, "true"]);
            assert.notEqual(result.status, 0);
            assert.match(result.stderr,
                new RegExp(`required variable ${variable} is missing`));
            assert.doesNotMatch(result.stderr + result.stdout,
                new RegExp(requiredEnvironment.MYSQL_PASSWORD.replace(
                    /[.*+?^${}()|[\]\\]/g, "\\$&")));
        });
    }
}

test("entrypoint writes a private sourceable environment without logging it", () => {
    const result = docker(["run", "--rm", ...environmentArguments(),
        "--env", `EXPECTED_PASSWORD=${requiredEnvironment.MYSQL_PASSWORD}`,
        image, "bash", "-c",
        "test \"$(stat -c %a /run/legendhub-backup.env)\" = 600; " +
        "unset MYSQL_PASSWORD; source /run/legendhub-backup.env; " +
        "test \"$MYSQL_PASSWORD\" = \"$EXPECTED_PASSWORD\""]);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr + result.stdout,
        new RegExp(requiredEnvironment.MYSQL_PASSWORD.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("entrypoint rejects an absent command", () => {
    const result = docker(["run", "--rm", ...environmentArguments(),
        "--entrypoint", "bash", image, "-c", "/usr/local/bin/backup-entrypoint"]);
    assert.equal(result.status, 64);
    assert.match(result.stderr, /command is required/);
});
```

- [ ] **Step 2: Run the focused test and verify the red state**

Run:

```bash
node --test scripts/test/mysql-backup-cron.test.js
```

Expected: FAIL because the image has no `/usr/local/bin/backup-entrypoint`, still declares cron directly as `CMD`, and the cron file does not source the runtime environment.

- [ ] **Step 3: Implement the minimal entrypoint**

Create executable `mysql/backup-entrypoint`:

```bash
#!/bin/bash
set -euo pipefail

required_variables=(
  MYSQL_PORT
  MYSQL_USER
  MYSQL_PASSWORD
  MYSQL_DATABASE
)

for variable_name in "${required_variables[@]}"; do
  if [[ -z "${!variable_name:-}" ]]; then
    printf 'backup-entrypoint: required variable %s is missing\n' \
      "$variable_name" >&2
    exit 1
  fi
done

[[ "$#" -gt 0 ]] || {
  printf 'backup-entrypoint: command is required\n' >&2
  exit 64
}

umask 077
runtime_file=/run/legendhub-backup.env
temporary_file="$(mktemp /run/legendhub-backup.env.XXXXXX)"
trap 'rm -f -- "$temporary_file"' EXIT

for variable_name in "${required_variables[@]}"; do
  printf 'export %s=%q\n' "$variable_name" "${!variable_name}" \
    >> "$temporary_file"
done

chmod 0600 "$temporary_file"
mv -f -- "$temporary_file" "$runtime_file"
trap - EXIT

exec "$@"
```

The only dynamic text written by an error is a fixed variable name from
`required_variables`; no value is printed.

- [ ] **Step 4: Wire the Dockerfile and cron command**

Update `mysql/Dockerfile` to copy and enable the entrypoint:

```dockerfile
COPY backup-entrypoint /usr/local/bin/backup-entrypoint
COPY backup-mysql /usr/local/bin/backup-mysql

RUN chmod 0644 /etc/cron.d/cron-mysql \
    && chmod +x /usr/local/bin/backup-entrypoint \
        /usr/local/bin/backup-mysql \
    && mkdir -p /backups/private /backups/public

ENTRYPOINT ["/usr/local/bin/backup-entrypoint"]
CMD ["cron", "-f", "-L", "15"]
```

Remove `touch /var/log/cron.log`; job output no longer belongs in an internal
file.

Replace `mysql/cron-mysql` with:

```cron
SHELL=/bin/bash
11 6 * * * root source /run/legendhub-backup.env && exec /usr/local/bin/backup-mysql >> /proc/1/fd/1 2>> /proc/1/fd/2
```

- [ ] **Step 5: Run focused tests and shell syntax checks**

Run:

```bash
node --test scripts/test/mysql-backup-cron.test.js
bash -n mysql/backup-entrypoint mysql/backup-mysql
```

Expected: all entrypoint tests pass and both scripts parse successfully.

- [ ] **Step 6: Commit the environment bridge**

Run:

```bash
git add -- \
  mysql/Dockerfile \
  mysql/backup-entrypoint \
  mysql/cron-mysql \
  scripts/test/mysql-backup-cron.test.js
git diff --cached --check
git commit -m "fix: pass container environment to backup cron"
```

Expected: one commit containing only the entrypoint, Docker/cron wiring, and focused regression test.

---

### Task 2: Require and report complete backup artifacts

**Files:**
- Modify: `mysql/backup-mysql:1-53`
- Modify: `scripts/test/mysql-backup-cron.test.js`

**Interfaces:**
- Consumes: the four sourced database variables from Task 1 and writable `/backups/private` and `/backups/public` directories.
- Produces: two nonempty artifacts followed by one stdout line shaped as `backup-mysql: success timestamp=<UTC> private=<path> private-bytes=<integer> public=<path> public-bytes=<integer>`; nonzero exit and no success line on dump failure.

- [ ] **Step 1: Add failing completion and failure-path tests**

Append helpers and tests to `scripts/test/mysql-backup-cron.test.js`:

```js
function runBackup(fakeDumpBody) {
    const command = [
        "fake_bin=$(mktemp -d)",
        "trap 'rm -rf -- \"$fake_bin\"' EXIT",
        "printf '%s\\n' '#!/bin/sh' " +
            `'${fakeDumpBody.replaceAll("'", "'\\''")}' > \"$fake_bin/mysqldump\"`,
        "chmod +x \"$fake_bin/mysqldump\"",
        "PATH=\"$fake_bin:$PATH\" /usr/local/bin/backup-mysql",
    ].join("; ");
    return docker(["run", "--rm", ...environmentArguments(),
        image, "bash", "-c", command]);
}

test("backup command reports two nonempty artifacts without leaking secrets", () => {
    const result = runBackup("printf 'CREATE TABLE backup_test (id int);\\n'");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout,
        /backup-mysql: success timestamp=\S+ private=\/backups\/private\/database_\d{2}-\d{2}-\d{4}\.sql\.gz private-bytes=[1-9]\d* public=\/backups\/public\/database\.sql public-bytes=[1-9]\d*/);
    assert.doesNotMatch(result.stdout + result.stderr,
        new RegExp(requiredEnvironment.MYSQL_PASSWORD.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("backup command does not report success after a dump failure", () => {
    const result = runBackup("exit 17");
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /backup-mysql: success/);
});
```

- [ ] **Step 2: Run the completion tests and verify the red state**

Run:

```bash
node --test --test-name-pattern='backup command' scripts/test/mysql-backup-cron.test.js
```

Expected: the success case fails because `backup-mysql` emits no completion record; the dump-failure case already exits nonzero and must remain green.

- [ ] **Step 3: Add explicit artifact gates and the safe success record**

Append to `mysql/backup-mysql` after the final `mysqldump` pipeline:

```bash
[[ -s "$private_backup" ]] || {
  printf 'backup-mysql: private backup is missing or empty\n' >&2
  exit 1
}

[[ -s "$public_backup" ]] || {
  printf 'backup-mysql: public backup is missing or empty\n' >&2
  exit 1
}

printf 'backup-mysql: success timestamp=%s private=%s private-bytes=%s public=%s public-bytes=%s\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  "$private_backup" "$(stat -c %s "$private_backup")" \
  "$public_backup" "$(stat -c %s "$public_backup")"
```

Do not print `MYSQL_PWD`, `MYSQL_PASSWORD`, dump content, or command tracing.

- [ ] **Step 4: Run focused and complete script tests**

Run:

```bash
node --test scripts/test/mysql-backup-cron.test.js
node --test scripts/test/*.test.js
bash -n mysql/backup-entrypoint mysql/backup-mysql
```

Expected: the focused suite and all script tests pass with zero failures.

- [ ] **Step 5: Commit backup completion evidence**

Run:

```bash
git add -- mysql/backup-mysql scripts/test/mysql-backup-cron.test.js
git diff --cached --check
git commit -m "fix: report completed database backups"
```

Expected: one commit containing only the backup completion gates and their tests.

---

### Task 3: Document verification and run the complete release gate

**Files:**
- Modify: `DEVELOPMENT.md:130-135`

**Interfaces:**
- Consumes: Task 1's runtime environment bridge and Task 2's success record.
- Produces: operator commands that run a backup, list only artifact metadata, and inspect bounded backup logs without exposing contents or credentials.

- [ ] **Step 1: Extend the manual-backup runbook**

Replace the short backup paragraph in `DEVELOPMENT.md` with:

````markdown
Generate a database backup immediately with:

```sh
docker compose exec mysql-backup /usr/local/bin/backup-mysql
```

The command must print one `backup-mysql: success` line. Verify both artifacts
without displaying their contents:

```sh
docker compose exec mysql-backup \
  find /backups/private /backups/public -type f -size +0c \
  -printf '%p %s bytes\n'
docker compose logs --tail=100 mysql-backup
```

Scheduled backups run daily at 06:11 UTC. Treat a missing success line, an
empty artifact list, or a nonzero command as a failed backup.
````

- [ ] **Step 2: Run focused documentation and source checks**

Run:

```bash
rg -n '06:11 UTC|backup-mysql: success|/backups/private|docker compose logs' DEVELOPMENT.md
git diff --check -- DEVELOPMENT.md mysql scripts/test/mysql-backup-cron.test.js
```

Expected: all four operational markers are present and the scoped whitespace check exits zero.

- [ ] **Step 3: Run the complete automated verification**

Run:

```bash
node --test scripts/test/mysql-backup-cron.test.js
node --test scripts/test/*.test.js
npm test --prefix www
npm test --prefix css
bash -n \
  mysql/backup-entrypoint \
  mysql/backup-mysql \
  scripts/publish-images.sh \
  scripts/deploy-test.sh
```

Expected: the focused and complete script suites pass; the web suite has zero failures and only its documented opt-in MySQL migration skip; CSS lint exits zero; every shell file parses successfully.

- [ ] **Step 4: Build and inspect the release-platform backup image**

Run:

```bash
docker buildx build \
  --platform linux/amd64 \
  --load \
  --tag legendhub-mysql-backup:cron-environment-verification \
  mysql

test "$(docker image inspect --format '{{.Os}}/{{.Architecture}}' \
  legendhub-mysql-backup:cron-environment-verification)" = linux/amd64

docker image inspect --format '{{json .Config.Entrypoint}} {{json .Config.Cmd}}' \
  legendhub-mysql-backup:cron-environment-verification
```

Expected: build exit zero; platform is exactly `linux/amd64`; configuration
prints `["/usr/local/bin/backup-entrypoint"] ["cron","-f","-L","15"]`.

- [ ] **Step 5: Remove only the local verification image**

Run:

```bash
docker image rm legendhub-mysql-backup:cron-environment-verification
```

Expected: only the local verification tag/image is removed. Do not remove published, test, production, database, or rollback images.

- [ ] **Step 6: Review scope and repository boundaries**

Run:

```bash
git diff --stat master
git diff --name-only master
git status --short --branch
```

Expected: the branch contains the approved design and plan, the new entrypoint and focused test, the MySQL Docker/cron/backup changes, and `DEVELOPMENT.md`. It does not contain root `docker-compose-prod.yaml`, production cutover files, application code, database schema changes, or unrelated theme changes.

- [ ] **Step 7: Commit the runbook**

Run:

```bash
git add -- DEVELOPMENT.md
git diff --cached --check
git commit -m "docs: verify scheduled database backups"
```

Expected: one documentation-only commit.

---

## Operational Hold Point

Implementation completion does not authorize GitHub push, Docker publication,
Dunwichmass deployment, manual production backup, or production deployment.
Before any production image change, separately authorize and run the current
container's manual backup command, verify both nonempty artifacts, and preserve
the existing production Compose file. Publication and test deployment then use
a new immutable SHA through the repository-owned scripts. Production rollout
requires another explicit authorization and a deployment plan updated from the
actual mixed-image production state.
