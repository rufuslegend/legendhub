"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const {afterEach, beforeEach, test} = require("node:test");

const deployer = path.resolve(__dirname, "../deploy-test.sh");
const releaseSha = "abcdef123456";
const fullSha = `${releaseSha}${"7".repeat(28)}`;
const dollar = "$";

const sshFake = String.raw`#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "${dollar}*" >> "${dollar}FAKE_SSH_LOG"
cat > "${dollar}FAKE_SSH_PAYLOAD"
`;

const gitFake = String.raw`#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "${dollar}*" >> "${dollar}FAKE_GIT_LOG"

if [[ "${dollar}*" == "fetch origin" ]]; then
  exit 0
fi

if [[ "${dollar}*" == "rev-parse --verify ${dollar}{FAKE_RELEASE_SHA}^{commit}" ]]; then
  printf '%s\n' "${dollar}FAKE_FULL_SHA"
  exit 0
fi

if [[ "${dollar}*" == "checkout --detach ${dollar}FAKE_FULL_SHA" ]]; then
  printf '%s\n' "${dollar}FAKE_FULL_SHA" > "${dollar}FAKE_CHECKED_OUT_STATE"
  if [[ "${dollar}{FAKE_POST_CHECKOUT_ENV+x}" == x ]]; then
    printf '%s' "${dollar}FAKE_POST_CHECKOUT_ENV" > "${dollar}FAKE_REMOTE_ENV"
  fi
  exit 0
fi

if [[ "${dollar}*" == "rev-parse --short=12 HEAD" ]]; then
  test "${dollar}(cat "${dollar}FAKE_CHECKED_OUT_STATE")" = "${dollar}FAKE_FULL_SHA"
  printf '%s\n' "${dollar}FAKE_RELEASE_SHA"
  exit 0
fi

if [[ "${dollar}*" == "ls-tree --name-only ${dollar}FAKE_FULL_SHA -- docker-compose.content-sync.yaml" ]]; then
  if [[ "${dollar}{FAKE_GIT_TREE_EXIT_STATUS:-0}" != 0 ]]; then
    exit "${dollar}FAKE_GIT_TREE_EXIT_STATUS"
  fi
  if [[ "${dollar}{FAKE_TRACKS_CONTENT_SYNC:-1}" == 1 ]]; then
    printf '%s\n' docker-compose.content-sync.yaml
  fi
  exit 0
fi

printf 'unexpected git command: %s\n' "${dollar}*" >&2
exit 64
`;

const dockerFake = String.raw`#!/usr/bin/env bash
set -euo pipefail
printf '%s\0' "${dollar}@" >> "${dollar}FAKE_DOCKER_LOG"
printf '\036' >> "${dollar}FAKE_DOCKER_LOG"
printf '%s\n' "${dollar}{COMPOSE_PROJECT_NAME:-<unset>}" >> \
  "${dollar}FAKE_PROJECT_NAME_LOG"

if [[ "${dollar}1" == ps ]]; then
  [[ -z "${dollar}{FAKE_CONTENT_SYNC_IDS:-}" ]] ||
    printf '%s\n' "${dollar}FAKE_CONTENT_SYNC_IDS"
fi

if [[ "${dollar}1" == rm && "${dollar}{FAKE_REMOVE_EXIT_STATUS:-0}" != 0 ]]; then
  exit "${dollar}FAKE_REMOVE_EXIT_STATUS"
fi

if [[ -n "${dollar}{FAKE_FAIL_DOCKER_CALL:-}" &&
      "${dollar}*" == "${dollar}FAKE_FAIL_DOCKER_CALL" ]]; then
  exit "${dollar}{FAKE_DOCKER_EXIT_STATUS:-1}"
fi
`;

let workspace;
let fakeBin;
let remoteRoot;
let sshLog;
let sshPayload;
let gitLog;
let dockerLog;
let projectNameLog;
let checkedOutState;

function writeExecutable(file, content) {
    fs.writeFileSync(file, content, {mode: 0o755});
}

function readIfPresent(file) {
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function readDockerCalls() {
    const log = readIfPresent(dockerLog);

    return log === "" ? [] : log.split("\x1e").filter(Boolean).map(
        (record) => record.split("\0").slice(0, -1));
}

beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "legendhub-deployer-"));
    fakeBin = path.join(workspace, "bin");
    remoteRoot = path.join(workspace, "remote");
    sshLog = path.join(workspace, "ssh.log");
    sshPayload = path.join(workspace, "ssh-payload.sh");
    gitLog = path.join(workspace, "git.log");
    dockerLog = path.join(workspace, "docker.log");
    projectNameLog = path.join(workspace, "project-name.log");
    checkedOutState = path.join(workspace, "checked-out");
    fs.mkdirSync(fakeBin);
    fs.mkdirSync(remoteRoot);
    writeExecutable(path.join(fakeBin, "ssh"), sshFake);
    writeExecutable(path.join(fakeBin, "git"), gitFake);
    writeExecutable(path.join(fakeBin, "docker"), dockerFake);
});

afterEach(() => fs.rmSync(workspace, {recursive: true, force: true}));

function environment(overrides = {}) {
    return {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
        FAKE_CHECKED_OUT_STATE: checkedOutState,
        FAKE_CONTENT_SYNC_IDS: "",
        FAKE_DOCKER_LOG: dockerLog,
        FAKE_FULL_SHA: fullSha,
        FAKE_GIT_LOG: gitLog,
        FAKE_PROJECT_NAME_LOG: projectNameLog,
        FAKE_RELEASE_SHA: releaseSha,
        FAKE_REMOTE_ENV: path.join(remoteRoot, ".env"),
        FAKE_SSH_LOG: sshLog,
        FAKE_SSH_PAYLOAD: sshPayload,
        COMPOSE_PROJECT_NAME: "",
        ...overrides,
    };
}

function runLocal(args) {
    return spawnSync("bash", [deployer, ...args], {
        env: environment(),
        encoding: "utf8",
    });
}

function runRemote(overrides = {}) {
    return spawnSync("bash", [deployer, "--remote", releaseSha, remoteRoot], {
        env: environment(overrides),
        encoding: "utf8",
    });
}

function writeProjectEnvironment(
    projectDefinitions = ["COMPOSE_PROJECT_NAME=legendhub-test"],
) {
    fs.writeFileSync(path.join(remoteRoot, ".env"), [
        ...projectDefinitions,
        "SECRET_VALUE=do-not-print",
        "",
    ].join("\n"));
}

test("rejects non-release tags before invoking SSH", async (t) => {
    for (const candidate of ["test", "latest", "ABCDEF123456", "", "abc123", "abcdef12345g"]) {
        await t.test(JSON.stringify(candidate), () => {
            const result = runLocal([candidate]);

            assert.notEqual(result.status, 0);
            assert.match(result.stderr, /12-character lowercase Git SHA/);
            assert.equal(readIfPresent(sshLog), "");
        });
    }
});

test("sends a validated release and fixed deployment directory to the server", () => {
    const result = runLocal([releaseSha]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(
        readIfPresent(sshLog),
        `-A dunwichmass bash -s -- --remote ${releaseSha} /home/rufus/legendhub\n`,
    );
    assert.notEqual(readIfPresent(sshPayload), "");
});

test("checks out the expanded commit before validating and deploying Compose", () => {
    writeProjectEnvironment();
    fs.writeFileSync(path.join(remoteRoot, "docker-compose.test.yaml"), "services: {}\n");
    fs.writeFileSync(path.join(remoteRoot, "docker-compose.registry.yaml"), "services: {}\n");
    fs.writeFileSync(path.join(remoteRoot, "docker-compose.content-sync.yaml"),
        "services: {}\n");

    const result = runRemote({COMPOSE_PROJECT_NAME: "hostile-project"});

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.includes("do-not-print"), false);
    assert.equal(result.stderr.includes("do-not-print"), false);
    assert.equal(readIfPresent(projectNameLog), "legendhub-test\n".repeat(3));
    assert.equal(readIfPresent(gitLog), [
        "fetch origin",
        `rev-parse --verify ${releaseSha}^{commit}`,
        `checkout --detach ${fullSha}`,
        "rev-parse --short=12 HEAD",
        `ls-tree --name-only ${fullSha} -- docker-compose.content-sync.yaml`,
        "",
    ].join("\n"));
    assert.deepEqual(readDockerCalls(), [
        ["compose", "-f", "docker-compose.yaml", "-f", "docker-compose.test.yaml",
            "-f", "docker-compose.registry.yaml", "-f",
            "docker-compose.content-sync.yaml", "config", "--quiet"],
        ["compose", "-f", "docker-compose.yaml", "-f", "docker-compose.test.yaml",
            "-f", "docker-compose.registry.yaml", "-f",
            "docker-compose.content-sync.yaml", "pull", "www", "python",
            "mysql-backup", "content-sync"],
        ["compose", "-f", "docker-compose.yaml", "-f", "docker-compose.test.yaml",
            "-f", "docker-compose.registry.yaml", "-f",
            "docker-compose.content-sync.yaml", "up", "-d", "--no-build"],
    ]);
});

const invalidProjectDefinitions = [
    {name: "a missing project definition", lines: []},
    {name: "duplicate project definitions", lines: [
        "COMPOSE_PROJECT_NAME=legendhub-test",
        "COMPOSE_PROJECT_NAME=legendhub-test",
    ]},
    {name: "the wrong project", lines: ["COMPOSE_PROJECT_NAME=other"]},
    {name: "a malformed project definition", lines: [
        "export COMPOSE_PROJECT_NAME = legendhub-test",
    ]},
];

for (const fixture of invalidProjectDefinitions) {
    test(`rejects ${fixture.name} before Git or Docker`, () => {
        writeProjectEnvironment(fixture.lines);
        fs.writeFileSync(path.join(remoteRoot, "docker-compose.test.yaml"),
            "services: {}\n");

        const result = runRemote();

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Compose project/);
        assert.equal(readIfPresent(gitLog), "");
        assert.deepEqual(readDockerCalls(), []);
    });
}

test("revalidates the project identity after checkout before Docker", () => {
    writeProjectEnvironment();
    fs.writeFileSync(path.join(remoteRoot, "docker-compose.test.yaml"), "services: {}\n");

    const result = runRemote({
        FAKE_POST_CHECKOUT_ENV: "COMPOSE_PROJECT_NAME=other\n",
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Compose project/);
    assert.equal(readIfPresent(gitLog), [
        "fetch origin",
        `rev-parse --verify ${releaseSha}^{commit}`,
        `checkout --detach ${fullSha}`,
        "",
    ].join("\n"));
    assert.deepEqual(readDockerCalls(), []);
});

test("stops before Compose when the registry override is absent", () => {
    writeProjectEnvironment();
    fs.writeFileSync(path.join(remoteRoot, "docker-compose.test.yaml"), "services: {}\n");

    const result = runRemote();

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /docker-compose\.registry\.yaml/);
    assert.deepEqual(readDockerCalls(), []);
});

test("stops before Compose when the content sync overlay is absent", () => {
    writeProjectEnvironment();
    fs.writeFileSync(path.join(remoteRoot, "docker-compose.test.yaml"), "services: {}\n");
    fs.writeFileSync(path.join(remoteRoot, "docker-compose.registry.yaml"), "services: {}\n");

    const result = runRemote();

    assert.notEqual(result.status, 0);
    assert.match(result.stderr,
        /Required deployment file is missing: docker-compose\.content-sync\.yaml/);
    assert.deepEqual(readDockerCalls(), []);
});

function writeLegacyRemoteFiles() {
    writeProjectEnvironment();
    fs.writeFileSync(path.join(remoteRoot, "docker-compose.test.yaml"), "services: {}\n");
    fs.writeFileSync(path.join(remoteRoot, "docker-compose.registry.yaml"),
        "services: {}\n");
}

const legacyCompose = [
    "compose", "-f", "docker-compose.yaml", "-f", "docker-compose.test.yaml",
    "-f", "docker-compose.registry.yaml",
];
const legacyDiscovery = [
    "ps", "--all", "--quiet", "--no-trunc",
    "--filter", "label=com.docker.compose.project=legendhub-test",
    "--filter", "label=com.docker.compose.service=content-sync",
];

test("a legacy target uses three overlays when its Git tree predates content sync", () => {
    writeLegacyRemoteFiles();

    const result = spawnSync("bash", [deployer, "--remote", releaseSha, remoteRoot], {
        env: environment({
            COMPOSE_PROJECT_NAME: "hostile-project",
            FAKE_TRACKS_CONTENT_SYNC: "0",
        }),
        encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(readIfPresent(projectNameLog), "legendhub-test\n".repeat(4));
    assert.deepEqual(readDockerCalls(), [
        [...legacyCompose, "config", "--quiet"],
        legacyDiscovery,
        [...legacyCompose, "pull", "www", "python", "mysql-backup"],
        [...legacyCompose, "up", "-d", "--no-build"],
    ]);
});

test("legacy rollback removes exactly one content-sync container by exact labels", () => {
    writeLegacyRemoteFiles();
    const containerId = "a".repeat(64);

    const result = spawnSync("bash", [deployer, "--remote", releaseSha, remoteRoot], {
        env: environment({
            FAKE_CONTENT_SYNC_IDS: containerId,
            FAKE_TRACKS_CONTENT_SYNC: "0",
        }),
        encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readDockerCalls(), [
        [...legacyCompose, "config", "--quiet"],
        legacyDiscovery,
        [...legacyCompose, "pull", "www", "python", "mysql-backup"],
        ["rm", "--force", "--", containerId],
        [...legacyCompose, "up", "-d", "--no-build"],
    ]);
});

test("legacy rollback rejects unexpected content-sync cardinality before mutation", () => {
    writeLegacyRemoteFiles();

    const result = spawnSync("bash", [deployer, "--remote", releaseSha, remoteRoot], {
        env: environment({
            FAKE_CONTENT_SYNC_IDS: `${"a".repeat(64)}\n${"b".repeat(64)}`,
            FAKE_TRACKS_CONTENT_SYNC: "0",
        }),
        encoding: "utf8",
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /expected at most one legacy content-sync container/);
    assert.deepEqual(readDockerCalls(), [
        [...legacyCompose, "config", "--quiet"],
        legacyDiscovery,
    ]);
});

test("legacy rollback stops before startup when stale-service removal fails", () => {
    writeLegacyRemoteFiles();
    const containerId = "a".repeat(64);

    const result = spawnSync("bash", [deployer, "--remote", releaseSha, remoteRoot], {
        env: environment({
            FAKE_CONTENT_SYNC_IDS: containerId,
            FAKE_REMOVE_EXIT_STATUS: "41",
            FAKE_TRACKS_CONTENT_SYNC: "0",
        }),
        encoding: "utf8",
    });

    assert.equal(result.status, 41);
    assert.deepEqual(readDockerCalls(), [
        [...legacyCompose, "config", "--quiet"],
        legacyDiscovery,
        [...legacyCompose, "pull", "www", "python", "mysql-backup"],
        ["rm", "--force", "--", containerId],
    ]);
});

test("legacy startup failure cannot resurrect the removed content-sync service", () => {
    writeLegacyRemoteFiles();
    const containerId = "a".repeat(64);
    const failedCall = [...legacyCompose, "up", "-d", "--no-build"].join(" ");

    const result = spawnSync("bash", [deployer, "--remote", releaseSha, remoteRoot], {
        env: environment({
            FAKE_CONTENT_SYNC_IDS: containerId,
            FAKE_DOCKER_EXIT_STATUS: "42",
            FAKE_FAIL_DOCKER_CALL: failedCall,
            FAKE_TRACKS_CONTENT_SYNC: "0",
        }),
        encoding: "utf8",
    });

    assert.equal(result.status, 42);
    assert.deepEqual(readDockerCalls().slice(-2), [
        ["rm", "--force", "--", containerId],
        [...legacyCompose, "up", "-d", "--no-build"],
    ]);
});

test("Git tree inspection failure stops before Docker", () => {
    writeLegacyRemoteFiles();

    const result = spawnSync("bash", [deployer, "--remote", releaseSha, remoteRoot], {
        env: environment({FAKE_GIT_TREE_EXIT_STATUS: "43"}),
        encoding: "utf8",
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /target Compose tree/);
    assert.deepEqual(readDockerCalls(), []);
});
