"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const {afterEach, beforeEach, test} = require("node:test");

const gateway = path.resolve(__dirname, "../serve-production-content.sh");
const dollar = "$";

const dockerFake = String.raw`#!/usr/bin/env bash
set -euo pipefail

printf '%s\0' "${dollar}@" >> "${dollar}FAKE_DOCKER_LOG"

if [[ "${dollar}1" == "ps" && -n "${dollar}{FAKE_DOCKER_IDS:-}" ]]; then
  printf '%s\n' "${dollar}FAKE_DOCKER_IDS"
fi
`;

let workspace;
let fakeBin;
let dockerLog;

function writeExecutable(file, content) {
    fs.writeFileSync(file, content, {mode: 0o755});
}

function readDockerLog() {
    return fs.existsSync(dockerLog) ? fs.readFileSync(dockerLog, "utf8") : "";
}

function readDockerArguments() {
    const log = readDockerLog();

    return log === "" ? [] : log.split("\0").slice(0, -1);
}

beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "legendhub-content-gateway-"));
    fakeBin = path.join(workspace, "bin");
    dockerLog = path.join(workspace, "docker.log");
    fs.mkdirSync(fakeBin);
    writeExecutable(path.join(fakeBin, "docker"), dockerFake);
});

afterEach(() => fs.rmSync(workspace, {recursive: true, force: true}));

function runGateway(command, containerIds) {
    return spawnSync("bash", [gateway], {
        encoding: "utf8",
        env: {
            ...process.env,
            FAKE_DOCKER_IDS: containerIds.join("\n"),
            FAKE_DOCKER_LOG: dockerLog,
            PATH: `${fakeBin}:${process.env.PATH}`,
            SSH_ORIGINAL_COMMAND: command,
        },
    });
}

test("serves only the exact manifest command", () => {
    const result = runGateway("manifest", ["backup-container-id"]);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readDockerArguments(), [
        "ps",
        "--quiet",
        "--filter",
        "label=com.docker.compose.project=legendhub260",
        "--filter",
        "label=com.docker.compose.service=mysql-backup",
        "exec",
        "backup-container-id",
        "/usr/local/bin/export-public-content",
        "manifest",
    ]);
});

test("passes a validated digest as one Docker argument", () => {
    const digest = "a".repeat(64);
    const result = runGateway(`snapshot ${digest}`, ["backup-container-id"]);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readDockerArguments().slice(-2), ["snapshot", digest]);
});

for (const command of ["", "bash", "manifest extra", "snapshot ../x",
    "snapshot " + "a".repeat(63), "snapshot " + "A".repeat(64)]) {
    test(`rejects ${JSON.stringify(command)}`, () => {
        const result = runGateway(command, ["backup-container-id"]);

        assert.equal(result.status, 64);
        assert.equal(readDockerLog(), "");
    });
}

for (const ids of [[], ["one", "two"]]) {
    test(`rejects ${ids.length} matching backup containers`, () => {
        const result = runGateway("manifest", ids);

        assert.equal(result.status, 1);
        assert.doesNotMatch(readDockerLog(), /exec/);
        assert.doesNotMatch(result.stderr, /MYSQL_|INSERT INTO|snapshot bytes/);
    });
}
