"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {verifyReleaseVersion} = require("../verify-release-version");

function createFixture(overrides = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "legendhub-version-"));
    fs.mkdirSync(path.join(root, "www"));
    const version = overrides.version || "2.6.0-beta";
    const packageVersion = overrides.packageVersion || version;
    const lockVersion = overrides.lockVersion || version;
    const readmeVersion = overrides.readmeVersion || version;

    if (!overrides.omitChangelog) {
        fs.writeFileSync(path.join(root, "CHANGELOG.md"),
            `# Changelog\n\n${overrides.unreleased ? "## [Unreleased]\n\n- Pending change.\n\n" : ""}## [${version}] - 2026-08-05\n\n### Fixed\n\n- Safer startup.\n`);
    }
    fs.writeFileSync(path.join(root, "www/package.json"), JSON.stringify({
        name: "legendhub",
        version: packageVersion
    }));
    fs.writeFileSync(path.join(root, "www/package-lock.json"), JSON.stringify({
        name: "legendhub",
        version: lockVersion,
        packages: {"": {name: "legendhub", version: lockVersion}}
    }));
    const badgeVersion = readmeVersion.replaceAll("-", "--");
    fs.writeFileSync(path.join(root, "README.md"),
        `[![Version v=${readmeVersion}](https://img.shields.io/badge/version-v=${badgeVersion}-brightgreen.svg)]\n`);
    return root;
}

test("accepts one consistent semantic prerelease version", (t) => {
    const root = createFixture();
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    assert.equal(verifyReleaseVersion(root), "2.6.0-beta");
});

test("accepts an Unreleased section above the current version", (t) => {
    const root = createFixture({unreleased: true});
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    assert.equal(verifyReleaseVersion(root), "2.6.0-beta");
});

test("rejects missing changelog metadata", (t) => {
    const root = createFixture({omitChangelog: true});
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    assert.throws(() => verifyReleaseVersion(root), /CHANGELOG\.md/);
});

test("rejects malformed semantic versions", (t) => {
    for (const version of ["2.6-beta", "2.6.0-01"]) {
        const root = createFixture({version});
        t.after(() => fs.rmSync(root, {recursive: true, force: true}));
        assert.throws(() => verifyReleaseVersion(root), /semantic version/i);
    }
});

test("rejects package and lockfile disagreement", (t) => {
    const root = createFixture({lockVersion: "2.5.0"});
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    assert.throws(() => verifyReleaseVersion(root), /package-lock\.json.*2\.5\.0/i);
});

test("rejects README badge disagreement", (t) => {
    const root = createFixture({readmeVersion: "2.5.0"});
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    assert.throws(() => verifyReleaseVersion(root), /README\.md.*2\.5\.0/i);
});
