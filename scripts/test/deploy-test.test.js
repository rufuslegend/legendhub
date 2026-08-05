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
  exit 0
fi

if [[ "${dollar}*" == "rev-parse --short=12 HEAD" ]]; then
  test "${dollar}(cat "${dollar}FAKE_CHECKED_OUT_STATE")" = "${dollar}FAKE_FULL_SHA"
  printf '%s\n' "${dollar}FAKE_RELEASE_SHA"
  exit 0
fi

printf 'unexpected git command: %s\n' "${dollar}*" >&2
exit 64
`;

const dockerFake = String.raw`#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "${dollar}*" >> "${dollar}FAKE_DOCKER_LOG"
`;

let workspace;
let fakeBin;
let remoteRoot;
let sshLog;
let sshPayload;
let gitLog;
let dockerLog;
let checkedOutState;

function writeExecutable(file, content) {
    fs.writeFileSync(file, content, {mode: 0o755});
}

function readIfPresent(file) {
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "legendhub-deployer-"));
    fakeBin = path.join(workspace, "bin");
    remoteRoot = path.join(workspace, "remote");
    sshLog = path.join(workspace, "ssh.log");
    sshPayload = path.join(workspace, "ssh-payload.sh");
    gitLog = path.join(workspace, "git.log");
    dockerLog = path.join(workspace, "docker.log");
    checkedOutState = path.join(workspace, "checked-out");
    fs.mkdirSync(fakeBin);
    fs.mkdirSync(remoteRoot);
    writeExecutable(path.join(fakeBin, "ssh"), sshFake);
    writeExecutable(path.join(fakeBin, "git"), gitFake);
    writeExecutable(path.join(fakeBin, "docker"), dockerFake);
});

afterEach(() => fs.rmSync(workspace, {recursive: true, force: true}));

function environment() {
    return {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
        FAKE_CHECKED_OUT_STATE: checkedOutState,
        FAKE_DOCKER_LOG: dockerLog,
        FAKE_FULL_SHA: fullSha,
        FAKE_GIT_LOG: gitLog,
        FAKE_RELEASE_SHA: releaseSha,
        FAKE_SSH_LOG: sshLog,
        FAKE_SSH_PAYLOAD: sshPayload,
    };
}

function runLocal(args) {
    return spawnSync("bash", [deployer, ...args], {
        env: environment(),
        encoding: "utf8",
    });
}

function runRemote(root = remoteRoot) {
    return spawnSync("bash", [deployer, "--remote", releaseSha, root], {
        env: environment(),
        encoding: "utf8",
    });
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
    fs.writeFileSync(path.join(remoteRoot, ".env"), "SECRET_VALUE=do-not-print\n");
    fs.writeFileSync(path.join(remoteRoot, "docker-compose.test.yaml"), "services: {}\n");
    fs.writeFileSync(path.join(remoteRoot, "docker-compose.registry.yaml"), "services: {}\n");

    const result = runRemote();

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.includes("do-not-print"), false);
    assert.equal(result.stderr.includes("do-not-print"), false);
    assert.equal(readIfPresent(gitLog), [
        "fetch origin",
        `rev-parse --verify ${releaseSha}^{commit}`,
        `checkout --detach ${fullSha}`,
        "rev-parse --short=12 HEAD",
        "",
    ].join("\n"));
    assert.equal(readIfPresent(dockerLog), [
        "compose -f docker-compose.yaml -f docker-compose.test.yaml -f docker-compose.registry.yaml config --quiet",
        "compose -f docker-compose.yaml -f docker-compose.test.yaml -f docker-compose.registry.yaml pull www python mysql-backup",
        "compose -f docker-compose.yaml -f docker-compose.test.yaml -f docker-compose.registry.yaml up -d --no-build",
        "",
    ].join("\n"));
});

test("stops before Compose when the registry override is absent", () => {
    fs.writeFileSync(path.join(remoteRoot, ".env"), "SECRET_VALUE=do-not-print\n");
    fs.writeFileSync(path.join(remoteRoot, "docker-compose.test.yaml"), "services: {}\n");

    const result = runRemote();

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /docker-compose\.registry\.yaml/);
    assert.equal(readIfPresent(dockerLog), "");
});
