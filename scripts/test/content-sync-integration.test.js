"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const {spawn, spawnSync} = require("node:child_process");
const {after, before, beforeEach, test} = require("node:test");
const mysql = require(path.resolve(__dirname, "../../www/node_modules/mysql"));

const repository = path.resolve(__dirname, "../..");
const publicTables = [
    "Areas", "Categories", "ChangelogVersions",
    "ChangelogVersions_AuditTrail", "Eras", "ItemMobMap",
    "ItemStatCategories", "ItemStatInfo", "Items", "Items_AuditTrail",
    "Mobs", "Mobs_AuditTrail", "Quests", "Quests_AuditTrail",
    "SubCategories", "WikiPages", "WikiPages_AuditTrail",
];
const privateTables = [
    "AuthTokens", "BannedIPs", "Members", "MemberRoleMap",
    "MigrationRuns", "Migrations", "NotificationChanges",
    "NotificationQueue", "NotificationSettings", "Notifications",
    "Permissions", "PersistentLogins", "RolePermissionMap", "Roles",
];
const password = "disposable-content-sync-password";
const containerName = `legendhub-content-sync-${process.pid}-${Date.now()}`;

let workspace;
let port;
let control;
let bridge;
let bridgePort;
let queryLog = [];
let currentManifest;
let currentDump;

function docker(argv, options = {}) {
    return spawnSync("docker", argv, {encoding: "utf8", ...options});
}

function wait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function query(connection, statement, parameters = []) {
    return new Promise((resolve, reject) => {
        connection.query(statement, parameters, (error, result) => {
            if (error) reject(error);
            else resolve(result);
        });
    });
}

function connect(configuration) {
    return new Promise((resolve, reject) => {
        const connection = mysql.createConnection(configuration);
        connection.connect((error) => error ? reject(error) : resolve(connection));
    });
}

function end(connection) {
    if (!connection) return Promise.resolve();
    return new Promise((resolve) => connection.end(resolve));
}

async function waitForMysql() {
    let lastError;
    for (let attempt = 0; attempt < 90; attempt += 1) {
        try {
            control = await connect({
                host: "127.0.0.1", port, user: "root", password,
            });
            return;
        } catch (error) {
            lastError = error;
            await wait(1000);
        }
    }
    throw lastError;
}

async function bridgeRequest(request, socket) {
    const session = request.session;
    try {
        if (request.op === "close") {
            const connection = bridge.sessions.get(session);
            if (connection) {
                bridge.sessions.delete(session);
                await end(connection);
            }
            socket.end(JSON.stringify({ok: true, rows: []}) + "\n");
            return;
        }
        let connection = bridge.sessions.get(session);
        if (!connection) {
            connection = await connect({
                host: "127.0.0.1",
                port,
                user: "root",
                password,
                database: request.database || "target",
            });
            bridge.sessions.set(session, connection);
        }
        queryLog.push({session, sql: request.sql});
        const statement = request.sql.replace(/%s/g, "?");
        const result = await query(connection, statement, request.parameters || []);
        const rows = Array.isArray(result) ? result.map((row) => ({...row})) : [];
        socket.end(JSON.stringify({ok: true, rows}) + "\n");
    } catch (error) {
        socket.end(JSON.stringify({
            ok: false,
            error: `${error.errno || ""} ${error.code || ""} ${error.message}`.trim(),
        }) + "\n");
    }
}

async function startBridge() {
    bridge = net.createServer((socket) => {
        let input = "";
        socket.setEncoding("utf8");
        socket.on("data", (chunk) => {
            input += chunk;
            if (!input.includes("\n")) return;
            const line = input.slice(0, input.indexOf("\n"));
            bridgeRequest(JSON.parse(line), socket);
        });
    });
    bridge.sessions = new Map();
    await new Promise((resolve, reject) => {
        bridge.once("error", reject);
        bridge.listen(0, "127.0.0.1", resolve);
    });
    bridgePort = bridge.address().port;
}

async function stopBridge() {
    if (!bridge) return;
    await Promise.all([...bridge.sessions.values()].map(end));
    bridge.sessions.clear();
    await new Promise((resolve) => bridge.close(resolve));
}

const pythonDriver = String.raw`
import hashlib
import json
import pathlib
import socket
import sys
import uuid

sys.path.insert(0, sys.argv[1])

from content_sync.contract import Manifest, MySqlConfig
from content_sync import source
from content_sync.target import PyMySqlDatabase, TargetConfig, apply_staging, prepare_staging, target_digest

bridge_port = int(sys.argv[2])
mysql_port = int(sys.argv[3])
action = sys.argv[4]
workspace = pathlib.Path(sys.argv[5])


def request(payload):
    payload = dict(payload)
    with socket.create_connection(("127.0.0.1", bridge_port), timeout=30) as connection:
        connection.sendall((json.dumps(payload) + "\n").encode("utf-8"))
        response = b""
        while not response.endswith(b"\n"):
            block = connection.recv(65536)
            if not block:
                break
            response += block
    result = json.loads(response.decode("utf-8"))
    if not result["ok"]:
        raise RuntimeError(result["error"])
    return result["rows"]


class ProxyCursor:
    def __init__(self, connection):
        self.connection = connection
        self.rows = []

    def __enter__(self):
        return self

    def __exit__(self, _type, _value, _traceback):
        return False

    def execute(self, statement, parameters=()):
        self.rows = request({
            "op": "query",
            "session": self.connection.session,
            "database": self.connection.database,
            "sql": statement,
            "parameters": list(parameters),
        })

    def fetchall(self):
        return self.rows


class ProxyConnection:
    def __init__(self, database):
        self.database = database
        self.session = uuid.uuid4().hex

    def cursor(self):
        return ProxyCursor(self)

    def begin(self):
        request({"op": "query", "session": self.session,
                 "database": self.database, "sql": "START TRANSACTION"})

    def commit(self):
        request({"op": "query", "session": self.session,
                 "database": self.database, "sql": "COMMIT"})

    def rollback(self):
        request({"op": "query", "session": self.session,
                 "database": self.database, "sql": "ROLLBACK"})

    def close(self):
        request({"op": "close", "session": self.session})


mysql_config = MySqlConfig("127.0.0.1", mysql_port, "root",
                           "disposable-content-sync-password")
target_config = TargetConfig(mysql_config, "target", "staging")


def target_database():
    return PyMySqlDatabase(target_config, ProxyConnection("target"))


if action == "snapshot":
    dump_path = workspace / "snapshot.sql"
    source.open_database_connection = lambda mysql, database: ProxyConnection(database)
    schema, counts = source.capture_consistent_dump(mysql_config, "source", dump_path)
    print(json.dumps({
        "schema": schema,
        "counts": counts,
        "content": hashlib.sha256(dump_path.read_bytes()).hexdigest(),
        "dump": str(dump_path),
    }, sort_keys=True))
elif action == "lock-probe":
    source.open_database_connection = lambda mysql, database: ProxyConnection(database)
    holder = ProxyConnection("source")
    metadata = None
    locked = False
    try:
        source.lock_tables(holder, "source")
        locked = True
        holder_rejected = False
        holder_error = None
        try:
            source.schema_digest(mysql_config, "source", holder)
        except RuntimeError as error:
            holder_error = str(error)
            holder_rejected = "1100" in str(error) or "not locked" in str(error)
        metadata = ProxyConnection("source")
        schema = source.schema_digest(mysql_config, "source", metadata)
        counts = source.row_counts(mysql_config, "source", metadata)
        probe_dump = workspace / "lock-probe.sql"
        captured_schema, captured_counts = source.capture_consistent_dump(
            mysql_config, "source", probe_dump)
        print(json.dumps({
            "holder_rejected": holder_rejected,
            "holder_error": holder_error,
            "holder_session": holder.session,
            "metadata_session": metadata.session,
            "separate_schema": schema,
            "separate_counts": counts,
            "captured_schema": captured_schema,
            "captured_counts": captured_counts,
        }, sort_keys=True))
    finally:
        if metadata is not None:
            metadata.close()
        if locked:
            source.unlock_tables(holder)
        holder.close()
else:
    manifest = Manifest.parse(pathlib.Path(sys.argv[6]).read_text())
    if action in ("sync", "prepare"):
        prepare_staging(target_config, pathlib.Path(sys.argv[7]), manifest,
                        database=target_database())
    if action in ("sync", "apply"):
        apply_staging(target_config, manifest, database=target_database())
    if action == "digest":
        print(target_digest(target_config, database=target_database()))
`;

function writeWrapper(name) {
    const executable = path.join(workspace, "bin", name);
    fs.writeFileSync(executable, `#!/usr/bin/env bash
set -euo pipefail
filtered=()
for argument in "$@"; do
    case "$argument" in
        --host=*|--port=*) ;;
        *) filtered+=("$argument") ;;
    esac
done
exec docker exec -i --env MYSQL_PWD="$MYSQL_PWD" \
    "$CONTENT_SYNC_MYSQL_CONTAINER" ${name} --host=127.0.0.1 --port=3306 \
    "\${filtered[@]}"
`, {mode: 0o755});
}

function runPython(action, extraArguments = []) {
    return new Promise((resolve, reject) => {
        const child = spawn("python3", [
            path.join(workspace, "driver.py"),
            path.join(repository, "mysql"),
            String(bridgePort),
            String(port),
            action,
            workspace,
            ...extraArguments,
        ], {
            cwd: repository,
            env: {
                ...process.env,
                CONTENT_SYNC_MYSQL_CONTAINER: containerName,
                PATH: `${path.join(workspace, "bin")}:${process.env.PATH}`,
            },
        });
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => { stdout += chunk; });
        child.stderr.on("data", (chunk) => { stderr += chunk; });
        child.on("error", reject);
        child.on("close", (status) => resolve({status, stdout, stderr}));
    });
}

async function sql(statement, parameters = []) {
    return query(control, statement, parameters);
}

async function rows(qualifiedTable) {
    return (await sql(`SELECT Id, Payload FROM ${qualifiedTable} ORDER BY Id`))
        .map((row) => ({Id: row.Id, Payload: row.Payload}));
}

async function scalar(statement, parameters = []) {
    const result = await sql(statement, parameters);
    return Number(Object.values(result[0])[0]);
}

async function resetFixture() {
    await sql("DROP DATABASE IF EXISTS staging");
    await sql("DROP DATABASE IF EXISTS target");
    await sql("DROP DATABASE IF EXISTS source");
    for (const database of ["source", "target", "staging"])
        await sql(`CREATE DATABASE \`${database}\``);
    for (const database of ["source", "target"]) {
        for (const table of publicTables) {
            await sql(`CREATE TABLE \`${database}\`.\`${table}\` (` +
                "Id INT NOT NULL PRIMARY KEY, Payload VARCHAR(255) NULL) ENGINE=InnoDB");
        }
    }
    for (const table of privateTables) {
        await sql(`CREATE TABLE target.\`${table}\` (` +
            "Id INT NOT NULL PRIMARY KEY, Payload VARCHAR(255) NOT NULL) ENGINE=InnoDB");
    }
    await sql("CREATE TRIGGER target.Items_AfterInsert AFTER INSERT ON target.Items " +
        "FOR EACH ROW INSERT INTO target.NotificationQueue (Id, Payload) " +
        "SELECT NEW.Id, NEW.Payload FROM DUAL WHERE @DISABLE_NOTIFICATIONS IS NULL");
    await sql("INSERT INTO source.Areas VALUES (1, 'new area')");
    await sql("INSERT INTO source.Categories VALUES (1, 'new category')");
    await sql("INSERT INTO source.Items VALUES (2263, ?)",
        ["Ruslan's lion shield (ARM)"]);
    await sql("INSERT INTO source.Items_AuditTrail VALUES (2263, ?)",
        ["Ruslan's lion shield changed from -14 to -8 AC"]);
    await sql("INSERT INTO source.ItemMobMap VALUES (1, 'relationship sentinel')");
    for (const table of publicTables) {
        await sql(`INSERT INTO target.\`${table}\` VALUES (7000, ?)`,
            [`${table} old row`]);
    }
    for (const [index, table] of privateTables.entries()) {
        await sql(`INSERT INTO target.\`${table}\` VALUES (?, ?)`,
            [9001 + index, `${table} sentinel`]);
    }
    queryLog = [];
    const snapshot = await runPython("snapshot");
    assert.equal(snapshot.status, 0, snapshot.stderr);
    const details = JSON.parse(snapshot.stdout);
    currentDump = details.dump;
    currentManifest = path.join(workspace, "manifest.json");
    const manifest = {
        version: 1,
        content_sha256: details.content,
        artifact_sha256: "a".repeat(64),
        artifact_bytes: fs.statSync(currentDump).size,
        schema_sha256: details.schema,
        created_at: "2026-08-17T14:00:00Z",
        row_counts: details.counts,
    };
    fs.writeFileSync(currentManifest, JSON.stringify(manifest) + "\n");
}

async function capturePrivateRows() {
    const captured = new Map();
    for (const table of privateTables)
        captured.set(table, await rows(`target.\`${table}\``));
    return captured;
}

async function assertPrivateRows(captured) {
    for (const table of privateTables) {
        assert.deepEqual(await rows(`target.\`${table}\``), captured.get(table),
            `private table ${table} changed`);
    }
}

async function withPrivateGuard(operation) {
    const privateRows = await capturePrivateRows();
    try {
        return await operation();
    } finally {
        await assertPrivateRows(privateRows);
    }
}

async function sync() {
    const result = await runPython("sync", [currentManifest, currentDump]);
    assert.equal(result.status, 0, result.stderr);
}

before(async () => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), "legendhub-content-sync-"));
    fs.mkdirSync(path.join(workspace, "bin"));
    fs.writeFileSync(path.join(workspace, "driver.py"), pythonDriver);
    writeWrapper("mysql");
    writeWrapper("mysqldump");

    const started = docker([
        "run", "--detach", "--rm", "--platform", "linux/amd64",
        "--name", containerName,
        "--env", `MYSQL_ROOT_PASSWORD=${password}`,
        "--publish", "127.0.0.1::3306",
        "mysql:5.7.44",
        "--skip-name-resolve",
    ]);
    assert.equal(started.status, 0, started.stderr);
    const portResult = docker(["port", containerName, "3306/tcp"]);
    assert.equal(portResult.status, 0, portResult.stderr);
    port = Number(portResult.stdout.trim().split(":").at(-1));
    assert.ok(port > 0);
    const platform = docker([
        "inspect", "--format", "{{.Platform}}", containerName,
    ]);
    assert.equal(platform.status, 0, platform.stderr);
    assert.match(platform.stdout, /linux/);
    const architecture = docker([
        "exec", containerName, "uname", "-m",
    ]);
    assert.equal(architecture.status, 0, architecture.stderr);
    assert.match(architecture.stdout, /x86_64/);
    await waitForMysql();
    await startBridge();
});

beforeEach(resetFixture);

after(async () => {
    await end(control);
    await stopBridge();
    const removed = docker(["rm", "--force", containerName]);
    assert.equal(removed.status, 0, removed.stderr);
    const absent = docker(["inspect", containerName]);
    assert.notEqual(absent.status, 0, "temporary MySQL container still exists");
    fs.rmSync(workspace, {recursive: true, force: true});
    process.stderr.write("content-sync integration cleanup: container removed\n");
});

test("MySQL 5.7 permits holder and separate-session metadata under exact locks", async () => {
    await withPrivateGuard(async () => {
        queryLog = [];
        const result = await runPython("lock-probe");
        assert.equal(result.status, 0, result.stderr);
        const proof = JSON.parse(result.stdout);
        assert.equal(proof.holder_rejected, false, JSON.stringify(proof));
        assert.equal(proof.holder_error, null, JSON.stringify(proof));
        assert.notEqual(proof.holder_session, proof.metadata_session);
        assert.equal(proof.separate_schema, proof.captured_schema);
        assert.deepEqual(proof.separate_counts, proof.captured_counts);
        const locks = queryLog.filter((entry) => entry.sql.startsWith("LOCK TABLES"));
        assert.equal(locks.length, 2);
        for (const lock of locks) {
            assert.equal((lock.sql.match(/ READ/g) || []).length, 17);
            for (const table of publicTables)
                assert.match(lock.sql, new RegExp("`source`\\.`" + table + "` READ"));
            for (const table of privateTables)
                assert.doesNotMatch(lock.sql, new RegExp("`" + table + "`"));
        }
        assert.ok(queryLog.some((entry) => entry.session === proof.holder_session &&
            entry.sql.includes("INFORMATION_SCHEMA.COLUMNS")),
        "the direct holder-session INFORMATION_SCHEMA query did not run");
        assert.ok(queryLog.some((entry) => entry.session === proof.metadata_session &&
            entry.sql.includes("INFORMATION_SCHEMA.COLUMNS")),
        "the explicit separate-session INFORMATION_SCHEMA query did not run");
    });
});

test("updates existing public content without firing notification triggers", async () => {
    await withPrivateGuard(async () => {
        await sync();
        for (const table of publicTables) {
            assert.deepEqual(await rows(`target.\`${table}\``),
                await rows(`source.\`${table}\``));
        }
        assert.equal(await scalar(
            "SELECT COUNT(*) FROM target.NotificationQueue WHERE Payload=?",
            ["Ruslan's lion shield (ARM)"]), 0);
        const digest = await runPython("digest", [currentManifest, currentDump]);
        assert.equal(digest.status, 0, digest.stderr);
        assert.equal(digest.stdout.trim(),
            JSON.parse(fs.readFileSync(currentManifest, "utf8")).content_sha256);
        const setEvent = queryLog.find((entry) =>
            entry.sql === "SET @DISABLE_NOTIFICATIONS=1");
        const inserts = queryLog.filter((entry) =>
            entry.sql.startsWith("INSERT INTO `target`"));
        assert.ok(setEvent);
        assert.equal(inserts.length, 17);
        assert.ok(inserts.every((entry) => entry.session === setEvent.session));
    });
});

test("deletes public rows absent from the source snapshot", async () => {
    await withPrivateGuard(async () => {
        await sync();
        assert.equal(await scalar("SELECT COUNT(*) FROM target.Areas WHERE Id=7000"), 0);
    });
});

test("copies audit history", async () => {
    await withPrivateGuard(async () => {
        await sync();
        assert.deepEqual(await rows("target.Items_AuditTrail"),
            await rows("source.Items_AuditTrail"));
    });
});

test("copies relationship rows", async () => {
    await withPrivateGuard(async () => {
        await sync();
        assert.deepEqual(await rows("target.ItemMobMap"),
            await rows("source.ItemMobMap"));
    });
});

test("reapplying an unchanged snapshot is idempotent", async () => {
    await withPrivateGuard(async () => {
        await sync();
        const first = await rows("target.Items");
        const result = await runPython("apply", [currentManifest, currentDump]);
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(await rows("target.Items"), first);
    });
});

test("repairs direct target drift with an unchanged source digest", async () => {
    await withPrivateGuard(async () => {
        await sync();
        const sourceDigest = JSON.parse(fs.readFileSync(currentManifest, "utf8"))
            .content_sha256;
        await sql("UPDATE target.Items SET Payload='drifted' WHERE Id=2263");
        const result = await runPython("apply", [currentManifest, currentDump]);
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(await rows("target.Items"), await rows("source.Items"));
        assert.equal(JSON.parse(fs.readFileSync(currentManifest, "utf8"))
            .content_sha256, sourceDigest);
    });
});

test("rejects a target schema mismatch before staging or target mutation", async () => {
    await withPrivateGuard(async () => {
        const before = await rows("target.Areas");
        await sql("ALTER TABLE target.Items ADD COLUMN Unexpected INT NULL");
        queryLog = [];
        const result = await runPython("sync", [currentManifest, currentDump]);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /target schema digest mismatch/);
        assert.deepEqual(await rows("target.Areas"), before);
        assert.ok(!queryLog.some((entry) => entry.sql === "START TRANSACTION"));
    });
});

test("rejects corrupt staging data before the target transaction", async () => {
    await withPrivateGuard(async () => {
        const prepared = await runPython("prepare", [currentManifest, currentDump]);
        assert.equal(prepared.status, 0, prepared.stderr);
        await sql("UPDATE staging.Items SET Payload='corrupt' WHERE Id=2263");
        const before = await rows("target.Items");
        queryLog = [];
        const result = await runPython("apply", [currentManifest, currentDump]);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /content digest mismatch/);
        assert.deepEqual(await rows("target.Items"), before);
        assert.ok(!queryLog.some((entry) => entry.sql === "START TRANSACTION"));
    });
});

test("rolls back every public table after a forced SQL failure", async () => {
    await withPrivateGuard(async () => {
        const prepared = await runPython("prepare", [currentManifest, currentDump]);
        assert.equal(prepared.status, 0, prepared.stderr);
        await sql("CREATE TRIGGER target.Categories_Reject BEFORE INSERT ON " +
            "target.Categories FOR EACH ROW SIGNAL SQLSTATE '45000' " +
            "SET MESSAGE_TEXT='forced integration failure'");
        const areasBefore = await rows("target.Areas");
        const categoriesBefore = await rows("target.Categories");
        queryLog = [];
        const result = await runPython("apply", [currentManifest, currentDump]);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /forced integration failure/);
        assert.deepEqual(await rows("target.Areas"), areasBefore);
        assert.deepEqual(await rows("target.Categories"), categoriesBefore);
        assert.ok(queryLog.some((entry) => entry.sql === "ROLLBACK"));
        assert.ok(!queryLog.some((entry) => entry.sql === "COMMIT"));
    });
});

test("rejects a MyISAM public target table before BEGIN", async () => {
    await withPrivateGuard(async () => {
        await sql("ALTER TABLE target.Areas ENGINE=MyISAM");
        const before = await rows("target.Areas");
        queryLog = [];
        const result = await runPython("sync", [currentManifest, currentDump]);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /non-InnoDB allowlisted table: Areas/);
        assert.deepEqual(await rows("target.Areas"), before);
        assert.ok(!queryLog.some((entry) => entry.sql === "START TRANSACTION"));
    });
});
