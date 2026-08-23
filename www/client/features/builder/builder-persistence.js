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

export function applySelectedColumns(cookie, statInfo) {
    const selected = cookie ? new Set(cookie.split("-").filter(Boolean)) : null;
    return (statInfo || []).map(function(stat) {
        return {
            ...stat,
            showColumn: selected ? selected.has(stat.short) : Boolean(stat.showColumnDefault)
        };
    });
}

export function readBuilderPersistence({cookies = {}, storage = {}, characterName} = {}) {
    if (!cookies["cookie-consent"]) {
        return {encodedLists: null, selectedList: null, itemsPerPage: 20, columns: null};
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
        itemsPerPage: Number(cookies.ipp || "20"),
        columns: (characterName && cookies[`sc-${characterName}`]) || cookies.sc2 || null
    };
}

export function createBuilderPersistencePlan(state, writtenAt = new Date()) {
    if (!state.hasConsent || state.exceptionEncountered)
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
