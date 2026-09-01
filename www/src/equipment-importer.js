"use strict";

require("dotenv").config({quiet: true});

const path = require("node:path");

const DEFAULT_POLL_MILLISECONDS = 5000;

function readConfiguration(environment) {
    const root = environment.EQUIPMENT_SPOOL_ROOT;
    if (typeof root !== "string" || !path.isAbsolute(root))
        throw new Error("EQUIPMENT_SPOOL_ROOT must be an absolute path.");

    const rawPoll = environment.EQUIPMENT_IMPORT_POLL_MS ||
        String(DEFAULT_POLL_MILLISECONDS);
    if (!/^\d+$/.test(rawPoll))
        throw new Error("EQUIPMENT_IMPORT_POLL_MS must be a positive integer.");
    const pollMilliseconds = Number(rawPoll);
    if (!Number.isSafeInteger(pollMilliseconds) || pollMilliseconds < 1)
        throw new Error("EQUIPMENT_IMPORT_POLL_MS must be a positive integer.");
    return {root, pollMilliseconds};
}

function endPool(pool) {
    return new Promise(function(resolve, reject) {
        pool.end(function(error) {
            if (error)
                reject(error);
            else
                resolve();
        });
    });
}

function delay(milliseconds, signal) {
    return new Promise(function(resolve) {
        if (signal.aborted)
            return resolve();
        const timer = setTimeout(finish, milliseconds);
        signal.addEventListener("abort", finish, {once: true});
        function finish() {
            clearTimeout(timer);
            signal.removeEventListener("abort", finish);
            resolve();
        }
    });
}

async function closeResources(repositoryPool, closeMigrationPool) {
    const errors = [];
    try {
        await endPool(repositoryPool);
    }
    catch (error) {
        errors.push(error);
    }
    try {
        await closeMigrationPool();
    }
    catch (error) {
        errors.push(error);
    }
    return errors;
}

async function start(options = {}) {
    const environment = options.environment || process.env;
    const configuration = readConfiguration(environment);
    const migrations = options.migrate && options.closeMigrationPool
        ? null : require("./routes/api/migrations");
    const migrate = options.migrate || migrations.run;
    const closeMigrationPool = options.closeMigrationPool || migrations.close;
    const repositoryPool = options.repositoryPool ||
        require("./routes/api/mysql-connection");
    const createConsumer = options.createConsumer || function({root, log}) {
        const {createEquipmentRepository} = require("./equipment-importer/repository");
        const {createSpoolConsumer} = require("./equipment-importer/spool");
        return createSpoolConsumer({
            root,
            log,
            repository: createEquipmentRepository(repositoryPool)
        });
    };
    const wait = options.delay || delay;
    const signalTarget = options.signalTarget || process;
    const log = options.log || console;
    const abortController = new AbortController();
    let stopping = false;
    let runError;

    function requestStop() {
        stopping = true;
        abortController.abort();
    }

    signalTarget.once("SIGTERM", requestStop);
    signalTarget.once("SIGINT", requestStop);
    try {
        await migrate();
        const consumer = createConsumer({root: configuration.root, log});
        const recovered = await consumer.recover();
        log.info("Equipment spool recovery complete.", {recovered});
        while (!stopping) {
            const outcome = await consumer.pollOnce();
            const retention = await consumer.applyRetention();
            log.info("Equipment spool poll complete.", {...outcome, ...retention});
            if (!stopping) {
                await wait(configuration.pollMilliseconds,
                    abortController.signal);
            }
        }
    }
    catch (error) {
        runError = error;
    }
    finally {
        signalTarget.removeListener("SIGTERM", requestStop);
        signalTarget.removeListener("SIGINT", requestStop);
    }

    const closeErrors = await closeResources(repositoryPool, closeMigrationPool);
    if (runError && closeErrors.length > 0) {
        throw new AggregateError([runError, ...closeErrors],
            "Equipment importer failed and could not close all database pools.");
    }
    if (runError)
        throw runError;
    if (closeErrors.length > 0)
        throw new AggregateError(closeErrors,
            "Equipment importer could not close all database pools.");
}

async function main(options = {}) {
    const log = options.log || console;
    const setExitCode = options.setExitCode || (value => {
        process.exitCode = value;
    });
    try {
        return await start(options);
    }
    catch (error) {
        log.error("Equipment importer stopped after an unexpected error.", {
            code: typeof error.code === "string" ? error.code : "importer_failure"
        });
        setExitCode(1);
        return undefined;
    }
}

if (require.main === module)
    main();

module.exports = {DEFAULT_POLL_MILLISECONDS, main, readConfiguration, start};
