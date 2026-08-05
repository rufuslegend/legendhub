const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const {afterEach, beforeEach, test} = require("node:test");

const publisher = path.resolve(__dirname, "../publish-images.sh");
let workspace;
let fakeBin;
let dockerState;
let dockerLog;
const dollar = "$";

const gitFake = String.raw`#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  rev-parse)
    printf '%s\n' 'abcdef123456'
    ;;
  status)
    printf '%s' "${dollar}{FAKE_GIT_STATUS:-}"
    ;;
  *)
    printf 'unexpected git command: %s\n' "$*" >&2
    exit 64
    ;;
esac
`;

const dockerFake = String.raw`#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$FAKE_DOCKER_LOG"

encode_ref() { printf '%s' "$1" | tr '/:' '__'; }

if [[ "$1 $2" == "buildx version" || "$1 $2" == "buildx inspect" ]]; then
  exit 0
fi

if [[ "$1 $2 $3" == "buildx imagetools inspect" ]]; then
  ref="${dollar}{!#}"
  if [[ "${dollar}{FAKE_DOCKER_INSPECT_FAILURE:-}" == "1" ]]; then
    printf 'temporary registry timeout\n' >&2
    exit 75
  fi
  test -f "${dollar}FAKE_DOCKER_STATE/${dollar}(encode_ref "${dollar}ref")" || {
    printf 'image not found\n' >&2
    exit 1
  }
  cat <<JSON
{"manifest":{"digest":"sha256:${dollar}{FAKE_DIGEST}","manifests":[{"platform":{"os":"linux","architecture":"amd64"}},{"platform":{"os":"unknown","architecture":"unknown"},"annotations":{"vnd.docker.reference.type":"attestation-manifest"}}]}}
JSON
  exit 0
fi

if [[ "$1 $2" == "buildx build" ]]; then
  shift 2
  while (($#)); do
    if [[ "$1" == "--tag" ]]; then
      ref="$2"
      touch "${dollar}FAKE_DOCKER_STATE/${dollar}(encode_ref "${dollar}ref")"
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
      touch "${dollar}FAKE_DOCKER_STATE/${dollar}(encode_ref "${dollar}ref")"
      exit 0
    fi
    shift
  done
fi

printf 'unexpected docker command\n' >&2
exit 64
`;

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

function runPublisher(gitStatus, environment = {}) {
    return spawnSync("bash", [publisher], {
        cwd: path.resolve(__dirname, "../.."),
        env: {
            ...process.env,
            PATH: `${fakeBin}:${process.env.PATH}`,
            FAKE_DIGEST: "b".repeat(64),
            FAKE_DOCKER_LOG: dockerLog,
            FAKE_DOCKER_STATE: dockerState,
            FAKE_GIT_STATUS: gitStatus,
            ...environment,
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

test("fails closed when inspection of a seeded SHA image fails", () => {
    seedShaImageState("abcdef123456");
    const result = runPublisher("", {FAKE_DOCKER_INSPECT_FAILURE: "1"});
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /inspection|timeout/i);
    assert.doesNotMatch(readDockerLog(), /buildx build/);
});
