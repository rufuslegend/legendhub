"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const {afterEach, beforeEach, test} = require("node:test");

const localSync = path.resolve(__dirname, "../sync-test-content.sh");
const remoteSync = path.resolve(__dirname, "../run-test-content-sync.sh");
const provision = path.resolve(__dirname, "../provision-test-content-sync.sh");
const dollar = "$";
const bash = fs.existsSync("/opt/homebrew/bin/bash") ?
    "/opt/homebrew/bin/bash" : "bash";

const sshFake = String.raw`#!/usr/bin/env bash
set -euo pipefail
printf '%s\0' "${dollar}@" >> "${dollar}FAKE_SSH_LOG"
if [[ "${dollar}{FAKE_SSH_EXECUTE:-0}" == 1 ]]; then
  if [[ "${dollar}1" == -a ]]; then
    shift
  fi
  shift
  exec "${dollar}@"
fi
exit "${dollar}{FAKE_SSH_EXIT_STATUS:-0}"
`;

const gitFake = String.raw`#!/usr/bin/env bash
set -euo pipefail
printf '%s\0' "${dollar}@" >> "${dollar}FAKE_GIT_LOG"
if [[ "${dollar}*" != "rev-parse --short=12 HEAD" ]]; then
  printf 'unexpected git command\n' >&2
  exit 64
fi
if [[ "${dollar}{FAKE_GIT_EXIT_STATUS:-0}" != 0 ]]; then
  exit "${dollar}FAKE_GIT_EXIT_STATUS"
fi
printf '%s\n' "${dollar}{FAKE_GIT_TAG:-abcdef123456}"
`;

const dockerFake = String.raw`#!/usr/bin/env bash
set -euo pipefail
printf '%s\0' "${dollar}@" >> "${dollar}FAKE_DOCKER_LOG"
printf '\036' >> "${dollar}FAKE_DOCKER_LOG"
printf '%s\n' "${dollar}{LEGENDHUB_IMAGE_TAG:-<unset>}" >> \
  "${dollar}FAKE_IMAGE_TAG_LOG"
printf '%s\n' "${dollar}{COMPOSE_PROJECT_NAME:-<unset>}" >> \
  "${dollar}FAKE_PROJECT_NAME_LOG"

case "${dollar}*" in
  "compose -f docker-compose.yaml -f docker-compose.test.yaml -f docker-compose.registry.yaml -f docker-compose.content-sync.yaml config --quiet")
    exit 0
    ;;
  "compose -f docker-compose.yaml -f docker-compose.test.yaml -f docker-compose.registry.yaml -f docker-compose.content-sync.yaml ps --quiet mysql")
    if [[ -n "${dollar}{FAKE_MYSQL_IDS:-}" ]]; then
      printf '%s\n' "${dollar}FAKE_MYSQL_IDS"
    fi
    exit 0
    ;;
  "compose -f docker-compose.yaml -f docker-compose.test.yaml -f docker-compose.registry.yaml -f docker-compose.content-sync.yaml run --rm --no-deps content-sync /usr/local/bin/sync-public-content --once"|\
  "compose -f docker-compose.yaml -f docker-compose.test.yaml -f docker-compose.registry.yaml -f docker-compose.content-sync.yaml run --rm --no-deps content-sync /usr/local/bin/sync-public-content --once --dry-run")
    exit "${dollar}{FAKE_DOCKER_EXIT_STATUS:-0}"
    ;;
esac

if [[ "${dollar}1" == exec && "${dollar}2" == "${dollar}FAKE_MYSQL_CONTAINER" && \
      "${dollar}3" == printenv && "${dollar}4" == MYSQL_USER ]]; then
  printf '%s\n' "${dollar}{FAKE_TARGET_USER:-legendhub}"
  exit 0
fi

if [[ "${dollar}1" == exec && "${dollar}2" == "${dollar}FAKE_MYSQL_CONTAINER" && \
      "${dollar}3" == sh ]]; then
  [[ -n "${dollar}{FAKE_ROOT_PASSWORD:-}" ]]
  exit
fi

if [[ "${dollar}1" == exec && "${dollar}2" == -i && \
      "${dollar}3" == "${dollar}FAKE_MYSQL_CONTAINER" && "${dollar}4" == sh ]]; then
  cat > "${dollar}FAKE_SQL_LOG"
  exit 0
fi

printf 'unexpected docker command\n' >&2
exit 64
`;

let workspace;
let fakeBin;
let remoteRoot;
let sshLog;
let dockerLog;
let gitLog;
let imageTagLog;
let projectNameLog;
let sqlLog;
let cdLog;
let bashEnvironment;

function writeExecutable(file, content) {
    fs.writeFileSync(file, content, {mode: 0o755});
}

function readIfPresent(file) {
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function readArguments(file) {
    const log = readIfPresent(file);

    return log === "" ? [] : log.split("\0").slice(0, -1);
}

function readDockerCalls() {
    const log = readIfPresent(dockerLog);

    return log === "" ? [] : log.split("\x1e").filter(Boolean).map(
        (record) => record.split("\0").slice(0, -1));
}

function environment(overrides = {}) {
    return {
        ...process.env,
        BASH_ENV: bashEnvironment,
        FAKE_CD_LOG: cdLog,
        FAKE_DOCKER_LOG: dockerLog,
        FAKE_GIT_LOG: gitLog,
        FAKE_GIT_TAG: "abcdef123456",
        FAKE_IMAGE_TAG_LOG: imageTagLog,
        FAKE_MYSQL_CONTAINER: "mysql-container-id",
        FAKE_MYSQL_IDS: "mysql-container-id",
        FAKE_PROJECT_NAME_LOG: projectNameLog,
        FAKE_REMOTE_ROOT: remoteRoot,
        FAKE_ROOT_PASSWORD: "root-password-do-not-print",
        FAKE_SQL_LOG: sqlLog,
        FAKE_SSH_LOG: sshLog,
        FAKE_TARGET_PASSWORD: "target-password-do-not-print",
        FAKE_TARGET_USER: "legendhub",
        COMPOSE_PROJECT_NAME: "",
        LEGENDHUB_IMAGE_TAG: "",
        PATH: `${fakeBin}:${process.env.PATH}`,
        ...overrides,
    };
}

function run(script, args = [], overrides = {}) {
    return spawnSync(bash, [script, ...args], {
        encoding: "utf8",
        env: environment(overrides),
    });
}

function writeRemoteFiles(stagingDatabase = "legendhub_content_sync",
    projectDefinitions = ["COMPOSE_PROJECT_NAME=legendhub-test"]) {
    fs.writeFileSync(path.join(remoteRoot, ".env"), [
        ...projectDefinitions,
        `CONTENT_SYNC_STAGING_DATABASE=${stagingDatabase}`,
        "MYSQL_ROOT_PASSWORD=root-password-do-not-print",
        "MYSQL_PASSWORD=target-password-do-not-print",
        "",
    ].join("\n"));
    for (const file of [
        "docker-compose.yaml",
        "docker-compose.test.yaml",
        "docker-compose.registry.yaml",
        "docker-compose.content-sync.yaml",
    ])
        fs.writeFileSync(path.join(remoteRoot, file), "services: {}\n");
}

beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "legendhub-content-operator-"));
    fakeBin = path.join(workspace, "bin");
    remoteRoot = path.join(workspace, "remote");
    sshLog = path.join(workspace, "ssh.log");
    dockerLog = path.join(workspace, "docker.log");
    gitLog = path.join(workspace, "git.log");
    imageTagLog = path.join(workspace, "image-tag.log");
    projectNameLog = path.join(workspace, "project-name.log");
    sqlLog = path.join(workspace, "sql.log");
    cdLog = path.join(workspace, "cd.log");
    bashEnvironment = path.join(workspace, "bash-env");
    fs.mkdirSync(fakeBin);
    fs.mkdirSync(remoteRoot);
    writeExecutable(path.join(fakeBin, "ssh"), sshFake);
    writeExecutable(path.join(fakeBin, "git"), gitFake);
    writeExecutable(path.join(fakeBin, "docker"), dockerFake);
    fs.writeFileSync(bashEnvironment, String.raw`cd() {
  printf '%s\n' "${dollar}1" > "${dollar}FAKE_CD_LOG"
  builtin cd "${dollar}FAKE_REMOTE_ROOT"
}
`);
    writeRemoteFiles();
});

afterEach(() => fs.rmSync(workspace, {recursive: true, force: true}));

test("manual sync sends the fixed remote command without agent forwarding", () => {
    const result = run(localSync);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readArguments(sshLog), [
        "-a",
        "dunwichmass",
        "/home/rufus/legendhub/scripts/run-test-content-sync.sh",
    ]);
});

test("dry run remains explicit and reaches the server as one argument", () => {
    const result = run(localSync, ["--dry-run"]);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readArguments(sshLog), [
        "-a",
        "dunwichmass",
        "/home/rufus/legendhub/scripts/run-test-content-sync.sh",
        "--dry-run",
    ]);
});

test("manual sync preserves the remote exit status", () => {
    const result = run(localSync, [], {FAKE_SSH_EXIT_STATUS: "37"});

    assert.equal(result.status, 37);
});

for (const args of [["--apply"], ["dry-run"], ["--remote"], ["anything"],
    ["--dry-run", "extra"]]) {
    test(`manual sync rejects ${JSON.stringify(args)}`, () => {
        const result = run(localSync, args);

        assert.equal(result.status, 64);
        assert.equal(readIfPresent(sshLog), "");
    });
}

test("remote sync runs the profiled service once from the fixed directory", () => {
    const result = run(remoteSync, [], {COMPOSE_PROJECT_NAME: "hostile-project"});

    assert.equal(result.status, 0, result.stderr);
    assert.equal(readIfPresent(cdLog), "/home/rufus/legendhub\n");
    assert.deepEqual(readArguments(gitLog), [
        "rev-parse", "--short=12", "HEAD",
    ]);
    assert.equal(readIfPresent(imageTagLog), "abcdef123456\n");
    assert.equal(readIfPresent(projectNameLog), "legendhub-test\n");
    assert.deepEqual(readDockerCalls(), [[
        "compose", "-f", "docker-compose.yaml",
        "-f", "docker-compose.test.yaml",
        "-f", "docker-compose.registry.yaml",
        "-f", "docker-compose.content-sync.yaml",
        "run", "--rm", "--no-deps", "content-sync",
        "/usr/local/bin/sync-public-content", "--once",
    ]]);
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
    test(`remote sync rejects ${fixture.name} before Git or Docker`, () => {
        writeRemoteFiles("legendhub_content_sync", fixture.lines);

        const result = run(remoteSync);

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Compose project/);
        assert.equal(readIfPresent(gitLog), "");
        assert.equal(readIfPresent(dockerLog), "");
    });
}

test("remote dry run remains one explicit container argument", () => {
    const result = run(remoteSync, ["--dry-run"]);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readDockerCalls()[0].slice(-3), [
        "/usr/local/bin/sync-public-content", "--once", "--dry-run",
    ]);
});

for (const failure of [
    {name: "Git failure", environment: {FAKE_GIT_EXIT_STATUS: "19"}},
    {name: "short tag", environment: {FAKE_GIT_TAG: "abcdef12345"}},
    {name: "uppercase tag", environment: {FAKE_GIT_TAG: "ABCDEF123456"}},
    {name: "non-hex tag", environment: {FAKE_GIT_TAG: "abcdef12345g"}},
]) {
    test(`remote sync rejects ${failure.name} before Docker`, () => {
        const result = run(remoteSync, [], failure.environment);

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /deployment image tag/);
        assert.equal(readIfPresent(dockerLog), "");
    });
}

test("remote sync preserves Docker status and rejects hidden arguments", async (t) => {
    const failed = run(remoteSync, [], {FAKE_DOCKER_EXIT_STATUS: "38"});
    assert.equal(failed.status, 38);

    for (const args of [["--once"], ["--dry-run", "extra"]]) {
        await t.test(JSON.stringify(args), () => {
            fs.rmSync(dockerLog, {force: true});
            const result = run(remoteSync, args);
            assert.equal(result.status, 64);
            assert.equal(readIfPresent(dockerLog), "");
        });
    }
});

test("provision uses the fixed staging database and minimum grant", () => {
    writeRemoteFiles();

    const result = run(provision, [], {
        COMPOSE_PROJECT_NAME: "hostile-project",
        FAKE_SSH_EXECUTE: "1",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readArguments(sshLog), [
        "-a", "dunwichmass", "bash", "-s", "--", "--remote",
        "/home/rufus/legendhub",
    ]);
    assert.equal(readIfPresent(cdLog), "/home/rufus/legendhub\n");
    assert.deepEqual(readArguments(gitLog), [
        "rev-parse", "--short=12", "HEAD",
    ]);
    assert.equal(readIfPresent(sqlLog), [
        "CREATE DATABASE IF NOT EXISTS `legendhub_content_sync`",
        "  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;",
        "GRANT ALL PRIVILEGES ON `legendhub_content_sync`.*",
        "  TO 'legendhub'@'%';",
        "",
    ].join("\n"));
    const calls = readDockerCalls();
    assert.deepEqual(calls[0].slice(-2), ["config", "--quiet"]);
    assert.deepEqual(calls[1].slice(-3), ["ps", "--quiet", "mysql"]);
    assert.deepEqual(calls[2], [
        "exec", "mysql-container-id", "printenv", "MYSQL_USER",
    ]);
    assert.deepEqual(calls[3], [
        "exec", "mysql-container-id", "sh", "-eu", "-c",
        "test -n \"${MYSQL_ROOT_PASSWORD:-}\"",
    ]);
    assert.deepEqual(calls[4], [
        "exec", "-i", "mysql-container-id", "sh", "-eu", "-c",
        [
            "",
            "export MYSQL_PWD=\"$MYSQL_ROOT_PASSWORD\"",
            "unset MYSQL_ROOT_PASSWORD MYSQL_PASSWORD",
            "exec mysql --protocol=socket --user=root",
            "",
        ].join("\n"),
    ]);
    assert.equal(readIfPresent(imageTagLog), "abcdef123456\n".repeat(5));
    assert.equal(readIfPresent(projectNameLog), "legendhub-test\n".repeat(5));
    const allOutput = result.stdout + result.stderr + JSON.stringify(calls);
    assert.doesNotMatch(allOutput, /root-password-do-not-print/);
    assert.doesNotMatch(allOutput, /target-password-do-not-print/);
});

for (const fixture of invalidProjectDefinitions) {
    test(`provision rejects ${fixture.name} before Git, Docker, or SQL`, () => {
        writeRemoteFiles("legendhub_content_sync", fixture.lines);

        const result = run(provision, [], {FAKE_SSH_EXECUTE: "1"});

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Compose project/);
        assert.equal(readIfPresent(gitLog), "");
        assert.equal(readIfPresent(dockerLog), "");
        assert.equal(readIfPresent(sqlLog), "");
    });
}

for (const failure of [
    {name: "Git failure", environment: {FAKE_GIT_EXIT_STATUS: "19"}},
    {name: "short tag", environment: {FAKE_GIT_TAG: "abcdef12345"}},
    {name: "uppercase tag", environment: {FAKE_GIT_TAG: "ABCDEF123456"}},
    {name: "non-hex tag", environment: {FAKE_GIT_TAG: "abcdef12345g"}},
]) {
    test(`provision rejects ${failure.name} before Docker or SQL`, () => {
        writeRemoteFiles();
        const result = run(provision, [], {
            ...failure.environment,
            FAKE_SSH_EXECUTE: "1",
        });

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /deployment image tag/);
        assert.equal(readIfPresent(dockerLog), "");
        assert.equal(readIfPresent(sqlLog), "");
    });
}

test("provision rejects unsafe staging configuration before Docker", () => {
    writeRemoteFiles("other_database");

    const result = run(provision, [], {FAKE_SSH_EXECUTE: "1"});

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /CONTENT_SYNC_STAGING_DATABASE/);
    assert.equal(readIfPresent(dockerLog), "");
    assert.equal(readIfPresent(sqlLog), "");
});

test("provision requires every remote Compose input before Docker", () => {
    writeRemoteFiles();
    fs.rmSync(path.join(remoteRoot, "docker-compose.test.yaml"));

    const result = run(provision, [], {FAKE_SSH_EXECUTE: "1"});

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /docker-compose\.test\.yaml/);
    assert.equal(readIfPresent(dockerLog), "");
});

for (const ids of ["", "first-container\nsecond-container"]) {
    test(`provision rejects ${ids === "" ? 0 : 2} MySQL containers`, () => {
        writeRemoteFiles();

        const result = run(provision, [], {
            FAKE_MYSQL_IDS: ids,
            FAKE_SSH_EXECUTE: "1",
        });

        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /expected one MySQL container/);
        assert.equal(readIfPresent(sqlLog), "");
    });
}

test("provision rejects a non-legendhub target user before SQL", () => {
    writeRemoteFiles();

    const result = run(provision, [], {
        FAKE_SSH_EXECUTE: "1",
        FAKE_TARGET_USER: "other-user",
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /expected target user legendhub/);
    assert.equal(readIfPresent(sqlLog), "");
    assert.doesNotMatch(result.stderr, /other-user/);
});

test("provision requires a root password before SQL without printing it", () => {
    writeRemoteFiles();

    const result = run(provision, [], {
        FAKE_ROOT_PASSWORD: "",
        FAKE_SSH_EXECUTE: "1",
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /root password/);
    assert.equal(readIfPresent(sqlLog), "");
    assert.doesNotMatch(result.stdout + result.stderr,
        /target-password-do-not-print|root-password-do-not-print/);
});
