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
const expectedBackupPayload = [
    "",
    "    set -euo pipefail",
    '    private="/backups/private/database_$(date +%m-%d-%Y).sql.gz"',
    '    public="/backups/public/database.sql"',
    '    test -s "$private"',
    '    gzip -t "$private"',
    '    test -s "$public"',
    '    stat -c "INFO: %n — %s bytes — mode %a" "$private" "$public"',
    "  ",
].join("\n");

const sshFake = String.raw`#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "${dollar}*" > "${dollar}FAKE_SSH_ARGS"
tee "${dollar}FAKE_SSH_PAYLOAD" | bash -n
`;

const composeFake = String.raw`#!/usr/bin/env bash
set -euo pipefail
printf 'docker-compose %s\n' "${dollar}*" >> "${dollar}FAKE_COMMAND_LOG"

case "${dollar}*" in
  *"config --services")
    if [[ "${dollar}PWD" == "${dollar}FAKE_ROLLBACK_ROOT" ]]; then
      printf '%s\n' mysql python www
      [[ -z "${dollar}{FAKE_EXTRA_ROLLBACK_SERVICE:-}" ]] ||
        printf '%s\n' "${dollar}FAKE_EXTRA_ROLLBACK_SERVICE"
    else
      printf '%s\n' mysql mysql-backup python www
      [[ -z "${dollar}{FAKE_EXTRA_CURRENT_SERVICE:-}" ]] ||
        printf '%s\n' "${dollar}FAKE_EXTRA_CURRENT_SERVICE"
    fi
    exit 0
    ;;
  *"config --quiet") exit 0 ;;
  *"config")
    printf '%s\n' \
      'services:' \
      '  mysql:' \
      '    environment:' \
      '      SECRET_VALUE: do-not-print' \
      '    image: mysql:5.7.44' \
      '  mysql-backup:' \
      '    image: tmckimmey/legendhub-mysql-backup:6ddaeab948a1' \
      '  python:' \
      '    image: tmckimmey/legendhub-python:6ddaeab948a1' \
      '  www:' \
      "    image: ${dollar}{FAKE_COMPOSE_WWW_IMAGE:-tmckimmey/legendhub-www:4bb661fd5dd7}"
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
  if [[ "${dollar}{FAKE_MISSING_ROLLBACK_CONTAINER:-}" == "${dollar}container" ]]; then
    exit 1
  fi
  case "${dollar}template" in
    *com.docker.compose.project*)
      case "${dollar}container" in
        legendhub260_*) printf '%s\n' legendhub260 ;;
        legendhub_*) printf '%s\n' "${dollar}{FAKE_ROLLBACK_PROJECT:-legendhub}" ;;
        *) exit 64 ;;
      esac
      ;;
    *com.docker.compose.service*)
      case "${dollar}container" in
        legendhub260_mysql_1) printf '%s\n' mysql ;;
        legendhub260_mysql-backup_1) printf '%s\n' mysql-backup ;;
        legendhub260_python_1) printf '%s\n' python ;;
        legendhub260_www_1) printf '%s\n' www ;;
        legendhub_mysql_1) printf '%s\n' mysql ;;
        legendhub_python_1) printf '%s\n' "${dollar}{FAKE_ROLLBACK_PYTHON_SERVICE:-python}" ;;
        legendhub_www_1|legendhub_www_2) printf '%s\n' www ;;
        *) exit 64 ;;
      esac
      ;;
    *Config.Image*)
      case "${dollar}container" in
        legendhub260_mysql_1) printf '%s\n' mysql:5.7.44 ;;
        legendhub260_mysql-backup_1) printf '%s\n' tmckimmey/legendhub-mysql-backup:6ddaeab948a1 ;;
        legendhub260_python_1) printf '%s\n' tmckimmey/legendhub-python:6ddaeab948a1 ;;
        legendhub260_www_1) printf '%s\n' "${dollar}{FAKE_WWW_CONTAINER_IMAGE:-tmckimmey/legendhub-www:4bb661fd5dd7}" ;;
        legendhub_mysql_1) printf '%s\n' legendhub_mysql ;;
        legendhub_python_1) printf '%s\n' "${dollar}{FAKE_ROLLBACK_PYTHON_IMAGE:-legendhub_python}" ;;
        legendhub_www_1) printf '%s\n' legendhub_www ;;
        *) exit 64 ;;
      esac
      ;;
    *State.Status*)
      case "${dollar}container" in
        legendhub260_*) printf '%s\n' running ;;
        legendhub_*)
          if [[ "${dollar}{FAKE_RUNNING_ROLLBACK_CONTAINER:-}" == "${dollar}container" ]]; then
            printf '%s\n' running
          elif [[ "${dollar}container" == legendhub_www_2 ]]; then
            printf '%s\n' created
          else
            printf '%s\n' exited
          fi
          ;;
        *) exit 64 ;;
      esac
      ;;
    *RestartCount*) printf '%s\n' 0 ;;
    *State.Health.Status*)
      [[ "${dollar}container" == legendhub260_mysql_1 ]] || exit 65
      printf '%s\n' healthy
      ;;
    *'{{.Image}}'*)
      case "${dollar}container" in
        legendhub260_mysql_1) printf '%s\n' sha256:mysql-image-id ;;
        legendhub260_mysql-backup_1) printf '%s\n' sha256:backup-image-id ;;
        legendhub260_python_1) printf '%s\n' sha256:python-image-id ;;
        legendhub260_www_1) printf '%s\n' "${dollar}{FAKE_WWW_RUNNING_ID:-sha256:www-image-id}" ;;
        legendhub_mysql_1) printf '%s\n' sha256:rollback-mysql-image-id ;;
        legendhub_python_1) printf '%s\n' sha256:rollback-python-image-id ;;
        legendhub_www_1) printf '%s\n' sha256:rollback-www-image-id ;;
        *) exit 64 ;;
      esac
      ;;
    *Mounts*)
      case "${dollar}container" in
        legendhub_mysql_1)
          printf '%s\n' legendhub_database legendhub_database-logs
          [[ -z "${dollar}{FAKE_EXTRA_ROLLBACK_VOLUME:-}" ]] ||
            printf '%s\n' "${dollar}FAKE_EXTRA_ROLLBACK_VOLUME"
          ;;
        legendhub_python_1) printf '%s\n' legendhub_python-logs ;;
        legendhub_www_1) : ;;
        *) exit 64 ;;
      esac
      ;;
    *Id*) printf 'container-id-%s\n' "${dollar}container" ;;
    *) exit 64 ;;
  esac
  exit 0
fi

if [[ "${dollar}{1:-}" == image && "${dollar}{2:-}" == inspect ]]; then
  template="${dollar}4"
  image="${dollar}5"
  if [[ "${dollar}{FAKE_MISSING_ROLLBACK_IMAGE_ID:-}" == "${dollar}image" ]]; then
    exit 1
  fi
  if [[ "${dollar}template" == '{{.Id}}' ]]; then
    case "${dollar}image" in
      mysql:5.7.44) printf '%s\n' sha256:mysql-image-id ;;
      tmckimmey/legendhub-mysql-backup:6ddaeab948a1) printf '%s\n' sha256:backup-image-id ;;
      tmckimmey/legendhub-python:6ddaeab948a1) printf '%s\n' sha256:python-image-id ;;
      tmckimmey/legendhub-www:4bb661fd5dd7) printf '%s\n' sha256:www-image-id ;;
      legendhub_mysql) printf '%s\n' sha256:rollback-mysql-image-id ;;
      legendhub_python) printf '%s\n' sha256:rollback-python-image-id ;;
      legendhub_www) printf '%s\n' sha256:rollback-www-image-id ;;
      *) exit 64 ;;
    esac
  else
    printf '%s\n' linux/amd64
  fi
  exit 0
fi

if [[ "${dollar}{1:-}" == exec ]]; then
  [[ "${dollar}#" -eq 5 ]]
  [[ "${dollar}{2:-}" == legendhub260_mysql-backup_1 ]]
  [[ "${dollar}{3:-}" == bash && "${dollar}{4:-}" == -c ]]
  printf '%s' "${dollar}{5:-}" > "${dollar}FAKE_DOCKER_EXEC_PAYLOAD"
  [[ "${dollar}{5:-}" == "${dollar}FAKE_EXPECTED_DOCKER_EXEC_PAYLOAD" ]] || exit 66
  printf '%s\n' \
    'INFO: /backups/private/database_08-11-2026.sql.gz — 123 bytes — mode 644' \
    'INFO: /backups/public/database.sql — 456 bytes — mode 644'
  exit 0
fi

if [[ "${dollar}{1:-}" == ps && "${dollar}{2:-}" == -a ]]; then
  case "${dollar}*" in
    *com.docker.compose.project=legendhub260*)
      printf '%s\n' legendhub260_mysql_1 legendhub260_mysql-backup_1 \
        legendhub260_python_1 legendhub260_www_1
      [[ -z "${dollar}{FAKE_EXTRA_CURRENT_CONTAINER:-}" ]] ||
        printf '%s\n' "${dollar}FAKE_EXTRA_CURRENT_CONTAINER"
      ;;
    *com.docker.compose.project=legendhub*)
      printf '%s\n' legendhub_mysql_1 legendhub_python_1 legendhub_www_1 legendhub_www_2
      [[ -z "${dollar}{FAKE_EXTRA_ROLLBACK_CONTAINER:-}" ]] ||
        printf '%s\n' "${dollar}FAKE_EXTRA_ROLLBACK_CONTAINER"
      ;;
    *) exit 64 ;;
  esac
  exit 0
fi

if [[ "${dollar}{1:-}" == volume && "${dollar}{2:-}" == inspect ]]; then
  [[ "${dollar}{FAKE_MISSING_ROLLBACK_VOLUME:-}" != "${dollar}{3:-}" ]]
  exit
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
if [[ "${dollar}{2:-}" == '%s %a %U' ]]; then
  printf '%s %s %s\n' \
    "${dollar}{FAKE_DUMP_SIZE:-2791012}" \
    "${dollar}{FAKE_DUMP_MODE:-600}" \
    "${dollar}{FAKE_DUMP_OWNER:-tester}"
  exit 0
fi
if [[ "${dollar}{2:-}" == 'INFO: %n — %s bytes — mode %a' ]]; then
  printf 'INFO: %s — %s bytes — mode %s\n' \
    "${dollar}{3:-missing}" \
    "${dollar}{FAKE_DUMP_SIZE:-2791012}" \
    "${dollar}{FAKE_DUMP_MODE:-600}"
  exit 0
fi
printf 'unexpected stat command: %s\n' "${dollar}*" >&2
exit 64
`;

const idFake = String.raw`#!/usr/bin/env bash
set -euo pipefail
[[ "${dollar}*" == '-un' ]] || exit 64
printf '%s\n' tester
`;

const mutatorFake = String.raw`#!/usr/bin/env bash
set -euo pipefail
printf 'MUTATOR %s %s\n' "${dollar}0" "${dollar}*" >> "${dollar}FAKE_COMMAND_LOG"
exit 97
`;

let workspace;
let fakeBin;
let remoteRoot;
let rollbackRoot;
let cutoverDump;
let sshArgs;
let sshPayload;
let commandLog;
let dockerExecPayload;

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
    dockerExecPayload = path.join(workspace, "docker-exec-payload");

    fs.mkdirSync(fakeBin);
    fs.mkdirSync(remoteRoot);
    fs.mkdirSync(rollbackRoot);
    fs.writeFileSync(path.join(remoteRoot, ".env"), "SECRET_VALUE=do-not-print\n");
    fs.writeFileSync(path.join(remoteRoot, "docker-compose.yaml"), "version: '3.7'\n");
    fs.writeFileSync(cutoverDump, zlib.gzipSync("validated cutover backup\n"));
    fs.writeFileSync(path.join(rollbackRoot, ".env"), "ROLLBACK_SECRET=rollback-do-not-print\n");
    fs.writeFileSync(path.join(rollbackRoot, "docker-compose.yaml"), "version: '2'\n");

    writeExecutable(path.join(fakeBin, "ssh"), sshFake);
    writeExecutable(path.join(fakeBin, "docker-compose"), composeFake);
    writeExecutable(path.join(fakeBin, "docker"), dockerFake);
    writeExecutable(path.join(fakeBin, "curl"), curlFake);
    writeExecutable(path.join(fakeBin, "stat"), statFake);
    writeExecutable(path.join(fakeBin, "id"), idFake);
    for (const command of ["cp", "install", "mv", "rm", "touch", "truncate"]) {
        writeExecutable(path.join(fakeBin, command), mutatorFake);
    }
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

function runRemote(extraEnvironment = {}, targetScript = preflight) {
    return spawnSync("bash", [
        targetScript,
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
            FAKE_DOCKER_EXEC_PAYLOAD: dockerExecPayload,
            FAKE_EXPECTED_DOCKER_EXEC_PAYLOAD: expectedBackupPayload,
            FAKE_HTTP_CODE: "200",
            FAKE_ROLLBACK_ROOT: rollbackRoot,
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
    assert.equal(result.stdout.includes("rollback-do-not-print"), false);
    assert.equal(result.stderr.includes("rollback-do-not-print"), false);
    assert.equal(fs.readFileSync(dockerExecPayload, "utf8"), expectedBackupPayload);

    const commands = fs.readFileSync(commandLog, "utf8").trim().split("\n");
    const curlCommands = commands.filter((line) => line.startsWith("curl "));
    assert.equal(curlCommands.length, 18);
    assert.equal(curlCommands.every((line) => line.includes("--connect-timeout 5 --max-time 15")), true);
    assert.equal(curlCommands.every((line) => !line.includes(" -L ")), true);
    assert.deepEqual(curlCommands.map((line) => line.split(" ").at(-1)), [
        "http://127.0.0.1:7000/",
        "http://127.0.0.1:7000/feedback.html",
        "http://127.0.0.1:7000/changelog",
        "http://127.0.0.1:7000/builder/",
        "http://127.0.0.1:7000/items/",
        "http://127.0.0.1:7000/mobs/",
        "http://127.0.0.1:7000/quests/",
        "http://127.0.0.1:7000/wiki/",
        "http://127.0.0.1:7000/login.html",
        "https://www.legendhub.org/",
        "https://www.legendhub.org/feedback.html",
        "https://www.legendhub.org/changelog",
        "https://www.legendhub.org/builder/",
        "https://www.legendhub.org/items/",
        "https://www.legendhub.org/mobs/",
        "https://www.legendhub.org/quests/",
        "https://www.legendhub.org/wiki/",
        "https://www.legendhub.org/login.html",
    ]);
    assert.equal(commands.filter((line) => line.startsWith("docker exec ")).length, 1);
    assert.equal(commands.some((line) => /docker-compose .* (up|down|pull|push|stop|start|restart)\b/.test(line)), false);
    assert.equal(commands.some((line) => /^docker (rm|rmi|start|stop|restart|pull|push)\b/.test(line)), false);
    assert.equal(commands.some((line) => line.startsWith("MUTATOR ")), false);
});

test("rejects a backup check that tries to print private backup contents", () => {
    const unsafeScript = path.join(workspace, "unsafe-preflight.sh");
    const source = fs.readFileSync(preflight, "utf8").replace(
        '    test -s "$private"',
        '    cat "$private"',
    );
    fs.writeFileSync(unsafeScript, source, {mode: 0o755});

    const result = runRemote({}, unsafeScript);

    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout + result.stderr, /PRODUCTION PREFLIGHT PASSED/);
});

test("fails when a production route is not healthy", () => {
    const result = runRemote({FAKE_HTTP_CODE: "503"});

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /local \/ returned HTTP 503/);
    assert.doesNotMatch(result.stdout + result.stderr, /PRODUCTION PREFLIGHT PASSED/);
});

test("fails when Compose, container tags, or running image IDs differ", async (t) => {
    const cases = [
        {
            environment: {FAKE_COMPOSE_WWW_IMAGE: "tmckimmey/legendhub-www:wrong"},
            message: /Compose image for www is .*wrong/,
            name: "Compose image",
        },
        {
            environment: {FAKE_WWW_CONTAINER_IMAGE: "tmckimmey/legendhub-www:wrong"},
            message: /container image for www is .*wrong/,
            name: "container image",
        },
        {
            environment: {FAKE_WWW_RUNNING_ID: "sha256:wrong"},
            message: /running image ID for www does not match/,
            name: "running image ID",
        },
    ];

    for (const candidate of cases) {
        await t.test(candidate.name, () => {
            const result = runRemote(candidate.environment);

            assert.notEqual(result.status, 0);
            assert.match(result.stderr, candidate.message);
            assert.doesNotMatch(result.stdout + result.stderr, /PRODUCTION PREFLIGHT PASSED/);
        });
    }
});

test("fails when current Compose services or project containers are unexpected", async (t) => {
    const cases = [
        {
            environment: {FAKE_EXTRA_CURRENT_SERVICE: "worker"},
            message: /Current Compose services does not match the expected set/,
            name: "extra Compose service",
        },
        {
            environment: {FAKE_EXTRA_CURRENT_CONTAINER: "legendhub260_worker_1"},
            message: /Current project containers does not match the expected set/,
            name: "extra project container",
        },
    ];

    for (const candidate of cases) {
        await t.test(candidate.name, () => {
            const result = runRemote(candidate.environment);

            assert.notEqual(result.status, 0);
            assert.match(result.stderr, candidate.message);
            assert.doesNotMatch(result.stdout + result.stderr, /PRODUCTION PREFLIGHT PASSED/);
        });
    }
});

test("fails when the cutover dump is too small, too open, or foreign-owned", async (t) => {
    const cases = [
        {
            environment: {FAKE_DUMP_SIZE: "1048576"},
            message: /Cutover backup is only 1048576 bytes/,
            name: "minimum size",
        },
        {
            environment: {FAKE_DUMP_MODE: "640"},
            message: /Cutover backup mode is 640/,
            name: "private mode",
        },
        {
            environment: {FAKE_DUMP_OWNER: "somebody-else"},
            message: /Cutover backup owner is somebody-else/,
            name: "owner",
        },
    ];

    for (const candidate of cases) {
        await t.test(candidate.name, () => {
            const result = runRemote(candidate.environment);

            assert.notEqual(result.status, 0);
            assert.match(result.stderr, candidate.message);
            assert.doesNotMatch(result.stdout + result.stderr, /PRODUCTION PREFLIGHT PASSED/);
        });
    }
});

test("fails when exact rollback containers or their volumes are unavailable", async (t) => {
    const cases = [
        {
            environment: {FAKE_MISSING_ROLLBACK_CONTAINER: "legendhub_python_1"},
            message: /Rollback project container legendhub_python_1 is missing/,
            name: "missing container",
        },
        {
            environment: {FAKE_RUNNING_ROLLBACK_CONTAINER: "legendhub_www_1"},
            message: /Rollback project container legendhub_www_1 is running/,
            name: "running container",
        },
        {
            environment: {FAKE_MISSING_ROLLBACK_VOLUME: "legendhub_database"},
            message: /Rollback volume legendhub_database is missing/,
            name: "missing volume",
        },
        {
            environment: {FAKE_MISSING_ROLLBACK_IMAGE_ID: "legendhub_python"},
            message: /Rollback image legendhub_python is missing/,
            name: "missing image",
        },
        {
            environment: {FAKE_ROLLBACK_PYTHON_IMAGE: "substituted-image"},
            message: /Rollback container image for python is substituted-image/,
            name: "substituted image",
        },
        {
            environment: {FAKE_ROLLBACK_PROJECT: "substituted-project"},
            message: /belongs to project substituted-project/,
            name: "wrong project label",
        },
        {
            environment: {FAKE_RUNNING_ROLLBACK_CONTAINER: "legendhub_www_2"},
            message: /Rollback project container legendhub_www_2 is running/,
            name: "running retained container",
        },
        {
            environment: {FAKE_EXTRA_ROLLBACK_SERVICE: "worker"},
            message: /Rollback Compose services does not match the expected set/,
            name: "extra Compose service",
        },
        {
            environment: {FAKE_EXTRA_ROLLBACK_CONTAINER: "legendhub_worker_1"},
            message: /Rollback project containers does not match the expected set/,
            name: "extra project container",
        },
        {
            environment: {FAKE_EXTRA_ROLLBACK_VOLUME: "legendhub_unexpected"},
            message: /Rollback named volumes does not match the expected set/,
            name: "extra named volume",
        },
    ];

    for (const candidate of cases) {
        await t.test(candidate.name, () => {
            const result = runRemote(candidate.environment);

            assert.notEqual(result.status, 0);
            assert.match(result.stderr, candidate.message);
            assert.doesNotMatch(result.stdout + result.stderr, /PRODUCTION PREFLIGHT PASSED/);
        });
    }
});

test("fails when rollback Compose or environment files are missing", async (t) => {
    for (const file of ["docker-compose.yaml", ".env"]) {
        await t.test(file, () => {
            const target = path.join(rollbackRoot, file);
            const contents = fs.readFileSync(target);
            fs.rmSync(target);

            const result = runRemote();

            fs.writeFileSync(target, contents);
            assert.notEqual(result.status, 0);
            assert.match(result.stderr, new RegExp(`Rollback ${file.replace(".", "\\.")} is missing`));
            assert.doesNotMatch(result.stdout + result.stderr, /PRODUCTION PREFLIGHT PASSED/);
        });
    }
});
