"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const test = require("node:test");

const tagger = path.resolve(__dirname, "../tag-release.sh");

function run(repo, command, args, environment = {}) {
    return spawnSync(command, args, {
        cwd: repo,
        env: {...process.env, ...environment},
        encoding: "utf8"
    });
}

function git(repo, ...args) {
    const result = run(repo, "git", args);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
}

function createReleaseRepository(t) {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "legendhub-tag-"));
    t.after(() => fs.rmSync(repo, {recursive: true, force: true}));
    fs.mkdirSync(path.join(repo, "www"));
    fs.writeFileSync(path.join(repo, "CHANGELOG.md"),
        "# Changelog\n\n## [2.6.0-beta] - 2026-08-05\n\n- Safer releases\n");
    fs.writeFileSync(path.join(repo, "README.md"),
        "[![Version v=2.6.0-beta](https://img.shields.io/badge/version-v=2.6.0--beta-brightgreen.svg)]\n");
    fs.writeFileSync(path.join(repo, "www/package.json"), JSON.stringify({
        name: "legendhub", version: "2.6.0-beta"
    }));
    fs.writeFileSync(path.join(repo, "www/package-lock.json"), JSON.stringify({
        name: "legendhub",
        version: "2.6.0-beta",
        packages: {"": {name: "legendhub", version: "2.6.0-beta"}}
    }));
    git(repo, "init");
    git(repo, "config", "user.name", "LegendHUB Test");
    git(repo, "config", "user.email", "legendhub-test@example.invalid");
    git(repo, "add", ".");
    git(repo, "commit", "-m", "release fixture");
    return repo;
}

function runTagger(repo) {
    return run(repo, "bash", [tagger], {LEGENDHUB_REPO_ROOT: repo});
}

test("creates one annotated beta tag on HEAD", (t) => {
    const repo = createReleaseRepository(t);
    const result = runTagger(repo);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(git(repo, "tag", "--list", "v2.6.0-beta"), "v2.6.0-beta");
    assert.equal(git(repo, "cat-file", "-t", "v2.6.0-beta"), "tag");
    assert.equal(git(repo, "rev-list", "-n", "1", "v2.6.0-beta"), git(repo, "rev-parse", "HEAD"));
});

test("rejects dirty release inputs before creating a tag", (t) => {
    const repo = createReleaseRepository(t);
    fs.appendFileSync(path.join(repo, "CHANGELOG.md"), "\nchanged\n");
    const result = runTagger(repo);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /dirty/i);
    assert.equal(git(repo, "tag", "--list"), "");
});

test("rejects an existing release tag without moving it", (t) => {
    const repo = createReleaseRepository(t);
    assert.equal(runTagger(repo).status, 0);
    const original = git(repo, "rev-parse", "v2.6.0-beta^{}");
    fs.writeFileSync(path.join(repo, "extra.txt"), "next\n");
    git(repo, "add", ".");
    git(repo, "commit", "-m", "next");
    const result = runTagger(repo);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /already exists/i);
    assert.equal(git(repo, "rev-parse", "v2.6.0-beta^{}"), original);
});
