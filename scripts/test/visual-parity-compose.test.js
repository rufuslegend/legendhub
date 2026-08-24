"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const overlay = path.join(root, "docker-compose.parity.yaml");
const snapshot = path.join(root,
    "data/local-stack/backups/dunwich-latest.sql.gz");
const fixture = path.join(root, "scripts/fixtures/visual-parity.sql");
const nginxConfig = path.join(root, "nginx/parity.conf");
const stateDirectory = path.join(root, "data/local-stack");
const baseEnvironment = {
    ...process.env,
    EXTERNAL_PORT: "127.0.0.1:7002",
    GITHUB_REPOSITORY: "rufuslegend/legendhub",
    GITHUB_TOKEN: "",
    LEGENDHUB_PARITY_FIXTURE: fixture,
    LEGENDHUB_PARITY_NGINX_CONFIG: nginxConfig,
    LEGENDHUB_PARITY_STATE_DIR: stateDirectory,
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

function taggedComposeAt(tag, destination) {
    const result = spawnSync("git", ["show", `${tag}:docker-compose.yaml`], {
        cwd: root,
        encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    fs.writeFileSync(destination, result.stdout);
}

function commandFixture({base, projectDirectory, projectName}) {
    return [
        "compose",
        "--project-directory", projectDirectory,
        "--project-name", projectName,
        "-f", base,
        "-f", overlay,
        "config",
        "--format", "json",
    ];
}

function renderCompose(command, port) {
    assert.equal(command.some((argument) =>
        argument.includes("docker-compose-prod.yaml")), false);
    const result = spawnSync("docker", command, {
        cwd: root,
        encoding: "utf8",
        env: {
            ...baseEnvironment,
            LEGENDHUB_PARITY_HTTPS_PORT: port,
        },
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
}

function namedResources(config, resourceType) {
    return Object.values(config[resourceType]).map((resource) => resource.name)
        .sort();
}

function assertParityContract(config, expectedPort) {
    assert.equal(config.services.mysql.image, "mysql:5.7.44");
    assert.equal(config.services.www.ports, undefined);
    assert.equal(config.services.www.volumes, undefined);
    assert.equal(config.services.nginx.ports[0].published, expectedPort);

    const snapshotMount = config.services.mysql.volumes.find((volume) =>
        volume.target.endsWith("01-dunwich.sql.gz"));
    const fixtureMount = config.services.mysql.volumes.find((volume) =>
        volume.target.endsWith("02-visual-parity.sql"));
    assert.equal(snapshotMount.source, snapshot);
    assert.equal(snapshotMount.read_only, true);
    assert.equal(fixtureMount.source, fixture);
    assert.equal(fixtureMount.read_only, true);
    assert.equal(path.isAbsolute(snapshotMount.source), true);
    assert.equal(path.isAbsolute(fixtureMount.source), true);

    assert.equal(config.services.nginx.volumes.every((volume) =>
        volume.read_only), true);
    assert.equal(config.services.www.environment.RECAPTCHA_SITEKEY,
        "6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI");
    assert.equal(JSON.stringify(config).includes("/tmp/"), false);
}

test("renders isolated current and v2.9 parity stacks from shared fixtures", (t) => {
    const referenceRoot = fs.mkdtempSync(path.join(root,
        ".visual-parity-compose-test-"));
    t.after(() => fs.rmSync(referenceRoot, {recursive: true, force: true}));
    const referenceBase = path.join(referenceRoot, "docker-compose.yaml");
    taggedComposeAt("v2.9.0", referenceBase);

    const referenceCommand = commandFixture({
        base: referenceBase,
        projectDirectory: referenceRoot,
        projectName: "legendhub-parity-reference",
    });
    const candidateCommand = commandFixture({
        base: path.join(root, "docker-compose.yaml"),
        projectDirectory: root,
        projectName: "legendhub-parity-candidate",
    });
    const reference = renderCompose(referenceCommand, "7443");
    const candidate = renderCompose(candidateCommand, "7444");

    assertParityContract(reference, "7443");
    assertParityContract(candidate, "7444");
    assert.equal(reference.name, "legendhub-parity-reference");
    assert.equal(candidate.name, "legendhub-parity-candidate");
    assert.notEqual(reference.services.nginx.ports[0].published,
        candidate.services.nginx.ports[0].published);
    assert.notDeepEqual(namedResources(reference, "networks"),
        namedResources(candidate, "networks"));
    assert.notDeepEqual(namedResources(reference, "volumes"),
        namedResources(candidate, "volumes"));
});
