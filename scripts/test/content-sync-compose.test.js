"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const overlay = path.join(root, "docker-compose.content-sync.yaml");
const baseEnvironment = {
    ...process.env,
    CONTENT_SYNC_KNOWN_HOSTS_FILE: "/example/content-sync-known-hosts",
    CONTENT_SYNC_SOURCE: "content-sync@example.invalid",
    CONTENT_SYNC_SSH_PORT: "7822",
    CONTENT_SYNC_SSH_KEY_FILE: "/example/content-sync-key",
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
    RECAPTCHA_SITEKEY: "",
};
const composeScaffold = [
    "services:",
    "    mysql:",
    "        image: mysql:5",
    "        healthcheck:",
    "            test: [\"CMD\", \"true\"]",
    "networks:",
    "    legendhub:",
    "",
].join("\n");

function render(arguments_, environment, input) {
    const result = spawnSync("docker", ["compose", ...arguments_], {
        cwd: root,
        encoding: "utf8",
        env: environment,
        input,
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
}

function composeConfig(extraEnvironment = {}) {
    return render([
        "--project-directory", root,
        "-f", "-",
        "-f", overlay,
        "config",
        "--format", "json",
    ], {...baseEnvironment, ...extraEnvironment}, composeScaffold);
}

function baseComposeConfig() {
    return render([
        "-f", "docker-compose.yaml",
        "config",
        "--format", "json",
    ], baseEnvironment);
}

test("content sync is opt-in, hourly, private, and reuses the backup image", () => {
    const config = composeConfig({COMPOSE_PROFILES: "content-sync"});
    const service = config.services["content-sync"];
    assert.equal(service.image,
        "tmckimmey/legendhub-mysql-backup:abcdef123456");
    assert.deepEqual(service.profiles, ["content-sync"]);
    assert.deepEqual(service.command,
        ["/usr/local/bin/sync-public-content", "--loop"]);
    assert.equal(service.environment.CONTENT_SYNC_INTERVAL_SECONDS, "3600");
    assert.equal(service.environment.CONTENT_SYNC_MAX_AGE_SECONDS, "7200");
    assert.equal(service.environment.CONTENT_SYNC_SSH_PORT, "7822");
    assert.equal(service.healthcheck.start_period, "2h0m0s");
    assert.equal(service.volumes.find((volume) =>
        volume.target === "/run/secrets/content_sync_key").read_only, true);
    assert.equal(service.volumes.find((volume) =>
        volume.target === "/run/secrets/content_sync_known_hosts").read_only,
    true);
    assert.equal(service.user, undefined);
    assert.equal(service.ports, undefined);
    assert.equal(service.volumes.some((volume) =>
        volume.source === "/var/run/docker.sock"), false);
    assert.equal("MYSQL_ROOT_PASSWORD" in service.environment, false);
    assert.equal(service.volumes.some((volume) =>
        volume.source.includes("snapshot")), false);
    assert.deepEqual(Object.keys(config.volumes), ["content-sync-state"]);
    assert.deepEqual(Object.keys(baseComposeConfig().services).sort(),
        ["mysql", "mysql-backup", "python", "www"]);
});

test("content sync requires explicit source and private-file paths", () => {
    for (const variable of [
        "CONTENT_SYNC_SOURCE",
        "CONTENT_SYNC_SSH_PORT",
        "CONTENT_SYNC_SSH_KEY_FILE",
        "CONTENT_SYNC_KNOWN_HOSTS_FILE",
    ]) {
        const result = spawnSync("docker", [
            "compose",
            "--project-directory", root,
            "-f", "-",
            "-f", overlay,
            "config",
            "--format", "json",
        ], {
            cwd: root,
            encoding: "utf8",
            env: {...baseEnvironment, [variable]: ""},
            input: composeScaffold,
        });
        assert.notEqual(result.status, 0, variable);
        assert.match(result.stderr, new RegExp(variable));
    }
});
