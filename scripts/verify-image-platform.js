#!/usr/bin/env node
"use strict";

const fs = require("node:fs");

function fail(message) {
    process.stderr.write(`${message}\n`);
    process.exit(1);
}

let inspection;
try {
    inspection = JSON.parse(fs.readFileSync(0, "utf8"));
} catch (error) {
    fail(`Invalid image inspection JSON: ${error.message}`);
}

const manifest = inspection.manifest;
const digest = manifest && manifest.digest;
if (!/^sha256:[a-f0-9]{64}$/.test(digest || "")) {
    fail("Image inspection did not contain a sha256 manifest digest");
}

let runnablePlatforms;
if (Array.isArray(manifest.manifests)) {
    runnablePlatforms = manifest.manifests
        .map((descriptor) => descriptor.platform || {})
        .filter((platform) =>
            platform.os !== "unknown" || platform.architecture !== "unknown");
} else {
    runnablePlatforms = [inspection.image || {}];
}

const names = runnablePlatforms.map(
    (platform) => `${platform.os || "missing"}/${platform.architecture || "missing"}`);
if (names.length !== 1 || names[0] !== "linux/amd64") {
    fail(`Expected only linux/amd64; found ${names.join(", ") || "no runnable platform"}`);
}

process.stdout.write(`${digest}\n`);
