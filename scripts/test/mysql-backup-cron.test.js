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
    assert.equal(config.User || "", "");

    const cron = fs.readFileSync(path.join(root, "mysql/cron-mysql"), "utf8");
    assert.match(cron, /^SHELL=\/bin\/bash$/m);
    assert.match(cron,
        /^11 6 \* \* \* root \{ source \/run\/legendhub-backup\.env && exec \/usr\/local\/bin\/backup-mysql; \} >> \/proc\/1\/fd\/1 2>> \/proc\/1\/fd\/2$/m);
    assert.doesNotMatch(cron, /MYSQL_PASSWORD|\$\{MYSQL_/);
});

test("backup image packages the content sync runtime and entry points", () => {
    const checks = [
        "command -v ssh >/dev/null",
        "test -x /usr/local/bin/export-public-content",
        "test -x /usr/local/bin/sync-public-content",
        "test -x /usr/local/bin/content-sync-health",
        "PYTHONPATH=/usr/local/lib python3 -c 'import pymysql, " +
            "content_sync.contract, " +
            "content_sync.source, content_sync.target, content_sync.sync, " +
            "content_sync.health'",
    ].join(" && ");
    const result = docker(["run", "--rm", ...environmentArguments(),
        image, "bash", "-c", checks]);
    assert.equal(result.status, 0, result.stderr);
});

test("cron sends environment source failures to container stderr", () => {
    const command = [
        "cron_command=\"$(cut -d ' ' -f 7- /etc/cron.d/cron-mysql)\"",
        "rm -f /run/legendhub-backup.env",
        "set +e",
        "bash -c \"$cron_command\" >/tmp/cron.stdout 2>/tmp/cron.stderr",
        "status=$?",
        "set -e",
        "test \"$status\" -ne 0",
        "exit \"$status\"",
    ].join("; ");
    const result = docker(["run", "--rm", ...environmentArguments(),
        image, "bash", "-c", command]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr,
        /\/run\/legendhub-backup\.env: No such file or directory/);
    assert.doesNotMatch(result.stderr + result.stdout,
        new RegExp(requiredEnvironment.MYSQL_PASSWORD.replace(
            /[.*+?^${}()|[\]\\]/g, "\\$&")));
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

function runBackupFailureAtInvocation(failingInvocation) {
    const fakeDumpBody = [
        "count=0",
        "test ! -f /tmp/mysqldump-count || read -r count < /tmp/mysqldump-count",
        "count=$((count + 1))",
        "printf '%s\\n' \"$count\" > /tmp/mysqldump-count",
        "printf 'partial dump invocation %s\\n' \"$count\"",
        `test "$count" -ne ${failingInvocation} || exit 17`,
    ].join("; ");
    const command = [
        "fake_bin=$(mktemp -d)",
        "trap 'rm -rf -- \"$fake_bin\"' EXIT",
        "printf '%s\\n' '#!/bin/sh' " +
            `'${fakeDumpBody.replaceAll("'", "'\\''")}' > "$fake_bin/mysqldump"`,
        "chmod +x \"$fake_bin/mysqldump\"",
        "private_backup=\"/backups/private/database_$(date +%m-%d-%Y).sql.gz\"",
        "public_backup=/backups/public/database.sql",
        "printf 'original private artifact\\n' | gzip > \"$private_backup\"",
        "printf 'original public artifact\\n' > \"$public_backup\"",
        "cp -- \"$private_backup\" /tmp/expected-private",
        "cp -- \"$public_backup\" /tmp/expected-public",
        "set +e",
        "PATH=\"$fake_bin:$PATH\" /usr/local/bin/backup-mysql",
        "status=$?",
        "set -e",
        "test \"$status\" -ne 0",
        "cmp -- /tmp/expected-private \"$private_backup\"",
        "cmp -- /tmp/expected-public \"$public_backup\"",
        "test \"$(find /backups/private -type f | wc -l)\" -eq 1",
        "test \"$(find /backups/public -type f | wc -l)\" -eq 1",
        "printf 'backup-status=%s\\n' \"$status\"",
    ].join("; ");
    return docker(["run", "--rm", ...environmentArguments(),
        image, "bash", "-c", command]);
}

function runPromotionFailureAtInvocation(failingInvocation, rollbackAlsoFails = false) {
    const failedMoves = rollbackAlsoFails ? `${failingInvocation}|3` : failingInvocation;
    const fakeMoveBody = [
        "count=0",
        "test ! -f /tmp/move-count || read -r count < /tmp/move-count",
        "count=$((count + 1))",
        "printf '%s\\n' \"$count\" > /tmp/move-count",
        `case "$count" in ${failedMoves}) exit 18 ;; esac`,
        "exec /usr/bin/mv \"$@\"",
    ].join("; ");
    const verification = rollbackAlsoFails ? [
        "cmp -- /tmp/expected-public \"$public_backup\"",
        "rollback_file=$(find /backups/private -type f -name '*.rollback')",
        "test -n \"$rollback_file\"",
        "cmp -- /tmp/expected-private \"$rollback_file\"",
        "test \"$(find /backups/private -type f | wc -l)\" -eq 2",
        "test \"$(find /backups/public -type f | wc -l)\" -eq 1",
    ] : [
        "cmp -- /tmp/expected-private \"$private_backup\"",
        "cmp -- /tmp/expected-public \"$public_backup\"",
        "test \"$(find /backups/private -type f | wc -l)\" -eq 1",
        "test \"$(find /backups/public -type f | wc -l)\" -eq 1",
    ];
    const command = [
        "fake_bin=$(mktemp -d)",
        "trap 'rm -rf -- \"$fake_bin\"' EXIT",
        "printf '%s\\n' '#!/bin/sh' \"printf 'new backup data\\\\n'\" " +
            "> \"$fake_bin/mysqldump\"",
        "printf '%s\\n' '#!/bin/sh' " +
            `'${fakeMoveBody.replaceAll("'", "'\\''")}' > "$fake_bin/mv"`,
        "chmod +x \"$fake_bin/mysqldump\" \"$fake_bin/mv\"",
        "private_backup=\"/backups/private/database_$(date +%m-%d-%Y).sql.gz\"",
        "public_backup=/backups/public/database.sql",
        "printf 'original private artifact\\n' | gzip > \"$private_backup\"",
        "printf 'original public artifact\\n' > \"$public_backup\"",
        "cp -- \"$private_backup\" /tmp/expected-private",
        "cp -- \"$public_backup\" /tmp/expected-public",
        "set +e",
        "PATH=\"$fake_bin:$PATH\" /usr/local/bin/backup-mysql",
        "status=$?",
        "set -e",
        "test \"$status\" -ne 0",
        ...verification,
        "printf 'backup-status=%s\\n' \"$status\"",
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

test("backup command stages every dump in a mode 0600 file", () => {
    const result = runBackup(
        "test \"$(stat -Lc %a /proc/$$/fd/1)\" = 600; " +
        "printf 'CREATE TABLE backup_test (id int);\\n'");
    assert.equal(result.status, 0, result.stderr);
});

test("backup command does not report success after a dump failure", () => {
    const result = runBackup("exit 17");
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /backup-mysql: success/);
});

for (const [invocation, stage] of [
    [1, "private dump"],
    [2, "public schema dump"],
    [3, "public data dump"],
]) {
    test(`${stage} failure preserves final artifacts and removes temporary files`,
        () => {
            const result = runBackupFailureAtInvocation(invocation);
            assert.equal(result.status, 0, result.stderr);
            assert.match(result.stdout, /backup-status=17/);
            assert.doesNotMatch(result.stdout, /backup-mysql: success/);
        });
}

for (const [invocation, artifact] of [
    [1, "private"],
    [2, "public"],
]) {
    test(`${artifact} promotion failure rolls back final artifacts and cleans up`,
        () => {
            const result = runPromotionFailureAtInvocation(invocation);
            assert.equal(result.status, 0, result.stderr);
            assert.match(result.stdout, /backup-status=18/);
            assert.doesNotMatch(result.stdout, /backup-mysql: success/);
        });
}

test("a rollback failure preserves the original artifact for recovery", () => {
    const result = runPromotionFailureAtInvocation(2, true);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr,
        /failed to roll back private backup; preserved rollback at \/backups\/private\//);
    assert.doesNotMatch(result.stderr + result.stdout,
        new RegExp(requiredEnvironment.MYSQL_PASSWORD.replace(
            /[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("a second temporary-file creation failure cleans up the first stage", () => {
    const fakeMktempBody = [
        "count=0",
        "test ! -f /tmp/mktemp-count || read -r count < /tmp/mktemp-count",
        "count=$((count + 1))",
        "printf '%s\\n' \"$count\" > /tmp/mktemp-count",
        "test \"$count\" -ne 2 || exit 19",
        "exec /usr/bin/mktemp \"$@\"",
    ].join("; ");
    const command = [
        "fake_bin=$(mktemp -d)",
        "trap 'rm -rf -- \"$fake_bin\"' EXIT",
        "printf '%s\\n' '#!/bin/sh' " +
            `'${fakeMktempBody.replaceAll("'", "'\\''")}' > "$fake_bin/mktemp"`,
        "chmod +x \"$fake_bin/mktemp\"",
        "set +e",
        "PATH=\"$fake_bin:$PATH\" /usr/local/bin/backup-mysql",
        "status=$?",
        "set -e",
        "test \"$status\" -eq 19",
        "test \"$(find /backups/private /backups/public -type f | wc -l)\" -eq 0",
    ].join("; ");
    const result = docker(["run", "--rm", ...environmentArguments(),
        image, "bash", "-c", command]);
    assert.equal(result.status, 0, result.stderr);
});

function runBackupWithFakeStat(fakeStatBody) {
    const command = [
        "fake_bin=$(mktemp -d)",
        "trap 'rm -rf -- \"$fake_bin\"' EXIT",
        "printf '%s\\n' '#!/bin/sh' \"printf 'backup data\\\\n'\" " +
            "> \"$fake_bin/mysqldump\"",
        "printf '%s\\n' '#!/bin/sh' " +
            `'${fakeStatBody}' > "$fake_bin/stat"`,
        "chmod +x \"$fake_bin/mysqldump\" \"$fake_bin/stat\"",
        "PATH=\"$fake_bin:$PATH\" /usr/local/bin/backup-mysql",
    ].join("; ");
    return docker(["run", "--rm", ...environmentArguments(),
        image, "bash", "-c", command]);
}

for (const [condition, fakeStatBody] of [
    ["cannot be read", "exit 23"],
    ["is zero", "printf '0\\n'"],
    ["is not an integer", "printf 'invalid\\n'"],
]) {
    test(`backup command fails when an artifact size ${condition}`, () => {
        const result = runBackupWithFakeStat(fakeStatBody);
        assert.notEqual(result.status, 0);
        assert.doesNotMatch(result.stdout, /backup-mysql: success/);
    });
}
