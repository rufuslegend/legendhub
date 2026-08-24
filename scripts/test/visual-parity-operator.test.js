"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const {afterEach, beforeEach, test} = require("node:test");

const candidateRoot = path.resolve(__dirname, "../..");
const operator = path.join(candidateRoot, "scripts/run-visual-parity.sh");
const referenceSha = "0cab3ac95826a53de19b3146d277e7056495210f";
const candidateSha = "1234567890abcdef1234567890abcdef12345678";
const candidateShortSha = candidateSha.slice(0, 12);
const timestamp = "20260824T120000Z";
const reportDirectory = path.join(candidateRoot, "data/parity-report",
    `${timestamp}-${candidateShortSha}`);
const secret = "operator-secret-must-not-leak";
const dollar = "$";

const gitFake = String.raw`#!/usr/bin/env bash
set -euo pipefail
printf '%s\0' "${dollar}@" >> "${dollar}FAKE_GIT_LOG"
printf '\036' >> "${dollar}FAKE_GIT_LOG"
printf 'git|%s\n' "${dollar}*" >> "${dollar}FAKE_EVENT_LOG"

candidate_root="${dollar}FAKE_CANDIDATE_ROOT"
reference_root="${dollar}FAKE_REFERENCE_ROOT"

if [[ "${dollar}*" == "-C ${dollar}candidate_root rev-parse --path-format=absolute --git-common-dir" ]]; then
  printf '%s\n' "${dollar}FAKE_COMMON_GIT_DIR"
  exit 0
fi
if [[ "${dollar}*" == "-C ${dollar}candidate_root rev-parse --verify v2.9.0^{commit}" ]]; then
  printf '%s\n' "${dollar}FAKE_REFERENCE_SHA"
  exit 0
fi
if [[ "${dollar}*" == "-C ${dollar}candidate_root rev-parse HEAD" ]]; then
  printf '%s\n' "${dollar}FAKE_CANDIDATE_SHA"
  exit 0
fi
if [[ "${dollar}*" == "-C ${dollar}candidate_root worktree add --detach ${dollar}reference_root ${dollar}FAKE_REFERENCE_SHA" ]]; then
  mkdir -p "${dollar}reference_root/mysql/conf"
  printf 'services: {}\n' > "${dollar}reference_root/docker-compose.yaml"
  exit "${dollar}{FAKE_WORKTREE_ADD_STATUS:-0}"
fi
if [[ "${dollar}*" == "-C ${dollar}reference_root rev-parse HEAD" ]]; then
  printf '%s\n' "${dollar}{FAKE_REFERENCE_HEAD:-${dollar}FAKE_REFERENCE_SHA}"
  exit 0
fi
if [[ "${dollar}*" == "-C ${dollar}reference_root status --porcelain" ]]; then
  if [[ "${dollar}{FAKE_REFERENCE_STATUS_EXIT_STATUS:-0}" != 0 ]]; then
    exit "${dollar}FAKE_REFERENCE_STATUS_EXIT_STATUS"
  fi
  printf '%s' "${dollar}{FAKE_REFERENCE_STATUS:-}"
  exit 0
fi
if [[ "${dollar}*" == "-C ${dollar}reference_root symbolic-ref -q HEAD" ]]; then
  symbolic_ref_status="${dollar}{FAKE_SYMBOLIC_REF_STATUS:-1}"
  if [[ "${dollar}symbolic_ref_status" == 0 ]]; then
    printf 'refs/heads/unexpected-reference-branch\n'
  fi
  exit "${dollar}symbolic_ref_status"
fi

printf 'unexpected fake git command\n' >&2
exit 64
`;

const dockerFake = String.raw`#!/usr/bin/env bash
set -euo pipefail
printf '%s\0' "${dollar}@" >> "${dollar}FAKE_DOCKER_LOG"
printf '\036' >> "${dollar}FAKE_DOCKER_LOG"
printf 'docker|%s\n' "${dollar}*" >> "${dollar}FAKE_EVENT_LOG"
printf '%s\0%s\0%s\0%s\0%s\0%s\0%s\0\036' \
  "${dollar}{LEGENDHUB_PARITY_HTTPS_PORT:-}" \
  "${dollar}{LEGENDHUB_PARITY_STATE_DIR:-}" \
  "${dollar}{LEGENDHUB_PARITY_FIXTURE:-}" \
  "${dollar}{LEGENDHUB_PARITY_NGINX_CONFIG:-}" \
  "${dollar}{LEGENDHUB_PARITY_SNAPSHOT:-}" \
  "${dollar}{LEGENDHUB_PARITY_CERTIFICATE:-}" \
  "${dollar}{LEGENDHUB_PARITY_CERTIFICATE_KEY:-}" >> "${dollar}FAKE_DOCKER_ENV_LOG"

project=""
for ((index = 1; index <= ${dollar}#; index += 1)); do
  if [[ "${dollar}{!index}" == --project-name ]]; then
    next_index=${dollar}((index + 1))
    project="${dollar}{!next_index}"
  fi
done

if [[ "${dollar}1" == ps && "${dollar}{FAKE_STALE_KIND:-}" == container &&
      "${dollar}*" == *"com.docker.compose.project=${dollar}{FAKE_STALE_PROJECT:-}"* ]]; then
  printf 'stale-container\n'
fi
if [[ "${dollar}1 ${dollar}2" == "network ls" && "${dollar}{FAKE_STALE_KIND:-}" == network &&
      "${dollar}*" == *"com.docker.compose.project=${dollar}{FAKE_STALE_PROJECT:-}"* ]]; then
  printf 'stale-network\n'
fi
if [[ "${dollar}1 ${dollar}2" == "volume ls" && "${dollar}{FAKE_STALE_KIND:-}" == volume &&
      "${dollar}*" == *"com.docker.compose.project=${dollar}{FAKE_STALE_PROJECT:-}"* ]]; then
  printf 'stale-volume\n'
fi

if [[ "${dollar}1" == compose && "${dollar}*" == *" logs "* ]]; then
  printf 'bounded diagnostic for %s\n' "${dollar}project"
fi
if [[ -n "${dollar}{FAKE_DOCKER_FAIL_PATTERN:-}" &&
      "${dollar}*" == *"${dollar}FAKE_DOCKER_FAIL_PATTERN"* ]]; then
  exit "${dollar}{FAKE_DOCKER_FAIL_STATUS:-1}"
fi
if [[ "${dollar}1" == compose && "${dollar}*" == *" down --volumes --remove-orphans"* &&
      "${dollar}{FAKE_DOWN_FAIL_STATUS:-0}" != 0 ]]; then
  exit "${dollar}FAKE_DOWN_FAIL_STATUS"
fi
`;

const npmFake = String.raw`#!/usr/bin/env bash
set -euo pipefail
printf '%s\0' "${dollar}@" >> "${dollar}FAKE_NPM_LOG"
printf '\036' >> "${dollar}FAKE_NPM_LOG"
printf 'npm|%s\n' "${dollar}*" >> "${dollar}FAKE_EVENT_LOG"
case "${dollar}{FAKE_NPM_SIGNAL:-}" in
  TERM) kill -TERM "${dollar}PPID"; exit 143 ;;
  INT) kill -INT "${dollar}PPID"; exit 130 ;;
esac
exit "${dollar}{FAKE_NPM_STATUS:-0}"
`;

const curlFake = String.raw`#!/usr/bin/env bash
set -euo pipefail
printf '%s\0' "${dollar}@" >> "${dollar}FAKE_CURL_LOG"
printf '\036' >> "${dollar}FAKE_CURL_LOG"
printf 'curl|%s\n' "${dollar}*" >> "${dollar}FAKE_EVENT_LOG"
if [[ -n "${dollar}{FAKE_CURL_FAIL_URL:-}" &&
      "${dollar}*" == *"${dollar}FAKE_CURL_FAIL_URL"* ]]; then
  exit 22
fi
`;

const lsofFake = String.raw`#!/usr/bin/env bash
set -euo pipefail
printf '%s\0' "${dollar}@" >> "${dollar}FAKE_LSOF_LOG"
printf '\036' >> "${dollar}FAKE_LSOF_LOG"
if [[ -n "${dollar}{FAKE_OCCUPIED_PORT:-}" &&
      "${dollar}*" == *":${dollar}FAKE_OCCUPIED_PORT"* ]]; then
  printf 'occupied\n'
  exit 0
fi
exit "${dollar}{FAKE_LSOF_STATUS:-1}"
`;

const dateFake = `#!/usr/bin/env bash\nprintf '%s\\n' '${timestamp}'\n`;
const sleepFake = "#!/usr/bin/env bash\nexit 0\n";
const unameFake = String.raw`#!/usr/bin/env bash
printf '%s\n' "${dollar}{FAKE_UNAME:-Darwin}"
`;

let workspace;
let fakeBin;
let stateDirectory;
let sharedRoot;
let referenceRoot;
let logs;

function writeExecutable(file, content) {
    fs.writeFileSync(file, content, {mode: 0o755});
}

function writeRequiredState() {
    fs.mkdirSync(path.join(stateDirectory, "backups"), {recursive: true});
    fs.mkdirSync(path.join(stateDirectory, "tls"), {recursive: true});
    fs.writeFileSync(path.join(stateDirectory, "local.env"), [
        "MYSQL_PASSWORD=test-password",
        `SECRET_VALUE=${secret}`,
        "",
    ].join("\n"));
    fs.writeFileSync(path.join(stateDirectory, "backups/dunwich-latest.sql.gz"),
        "snapshot");
    fs.writeFileSync(path.join(stateDirectory, "tls/localhost.pem"), "certificate");
    fs.writeFileSync(path.join(stateDirectory, "tls/localhost-key.pem"), "key");
}

function createReferenceWorktree() {
    fs.mkdirSync(path.join(referenceRoot, "mysql/conf"), {recursive: true});
    fs.writeFileSync(path.join(referenceRoot, "docker-compose.yaml"),
        "services: {}\n");
}

function readRecords(file) {
    if (!fs.existsSync(file)) {
        return [];
    }
    const contents = fs.readFileSync(file, "utf8");
    return contents === "" ? [] : contents.split("\x1e").filter(Boolean).map(
        (record) => record.split("\0").slice(0, -1));
}

function composePrefix(checkout, project, platform = "Darwin") {
    const prefix = [
        "compose",
        "--project-directory", checkout,
        "--project-name", project,
        "--env-file", path.join(stateDirectory, "local.env"),
        "-f", path.join(checkout, "docker-compose.yaml"),
        "-f", path.join(candidateRoot, "docker-compose.parity.yaml"),
    ];
    if (platform === "Darwin") {
        prefix.push("-f", path.join(candidateRoot,
            "docker-compose.parity-darwin.yaml"));
    }
    return prefix;
}

function printableCompose(checkout, project, suffix, platform = "Darwin") {
    const port = project.endsWith("reference") ? "7443" : "7444";
    return [
        `LEGENDHUB_PARITY_HTTPS_PORT=${port}`,
        `LEGENDHUB_PARITY_STATE_DIR=${stateDirectory}`,
        `LEGENDHUB_PARITY_FIXTURE=${path.join(candidateRoot,
            "scripts/fixtures/visual-parity.sql")}`,
        `LEGENDHUB_PARITY_NGINX_CONFIG=${path.join(candidateRoot,
            "nginx/parity.conf")}`,
        "docker", ...composePrefix(checkout, project, platform), ...suffix,
    ].join(" ");
}

function environment(overrides = {}) {
    return {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
        FAKE_CANDIDATE_ROOT: candidateRoot,
        FAKE_CANDIDATE_SHA: candidateSha,
        FAKE_COMMON_GIT_DIR: path.join(sharedRoot, ".git"),
        FAKE_CURL_LOG: logs.curl,
        FAKE_DOCKER_ENV_LOG: logs.dockerEnvironment,
        FAKE_DOCKER_LOG: logs.docker,
        FAKE_EVENT_LOG: logs.events,
        FAKE_GIT_LOG: logs.git,
        FAKE_LSOF_LOG: logs.lsof,
        FAKE_NPM_LOG: logs.npm,
        FAKE_REFERENCE_ROOT: referenceRoot,
        FAKE_REFERENCE_SHA: referenceSha,
        LEGENDHUB_LOCAL_STATE_DIR: stateDirectory,
        ...overrides,
    };
}

function runOperator(args = [], overrides = {}) {
    return spawnSync("bash", [operator, ...args], {
        encoding: "utf8",
        env: environment(overrides),
    });
}

function assertNoForbiddenTarget(result) {
    const recorded = [
        result.stdout,
        result.stderr,
        ...Object.values(logs).map((file) =>
            fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""),
    ].join("\n");
    assert.equal(recorded.includes("legendhub-local"), false, recorded);
    assert.equal(recorded.includes("docker-compose-prod.yaml"), false, recorded);
    assert.equal(result.stdout.includes(secret), false);
    assert.equal(result.stderr.includes(secret), false);
}

function downCalls() {
    return readRecords(logs.docker).filter((call) =>
        call[0] === "compose" && call.includes("down"));
}

function assertNoExternalEventAfter(eventFragment) {
    const events = fs.readFileSync(logs.events, "utf8").trimEnd().split("\n");
    const failedIndex = events.findIndex((event) => event.includes(eventFragment));
    assert.notEqual(failedIndex, -1, `missing event containing ${eventFragment}`);
    assert.deepEqual(events.slice(failedIndex + 1).filter((event) =>
        /^(git|docker|npm|curl)\|/.test(event)), []);
}

beforeEach(() => {
    workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),
        "legendhub-parity-operator-")));
    fakeBin = path.join(workspace, "bin");
    stateDirectory = path.join(workspace, "state");
    sharedRoot = path.join(workspace, "shared-repository");
    referenceRoot = path.join(sharedRoot, ".worktrees/parity-v2.9.0");
    logs = Object.fromEntries([
        "curl", "docker", "dockerEnvironment", "events", "git", "lsof", "npm",
    ].map((name) => [name, path.join(workspace, `${name}.log`)]));
    fs.mkdirSync(fakeBin, {recursive: true});
    fs.mkdirSync(path.join(sharedRoot, ".git"), {recursive: true});
    writeRequiredState();
    writeExecutable(path.join(fakeBin, "git"), gitFake);
    writeExecutable(path.join(fakeBin, "docker"), dockerFake);
    writeExecutable(path.join(fakeBin, "npm"), npmFake);
    writeExecutable(path.join(fakeBin, "curl"), curlFake);
    writeExecutable(path.join(fakeBin, "lsof"), lsofFake);
    writeExecutable(path.join(fakeBin, "date"), dateFake);
    writeExecutable(path.join(fakeBin, "sleep"), sleepFake);
    writeExecutable(path.join(fakeBin, "uname"), unameFake);
});

afterEach(() => {
    fs.rmSync(workspace, {recursive: true, force: true});
    fs.rmSync(reportDirectory, {recursive: true, force: true});
});

for (const relativeFile of [
    "local.env",
    "backups/dunwich-latest.sql.gz",
    "tls/localhost.pem",
    "tls/localhost-key.pem",
]) {
    test(`rejects an empty ${relativeFile} before Git or Docker`, () => {
        fs.writeFileSync(path.join(stateDirectory, relativeFile), "");

        const result = runOperator(["--mode", "smoke"]);

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /required local state is missing/);
        assert.deepEqual(readRecords(logs.git), []);
        assert.deepEqual(readRecords(logs.docker), []);
        assertNoForbiddenTarget(result);
    });
}

test("rejects invalid arguments before invoking external commands", () => {
    const result = runOperator(["--mode", "quick"]);

    assert.equal(result.status, 64);
    assert.match(result.stderr, /Usage:/);
    assert.deepEqual(readRecords(logs.git), []);
    assert.deepEqual(readRecords(logs.docker), []);
    assertNoForbiddenTarget(result);
});

for (const resolvedSha of ["f".repeat(40), referenceSha.slice(0, -1)]) {
    test(`rejects v2.9.0 resolving to ${resolvedSha.length} unexpected characters`, () => {
        const result = runOperator(["--mode", "smoke"], {
            FAKE_REFERENCE_SHA: resolvedSha,
        });

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /v2\.9\.0 did not resolve to the required commit/);
        assert.deepEqual(readRecords(logs.docker), []);
        assertNoForbiddenTarget(result);
    });
}

test("creates the cached reference as a detached worktree at the fixed SHA", () => {
    const result = runOperator(["--mode", "smoke"]);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readRecords(logs.git), [
        ["-C", candidateRoot, "rev-parse", "--path-format=absolute",
            "--git-common-dir"],
        ["-C", candidateRoot, "rev-parse", "--verify", "v2.9.0^{commit}"],
        ["-C", candidateRoot, "rev-parse", "HEAD"],
        ["-C", candidateRoot, "worktree", "add", "--detach", referenceRoot,
            referenceSha],
        ["-C", referenceRoot, "rev-parse", "HEAD"],
        ["-C", referenceRoot, "status", "--porcelain"],
        ["-C", referenceRoot, "symbolic-ref", "-q", "HEAD"],
    ]);
    assert.equal(fs.existsSync(path.join(referenceRoot, "docker-compose.yaml")), true);
    assertNoForbiddenTarget(result);
});

test("reuses a clean status-1 detached reference without resetting or removing it", () => {
    createReferenceWorktree();

    const result = runOperator(["--mode", "smoke"], {
        FAKE_SYMBOLIC_REF_STATUS: "1",
    });

    assert.equal(result.status, 0, result.stderr);
    const gitCalls = readRecords(logs.git);
    assert.equal(gitCalls.some((call) => call.includes("worktree")), false);
    assert.equal(gitCalls.some((call) => call.includes("reset")), false);
    assert.equal(gitCalls.some((call) => call.includes("clean")), false);
    assertNoForbiddenTarget(result);
});

test("rejects a dirty cached reference before Docker without modifying it", () => {
    createReferenceWorktree();

    const result = runOperator(["--mode", "smoke"], {
        FAKE_REFERENCE_STATUS: " M www/src/app.js\n",
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /cached reference worktree is modified/);
    assert.deepEqual(readRecords(logs.docker), []);
    assert.equal(fs.existsSync(referenceRoot), true);
    assertNoForbiddenTarget(result);
});

test("fails closed when reference status inspection fails", () => {
    createReferenceWorktree();

    const result = runOperator(["--mode", "smoke"], {
        FAKE_REFERENCE_STATUS_EXIT_STATUS: "71",
    });

    assert.equal(result.status, 71);
    assert.match(result.stderr, /could not inspect cached reference worktree status/);
    assert.deepEqual(readRecords(logs.docker), []);
    assertNoExternalEventAfter("status --porcelain");
    assertNoForbiddenTarget(result);
});

test("rejects a cached reference checked out at another commit", () => {
    createReferenceWorktree();

    const result = runOperator(["--mode", "smoke"], {
        FAKE_REFERENCE_HEAD: "a".repeat(40),
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /cached reference worktree is not at the required commit/);
    assert.deepEqual(readRecords(logs.docker), []);
    assertNoForbiddenTarget(result);
});

test("rejects an attached cached reference without detaching or resetting it", () => {
    createReferenceWorktree();

    const result = runOperator(["--mode", "smoke"], {
        FAKE_SYMBOLIC_REF_STATUS: "0",
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /cached reference worktree is not detached/);
    assert.deepEqual(readRecords(logs.docker), []);
    const gitCalls = readRecords(logs.git);
    assert.equal(gitCalls.some((call) => call.includes("checkout")), false);
    assert.equal(gitCalls.some((call) => call.includes("reset")), false);
    assertNoForbiddenTarget(result);
});

test("fails closed when detached-reference inspection returns status 128", () => {
    createReferenceWorktree();

    const result = runOperator(["--mode", "smoke"], {
        FAKE_SYMBOLIC_REF_STATUS: "128",
    });

    assert.equal(result.status, 128);
    assert.match(result.stderr, /could not inspect whether cached reference is detached/);
    assert.deepEqual(readRecords(logs.docker), []);
    assertNoExternalEventAfter("symbolic-ref -q HEAD");
    assertNoForbiddenTarget(result);
});

for (const port of ["7443", "7444"]) {
    test(`rejects occupied port ${port} before Docker`, () => {
        const result = runOperator(["--mode", "smoke"], {
            FAKE_OCCUPIED_PORT: port,
        });

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, new RegExp(`port ${port} is already in use`));
        assert.deepEqual(readRecords(logs.docker), []);
        assertNoForbiddenTarget(result);
    });
}

test("fails closed when occupied-port inspection cannot complete", () => {
    const result = runOperator(["--mode", "smoke"], {
        FAKE_LSOF_STATUS: "2",
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /could not inspect port 7443/);
    assert.deepEqual(readRecords(logs.docker), []);
    assertNoForbiddenTarget(result);
});

for (const project of [
    "legendhub-parity-reference",
    "legendhub-parity-candidate",
]) {
    for (const kind of ["container", "network", "volume"]) {
        test(`rejects a stale ${kind} for ${project} and prints bounded cleanup`, () => {
            const result = runOperator(["--mode", "smoke"], {
                FAKE_STALE_KIND: kind,
                FAKE_STALE_PROJECT: project,
            });
            const checkout = project.endsWith("reference") ?
                referenceRoot : candidateRoot;
            const expectedCleanup = printableCompose(checkout, project,
                ["down", "--volumes", "--remove-orphans"]);

            assert.notEqual(result.status, 0);
            assert.match(result.stderr, /retained or stale Docker resources/);
            assert.ok(result.stderr.includes(expectedCleanup), result.stderr);
            assert.deepEqual(downCalls(), []);
            assertNoForbiddenTarget(result);
        });
    }
}

for (const failureCase of [
    {
        name: "container",
        command: "ps --all --quiet --no-trunc --filter",
    },
    {
        name: "network",
        command: "network ls --quiet --filter",
    },
    {
        name: "volume",
        command: "volume ls --quiet --filter",
    },
]) {
    test(`fails closed when ${failureCase.name} stale-resource inspection fails`, () => {
        const project = "legendhub-parity-reference";
        const failurePattern = `${failureCase.command} ` +
            `label=com.docker.compose.project=${project}`;
        const result = runOperator(["--mode", "smoke"], {
            FAKE_DOCKER_FAIL_PATTERN: failurePattern,
            FAKE_DOCKER_FAIL_STATUS: "72",
        });

        assert.equal(result.status, 2);
        assert.match(result.stderr,
            new RegExp(`could not inspect ${failureCase.name}s for ${project}`));
        assertNoExternalEventAfter(failurePattern);
        assert.deepEqual(readRecords(logs.npm), []);
        assert.deepEqual(readRecords(logs.curl), []);
        assertNoForbiddenTarget(result);
    });
}

test("renders and starts only mysql, www, and nginx before capture", () => {
    const result = runOperator(["--mode", "full", "--fail-on-diff"]);

    assert.equal(result.status, 0, result.stderr);
    const dockerCalls = readRecords(logs.docker);
    const lifecycleCalls = dockerCalls.filter((call) => call[0] === "compose");
    assert.deepEqual(lifecycleCalls, [
        [...composePrefix(referenceRoot, "legendhub-parity-reference"),
            "config", "--quiet"],
        [...composePrefix(referenceRoot, "legendhub-parity-reference"),
            "up", "--build", "-d", "mysql", "www", "nginx"],
        [...composePrefix(candidateRoot, "legendhub-parity-candidate"),
            "config", "--quiet"],
        [...composePrefix(candidateRoot, "legendhub-parity-candidate"),
            "up", "--build", "-d", "mysql", "www", "nginx"],
        [...composePrefix(referenceRoot, "legendhub-parity-reference"),
            "down", "--volumes", "--remove-orphans"],
        [...composePrefix(candidateRoot, "legendhub-parity-candidate"),
            "down", "--volumes", "--remove-orphans"],
    ]);

    const dockerEnvironments = readRecords(logs.dockerEnvironment);
    const composeEnvironments = dockerEnvironments.slice(-6);
    assert.deepEqual(composeEnvironments.map((entry) => entry[0]),
        ["7443", "7443", "7444", "7444", "7443", "7444"]);
    for (const entry of composeEnvironments) {
        assert.equal(entry[1], stateDirectory);
        assert.equal(entry[2], path.join(candidateRoot,
            "scripts/fixtures/visual-parity.sql"));
        assert.equal(entry[3], path.join(candidateRoot, "nginx/parity.conf"));
        assert.equal(entry[4], path.join(stateDirectory,
            "backups/dunwich-latest.sql.gz"));
        assert.equal(entry[5], path.join(stateDirectory, "tls/localhost.pem"));
        assert.equal(entry[6], path.join(stateDirectory,
            "tls/localhost-key.pem"));
    }

    const npmCalls = readRecords(logs.npm);
    assert.deepEqual(npmCalls, [[
        "--prefix", path.join(candidateRoot, "www"),
        "run", "parity:visual", "--",
        "--reference-base-url=https://localhost:7443",
        "--candidate-base-url=https://localhost:7444",
        `--reference-sha=${referenceSha}`,
        `--candidate-sha=${candidateSha}`,
        "--mode=full",
        `--output-dir=${reportDirectory}`,
        "--fail-on-diff",
    ]]);
    const events = fs.readFileSync(logs.events, "utf8").split("\n");
    const referenceReady = events.findIndex((event) =>
        event.startsWith("curl|") && event.endsWith("https://localhost:7443/"));
    const candidateReady = events.findIndex((event) =>
        event.startsWith("curl|") && event.endsWith("https://localhost:7444/"));
    const capture = events.findIndex((event) => event.startsWith("npm|"));
    assert.ok(referenceReady >= 0 && candidateReady > referenceReady);
    assert.ok(capture > candidateReady);
    assert.equal(readRecords(logs.curl).flat().includes("-k"), false);
    for (const [port, curlCall] of [
        ["7443", readRecords(logs.curl)[0]],
        ["7444", readRecords(logs.curl)[1]],
    ]) {
        assert.ok(curlCall.includes("--resolve"), curlCall);
        assert.ok(curlCall.includes(`localhost:${port}:[::1]`), curlCall);
    }
    assertNoForbiddenTarget(result);
});

test("non-Darwin operation retains the IPv4-only Compose path", () => {
    const result = runOperator(["--mode", "smoke"], {FAKE_UNAME: "Linux"});

    assert.equal(result.status, 0, result.stderr);
    const composeCalls = readRecords(logs.docker).filter((call) =>
        call[0] === "compose");
    assert.equal(composeCalls.every((call) =>
        !call.includes(path.join(candidateRoot,
            "docker-compose.parity-darwin.yaml"))), true);
    assert.equal(readRecords(logs.curl).flat().includes("--resolve"), false);
    assert.deepEqual(downCalls(), [
        [...composePrefix(referenceRoot, "legendhub-parity-reference", "Linux"),
            "down", "--volumes", "--remove-orphans"],
        [...composePrefix(candidateRoot, "legendhub-parity-candidate", "Linux"),
            "down", "--volumes", "--remove-orphans"],
    ]);
    assertNoForbiddenTarget(result);
});

test("explicit image reuse bypasses builds without changing the default", () => {
    const result = runOperator(["--mode", "smoke"], {
        LEGENDHUB_PARITY_REUSE_IMAGES: "1",
    });

    assert.equal(result.status, 0, result.stderr);
    const composeCalls = readRecords(logs.docker).filter((call) =>
        call[0] === "compose");
    const startCalls = composeCalls.filter((call) => call.includes("up"));
    assert.equal(startCalls.length, 2);
    assert.equal(startCalls.every((call) => call.includes("--no-build")), true);
    assert.equal(startCalls.some((call) => call.includes("--build")), false);
    assertNoForbiddenTarget(result);
});

test("cleans both exact projects after startup failure and preserves status", () => {
    const result = runOperator(["--mode", "smoke"], {
        FAKE_DOCKER_FAIL_PATTERN: [
            `${candidateRoot}/docker-compose.yaml`,
            "-f", `${candidateRoot}/docker-compose.parity.yaml`,
            "-f", `${candidateRoot}/docker-compose.parity-darwin.yaml`,
            "up", "--build", "-d", "mysql", "www", "nginx",
        ].join(" "),
        FAKE_DOCKER_FAIL_STATUS: "27",
    });

    assert.equal(result.status, 27, result.stderr);
    assert.match(result.stderr,
        /startup failed for legendhub-parity-candidate services mysql www nginx/);
    const composeCalls = readRecords(logs.docker).filter((call) =>
        call[0] === "compose");
    assert.equal(composeCalls.some((call) =>
        call.includes("ps") && call.slice(-3).join(" ") === "mysql www nginx"), true);
    assert.equal(composeCalls.some((call) =>
        call.includes("logs") && call.includes("--tail") &&
        call.slice(-3).join(" ") === "mysql www nginx"), true);
    assert.deepEqual(downCalls(), [
        [...composePrefix(referenceRoot, "legendhub-parity-reference"),
            "down", "--volumes", "--remove-orphans"],
        [...composePrefix(candidateRoot, "legendhub-parity-candidate"),
            "down", "--volumes", "--remove-orphans"],
    ]);
    assertNoForbiddenTarget(result);
});

test("prints bounded status and logs after readiness timeout, then cleans", () => {
    const result = runOperator(["--mode", "smoke"], {
        FAKE_CURL_FAIL_URL: "https://localhost:7444/",
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /candidate.*readiness/i);
    const composeCalls = readRecords(logs.docker).filter((call) =>
        call[0] === "compose");
    assert.equal(composeCalls.some((call) =>
        call.includes("ps") && call.slice(-3).join(" ") === "mysql www nginx"), true);
    assert.equal(composeCalls.some((call) =>
        call.includes("logs") && call.includes("--tail") &&
        call.slice(-3).join(" ") === "mysql www nginx"), true);
    assert.equal(downCalls().length, 2);
    assertNoForbiddenTarget(result);
});

test("preserves capture failure status even when cleanup also fails", () => {
    const result = runOperator(["--mode", "smoke"], {
        FAKE_DOWN_FAIL_STATUS: "19",
        FAKE_NPM_STATUS: "42",
    });

    assert.equal(result.status, 42, result.stderr);
    assert.equal(downCalls().length, 2);
    assertNoForbiddenTarget(result);
});

for (const npmStatus of ["0", "44"]) {
    test(`--keep preserves both projects after capture status ${npmStatus}`, () => {
        const result = runOperator(["--mode", "smoke", "--keep"], {
            FAKE_NPM_STATUS: npmStatus,
        });
        const expectedStatus = Number(npmStatus);

        assert.equal(result.status, expectedStatus, result.stderr);
        assert.deepEqual(downCalls(), []);
        for (const [checkout, project] of [
            [referenceRoot, "legendhub-parity-reference"],
            [candidateRoot, "legendhub-parity-candidate"],
        ]) {
            assert.ok(result.stderr.includes(printableCompose(checkout, project,
                ["logs", "--tail", "100", "mysql", "www", "nginx"])),
            result.stderr);
            assert.ok(result.stderr.includes(printableCompose(checkout, project,
                ["down", "--volumes", "--remove-orphans"])), result.stderr);
        }
        assertNoForbiddenTarget(result);
    });
}

for (const signal of ["TERM", "INT"]) {
    test(`${signal} cleans both projects with the conventional signal status`, () => {
        const result = runOperator(["--mode", "smoke"], {
            FAKE_NPM_SIGNAL: signal,
        });

        assert.equal(result.status, signal === "TERM" ? 143 : 130, result.stderr);
        assert.equal(downCalls().length, 2);
        assertNoForbiddenTarget(result);
    });
}
