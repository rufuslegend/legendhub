"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const localState = "/example/legendhub-local-stack";
const environment = {
    ...process.env,
    EXTERNAL_PORT: "127.0.0.1:7002",
    GITHUB_REPOSITORY: "rufuslegend/legendhub",
    GITHUB_TOKEN: "",
    LEGENDHUB_LOCAL_STATE_DIR: localState,
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

function renderLocalCompose() {
    const result = spawnSync("docker", [
        "compose",
        "--project-name", "legendhub-local",
        "-f", "docker-compose.yaml",
        "-f", "docker-compose.local.yaml",
        "config",
        "--format", "json",
    ], {
        cwd: root,
        encoding: "utf8",
        env: environment,
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
}

test("renders a persistent production-shaped local HTTPS stack", () => {
    const config = renderLocalCompose();
    const services = config.services;

    assert.deepEqual(Object.keys(services).sort(),
        ["mailpit", "mysql", "mysql-backup", "nginx", "python", "www"]);
    assert.equal(services.mailpit.image, "axllent/mailpit:v1.30.5");
    assert.deepEqual(services.mailpit.ports, [{
        mode: "ingress",
        target: 8025,
        published: "8025",
        protocol: "tcp",
        host_ip: "127.0.0.1",
    }]);
    assert.equal(services.mailpit.environment.MP_SMTP_AUTH_ACCEPT_ANY, "1");
    assert.equal(services.mailpit.environment.MP_SMTP_AUTH_ALLOW_INSECURE, "1");
    assert.equal(services.www.environment.SMTP_HOST, "mailpit");
    assert.equal(services.www.environment.SMTP_PORT, "1025");
    assert.equal(services.www.environment.SMTP_SECURE, "false");
    assert.equal(services.www.depends_on.mailpit.condition, "service_healthy");
    assert.equal(services.nginx.image, "nginx:1.27-alpine");
    assert.deepEqual(services.nginx.ports, [{
        mode: "ingress",
        target: 443,
        published: "443",
        protocol: "tcp",
        host_ip: "127.0.0.1",
    }]);
    assert.equal(services.nginx.volumes.find((volume) =>
        volume.target === "/etc/nginx/conf.d/default.conf").read_only, true);
    assert.equal(services.nginx.volumes.find((volume) =>
        volume.target === "/etc/nginx/tls/localhost.pem").source,
    path.join(localState, "tls/localhost.pem"));
    assert.equal(services.nginx.volumes.find((volume) =>
        volume.target === "/etc/nginx/tls/localhost-key.pem").read_only, true);

    assert.equal(services.www.ports, undefined);
    assert.equal(services.www.volumes, undefined);
    assert.equal(services.www.environment.RECAPTCHA_SITEKEY,
        "6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI");
    assert.equal(services.www.environment.RECAPTCHA_SECRET,
        "6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe");
    assert.equal(services.mysql.volumes.find((volume) =>
        volume.target === "/docker-entrypoint-initdb.d/01-dunwich.sql.gz").source,
    path.join(localState, "backups/dunwich-latest.sql.gz"));
    assert.deepEqual(services.mysql.healthcheck.test, [
        "CMD-SHELL",
        "mysqladmin ping --protocol=tcp -h 127.0.0.1 -u root " +
            "-p$${MYSQL_ROOT_PASSWORD} --silent",
    ]);
    assert.equal(JSON.stringify(config).includes("/tmp/"), false);
});

test("prepares private persistent state and renders through the local wrapper", (t) => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(),
        "legendhub-local-compose-test-"));
    t.after(() => fs.rmSync(fixtureRoot, {recursive: true, force: true}));

    const stateDirectory = path.join(fixtureRoot, "state");
    const snapshot = path.join(fixtureRoot, "dunwich.sql.gz");
    const gzip = spawnSync("gzip", ["-c"], {
        encoding: null,
        input: Buffer.from("CREATE DATABASE legendhub;\n"),
    });
    assert.equal(gzip.status, 0, gzip.stderr?.toString());
    fs.writeFileSync(snapshot, gzip.stdout, {mode: 0o600});

    const fakeBin = path.join(fixtureRoot, "bin");
    fs.mkdirSync(fakeBin);
    const fakeMkcert = path.join(fakeBin, "mkcert");
    fs.writeFileSync(fakeMkcert, [
        "#!/bin/sh",
        "while [ \"$#\" -gt 0 ]; do",
        "  case \"$1\" in",
        "    -cert-file) cert_file=$2; shift 2 ;;",
        "    -key-file) key_file=$2; shift 2 ;;",
        "    *) shift ;;",
        "  esac",
        "done",
        "printf 'test certificate\\n' > \"$cert_file\"",
        "printf 'test private key\\n' > \"$key_file\"",
        "",
    ].join("\n"), {mode: 0o700});

    const prepared = spawnSync("bash", [
        path.join(root, "scripts/prepare-local-stack.sh"),
        snapshot,
    ], {
        cwd: "/",
        encoding: "utf8",
        env: {
            ...process.env,
            LEGENDHUB_LOCAL_STATE_DIR: stateDirectory,
            PATH: `${fakeBin}:/opt/homebrew/bin:${process.env.PATH}`,
        },
    });
    assert.equal(prepared.status, 0, prepared.stderr);

    const expectedFiles = [
        "backups/dunwich-latest.sql.gz",
        "local.env",
        "tls/localhost-key.pem",
        "tls/localhost.pem",
    ];
    for (const relativePath of expectedFiles) {
        const file = path.join(stateDirectory, relativePath);
        assert.equal(fs.statSync(file).mode & 0o777, 0o600, relativePath);
    }
    assert.deepEqual(
        fs.readFileSync(path.join(stateDirectory,
            "backups/dunwich-latest.sql.gz")),
        fs.readFileSync(snapshot));

    const localEnvironment = fs.readFileSync(
        path.join(stateDirectory, "local.env"), "utf8");
    for (const name of ["MYSQL_ROOT_PASSWORD", "MYSQL_PASSWORD"]) {
        const value = localEnvironment.match(new RegExp(`^${name}=(.+)$`, "m"))[1];
        assert.equal(value.length >= 32, true, name);
        assert.equal(`${prepared.stdout}${prepared.stderr}`.includes(value), false,
            `${name} leaked`);
    }

    const rendered = spawnSync(path.join(root, "scripts/local-stack.sh"), [
        "config", "--format", "json",
    ], {
        cwd: "/",
        encoding: "utf8",
        env: {
            ...process.env,
            LEGENDHUB_LOCAL_STATE_DIR: stateDirectory,
        },
    });
    assert.equal(rendered.status, 0, rendered.stderr);
    const wrapperConfig = JSON.parse(rendered.stdout);
    assert.equal(wrapperConfig.name, "legendhub-local");
    assert.equal(wrapperConfig.services.nginx.ports[0].host_ip, "127.0.0.1");
});
