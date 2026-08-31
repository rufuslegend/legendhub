"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const baseEnvironment = {
    ...process.env,
    EQUIPMENT_SPOOL_HOST_PATH: "/home/rufus/legendhub-spool",
    EXTERNAL_PORT: "127.0.0.1:7001",
    GITHUB_REPOSITORY: "rufuslegend/legendhub",
    GITHUB_TOKEN: "",
    LEGENDHUB_IMAGE_TAG: "abcdef123456",
    MYSQL_DATABASE: "legendhub",
    MYSQL_PASSWORD: "test-app-password",
    MYSQL_PORT: "3306",
    MYSQL_ROOT_PASSWORD: "test-root-password",
    MYSQL_USER: "legendhub",
    NODE_ENV: "production",
    PORT: "80",
    RECAPTCHA_SECRET: "",
    RECAPTCHA_SITEKEY: ""
};

function render({profile = "", registry = false} = {}) {
    const files = [
        "-f", "docker-compose.yaml",
        "-f", "docker-compose.equipment-importer.yaml"
    ];
    if (registry)
        files.push("-f", "docker-compose.registry.yaml");
    const result = spawnSync("docker", ["compose", ...files, "config", "--format", "json"], {
        cwd: root,
        env: {...baseEnvironment, COMPOSE_PROFILES: profile},
        encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
}

test("equipment importer is opt-in and does not enable the downstream content sync", () => {
    const disabled = render();
    assert.equal("equipment-importer" in disabled.services, false);
    assert.equal("content-sync" in disabled.services, false);

    const enabled = render({profile: "equipment-importer"});
    const service = enabled.services["equipment-importer"];
    assert.deepEqual(service.profiles, ["equipment-importer"]);
    assert.deepEqual(service.entrypoint, ["node", "src/equipment-importer.js"]);
    assert.equal(service.environment.EQUIPMENT_SPOOL_ROOT, "/var/spool/legendhub");
    assert.equal(service.environment.EQUIPMENT_IMPORT_POLL_MS, "5000");
    assert.equal(service.ports, undefined);
    assert.deepEqual(service.networks, {legendhub: null});
    assert.equal("MYSQL_ROOT_PASSWORD" in service.environment, false);
    assert.deepEqual(service.volumes, [{
        type: "bind",
        source: "/home/rufus/legendhub-spool",
        target: "/var/spool/legendhub"
    }]);
    assert.equal("content-sync" in enabled.services, false);
});

test("registry deployment reuses the immutable web image without a build or source mount", () => {
    const service = render({profile: "equipment-importer", registry: true})
        .services["equipment-importer"];
    assert.equal(service.image, "tmckimmey/legendhub-www:abcdef123456");
    assert.equal("build" in service, false);
    assert.equal(service.volumes.some(volume => volume.target === "/app/src"), false);
});

test("equipment importer requires an explicit host spool path", () => {
    const result = spawnSync("docker", [
        "compose",
        "-f", "docker-compose.yaml",
        "-f", "docker-compose.equipment-importer.yaml",
        "config", "--format", "json"
    ], {
        cwd: root,
        env: {...baseEnvironment, EQUIPMENT_SPOOL_HOST_PATH: ""},
        encoding: "utf8"
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /EQUIPMENT_SPOOL_HOST_PATH/);
});
