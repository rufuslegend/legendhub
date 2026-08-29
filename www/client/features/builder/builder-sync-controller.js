const DEBOUNCE_MS = 750;
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000];
const MAX_RETRY_WINDOW_MS = 30000;

export const BUILDER_SYNC_MESSAGES = Object.freeze({
    saving: "Saving…",
    saved: "Saved to account",
    problem: "Sync problem. Changes are still in memory. Export them before reloading.",
    conflict: "A newer account copy was kept and your edits were saved as a conflict copy.",
    revisionProblem: "Builder data changed on the server. Your edits are still in memory. Export them before reloading account data.",
    quotaProblem: "Builder account storage is limited to 10 MB. Changes are still in memory. Export them before reloading.",
    generationChanged: "Synced Builder data changed in another session. Export your unsaved data before reloading."
});

function queueKey(snapshot) {
    if (typeof snapshot?.id === "string" && snapshot.id)
        return `id:${snapshot.id}`;
    if (typeof snapshot?.queueKey === "string" && snapshot.queueKey)
        return `local:${snapshot.queueKey}`;
    return `name:${String(snapshot?.name || "")}`;
}

function errorDetails(error) {
    const errors = Array.isArray(error?.errors) ? error.errors : [];
    const first = errors[0] || {};
    return {
        code: first.code ?? error?.code,
        message: typeof first.message === "string" ? first.message : ""
    };
}

function isGenerationFailure(error) {
    const details = errorDetails(error);
    return details.code === 409 && details.message === "Account storage changed. Reload before saving.";
}

function fixedProblemMessage(error) {
    const code = errorDetails(error).code;
    if (code === 409)
        return BUILDER_SYNC_MESSAGES.revisionProblem;
    if (code === 413)
        return BUILDER_SYNC_MESSAGES.quotaProblem;
    return BUILDER_SYNC_MESSAGES.problem;
}

function isRetryableNetworkFailure(error) {
    if (error?.retryable === true)
        return true;
    if (error?.name === "TypeError" || error?.name === "NetworkError")
        return true;
    if (["NETWORK", "ECONNRESET", "ETIMEDOUT"].includes(error?.code))
        return true;
    return error?.name === "GraphQLRequestError" &&
        error.message !== "Authorization required." &&
        Array.isArray(error.errors) && error.errors.length === 0;
}

function committedMetadata(snapshot, result) {
    const profile = result?.profile;
    if (!profile || typeof profile !== "object")
        return snapshot;
    return {
        ...snapshot,
        ...(typeof profile.id === "string" && profile.id ? {id: profile.id} : {}),
        ...(Number.isInteger(profile.revision) ? {revision: profile.revision} : {}),
        ...(Number.isInteger(result.storageGeneration)
            ? {storageGeneration: result.storageGeneration}
            : {})
    };
}

export function createBuilderSyncController({
    saveProfile,
    deleteProfile,
    schedule = (callback, delay) => setTimeout(callback, delay),
    cancel = handle => clearTimeout(handle),
    onResult = () => {},
    onStatus = () => {}
}) {
    const entries = new Map();
    let disposed = false;
    let stoppedForGeneration = false;
    let conflictNotice = false;
    let epoch = 0;

    function notifyStatus(status, message) {
        if (disposed)
            return;
        try {
            const notified = onStatus({status, message});
            if (notified?.catch)
                notified.catch(function() {});
        }
        catch {
            // Presentation failures never change persistence truth.
        }
    }

    function publishStatus() {
        if (stoppedForGeneration) {
            notifyStatus("generation-changed", BUILDER_SYNC_MESSAGES.generationChanged);
            return;
        }
        if (conflictNotice) {
            notifyStatus("conflict", BUILDER_SYNC_MESSAGES.conflict);
            return;
        }
        const problem = [...entries.values()].find(entry =>
            entry.state === "problem" || entry.state === "retrying");
        if (problem) {
            notifyStatus("problem", problem.problemMessage || BUILDER_SYNC_MESSAGES.problem);
            return;
        }
        if ([...entries.values()].some(entry =>
            entry.timer !== null || entry.inFlight || entry.state === "pending" || entry.state === "saving")) {
            notifyStatus("saving", BUILDER_SYNC_MESSAGES.saving);
            return;
        }
        notifyStatus("saved", BUILDER_SYNC_MESSAGES.saved);
    }

    function cancelTimer(entry) {
        if (entry.timer === null)
            return;
        cancel(entry.timer);
        entry.timer = null;
    }

    function stopEveryQueue() {
        stoppedForGeneration = true;
        epoch += 1;
        for (const entry of entries.values()) {
            cancelTimer(entry);
            entry.state = "generation-changed";
        }
    }

    async function notifyResult(value, activeEpoch) {
        if (disposed || activeEpoch !== epoch)
            return false;
        try {
            await onResult(value);
            return !disposed && activeEpoch === epoch;
        }
        catch {
            return false;
        }
    }

    function rekeyCommittedEntry(entry, result) {
        const next = committedMetadata(entry.latest, result);
        entry.latest = next;
        const nextKey = queueKey(next);
        if (nextKey === entry.key)
            return;
        entries.delete(entry.key);
        entry.key = nextKey;
        entries.set(nextKey, entry);
    }

    function retryDelay(entry) {
        const proposed = RETRY_DELAYS_MS[entry.retryAttempt];
        if (proposed === undefined)
            return null;
        const remaining = MAX_RETRY_WINDOW_MS - entry.retryElapsed;
        if (remaining <= 0)
            return null;
        return Math.min(proposed, remaining);
    }

    function scheduleEntry(entry, delay) {
        cancelTimer(entry);
        entry.timer = schedule(function() {
            entry.timer = null;
            return perform(entry);
        }, delay);
    }

    async function handleFailure(entry, error, operation, sentVersion, activeEpoch) {
        if (disposed || activeEpoch !== epoch)
            return;
        entry.inFlight = false;
        entry.inFlightPromise = null;

        if (isGenerationFailure(error)) {
            stopEveryQueue();
            await notifyResult({type: "generation-changed", operation, snapshot: entry.latest}, epoch);
            publishStatus();
            return;
        }

        const details = errorDetails(error);
        if (details.code === 409 || details.code === 413) {
            cancelTimer(entry);
            entry.ready = false;
            entry.removed = false;
            entry.state = "problem";
            entry.problemMessage = fixedProblemMessage(error);
            await notifyResult({type: "problem", operation, snapshot: entry.latest}, activeEpoch);
            publishStatus();
            return;
        }

        if (entry.version !== sentVersion) {
            if (entry.removed) {
                if (entry.latest.id)
                    return perform(entry);
                else {
                    entries.delete(entry.key);
                    publishStatus();
                }
            }
            else if (!entry.removed && entry.ready && entry.timer === null)
                return perform(entry);
            else
                publishStatus();
            return;
        }

        if (isRetryableNetworkFailure(error)) {
            const delay = retryDelay(entry);
            if (delay !== null) {
                entry.retryAttempt += 1;
                entry.retryElapsed += delay;
                entry.state = "retrying";
                scheduleEntry(entry, delay);
                publishStatus();
                return;
            }
        }

        entry.removed = false;
        entry.state = "problem";
        entry.problemMessage = fixedProblemMessage(error);
        await notifyResult({type: "problem", operation, snapshot: entry.latest}, activeEpoch);
        publishStatus();
    }

    async function perform(entry) {
        if (disposed || stoppedForGeneration || !entries.has(entry.key))
            return;
        if (entry.inFlight) {
            entry.ready = true;
            return entry.inFlightPromise;
        }

        if (entry.removed && !entry.latest.id) {
            entries.delete(entry.key);
            publishStatus();
            return;
        }

        const activeEpoch = epoch;
        const operation = entry.removed ? "delete" : "save";
        const sent = entry.latest;
        const sentVersion = entry.version;
        entry.inFlight = true;
        entry.ready = false;
        entry.state = "saving";
        publishStatus();

        const request = (async function() {
            let result;
            try {
                result = operation === "delete"
                    ? await deleteProfile(sent)
                    : await saveProfile(sent);
            }
            catch (error) {
                await handleFailure(entry, error, operation, sentVersion, activeEpoch);
                return;
            }

            if (disposed || activeEpoch !== epoch)
                return;

            entry.inFlight = false;
            entry.inFlightPromise = null;
            entry.retryAttempt = 0;
            entry.retryElapsed = 0;

            if (operation === "delete") {
                if (result?.status !== "deleted") {
                    entry.removed = false;
                    entry.state = "problem";
                    await notifyResult({type: "problem", operation, snapshot: sent}, activeEpoch);
                    publishStatus();
                    return;
                }
                entries.delete(entry.key);
                const delivered = await notifyResult({type: "deleted", snapshot: sent, result}, activeEpoch);
                if (!delivered && !disposed) {
                    entry.state = "problem";
                    entries.set(entry.key, entry);
                }
                publishStatus();
                return;
            }

            if (result?.status === "conflict") {
                const current = entry.latest;
                cancelTimer(entry);
                entries.delete(entry.key);
                entry.state = "conflict";
                conflictNotice = true;
                await notifyResult({
                    type: "conflict",
                    previous: sent,
                    current,
                    result
                }, activeEpoch);
                publishStatus();
                return;
            }

            if (result?.status !== "saved") {
                entry.state = "problem";
                await notifyResult({type: "problem", operation, snapshot: sent}, activeEpoch);
                publishStatus();
                return;
            }

            entry.lastCommittedFingerprint = sent.fingerprint;
            rekeyCommittedEntry(entry, result);
            const delivered = await notifyResult({
                type: "saved",
                previous: sent,
                current: entry.latest,
                result
            }, activeEpoch);
            if (!delivered) {
                entry.state = "problem";
                publishStatus();
                return;
            }

            if (entry.removed) {
                entry.state = "pending";
                return perform(entry);
            }
            if (entry.latest.fingerprint !== sent.fingerprint) {
                entry.state = "pending";
                if (entry.ready && entry.timer === null)
                    return perform(entry);
                else
                    publishStatus();
                return;
            }
            cancelTimer(entry);
            entry.state = "idle";
            publishStatus();
        })();
        entry.inFlightPromise = request;
        return request;
    }

    function queue(snapshot) {
        if (disposed || stoppedForGeneration)
            return;
        const key = queueKey(snapshot);
        let entry = entries.get(key);
        if (!entry) {
            entry = {
                key,
                latest: snapshot,
                version: 0,
                timer: null,
                inFlight: false,
                inFlightPromise: null,
                ready: false,
                removed: false,
                retryAttempt: 0,
                retryElapsed: 0,
                lastCommittedFingerprint: null,
                problemMessage: null,
                state: "idle"
            };
            entries.set(key, entry);
        }
        if (!entry.removed && entry.latest?.fingerprint === snapshot.fingerprint &&
            (entry.timer !== null || entry.inFlight || entry.lastCommittedFingerprint === snapshot.fingerprint))
            return;

        entry.latest = snapshot;
        entry.version += 1;
        entry.removed = false;
        entry.ready = false;
        entry.retryAttempt = 0;
        entry.retryElapsed = 0;
        entry.problemMessage = null;
        entry.state = "pending";
        scheduleEntry(entry, DEBOUNCE_MS);
        publishStatus();
    }

    function remove(snapshot) {
        if (disposed || stoppedForGeneration)
            return;
        const key = queueKey(snapshot);
        let entry = entries.get(key);
        if (!entry) {
            entry = {
                key,
                latest: snapshot,
                version: 0,
                timer: null,
                inFlight: false,
                inFlightPromise: null,
                ready: false,
                removed: false,
                retryAttempt: 0,
                retryElapsed: 0,
                lastCommittedFingerprint: null,
                problemMessage: null,
                state: "idle"
            };
            entries.set(key, entry);
        }
        entry.latest = snapshot;
        entry.version += 1;
        entry.removed = true;
        entry.ready = true;
        entry.retryAttempt = 0;
        entry.retryElapsed = 0;
        entry.problemMessage = null;
        entry.state = "pending";
        cancelTimer(entry);
        if (!entry.inFlight)
            void perform(entry);
        publishStatus();
    }

    async function flush() {
        if (disposed || stoppedForGeneration)
            return;
        const pending = [];
        for (const entry of entries.values()) {
            if (entry.timer !== null) {
                cancelTimer(entry);
                pending.push(perform(entry));
            }
            else if (entry.inFlightPromise)
                pending.push(entry.inFlightPromise);
        }
        await Promise.allSettled(pending);
    }

    function dispose() {
        if (disposed)
            return;
        disposed = true;
        epoch += 1;
        for (const entry of entries.values())
            cancelTimer(entry);
        entries.clear();
    }

    return {queue, remove, flush, dispose};
}
