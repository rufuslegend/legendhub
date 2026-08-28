import {
    decodeBuilderEntries,
    encodeBuilderLists,
    readBuilderFormatVersion
} from "./builder-encoding.js";

const ITEMS_PER_PAGE = new Set([20, 50, 100, 200, 500, 1000]);
const THEMES = new Set([
    "light", "dark", "solarized-dark", "high-contrast", "glass-blue",
    "glass-emerald", "glass-ruby", "glass-amethyst", "glass-amber"
]);
const ITEM_COLUMNS = new Set([
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
const LEGACY_ITEM_COLUMN_ALIASES = new Map([
    ["Accu", "Shot Acc"], ["AccuBonus", "Bonus Acc"], ["AC", "Ac"],
    ["HP", "Hp"]
]);
const DEFAULT_ACCOUNT_PREFERENCES = {
    version: 1,
    theme: "glass-blue",
    itemsPerPage: 20,
    itemColumns: [],
    builderColumns: {},
    selectedProfileId: null,
    selectedVariant: null
};
const SAFE_PROFILE_NAME = /^[A-Za-z\d ]{1,255}$/;

export function classifyAnonymousData(snapshot) {
    const value = snapshot?.encodedLists;
    if (typeof value !== "string" || !value)
        return {profiles: [], localRejected: [], encodedLists: encodeBuilderLists([])};
    const version = readBuilderFormatVersion(value);
    const body = version === null ? value : value.slice(value.indexOf("*") + 1);
    const rows = body.split("*").filter(Boolean);
    const profiles = [];
    const localRejected = [];
    rows.forEach(function(row, index) {
        try {
            const decoded = decodeBuilderEntries(version === null ? row : `${version}*${row}`);
            if (decoded.length !== 1)
                throw new Error("Invalid local row.");
            const current = profiles.find(profile => profile.name === decoded[0].name);
            if (current)
                current.variants.push(decoded[0].variants[0]);
            else
                profiles.push(decoded[0]);
        }
        catch {
            localRejected.push({
                name: `Local row ${index + 1}`,
                reason: "Could not be copied."
            });
        }
    });
    return {profiles, localRejected, encodedLists: encodeBuilderLists(profiles)};
}

function localProfileId(index) {
    return `local-${index + 1}`;
}

function selectedIdentity(snapshot, profiles) {
    const [name, variant = ""] = String(snapshot?.selectedList || "").split("!");
    const index = profiles.findIndex(profile => profile.name === name);
    if (index < 0)
        return {selectedProfileId: null, selectedVariant: null};
    const selectedVariant = profiles[index].variants.some(entry => entry.name === variant)
        ? variant
        : profiles[index].variants[0]?.name || null;
    return {selectedProfileId: localProfileId(index), selectedVariant};
}

function canonicalColumns(value) {
    const columns = typeof value === "string"
        ? value.split("-").filter(Boolean)
        : Array.isArray(value) ? value : [];
    const canonical = [];
    const seen = new Set();
    for (const column of columns) {
        const resolved = LEGACY_ITEM_COLUMN_ALIASES.get(column) || column;
        if (typeof column === "string" && ITEM_COLUMNS.has(resolved) && !seen.has(resolved)) {
            seen.add(resolved);
            canonical.push(resolved);
        }
    }
    return canonical;
}

function syncablePreferences(snapshot, profiles) {
    const selected = selectedIdentity(snapshot, profiles);
    const browserBuilderColumns = snapshot?.builderColumns &&
        typeof snapshot.builderColumns === "object" &&
        !Array.isArray(snapshot.builderColumns)
        ? snapshot.builderColumns
        : {};
    const builderColumns = {};
    profiles.forEach(function(profile, index) {
        const columns = canonicalColumns(browserBuilderColumns[profile.name]);
        if (columns.length)
            builderColumns[localProfileId(index)] = columns;
    });
    return {
        version: 1,
        theme: THEMES.has(snapshot?.theme) ? snapshot.theme : DEFAULT_ACCOUNT_PREFERENCES.theme,
        itemsPerPage: ITEMS_PER_PAGE.has(snapshot?.itemsPerPage)
            ? snapshot.itemsPerPage
            : DEFAULT_ACCOUNT_PREFERENCES.itemsPerPage,
        itemColumns: canonicalColumns(snapshot?.itemColumns),
        builderColumns,
        ...selected
    };
}

function canonicalAnonymousData(snapshot) {
    const classified = classifyAnonymousData(snapshot);
    return {
        encodedLists: classified.encodedLists,
        preferences: syncablePreferences(snapshot, classified.profiles)
    };
}

function toHex(buffer) {
    return Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, "0")).join("");
}

function batchIdempotencyKey() {
    const crypto = globalThis.crypto;
    if (!crypto?.randomUUID)
        throw new Error("Secure random identifiers are unavailable.");
    return crypto.randomUUID();
}

function safeNames(value) {
    if (!Array.isArray(value) || !value.every(name => typeof name === "string" && SAFE_PROFILE_NAME.test(name)))
        throw new Error("Builder migration result is invalid.");
    return value.slice();
}

export async function fingerprintAnonymousData(snapshot, crypto = globalThis.crypto) {
    if (!crypto?.subtle?.digest)
        throw new Error("SHA-256 is unavailable.");
    const bytes = new TextEncoder().encode(JSON.stringify(canonicalAnonymousData(snapshot)));
    return toHex(await crypto.subtle.digest("SHA-256", bytes));
}

export function migrationAcknowledgementKey(storageNamespace) {
    return `legendhub-builder-import:${storageNamespace}`;
}

export function writeMigrationAcknowledgement({storage, storageNamespace, fingerprint}) {
    if (!storage || typeof storage.setItem !== "function" ||
        typeof storageNamespace !== "string" || !storageNamespace ||
        typeof fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(fingerprint)) {
        return false;
    }
    try {
        storage.setItem(migrationAcknowledgementKey(storageNamespace), fingerprint);
        return true;
    }
    catch {
        return false;
    }
}

export function shouldOfferMigration({snapshot, fingerprint, acknowledgedFingerprint}) {
    if (typeof fingerprint !== "string" || !fingerprint || fingerprint === acknowledgedFingerprint)
        return false;
    return classifyAnonymousData(snapshot).profiles.length > 0;
}

export function buildImportRequest({snapshot, preferencesChoice, storageGeneration}) {
    const classified = classifyAnonymousData(snapshot);
    const profiles = classified.profiles;
    return {
        profiles: profiles.map((profile, index) => ({
            id: localProfileId(index),
            name: profile.name,
            payload: encodeBuilderLists([profile])
        })),
        preferences: preferencesChoice === "browser"
            ? syncablePreferences(snapshot, profiles)
            : null,
        replacePreferences: preferencesChoice === "browser",
        idempotencyKey: batchIdempotencyKey(),
        storageGeneration,
        localRejected: classified.localRejected
    };
}

export function defaultMigrationPreferencesChoice(accountPreferences, preferenceRevision) {
    if (!accountPreferences || Object.keys(accountPreferences).length === 0)
        return "browser";
    const keys = Object.keys(DEFAULT_ACCOUNT_PREFERENCES);
    const isFreshCanonicalDefault = preferenceRevision === 1 &&
        Object.keys(accountPreferences).length === keys.length &&
        keys.every(key => JSON.stringify(accountPreferences[key]) ===
            JSON.stringify(DEFAULT_ACCOUNT_PREFERENCES[key]));
    return isFreshCanonicalDefault ? "browser" : "account";
}

export function normalizeMigrationResult(value, localRejected = []) {
    let parsed;
    try {
        parsed = typeof value === "string" ? JSON.parse(value) : value;
    }
    catch {
        throw new Error("Builder migration result is invalid.");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
        !Array.isArray(parsed.renamed) ||
        !parsed.renamed.every(entry => entry && typeof entry === "object" &&
            typeof entry.from === "string" && SAFE_PROFILE_NAME.test(entry.from) &&
            typeof entry.to === "string" && SAFE_PROFILE_NAME.test(entry.to)) ||
        !Array.isArray(parsed.rejected) ||
        typeof parsed.preferencesImported !== "boolean") {
        throw new Error("Builder migration result is invalid.");
    }
    return {
        copied: safeNames(parsed.copied),
        renamed: parsed.renamed.map(({from, to}) => ({from, to})),
        deduplicated: safeNames(parsed.deduplicated),
        rejected: [
            ...(Array.isArray(localRejected) ? localRejected : []).map((entry, index) => ({
                name: typeof entry?.name === "string" && SAFE_PROFILE_NAME.test(entry.name)
                    ? entry.name
                    : `Local row ${index + 1}`,
                reason: "Could not be copied."
            })),
            ...parsed.rejected.map((entry, index) => ({
                name: typeof entry?.name === "string" && SAFE_PROFILE_NAME.test(entry.name)
                    ? entry.name
                    : `Server rejection ${index + 1}`,
                reason: "Could not be copied."
            }))
        ],
        preferencesImported: parsed.preferencesImported
    };
}
