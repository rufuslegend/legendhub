"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const {spawnSync} = require("node:child_process");
const {afterEach, beforeEach, test} = require("node:test");

const preflight = path.resolve(__dirname, "../preflight-production.sh");
const dollar = "$";

const sshFake = String.raw`#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "${dollar}*" > "${dollar}FAKE_SSH_ARGS"
tee "${dollar}FAKE_SSH_PAYLOAD" | bash -n
`;

const composeFake = String.raw`#!/usr/bin/env bash
set -euo pipefail
printf 'docker-compose %s\n' "${dollar}*" >> "${dollar}FAKE_COMMAND_LOG"

case "${dollar}*" in
  *" config --quiet") exit 0 ;;
  *" config")
    printf '%s\n' \
      '    image: mysql:5.7.44' \
      '    image: tmckimmey/legendhub-mysql-backup:6ddaeab948a1' \
      '    image: tmckimmey/legendhub-python:6ddaeab948a1' \
      '    image: tmckimmey/legendhub-www:4bb661fd5dd7'
    exit 0
    ;;
esac

printf 'unexpected docker-compose command: %s\n' "${dollar}*" >&2
exit 64
`;

const dockerFake = String.raw`#!/usr/bin/env bash
set -euo pipefail
printf 'docker %s\n' "${dollar}*" >> "${dollar}FAKE_COMMAND_LOG"

if [[ "${dollar}{1:-}" == inspect && "${dollar}{2:-}" == --format ]]; then
  template="${dollar}3"
  container="${dollar}4"
  case "${dollar}template" in
    *com.docker.compose.project*) printf '%s\n' legendhub260 ;;
    *Config.Image*)
      case "${dollar}container" in
        legendhub260_mysql_1) printf '%s\n' mysql:5.7.44 ;;
        legendhub260_mysql-backup_1) printf '%s\n' tmckimmey/legendhub-mysql-backup:6ddaeab948a1 ;;
        legendhub260_python_1) printf '%s\n' tmckimmey/legendhub-python:6ddaeab948a1 ;;
        legendhub260_www_1) printf '%s\n' tmckimmey/legendhub-www:4bb661fd5dd7 ;;
        *) exit 64 ;;
      esac
      ;;
    *State.Status*) printf '%s\n' running ;;
    *RestartCount*) printf '%s\n' 0 ;;
    *State.Health.Status*)
      [[ "${dollar}container" == legendhub260_mysql_1 ]] || exit 65
      printf '%s\n' healthy
      ;;
    *Id*) printf 'container-id-%s\n' "${dollar}container" ;;
    *) exit 64 ;;
  esac
  exit 0
fi

if [[ "${dollar}{1:-}" == image && "${dollar}{2:-}" == inspect ]]; then
  printf '%s\n' linux/amd64
  exit 0
fi

if [[ "${dollar}{1:-}" == exec ]]; then
  printf '%s\n' \
    'INFO: /backups/private/database_08-11-2026.sql.gz — 123 bytes — mode 644' \
    'INFO: /backups/public/database.sql — 456 bytes — mode 644'
  exit 0
fi

if [[ "${dollar}{1:-}" == ps && "${dollar}{2:-}" == -aq ]]; then
  printf '%s\n' rollback-container-id
  exit 0
fi

if [[ "${dollar}{1:-}" == ps && "${dollar}{2:-}" == -a ]]; then
  printf '%s\n' 'INFO: rollback container=legendhub_mysql_1 image=legendhub_mysql state=Exited'
  exit 0
fi

printf 'unexpected docker command: %s\n' "${dollar}*" >&2
exit 64
`;

const curlFake = String.raw`#!/usr/bin/env bash
set -euo pipefail
printf 'curl %s\n' "${dollar}*" >> "${dollar}FAKE_COMMAND_LOG"
printf '%s' "${dollar}{FAKE_HTTP_CODE:-200}"
`;

const statFake = String.raw`#!/usr/bin/env bash
set -euo pipefail
printf 'INFO: %s — 789 bytes — mode 600\n' "${dollar}{@: -1}"
`;

let workspace;
let fakeBin;
let remoteRoot;
let rollbackRoot;
let cutoverDump;
let sshArgs;
let sshPayload;
let commandLog;

function writeExecutable(file, content) {
    fs.writeFileSync(file, content, {mode: 0o755});
}

beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "legendhub-preflight-"));
    fakeBin = path.join(workspace, "bin");
    remoteRoot = path.join(workspace, "remote");
    rollbackRoot = path.join(workspace, "rollback");
    cutoverDump = path.join(workspace, "cutover.sql.gz");
    sshArgs = path.join(workspace, "ssh-args");
    sshPayload = path.join(workspace, "ssh-payload.sh");
    commandLog = path.join(workspace, "commands.log");

    fs.mkdirSync(fakeBin);
    fs.mkdirSync(remoteRoot);
    fs.mkdirSync(rollbackRoot);
    fs.writeFileSync(path.join(remoteRoot, ".env"), "SECRET_VALUE=do-not-print\n");
    fs.writeFileSync(path.join(remoteRoot, "docker-compose.yaml"), "version: '3.7'\n");
    fs.writeFileSync(cutoverDump, zlib.gzipSync("validated cutover backup\n"));

    writeExecutable(path.join(fakeBin, "ssh"), sshFake);
    writeExecutable(path.join(fakeBin, "docker-compose"), composeFake);
    writeExecutable(path.join(fakeBin, "docker"), dockerFake);
    writeExecutable(path.join(fakeBin, "curl"), curlFake);
    writeExecutable(path.join(fakeBin, "stat"), statFake);
});

afterEach(() => fs.rmSync(workspace, {recursive: true, force: true}));

function runPreflight(extraEnvironment = {}) {
    return spawnSync("bash", [preflight], {
        encoding: "utf8",
        env: {
            ...process.env,
            PATH: `${fakeBin}:${process.env.PATH}`,
            FAKE_COMMAND_LOG: commandLog,
            FAKE_SSH_ARGS: sshArgs,
            FAKE_SSH_PAYLOAD: sshPayload,
            ...extraEnvironment,
        },
    });
}

function runRemote(extraEnvironment = {}) {
    return spawnSync("bash", [
        preflight,
        "--remote",
        remoteRoot,
        cutoverDump,
        rollbackRoot,
    ], {
        encoding: "utf8",
        env: {
            ...process.env,
            PATH: `${fakeBin}:${process.env.PATH}`,
            FAKE_COMMAND_LOG: commandLog,
            FAKE_HTTP_CODE: "200",
            ...extraEnvironment,
        },
    });
}

test("sends fixed production paths through agent-forwarded SSH", () => {
    const result = runPreflight();

    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(sshArgs, "utf8"), [
        "-A legend bash -s -- --remote",
        "/home/rufus/legendhub",
        "/home/rufus/legendhub-cutover-backups/legendhub-pre-2.6.0.sql.gz",
        "/legend/LegendHubOriginal",
        "",
    ].join(" ").trimEnd() + "\n");
    assert.notEqual(fs.readFileSync(sshPayload, "utf8"), "");
});

test("runs read-only production checks without exposing secrets", () => {
    const result = runRemote();

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /PRODUCTION PREFLIGHT PASSED/);
    assert.equal(result.stdout.includes("do-not-print"), false);
    assert.equal(result.stderr.includes("do-not-print"), false);

    const commands = fs.readFileSync(commandLog, "utf8").trim().split("\n");
    assert.equal(commands.filter((line) => line.startsWith("curl ")).length, 18);
    assert.equal(commands.filter((line) => line.startsWith("docker exec ")).length, 1);
    assert.equal(commands.some((line) => /docker-compose .* (up|down|pull|push|stop|start|restart)\b/.test(line)), false);
    assert.equal(commands.some((line) => /^docker (rm|rmi|start|stop|restart|pull|push)\b/.test(line)), false);
});

test("fails when a production route is not healthy", () => {
    const result = runRemote({FAKE_HTTP_CODE: "503"});

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /local \/ returned HTTP 503/);
    assert.doesNotMatch(result.stdout + result.stderr, /PRODUCTION PREFLIGHT PASSED/);
});
