"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const test = require("node:test");

const verifier = path.resolve(__dirname, "../verify-image-platform.js");
const digest = `sha256:${"a".repeat(64)}`;

function verify(document) {
    return spawnSync(process.execPath, [verifier], {
        input: JSON.stringify(document),
        encoding: "utf8",
    });
}

test("accepts one linux/amd64 image plus a BuildKit attestation", () => {
    const result = verify({
        name: "docker.io/tmckimmey/legendhub-www:abcdef123456",
        manifest: {
            schemaVersion: 2,
            mediaType: "application/vnd.oci.image.index.v1+json",
            digest,
            size: 1801,
            manifests: [
                {
                    mediaType: "application/vnd.oci.image.manifest.v1+json",
                    digest: `sha256:${"b".repeat(64)}`,
                    size: 1234,
                    platform: {os: "linux", architecture: "amd64"},
                },
                {
                    mediaType: "application/vnd.oci.image.manifest.v1+json",
                    digest: `sha256:${"c".repeat(64)}`,
                    size: 567,
                    annotations: {
                        "vnd.docker.reference.digest": `sha256:${"b".repeat(64)}`,
                        "vnd.docker.reference.type": "attestation-manifest",
                    },
                    platform: {os: "unknown", architecture: "unknown"},
                },
            ],
        },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), digest);
});

test("rejects an unannotated unknown platform descriptor", () => {
    const result = verify({
        name: "docker.io/tmckimmey/legendhub-www:abcdef123456",
        manifest: {
            schemaVersion: 2,
            mediaType: "application/vnd.oci.image.index.v1+json",
            digest,
            size: 1801,
            manifests: [
                {
                    mediaType: "application/vnd.oci.image.manifest.v1+json",
                    digest: `sha256:${"b".repeat(64)}`,
                    size: 1234,
                    platform: {os: "linux", architecture: "amd64"},
                },
                {
                    mediaType: "application/vnd.oci.image.manifest.v1+json",
                    digest: `sha256:${"c".repeat(64)}`,
                    size: 567,
                    platform: {os: "unknown", architecture: "unknown"},
                },
            ],
        },
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unknown\/unknown/);
});

test("rejects an additional runnable platform", () => {
    const result = verify({
        manifest: {
            digest,
            manifests: [
                {platform: {os: "linux", architecture: "amd64"}},
                {platform: {os: "linux", architecture: "arm64"}},
            ],
        },
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /linux\/arm64/);
});

test("accepts a single linux/amd64 image manifest", () => {
    const result = verify({
        manifest: {digest},
        image: {os: "linux", architecture: "amd64"},
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), digest);
});

test("rejects malformed inspection output", () => {
    const result = verify({manifest: {}});

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /digest|platform/i);
});
