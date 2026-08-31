"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const zlib = require("node:zlib");

const {createSpoolConsumer} = require("../src/equipment-importer/spool");

const FIXTURE = path.join(__dirname, "..", "test-fixtures", "equipment-spool", "valid.json");
const NOW = new Date("2026-08-31T23:00:00.000Z");

async function createSpool(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "legendhub-spool-"));
    t.after(() => fs.rm(root, {recursive: true, force: true}));
    for (const name of ["incoming", "processing", "processed", "rejected"])
        await fs.mkdir(path.join(root, name));
    return root;
}

async function copyFixture(root, directory, name, mutate) {
    const document = JSON.parse(await fs.readFile(FIXTURE, "utf8"));
    if (mutate)
        mutate(document);
    await fs.writeFile(path.join(root, directory, name), `${JSON.stringify(document)}\n`);
}

function repository(handler = async () => ({status: "created", itemId: 1})) {
    const parsed = [];
    return {
        parsed,
        async ingest(value, receivedAt) {
            parsed.push({value, receivedAt});
            return handler(value, receivedAt);
        }
    };
}

test("polls sorted visible JSON files serially and moves successes to processed", async t => {
    const root = await createSpool(t);
    await copyFixture(root, "incoming", "b.json", document => {
        document.submission.id = "second";
    });
    await copyFixture(root, "incoming", "a.json", document => {
        document.submission.id = "first";
    });
    await copyFixture(root, "incoming", ".writing.json");
    await fs.writeFile(path.join(root, "incoming", "notes.txt"), "ignore me");
    let active = 0;
    let peak = 0;
    const order = [];
    const repo = repository(async parsed => {
        active += 1;
        peak = Math.max(peak, active);
        order.push(parsed.document.submission.id);
        await new Promise(resolve => setImmediate(resolve));
        active -= 1;
        return {status: "created", itemId: order.length};
    });

    const result = await createSpoolConsumer({root, repository: repo, now: () => NOW})
        .pollOnce();

    assert.deepEqual(result, {processed: 2, rejected: 0});
    assert.deepEqual(order, ["first", "second"]);
    assert.equal(peak, 1);
    assert.deepEqual(await fs.readdir(path.join(root, "processed")), ["a.json", "b.json"]);
    assert.deepEqual((await fs.readdir(path.join(root, "incoming"))).sort(),
        [".writing.json", "notes.txt"]);
    assert.equal(repo.parsed[0].receivedAt, NOW);
});

test("rejects invalid observations with a safe atomic sidecar", async t => {
    const root = await createSpool(t);
    await copyFixture(root, "incoming", "bad.json", document => {
        document.item.slots = [];
    });

    const result = await createSpoolConsumer({root, repository: repository(), now: () => NOW})
        .pollOnce();

    assert.deepEqual(result, {processed: 0, rejected: 1});
    assert.deepEqual((await fs.readdir(path.join(root, "rejected"))).sort(),
        ["bad.json", "bad.json.error.json"]);
    const sidecar = JSON.parse(await fs.readFile(
        path.join(root, "rejected", "bad.json.error.json"), "utf8"));
    assert.deepEqual(sidecar, {
        code: "contract_invalid",
        message: "The equipment observation contains invalid slots.",
        failed_at: NOW.toISOString(),
        paths: ["item.slots"]
    });
    assert.equal((await fs.stat(path.join(root, "rejected", "bad.json.error.json"))).mode & 0o777,
        0o660);
    assert.equal((await fs.readdir(path.join(root, "rejected"))).some(name => name.startsWith(".")),
        false);
});

test("uses stable safe codes for malformed, oversized, collision, and database failures", async t => {
    const cases = [
        ["invalid.json", Buffer.from("{"), repository(), "invalid_json"],
        ["large.json", Buffer.alloc((256 * 1024) + 1, 32), repository(), "file_too_large"],
        ["collision.json", await fs.readFile(FIXTURE), repository(async () => {
            const error = new Error("unsafe internal collision detail");
            error.code = "submission_id_collision";
            throw error;
        }), "submission_id_collision"],
        ["database.json", await fs.readFile(FIXTURE), repository(async () => {
            throw new Error("password=something-secret");
        }), "database_error"]
    ];
    for (const [name, contents, repo, code] of cases) {
        const root = await createSpool(t);
        await fs.writeFile(path.join(root, "incoming", name), contents);
        await createSpoolConsumer({root, repository: repo, now: () => NOW}).pollOnce();
        const sidecar = JSON.parse(await fs.readFile(
            path.join(root, "rejected", `${name}.error.json`), "utf8"));
        assert.equal(sidecar.code, code);
        assert.doesNotMatch(JSON.stringify(sidecar), /something-secret|unsafe internal/);
    }
});

test("startup recovery returns all claimed JSON while normal polling recovers only stale claims", async t => {
    const root = await createSpool(t);
    await copyFixture(root, "processing", "startup.json");
    await fs.writeFile(path.join(root, "processing", ".working.json"), "{}");
    const consumer = createSpoolConsumer({root, repository: repository(), now: () => NOW});

    assert.equal(await consumer.recover(), 1);
    assert.deepEqual((await fs.readdir(path.join(root, "incoming"))), ["startup.json"]);

    await fs.rename(path.join(root, "incoming", "startup.json"),
        path.join(root, "processing", "fresh.json"));
    await copyFixture(root, "processing", "stale.json", document => {
        document.submission.id = "stale";
    });
    await fs.utimes(path.join(root, "processing", "stale.json"),
        new Date(NOW.getTime() - (16 * 60 * 1000)), new Date(NOW.getTime() - (16 * 60 * 1000)));

    const result = await consumer.pollOnce();

    assert.deepEqual(result, {processed: 1, rejected: 0});
    assert.deepEqual((await fs.readdir(path.join(root, "processing"))).sort(),
        [".working.json", "fresh.json"]);
    assert.deepEqual(await fs.readdir(path.join(root, "processed")), ["stale.json"]);
});

test("a recovered post-commit claim is safely accepted as a repository replay", async t => {
    const root = await createSpool(t);
    await copyFixture(root, "processing", "committed.json");
    const repo = repository(async () => ({status: "replay", itemId: 42}));
    const consumer = createSpoolConsumer({root, repository: repo, now: () => NOW});

    await consumer.recover();
    assert.deepEqual(await consumer.pollOnce(), {processed: 1, rejected: 0});
    assert.equal(repo.parsed.length, 1);
    assert.deepEqual(await fs.readdir(path.join(root, "processed")), ["committed.json"]);
});

test("a failed final move leaves a committed claim in processing for replay", async t => {
    const root = await createSpool(t);
    await copyFixture(root, "incoming", "committed.json");
    await fs.mkdir(path.join(root, "processed", "committed.json"));
    const repo = repository();
    const consumer = createSpoolConsumer({root, repository: repo, now: () => NOW});

    await assert.rejects(consumer.pollOnce(), /directory|EISDIR|ENOTDIR/i);

    assert.equal(repo.parsed.length, 1);
    assert.deepEqual(await fs.readdir(path.join(root, "processing")), ["committed.json"]);
    assert.deepEqual(await fs.readdir(path.join(root, "rejected")), []);
});

test("retention gzips one-day processed files and expires old processed and rejected files", async t => {
    const root = await createSpool(t);
    const names = [
        ["processed", "fresh.json", 12 * 60 * 60 * 1000],
        ["processed", "compress.json", 2 * 24 * 60 * 60 * 1000],
        ["processed", "expired.json", 31 * 24 * 60 * 60 * 1000],
        ["processed", "expired.json.gz", 31 * 24 * 60 * 60 * 1000],
        ["rejected", "keep.json", 89 * 24 * 60 * 60 * 1000],
        ["rejected", "expired.json", 91 * 24 * 60 * 60 * 1000],
        ["rejected", "expired.json.error.json", 91 * 24 * 60 * 60 * 1000]
    ];
    for (const [directory, name, age] of names) {
        const filename = path.join(root, directory, name);
        await fs.writeFile(filename, `${directory}/${name}`);
        const timestamp = new Date(NOW.getTime() - age);
        await fs.utimes(filename, timestamp, timestamp);
    }

    const result = await createSpoolConsumer({root, repository: repository(), now: () => NOW})
        .applyRetention();

    assert.deepEqual(result, {compressed: 1, deletedProcessed: 2, deletedRejected: 2});
    assert.deepEqual((await fs.readdir(path.join(root, "processed"))).sort(),
        ["compress.json.gz", "fresh.json"]);
    assert.equal(zlib.gunzipSync(await fs.readFile(
        path.join(root, "processed", "compress.json.gz"))).toString(),
    "processed/compress.json");
    assert.deepEqual(await fs.readdir(path.join(root, "rejected")), ["keep.json"]);
});
