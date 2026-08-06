#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const semanticVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function readFile(file) {
    try {
        return fs.readFileSync(file, "utf8");
    }
    catch (error) {
        throw new Error(`Unable to read ${file}: ${error.message}`, {cause: error});
    }
}

function readJson(file) {
    try {
        return JSON.parse(readFile(file));
    }
    catch (error) {
        throw new Error(`Unable to parse ${file}: ${error.message}`, {cause: error});
    }
}

function verifyReleaseVersion(repoRoot) {
    const changelog = readFile(path.join(repoRoot, "CHANGELOG.md"));
    const packageJson = readJson(path.join(repoRoot, "www/package.json"));
    const packageLock = readJson(path.join(repoRoot, "www/package-lock.json"));
    const readme = readFile(path.join(repoRoot, "README.md"));
    const headings = [...changelog.matchAll(/^## \[([^\]]+)\](?: - \d{4}-\d{2}-\d{2})?$/gm)];
    const changelogMatch = headings[0]?.[1] === "Unreleased" ? headings[1] : headings[0];

    if (!changelogMatch || !semanticVersion.test(changelogMatch[1] || ""))
        throw new Error("CHANGELOG.md does not begin with a valid semantic version heading");

    const version = changelogMatch[1];
    const observed = [
        ["www/package.json", packageJson.version],
        ["www/package-lock.json", packageLock.version],
        ["www/package-lock.json root package", packageLock.packages?.[""]?.version],
        ["README.md", readme.match(/\[!\[Version v=([^\]]+)\]/)?.[1]],
    ];
    for (const [source, value] of observed) {
        if (value !== version)
            throw new Error(`${source} version ${String(value)} does not match ${version}`);
    }

    const badgeVersion = version.replaceAll("-", "--");
    if (!readme.includes(`/badge/version-v=${badgeVersion}-brightgreen.svg`))
        throw new Error(`README.md badge URL does not encode ${version}`);

    return version;
}

if (require.main === module) {
    const repoRoot = path.resolve(process.argv[2] || path.join(__dirname, ".."));
    process.stdout.write(`${verifyReleaseVersion(repoRoot)}\n`);
}

exports.verifyReleaseVersion = verifyReleaseVersion;
