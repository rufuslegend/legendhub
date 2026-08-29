const SAVE_DELAY_MS = 750;
const SAFE_SAVE_ERROR = "Account preferences could not be saved.";
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];
const MAX_RETRY_WINDOW_MS = 30000;
const PROFILE_ID = /^[A-Za-z0-9-]{1,64}$/;

export const ACCOUNT_PREFERENCE_STATUS_MESSAGES = Object.freeze({
    saving: "Saving account preferences…",
    problem: "Account preference sync problem. Changes are still in this browser."
});

export const ACCOUNT_PREFERENCE_THEMES = new Set([
    "light",
    "dark",
    "solarized-dark",
    "high-contrast",
    "glass-blue",
    "glass-emerald",
    "glass-ruby",
    "glass-amethyst",
    "glass-amber"
]);

export const ACCOUNT_PREFERENCE_PAGE_SIZES = new Set([20, 50, 100, 200, 500, 1000]);

export const ACCOUNT_PREFERENCE_COLUMNS = new Set([
    "Slot", "Name", "Light", "Heroic", "Str", "Min", "Dex", "Con",
    "Per", "Spi", "Ac", "Align", "Hp", "Ma", "Mv", "Hpr", "Mar",
    "Mvr", "Hit", "Dam", "SpDam", "SpCrit", "Ma Redux", "Concen",
    "Mit", "Parry", "Shot Acc", "Ammo", "Bonus Acc", "2H", "Quality",
    "Speed", "MaxDam", "AvgDam", "MinDam", "Holdable", "Weap Type",
    "Weap Stat", "Weight", "Unique", "Bonded", "Casts", "Level",
    "Net Stat", "Sell", "Rent", "Str Cap", "Min Cap", "Dex Cap",
    "Con Cap", "Per Cap", "Spi Cap", "Soulbound", "Limited",
    "MeCritPerc", "MeCrit", "MeDamCap", "DmgShield"
]);

const LEGACY_COLUMN_ALIASES = new Map([
    ["Accu", "Shot Acc"],
    ["AccuBonus", "Bonus Acc"],
    ["AC", "Ac"],
    ["HP", "Hp"]
]);

export const DEFAULT_ACCOUNT_PREFERENCES = Object.freeze({
    version: 1,
    theme: "glass-blue",
    itemsPerPage: 20,
    itemColumns: Object.freeze([]),
    builderColumns: Object.freeze({}),
    selectedProfileId: null,
    selectedVariant: null
});

function plainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
        [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function invalidPreferences() {
    return new TypeError("Account preference data is invalid.");
}

export function canonicalPreferenceColumns(value, {tolerant = false} = {}) {
    const input = tolerant && typeof value === "string"
        ? value.split("-").filter(Boolean)
        : value;
    if (!Array.isArray(input)) {
        if (tolerant)
            return [];
        throw invalidPreferences();
    }
    const columns = [];
    const seen = new Set();
    for (const column of input) {
        const canonical = LEGACY_COLUMN_ALIASES.get(column) || column;
        if (typeof column !== "string" || !column || !ACCOUNT_PREFERENCE_COLUMNS.has(canonical)) {
            if (tolerant)
                continue;
            throw invalidPreferences();
        }
        if (!seen.has(canonical)) {
            seen.add(canonical);
            columns.push(canonical);
        }
    }
    return columns;
}

function selectedProfileId(value, tolerant) {
    if (value === undefined || value === null)
        return null;
    if (typeof value === "string" && PROFILE_ID.test(value))
        return value;
    if (tolerant)
        return null;
    throw invalidPreferences();
}

function selectedVariant(value, profileId, tolerant) {
    if (!profileId || value === undefined || value === null)
        return null;
    if (typeof value === "string" && value.length > 0 && value.length <= 255)
        return value;
    if (tolerant)
        return null;
    throw invalidPreferences();
}

export function canonicalizeAccountPreferences(value, {tolerant = false} = {}) {
    let input = value;
    if (typeof input === "string") {
        try {
            input = JSON.parse(input);
        }
        catch {
            if (!tolerant)
                throw invalidPreferences();
            input = {};
        }
    }
    if (!plainObject(input)) {
        if (!tolerant)
            throw invalidPreferences();
        input = {};
    }
    if (input.version !== undefined && input.version !== 1 && !tolerant)
        throw invalidPreferences();

    let theme = input.theme;
    if (!ACCOUNT_PREFERENCE_THEMES.has(theme)) {
        if (theme !== undefined && !tolerant)
            throw invalidPreferences();
        theme = DEFAULT_ACCOUNT_PREFERENCES.theme;
    }

    let itemsPerPage = input.itemsPerPage;
    if (!ACCOUNT_PREFERENCE_PAGE_SIZES.has(itemsPerPage)) {
        if (itemsPerPage !== undefined && !tolerant)
            throw invalidPreferences();
        itemsPerPage = DEFAULT_ACCOUNT_PREFERENCES.itemsPerPage;
    }

    const builderColumns = {};
    if (input.builderColumns !== undefined) {
        if (!plainObject(input.builderColumns)) {
            if (!tolerant)
                throw invalidPreferences();
        }
        else {
            for (const [profileId, columns] of Object.entries(input.builderColumns)) {
                if (!PROFILE_ID.test(profileId)) {
                    if (!tolerant)
                        throw invalidPreferences();
                    continue;
                }
                try {
                    builderColumns[profileId] = canonicalPreferenceColumns(columns, {tolerant});
                }
                catch {
                    if (!tolerant)
                        throw invalidPreferences();
                }
            }
        }
    }

    const profileId = selectedProfileId(input.selectedProfileId, tolerant);
    return {
        version: 1,
        theme,
        itemsPerPage,
        itemColumns: input.itemColumns === undefined
            ? []
            : canonicalPreferenceColumns(input.itemColumns, {tolerant}),
        builderColumns,
        selectedProfileId: profileId,
        selectedVariant: selectedVariant(input.selectedVariant, profileId, tolerant)
    };
}

function normalizeInitialState(initialState) {
    const context = plainObject(initialState) && Object.hasOwn(initialState, "enabled")
        ? initialState
        : {enabled: true, payload: initialState, revision: 1, storageGeneration: 1};
    const account = context.enabled === true || plainObject(context.payload);
    if (context.enabled !== true) {
        return {
            account,
            enabled: false,
            document: canonicalizeAccountPreferences(
                account ? context.payload : {},
                {tolerant: true}
            ),
            revision: 0,
            storageGeneration: 0
        };
    }
    try {
        if (!Number.isSafeInteger(context.revision) || context.revision < 1 ||
            !Number.isSafeInteger(context.storageGeneration) || context.storageGeneration < 1)
            throw invalidPreferences();
        return {
            account: true,
            enabled: true,
            document: canonicalizeAccountPreferences(context.payload),
            revision: context.revision,
            storageGeneration: context.storageGeneration
        };
    }
    catch {
        return {
            account: true,
            enabled: false,
            document: canonicalizeAccountPreferences({}, {tolerant: true}),
            revision: 0,
            storageGeneration: 0
        };
    }
}

function canonicalPatch(document, patch) {
    if (!plainObject(patch))
        return document;
    const allowed = {};
    for (const key of [
        "theme", "itemsPerPage", "itemColumns", "builderColumns",
        "selectedProfileId", "selectedVariant"
    ]) {
        if (Object.hasOwn(patch, key))
            allowed[key] = patch[key];
    }
    try {
        return canonicalizeAccountPreferences({...document, ...allowed});
    }
    catch {
        return document;
    }
}

function resultState(result) {
    if (!plainObject(result) || result.status !== "saved" ||
        !Number.isSafeInteger(result.preferenceRevision) || result.preferenceRevision < 1 ||
        !Number.isSafeInteger(result.storageGeneration) || result.storageGeneration < 1) {
        throw new Error(SAFE_SAVE_ERROR);
    }
    return {
        document: canonicalizeAccountPreferences(result.preferences),
        revision: result.preferenceRevision,
        storageGeneration: result.storageGeneration
    };
}

function cancelTimer(timer) {
    if (typeof timer === "function")
        timer();
    else if (timer !== null && timer !== undefined)
        globalThis.clearTimeout(timer);
}

function errorCode(error) {
    const errors = Array.isArray(error?.errors) ? error.errors : [];
    return errors[0]?.code ?? error?.code ?? error?.status;
}

function isRetryableNetworkFailure(error) {
    if (error?.retryable === true)
        return true;
    if (error?.name === "AbortError")
        return false;
    if (error?.name === "TypeError" || error?.name === "NetworkError")
        return true;
    if (["NETWORK", "ECONNRESET", "ETIMEDOUT"].includes(errorCode(error)))
        return true;
    return false;
}

export function renderAccountPreferenceStatus(document, detail) {
    const element = document?.querySelector?.("[data-account-preferences-status]");
    if (!element)
        return;
    if (detail?.status === "saving") {
        element.hidden = false;
        element.className = "sr-only";
        element.textContent = ACCOUNT_PREFERENCE_STATUS_MESSAGES.saving;
        return;
    }
    if (detail?.status === "problem") {
        element.hidden = false;
        element.className = "container alert alert-warning mt-2";
        element.textContent = ACCOUNT_PREFERENCE_STATUS_MESSAGES.problem;
        return;
    }
    element.hidden = true;
    element.className = "sr-only";
    element.textContent = "";
}

export function createAccountPreferencesStore({
    initialState,
    save = async function() { throw new Error(SAFE_SAVE_ERROR); },
    schedule = (callback, delay) => globalThis.setTimeout(callback, delay),
    onStatus = function() {}
} = {}) {
    let source = normalizeInitialState(initialState);
    let status = source.enabled ? "saved" : "disabled";
    let message = "";
    let version = 0;
    let settledVersion = 0;
    let epoch = 0;
    let timer = null;
    let ready = false;
    let activePromise = null;
    let retryAttempt = 0;
    let retryElapsed = 0;
    let disposed = false;
    const listeners = new Set();

    function snapshot() {
        return {
            account: source.account,
            enabled: source.enabled,
            document: canonicalizeAccountPreferences(source.document),
            revision: source.revision,
            storageGeneration: source.storageGeneration,
            status,
            message
        };
    }

    function notify() {
        const value = snapshot();
        for (const listener of listeners) {
            try { listener(value); }
            catch {}
        }
    }

    function setStatus(nextStatus, nextMessage = "") {
        status = nextStatus;
        message = nextMessage;
        try { onStatus({status, message}); }
        catch {}
        notify();
    }

    function clearScheduled() {
        if (timer !== null)
            cancelTimer(timer);
        timer = null;
    }

    function schedulePerform(delay) {
        clearScheduled();
        ready = false;
        timer = schedule(function() {
            timer = null;
            ready = true;
            void perform();
        }, delay);
    }

    function retryDelay() {
        const proposed = RETRY_DELAYS_MS[retryAttempt];
        if (proposed === undefined)
            return null;
        const remaining = MAX_RETRY_WINDOW_MS - retryElapsed;
        if (remaining <= 0)
            return null;
        return Math.min(proposed, remaining);
    }

    function scheduleSave() {
        schedulePerform(SAVE_DELAY_MS);
    }

    async function perform() {
        if (disposed || !source.enabled || activePromise || !ready || version <= settledVersion)
            return activePromise;
        ready = false;
        const requestEpoch = epoch;
        const requestVersion = version;
        const request = {
            document: canonicalizeAccountPreferences(source.document),
            revision: source.revision,
            storageGeneration: source.storageGeneration
        };
        setStatus("saving");
        let saveOperation;
        try {
            saveOperation = save(request);
        }
        catch (error) {
            saveOperation = Promise.reject(error);
        }
        let operation;
        operation = Promise.resolve(saveOperation).then(function(result) {
            if (disposed || requestEpoch !== epoch)
                return;
            const accepted = resultState(result);
            if (accepted.revision <= request.revision ||
                accepted.storageGeneration !== request.storageGeneration)
                throw new Error(SAFE_SAVE_ERROR);
            source = {
                ...source,
                document: version === requestVersion ? accepted.document : source.document,
                revision: accepted.revision,
                storageGeneration: accepted.storageGeneration
            };
            retryAttempt = 0;
            retryElapsed = 0;
            settledVersion = Math.max(settledVersion, requestVersion);
            if (version === requestVersion)
                setStatus("saved");
            else
                setStatus("saving");
        }).catch(function(error) {
            if (disposed || requestEpoch !== epoch)
                return;
            if (version !== requestVersion) {
                settledVersion = Math.max(settledVersion, requestVersion);
                setStatus("saving");
                return;
            }
            const delay = isRetryableNetworkFailure(error) ? retryDelay() : null;
            if (delay !== null) {
                retryAttempt += 1;
                retryElapsed += delay;
                setStatus("problem", SAFE_SAVE_ERROR);
                schedulePerform(delay);
                return;
            }
            settledVersion = Math.max(settledVersion, requestVersion);
            setStatus("problem", SAFE_SAVE_ERROR);
        }).finally(function() {
            if (activePromise === operation)
                activePromise = null;
            if (disposed)
                return;
            if (version > settledVersion && ready)
                void perform();
        });
        activePromise = operation;
        return operation;
    }

    return {
        get: snapshot,
        patch(value) {
            if (disposed || !source.enabled)
                return false;
            const document = canonicalPatch(source.document, value);
            const unchanged = JSON.stringify(document) === JSON.stringify(source.document);
            if (unchanged && status !== "problem")
                return false;
            if (!unchanged)
                source = {...source, document};
            version += 1;
            retryAttempt = 0;
            retryElapsed = 0;
            setStatus("saving");
            scheduleSave();
            return true;
        },
        replace(value) {
            if (disposed)
                return false;
            const nextSource = normalizeInitialState(value);
            if (source.enabled && nextSource.enabled &&
                (nextSource.storageGeneration < source.storageGeneration ||
                    (source.storageGeneration === nextSource.storageGeneration &&
                        (nextSource.revision < source.revision ||
                            (nextSource.revision === source.revision && version > settledVersion))))) {
                return false;
            }
            epoch += 1;
            clearScheduled();
            ready = false;
            version = 0;
            settledVersion = 0;
            retryAttempt = 0;
            retryElapsed = 0;
            source = nextSource;
            setStatus(source.enabled ? "saved" : "disabled");
            return source.enabled;
        },
        subscribe(listener) {
            if (typeof listener !== "function" || disposed)
                return function() {};
            listeners.add(listener);
            return function unsubscribe() { listeners.delete(listener); };
        },
        async flush() {
            if (disposed)
                return;
            clearScheduled();
            if (version > settledVersion)
                ready = true;
            while (!disposed) {
                const pending = activePromise || perform();
                if (!pending)
                    break;
                await pending;
                if (!activePromise && version <= settledVersion)
                    break;
                if (!activePromise && version > settledVersion)
                    ready = true;
            }
        },
        dispose() {
            if (disposed)
                return;
            disposed = true;
            epoch += 1;
            clearScheduled();
            activePromise = null;
            listeners.clear();
        }
    };
}

let pageAccountPreferencesStore = null;

export function setPageAccountPreferencesStore(store) {
    pageAccountPreferencesStore = store || null;
    return pageAccountPreferencesStore;
}

export function getPageAccountPreferencesStore() {
    return pageAccountPreferencesStore;
}

export function readAccountPreferenceContext(document = globalThis.document) {
    const element = document?.querySelector?.("script[data-account-preferences]");
    if (!element)
        return {enabled: false, payload: null, revision: 0, storageGeneration: 0};
    try {
        const value = JSON.parse(element.textContent || "");
        const normalized = normalizeInitialState(value);
        return normalized.account
            ? {
                enabled: normalized.enabled,
                payload: normalized.document,
                revision: normalized.revision,
                storageGeneration: normalized.storageGeneration
            }
            : {enabled: false, payload: null, revision: 0, storageGeneration: 0};
    }
    catch {
        return {enabled: false, payload: null, revision: 0, storageGeneration: 0};
    }
}
