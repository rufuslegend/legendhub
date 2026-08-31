"use strict";

const assert = require("node:assert/strict");
const {EventEmitter} = require("node:events");
const test = require("node:test");

const {start} = require("../src/equipment-importer");

function endingPool(events) {
    return {
        end(callback) {
            events.push("close repository pool");
            callback();
        }
    };
}

test("validates importer configuration before migrations or filesystem work", async () => {
    let migrated = false;
    await assert.rejects(start({
        environment: {
            EQUIPMENT_SPOOL_ROOT: "relative/spool",
            EQUIPMENT_IMPORT_POLL_MS: "5000"
        },
        migrate: async () => {
            migrated = true;
        }
    }), /absolute path/);
    assert.equal(migrated, false);
});

test("migrates, recovers, polls immediately, reports counts, and closes on SIGTERM", async () => {
    const events = [];
    const messages = [];
    const signals = new EventEmitter();
    const consumer = {
        async recover() {
            events.push("recover");
            return 2;
        },
        async pollOnce() {
            events.push("poll");
            return {processed: 3, rejected: 1};
        },
        async applyRetention() {
            events.push("retention");
            return {compressed: 4, deletedProcessed: 5, deletedRejected: 6};
        }
    };

    await start({
        environment: {
            EQUIPMENT_SPOOL_ROOT: "/var/spool/legendhub",
            EQUIPMENT_IMPORT_POLL_MS: "23"
        },
        migrate: async () => events.push("migrate"),
        createConsumer(options) {
            events.push(`consumer ${options.root}`);
            return consumer;
        },
        delay: async milliseconds => {
            events.push(`delay ${milliseconds}`);
            signals.emit("SIGTERM");
        },
        signalTarget: signals,
        repositoryPool: endingPool(events),
        closeMigrationPool: async () => events.push("close migration pool"),
        log: {
            info(message, detail) {
                messages.push({message, detail});
            },
            error() {}
        }
    });

    assert.deepEqual(events, [
        "migrate",
        "consumer /var/spool/legendhub",
        "recover",
        "poll",
        "retention",
        "delay 23",
        "close repository pool",
        "close migration pool"
    ]);
    assert.deepEqual(messages, [
        {message: "Equipment spool recovery complete.", detail: {recovered: 2}},
        {message: "Equipment spool poll complete.", detail: {
            processed: 3,
            rejected: 1,
            compressed: 4,
            deletedProcessed: 5,
            deletedRejected: 6
        }}
    ]);
    assert.equal(signals.listenerCount("SIGTERM"), 0);
    assert.equal(signals.listenerCount("SIGINT"), 0);
});

test("SIGINT is also a clean shutdown and closes both pools once", async () => {
    const events = [];
    const signals = new EventEmitter();
    await start({
        environment: {
            EQUIPMENT_SPOOL_ROOT: "/var/spool/legendhub"
        },
        migrate: async () => {},
        createConsumer: () => ({
            recover: async () => 0,
            pollOnce: async () => ({processed: 0, rejected: 0}),
            applyRetention: async () => ({
                compressed: 0, deletedProcessed: 0, deletedRejected: 0
            })
        }),
        delay: async () => signals.emit("SIGINT"),
        signalTarget: signals,
        repositoryPool: endingPool(events),
        closeMigrationPool: async () => events.push("close migration pool"),
        log: {info() {}, error() {}}
    });
    assert.deepEqual(events, ["close repository pool", "close migration pool"]);
});

test("startup failures still close both pools without logging sensitive error details", async () => {
    const events = [];
    const logged = [];
    const secret = new Error("password=do-not-log");
    const result = await require("../src/equipment-importer").main({
        environment: {EQUIPMENT_SPOOL_ROOT: "/var/spool/legendhub"},
        migrate: async () => {
            throw secret;
        },
        repositoryPool: endingPool(events),
        closeMigrationPool: async () => events.push("close migration pool"),
        log: {
            info() {},
            error(...values) {
                logged.push(values);
            }
        },
        setExitCode: value => events.push(`exit ${value}`)
    });

    assert.equal(result, undefined);
    assert.deepEqual(events,
        ["close repository pool", "close migration pool", "exit 1"]);
    assert.doesNotMatch(JSON.stringify(logged), /do-not-log/);
});
