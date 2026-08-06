"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const baseEnvironment = {
    ...process.env,
    EXTERNAL_PORT: "127.0.0.1:7001",
    GITHUB_REPOSITORY: "rufuslegend/legendhub",
    GITHUB_TOKEN: "",
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

function renderBase() {
    return spawnSync("docker", [
        "compose",
        "-f", "docker-compose.yaml",
        "config",
        "--format", "json",
    ], {
        cwd: root,
        env: baseEnvironment,
        encoding: "utf8",
    });
}

function render(extraEnvironment = {}) {
    return spawnSync("docker", [
        "compose",
        "-f", "docker-compose.yaml",
        "-f", "docker-compose.registry.yaml",
        "config",
        "--format", "json",
    ], {
        cwd: root,
        env: {...baseEnvironment, ...extraEnvironment},
        encoding: "utf8",
    });
}

test("builds the web image from the repository root with its explicit Dockerfile", () => {
    const result = renderBase();
    assert.equal(result.status, 0, result.stderr);
    const build = JSON.parse(result.stdout).services.www.build;
    assert.equal(path.resolve(build.context), root);
    assert.equal(path.resolve(root, build.dockerfile), path.join(root, "www/Dockerfile"));
});

test("passes the readable feedback repository slug to the web service", () => {
    const result = renderBase();
    assert.equal(result.status, 0, result.stderr);
    const environment = JSON.parse(result.stdout).services.www.environment;
    assert.equal(environment.GITHUB_REPOSITORY, "rufuslegend/legendhub");
});

test("requires an explicit registry image tag", () => {
    const result = render({LEGENDHUB_IMAGE_TAG: ""});
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /LEGENDHUB_IMAGE_TAG/);
});

test("uses immutable registry images without builds or the web source mount", () => {
    const result = render({LEGENDHUB_IMAGE_TAG: "abcdef123456"});
    assert.equal(result.status, 0, result.stderr);

    const services = JSON.parse(result.stdout).services;
    assert.equal(services.www.image, "tmckimmey/legendhub-www:abcdef123456");
    assert.equal(services.python.image, "tmckimmey/legendhub-python:abcdef123456");
    assert.equal(services["mysql-backup"].image,
        "tmckimmey/legendhub-mysql-backup:abcdef123456");

    for (const name of ["www", "python", "mysql-backup"]) {
        assert.equal("build" in services[name], false);
    }
    assert.equal((services.www.volumes || []).some(
        (volume) => volume.target === "/app/src"), false);
    assert.equal(services.mysql.image, "mysql:5");
    assert.equal(services.mysql.platform, "linux/amd64");
});
