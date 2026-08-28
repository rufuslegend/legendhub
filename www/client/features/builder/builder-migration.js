import {decodeBuilderLists, encodeBuilderLists} from "./builder-encoding.js";

const ITEMS_PER_PAGE = new Set([20, 50, 100, 200, 500, 1000]);
const SAFE_PROFILE_NAME = /^[A-Za-z\d ]{1,255}$/;

function decodedProfiles(snapshot) {
    return decodeBuilderLists(snapshot?.encodedLists);
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

function selectedColumns(snapshot) {
    if (typeof snapshot?.columns !== "string")
        return [];
    return [...new Set(snapshot.columns.split("-").filter(Boolean))];
}

function syncablePreferences(snapshot, profiles) {
    const selected = selectedIdentity(snapshot, profiles);
    const columns = selectedColumns(snapshot);
    return {
        version: 1,
        itemsPerPage: ITEMS_PER_PAGE.has(snapshot?.itemsPerPage)
            ? snapshot.itemsPerPage
            : 20,
        itemColumns: [],
        builderColumns: selected.selectedProfileId && columns.length
            ? {[selected.selectedProfileId]: columns}
            : {},
        ...selected
    };
}

function canonicalAnonymousData(snapshot) {
    const profiles = decodedProfiles(snapshot);
    return {
        encodedLists: encodeBuilderLists(profiles),
        preferences: syncablePreferences(snapshot, profiles)
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

export function shouldOfferMigration({snapshot, fingerprint, acknowledgedFingerprint}) {
    if (typeof fingerprint !== "string" || !fingerprint || fingerprint === acknowledgedFingerprint)
        return false;
    try {
        return decodedProfiles(snapshot).length > 0;
    }
    catch {
        return false;
    }
}

export function buildImportRequest({snapshot, preferencesChoice, storageGeneration}) {
    const profiles = decodedProfiles(snapshot);
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
        storageGeneration
    };
}

export function defaultMigrationPreferencesChoice(accountPreferences) {
    return accountPreferences && Object.keys(accountPreferences).length > 0
        ? "account"
        : "browser";
}

export function normalizeMigrationResult(value) {
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
        !parsed.rejected.every(entry => entry && typeof entry === "object" &&
            typeof entry.name === "string" && SAFE_PROFILE_NAME.test(entry.name)) ||
        typeof parsed.preferencesImported !== "boolean") {
        throw new Error("Builder migration result is invalid.");
    }
    return {
        copied: safeNames(parsed.copied),
        renamed: parsed.renamed.map(({from, to}) => ({from, to})),
        deduplicated: safeNames(parsed.deduplicated),
        rejected: parsed.rejected.map(({name}) => ({name, reason: "Could not be copied."})),
        preferencesImported: parsed.preferencesImported
    };
}
