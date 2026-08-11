"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const {after, before, test} = require("node:test");

const root = path.resolve(__dirname, "../..");
const image = `legendhub-mysql-backup-cron-test:${process.pid}`;
const requiredEnvironment = {
    MYSQL_DATABASE: "legendhub",
    MYSQL_PASSWORD: "space '$dollar%back\\slash",
    MYSQL_PORT: "3306",
    MYSQL_USER: "legendhub",
};

function docker(args) {
    return spawnSync("docker", args, {
        cwd: root,
        encoding: "utf8",
    });
}

function environmentArguments(environment = requiredEnvironment) {
    return Object.entries(environment).flatMap(
        ([name, value]) => ["--env", `${name}=${value}`]);
}

before(() => {
    const result = docker(["build", "--tag", image, "mysql"]);
    assert.equal(result.status, 0, result.stderr);
});

after(() => {
    docker(["image", "rm", "--force", image]);
});

test("backup image wires the entrypoint to foreground cron", () => {
    const result = docker(["image", "inspect", "--format", "{{json .Config}}", image]);
    assert.equal(result.status, 0, result.stderr);
    const config = JSON.parse(result.stdout);
    assert.deepEqual(config.Entrypoint, ["/usr/local/bin/backup-entrypoint"]);
    assert.deepEqual(config.Cmd, ["cron", "-f", "-L", "15"]);

    const cron = fs.readFileSync(path.join(root, "mysql/cron-mysql"), "utf8");
    assert.match(cron, /^SHELL=\/bin\/bash$/m);
    assert.match(cron,
        /^11 6 \* \* \* root source \/run\/legendhub-backup\.env && exec \/usr\/local\/bin\/backup-mysql >> \/proc\/1\/fd\/1 2>> \/proc\/1\/fd\/2$/m);
    assert.doesNotMatch(cron, /MYSQL_PASSWORD|\$\{MYSQL_/);
});

for (const variable of Object.keys(requiredEnvironment)) {
    for (const state of ["missing", "empty"]) {
        test(`entrypoint fails closed when ${variable} is ${state}`, () => {
            const environment = {...requiredEnvironment};
            if (state === "missing")
                delete environment[variable];
            else
                environment[variable] = "";
            const result = docker(["run", "--rm", ...environmentArguments(environment),
                image, "true"]);
            assert.notEqual(result.status, 0);
            assert.match(result.stderr,
                new RegExp(`required variable ${variable} is missing`));
            assert.doesNotMatch(result.stderr + result.stdout,
                new RegExp(requiredEnvironment.MYSQL_PASSWORD.replace(
                    /[.*+?^${}()|[\]\\]/g, "\\$&")));
        });
    }
}

test("entrypoint writes a private sourceable environment without logging it", () => {
    const result = docker(["run", "--rm", ...environmentArguments(),
        "--env", `EXPECTED_PASSWORD=${requiredEnvironment.MYSQL_PASSWORD}`,
        image, "bash", "-c",
        "test \"$(stat -c %a /run/legendhub-backup.env)\" = 600; " +
        "unset MYSQL_PASSWORD; source /run/legendhub-backup.env; " +
        "test \"$MYSQL_PASSWORD\" = \"$EXPECTED_PASSWORD\""]);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr + result.stdout,
        new RegExp(requiredEnvironment.MYSQL_PASSWORD.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("entrypoint rejects an absent command", () => {
    const result = docker(["run", "--rm", ...environmentArguments(),
        "--entrypoint", "bash", image, "-c", "/usr/local/bin/backup-entrypoint"]);
    assert.equal(result.status, 64);
    assert.match(result.stderr, /command is required/);
});

function runBackup(fakeDumpBody) {
    const command = [
        "fake_bin=$(mktemp -d)",
        "trap 'rm -rf -- \"$fake_bin\"' EXIT",
        "printf '%s\\n' '#!/bin/sh' " +
            `'${fakeDumpBody.replaceAll("'", "'\\''")}' > \"$fake_bin/mysqldump\"`,
        "chmod +x \"$fake_bin/mysqldump\"",
        "PATH=\"$fake_bin:$PATH\" /usr/local/bin/backup-mysql",
    ].join("; ");
    return docker(["run", "--rm", ...environmentArguments(),
        image, "bash", "-c", command]);
}

test("backup command reports two nonempty artifacts without leaking secrets", () => {
    const result = runBackup("printf 'CREATE TABLE backup_test (id int);\\n'");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout,
        /backup-mysql: success timestamp=\S+ private=\/backups\/private\/database_\d{2}-\d{2}-\d{4}\.sql\.gz private-bytes=[1-9]\d* public=\/backups\/public\/database\.sql public-bytes=[1-9]\d*/);
    assert.doesNotMatch(result.stdout + result.stderr,
        new RegExp(requiredEnvironment.MYSQL_PASSWORD.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("backup command does not report success after a dump failure", () => {
    const result = runBackup("exit 17");
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /backup-mysql: success/);
});
