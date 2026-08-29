import {canonicalPreferenceColumns} from "../../lib/account-preferences-store.js";

export const BUILDER_STORAGE_KEYS = {
    currentLists: "cln",
    version2Lists: "cl2",
    version1Lists: "cl1",
    legacyLists: "cl",
    selectedList: "scl"
};

function hasOwn(object, property) {
    return Object.prototype.hasOwnProperty.call(object || {}, property);
}

function readBuilderColumnCookies(cookies) {
    return Object.fromEntries(Object.entries(cookies).flatMap(function([name, value]) {
        if (!name.startsWith("sc-") || name.length <= 3 || typeof value !== "string")
            return [];
        return [[name.slice(3), value]];
    }));
}

export function applySelectedColumns(cookie, statInfo) {
    const selected = cookie
        ? new Set((Array.isArray(cookie) ? cookie : cookie.split("-")).filter(Boolean))
        : null;
    return (statInfo || []).map(function(stat) {
        return {
            ...stat,
            showColumn: selected ? selected.has(stat.short) : Boolean(stat.showColumnDefault)
        };
    });
}

export function accountPreferenceColumns(document, character, statInfo) {
    const profileId = typeof character?.account?.id === "string" && character.account.id
        ? character.account.id
        : null;
    const columns = (profileId && document?.builderColumns?.[profileId]) || document?.itemColumns;
    return applySelectedColumns(columns, statInfo);
}

export function readBuilderPersistence({cookies = {}, storage = {}} = {}) {
    if (!cookies["cookie-consent"]) {
        return {
            encodedLists: null,
            selectedList: null,
            theme: null,
            itemsPerPage: 20,
            itemColumns: null,
            builderColumns: {}
        };
    }

    let encodedLists = storage.cln || null;
    if (!encodedLists && storage.cl2)
        encodedLists = `2*${storage.cl2}`;
    if (!encodedLists && storage.cl1)
        encodedLists = `1*${storage.cl1}`;
    if (!encodedLists && storage.cl)
        encodedLists = storage.cl;

    return {
        encodedLists,
        selectedList: storage.scl || cookies.scl1 || null,
        theme: typeof cookies.theme === "string" ? cookies.theme : null,
        itemsPerPage: Number(cookies.ipp || "20"),
        itemColumns: typeof cookies.sc2 === "string" ? cookies.sc2 : null,
        builderColumns: readBuilderColumnCookies(cookies)
    };
}

export function createBuilderPersistencePlan(state, writtenAt = new Date()) {
    if (state.storageMode === "account" || !state.hasConsent || state.exceptionEncountered)
        return null;

    const expires = new Date(writtenAt);
    expires.setFullYear(expires.getFullYear() + 20);
    const options = {path: "/", samesite: "lax", secure: true, expires};

    return {
        storage: {
            cln: state.encodedLists,
            scl: `${state.selectedCharacter}!${state.selectedVariant}`
        },
        cookies: [
            {name: "ipp", value: String(state.itemsPerPage), options: {...options}},
            {
                name: `sc-${state.selectedCharacter}`,
                value: `${state.selectedColumns.join("-")}${state.selectedColumns.length ? "-" : ""}`,
                options: {...options}
            }
        ],
        removeCookies: ["cl1", "scl1"]
    };
}

export function createBuilderAccountPreferencePatch({
    document,
    character,
    variant,
    itemsPerPage,
    selectedColumns
}) {
    const profileId = typeof character?.account?.id === "string" && character.account.id
        ? character.account.id
        : null;
    const builderColumns = {...(document?.builderColumns || {})};
    if (profileId)
        builderColumns[profileId] = canonicalPreferenceColumns(selectedColumns, {tolerant: true});
    return {
        itemsPerPage,
        builderColumns,
        selectedProfileId: profileId,
        selectedVariant: profileId && typeof variant?.name === "string" && variant.name
            ? variant.name
            : null
    };
}

export function applyBuilderPersistencePlan(plan, {cookies, storage}) {
    if (!plan)
        return;
    for (const [key, value] of Object.entries(plan.storage))
        storage.setItem(key, value);
    for (const cookie of plan.cookies)
        cookies.put(cookie.name, cookie.value, cookie.options);
    for (const name of plan.removeCookies) {
        if (cookies.get(name))
            cookies.remove(name);
    }
}

export function calculateStorageSize(storage) {
    let total = 0;
    for (const key in storage) {
        if (hasOwn(storage, key) && typeof storage[key] === "string")
            total += (storage[key].length + key.length) * 2;
    }
    return total;
}

export function formatStorageSize(size) {
    if (!size)
        return "";
    const percent = size / 10485760;
    let label = "B";
    if (size > 1024) {
        size /= 1024;
        label = "KB";
        if (size > 1024) {
            size /= 1024;
            label = "MB";
        }
    }
    return `Storage Size: ${size.toFixed(2)}${label}/10MB ${percent.toFixed(2)}%`;
}
