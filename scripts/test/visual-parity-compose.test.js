"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const overlay = path.join(root, "docker-compose.parity.yaml");
const darwinOverlay = path.join(root, "docker-compose.parity-darwin.yaml");
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

function extractTaggedCheckout(tag, destination) {
    const archive = spawnSync("git", ["archive", "--format=tar", tag], {
        cwd: root,
        encoding: null,
        maxBuffer: 64 * 1024 * 1024,
    });
    assert.equal(archive.status, 0, archive.stderr.toString());
    const extraction = spawnSync("tar", ["-x", "-C", destination], {
        encoding: "utf8",
        input: archive.stdout,
    });
    assert.equal(extraction.status, 0, extraction.stderr);
}

function commandFixture({base, extraOverlays = [], projectDirectory, projectName}) {
    return [
        "compose",
        "--project-directory", projectDirectory,
        "--project-name", projectName,
        "-f", base,
        "-f", overlay,
        ...extraOverlays.flatMap((extraOverlay) => ["-f", extraOverlay]),
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

function assertParityContract(config, expectedPort, checkoutRoot,
    expectedHostIps = ["127.0.0.1"]) {
    assert.equal(config.services.mysql.image, "mysql:5.7.44");
    assert.equal(config.services.www.ports, undefined);
    assert.equal(config.services.www.volumes, undefined);
    assert.deepEqual(config.services.nginx.ports.map((port) => ({
        hostIp: port.host_ip,
        published: port.published,
        target: port.target,
    })), expectedHostIps.map((hostIp) => ({
        hostIp,
        published: expectedPort,
        target: 443,
    })));
    assert.equal(config.services.www.build.context, checkoutRoot);
    assert.equal(fs.existsSync(path.join(config.services.www.build.context,
        "www/Dockerfile")), true);

    const mysqlConfigMount = config.services.mysql.volumes.find((volume) =>
        volume.target === "/etc/mysql/mysql.conf.d");
    const snapshotMount = config.services.mysql.volumes.find((volume) =>
        volume.target.endsWith("01-dunwich.sql.gz"));
    const fixtureMount = config.services.mysql.volumes.find((volume) =>
        volume.target.endsWith("02-visual-parity.sql"));
    assert.equal(mysqlConfigMount.source, path.join(checkoutRoot, "mysql/conf"));
    assert.equal(mysqlConfigMount.read_only, true);
    assert.equal(fs.existsSync(mysqlConfigMount.source) &&
        fs.statSync(mysqlConfigMount.source).isDirectory(), true);
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
    extractTaggedCheckout("v2.9.0", referenceRoot);
    const referenceBase = path.join(referenceRoot, "docker-compose.yaml");

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

    assertParityContract(reference, "7443", referenceRoot);
    assertParityContract(candidate, "7444", root);
    assert.equal(reference.name, "legendhub-parity-reference");
    assert.equal(candidate.name, "legendhub-parity-candidate");
    assert.notEqual(reference.services.nginx.ports[0].published,
        candidate.services.nginx.ports[0].published);
    assert.notDeepEqual(namedResources(reference, "networks"),
        namedResources(candidate, "networks"));
    assert.notDeepEqual(namedResources(reference, "volumes"),
        namedResources(candidate, "volumes"));
});

test("Darwin parity overlay adds IPv6 without removing IPv4 isolation", (t) => {
    const referenceRoot = fs.mkdtempSync(path.join(root,
        ".visual-parity-compose-test-"));
    t.after(() => fs.rmSync(referenceRoot, {recursive: true, force: true}));
    extractTaggedCheckout("v2.9.0", referenceRoot);

    for (const fixture of [
        {
            base: path.join(referenceRoot, "docker-compose.yaml"),
            checkoutRoot: referenceRoot,
            port: "7443",
            projectName: "legendhub-parity-reference",
        },
        {
            base: path.join(root, "docker-compose.yaml"),
            checkoutRoot: root,
            port: "7444",
            projectName: "legendhub-parity-candidate",
        },
    ]) {
        const config = renderCompose(commandFixture({
            base: fixture.base,
            extraOverlays: [darwinOverlay],
            projectDirectory: fixture.checkoutRoot,
            projectName: fixture.projectName,
        }), fixture.port);
        assertParityContract(config, fixture.port, fixture.checkoutRoot,
            ["127.0.0.1", "::1"]);
    }
});
