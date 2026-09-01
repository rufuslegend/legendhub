"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const {promisify} = require("node:util");
const zlib = require("node:zlib");

const {MAX_FILE_BYTES, parseObservation} = require("./contract");
const {ImportValidationError} = require("./errors");

const gzip = promisify(zlib.gzip);
const READY_FILE = /^[^.].*\.json$/;
const STALE_MILLISECONDS = 15 * 60 * 1000;
const COMPRESS_MILLISECONDS = 24 * 60 * 60 * 1000;
const PROCESSED_RETENTION_MILLISECONDS = 30 * 24 * 60 * 60 * 1000;
const REJECTED_RETENTION_MILLISECONDS = 90 * 24 * 60 * 60 * 1000;

const SAFE_ERRORS = {
    invalid_json: "The equipment observation is not valid JSON.",
    invalid_utf8: "The equipment observation is not valid UTF-8.",
    file_too_large: "The equipment observation exceeds the file-size limit.",
    contract_invalid: "The equipment observation is invalid.",
    submission_id_collision: "The submission identity was already used for different content.",
    database_error: "The equipment observation could not be stored."
};

function validateOptions(root, repository, now) {
    if (typeof root !== "string" || !path.isAbsolute(root))
        throw new TypeError("The equipment spool root must be an absolute path.");
    if (!repository || typeof repository.ingest !== "function")
        throw new TypeError("The equipment spool consumer requires a repository.");
    if (typeof now !== "function")
        throw new TypeError("The equipment spool consumer requires a clock function.");
}

async function listReady(directory, pattern = READY_FILE) {
    return (await fs.readdir(directory)).filter(name => pattern.test(name)).sort();
}

async function renameClaim(source, destination) {
    try {
        await fs.rename(source, destination);
        return true;
    }
    catch (error) {
        if (error.code === "ENOENT")
            return false;
        throw error;
    }
}

function safeFailure(error, failedAt) {
    const recognized = Object.hasOwn(SAFE_ERRORS, error && error.code)
        ? error.code
        : "database_error";
    const validationMessage = error instanceof ImportValidationError &&
        recognized !== "database_error" ? error.message : null;
    return {
        code: recognized,
        message: validationMessage || SAFE_ERRORS[recognized],
        failed_at: failedAt.toISOString(),
        paths: error instanceof ImportValidationError && Array.isArray(error.paths)
            ? error.paths : []
    };
}

async function writeSidecarAtomic(filename, value) {
    const directory = path.dirname(filename);
    const basename = path.basename(filename);
    const temporary = path.join(directory, `.${basename}.${process.pid}.tmp`);
    const handle = await fs.open(temporary, "w", 0o660);
    try {
        await handle.chmod(0o660);
        await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
        await handle.sync();
    }
    finally {
        await handle.close();
    }
    try {
        await fs.rename(temporary, filename);
    }
    catch (error) {
        await fs.rm(temporary, {force: true});
        throw error;
    }
}

async function recoverFiles(paths, cutoff) {
    let recovered = 0;
    for (const name of await listReady(paths.processing)) {
        const source = path.join(paths.processing, name);
        if (cutoff !== undefined) {
            let stat;
            try {
                stat = await fs.lstat(source);
            }
            catch (error) {
                if (error.code === "ENOENT")
                    continue;
                throw error;
            }
            if (stat.mtimeMs >= cutoff)
                continue;
        }
        if (await renameClaim(source, path.join(paths.incoming, name)))
            recovered += 1;
    }
    return recovered;
}

async function processClaim(paths, name, repository, receivedAt) {
    const processingFile = path.join(paths.processing, name);
    const stat = await fs.lstat(processingFile);
    if (!stat.isFile()) {
        throw new ImportValidationError(
            "contract_invalid", "The equipment observation must be a regular file.");
    }
    if (stat.size > MAX_FILE_BYTES) {
        throw new ImportValidationError(
            "file_too_large", "The equipment observation exceeds the file-size limit.");
    }
    const parsed = parseObservation(await fs.readFile(processingFile));
    return repository.ingest(parsed, receivedAt);
}

async function rejectClaim(paths, name, error, failedAt) {
    const source = path.join(paths.processing, name);
    const rejected = path.join(paths.rejected, name);
    await fs.rename(source, rejected);
    await writeSidecarAtomic(`${rejected}.error.json`, safeFailure(error, failedAt));
}

async function compressFile(filename, stat) {
    const destination = `${filename}.gz`;
    const temporary = `${destination}.${process.pid}.tmp`;
    await fs.writeFile(temporary, await gzip(await fs.readFile(filename)), {mode: 0o660});
    await fs.chmod(temporary, 0o660);
    await fs.rename(temporary, destination);
    await fs.utimes(destination, stat.atime, stat.mtime);
    await fs.unlink(filename);
}

function createSpoolConsumer({root, repository, now = () => new Date(), log = console}) {
    validateOptions(root, repository, now);
    const paths = Object.fromEntries(["incoming", "processing", "processed", "rejected"]
        .map(name => [name, path.join(root, name)]));

    return {
        recover() {
            return recoverFiles(paths);
        },

        async pollOnce() {
            const pollTime = now();
            await recoverFiles(paths, pollTime.getTime() - STALE_MILLISECONDS);
            const result = {processed: 0, rejected: 0};
            for (const name of await listReady(paths.incoming)) {
                if (!await renameClaim(path.join(paths.incoming, name),
                    path.join(paths.processing, name))) {
                    continue;
                }
                try {
                    await processClaim(paths, name, repository, pollTime);
                }
                catch (error) {
                    await rejectClaim(paths, name, error, pollTime);
                    result.rejected += 1;
                    if (log && typeof log.warn === "function")
                        log.warn("Equipment observation rejected.", {filename: name, code: safeFailure(error, pollTime).code});
                    continue;
                }
                await fs.rename(path.join(paths.processing, name),
                    path.join(paths.processed, name));
                result.processed += 1;
            }
            return result;
        },

        async applyRetention() {
            const currentTime = now().getTime();
            const result = {compressed: 0, deletedProcessed: 0, deletedRejected: 0};
            const processed = await listReady(paths.processed,
                /^(?!\.).*\.json(?:\.gz)?$/);
            for (const name of processed) {
                const filename = path.join(paths.processed, name);
                const stat = await fs.lstat(filename);
                const age = currentTime - stat.mtimeMs;
                if (age > PROCESSED_RETENTION_MILLISECONDS) {
                    await fs.unlink(filename);
                    result.deletedProcessed += 1;
                }
                else if (READY_FILE.test(name) && age > COMPRESS_MILLISECONDS) {
                    await compressFile(filename, stat);
                    result.compressed += 1;
                }
            }
            for (const name of await listReady(paths.rejected)) {
                const filename = path.join(paths.rejected, name);
                const stat = await fs.lstat(filename);
                if (currentTime - stat.mtimeMs > REJECTED_RETENTION_MILLISECONDS) {
                    await fs.unlink(filename);
                    result.deletedRejected += 1;
                }
            }
            return result;
        }
    };
}

module.exports = {
    COMPRESS_MILLISECONDS,
    PROCESSED_RETENTION_MILLISECONDS,
    REJECTED_RETENTION_MILLISECONDS,
    STALE_MILLISECONDS,
    createSpoolConsumer
};
