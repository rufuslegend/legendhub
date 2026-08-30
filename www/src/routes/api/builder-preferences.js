"use strict";

const {BadRequestError} = require("./utils");

const THEMES = new Set([
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
const ITEMS_PER_PAGE = new Set([20, 50, 100, 200, 500, 1000]);
const ITEM_COLUMNS = new Set([
    "Slot", "Name", "Light", "Heroic", "Str", "Min", "Dex", "Con",
    "Per", "Spi", "Ac", "Align", "Hp", "Ma", "Mv",
    "Hpr", "Mar", "Mvr", "Hit", "Dam", "SpDam", "SpCrit", "Ma Redux",
    "Concen", "Mit", "Parry", "Shot Acc", "Ammo", "Bonus Acc", "2H",
    "Quality", "Speed", "MaxDam", "AvgDam", "MinDam", "Holdable",
    "Weap Type", "Weap Stat", "Weight", "Unique", "Bonded", "Casts",
    "Level", "Net Stat", "Sell", "Rent", "Str Cap", "Min Cap", "Dex Cap",
    "Con Cap", "Per Cap", "Spi Cap", "Soulbound", "Limited", "MeCritPerc",
    "MeCrit", "MeDamCap", "DmgShield"
]);
const LEGACY_ITEM_COLUMN_ALIASES = new Map([
    ["Accu", "Shot Acc"],
    ["AccuBonus", "Bonus Acc"],
    ["AC", "Ac"],
    ["HP", "Hp"]
]);
const PROFILE_ID = /^[A-Za-z0-9-]{1,64}$/;
const DEFAULT_PREFERENCES = Object.freeze({
    version: 1,
    theme: "dark",
    itemsPerPage: 20,
    itemColumns: Object.freeze([]),
    builderColumns: Object.freeze({}),
    selectedProfileId: null,
    selectedVariant: null
});

function invalidPreferences() {
    return new BadRequestError("The preference payload is invalid.");
}

function parsePayload(payload) {
    let parsed = payload;
    if (typeof payload === "string") {
        try {
            parsed = JSON.parse(payload);
        }
        catch {
            throw invalidPreferences();
        }
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw invalidPreferences();
    return parsed;
}

function knownColumns(value) {
    if (!Array.isArray(value))
        throw invalidPreferences();
    const result = [];
    const seen = new Set();
    for (const column of value) {
        const canonical = LEGACY_ITEM_COLUMN_ALIASES.get(column) || column;
        if (typeof column !== "string" || !column || !ITEM_COLUMNS.has(canonical))
            throw invalidPreferences();
        if (!seen.has(canonical)) {
            result.push(canonical);
            seen.add(canonical);
        }
    }
    return result;
}

function validProfileId(value) {
    return typeof value === "string" && PROFILE_ID.test(value);
}

function activeIds(options) {
    if (options?.activeProfileIds === undefined)
        return null;
    const ids = options.activeProfileIds;
    if (ids instanceof Set)
        return ids;
    if (Array.isArray(ids))
        return new Set(ids);
    throw new TypeError("Active profile IDs must be a Set or array.");
}

function validatePreferences(payload, options = {}) {
    const input = parsePayload(payload);
    if (input.version !== undefined && input.version !== 1)
        throw invalidPreferences();
    if (input.theme !== undefined && !THEMES.has(input.theme))
        throw invalidPreferences();
    if (input.itemsPerPage !== undefined && !ITEMS_PER_PAGE.has(input.itemsPerPage))
        throw invalidPreferences();

    const itemColumns = input.itemColumns === undefined
        ? []
        : knownColumns(input.itemColumns);
    const ids = activeIds(options);
    const builderColumns = {};
    if (input.builderColumns !== undefined) {
        if (!input.builderColumns || typeof input.builderColumns !== "object" ||
            Array.isArray(input.builderColumns) ||
            ![Object.prototype, null].includes(Object.getPrototypeOf(input.builderColumns))) {
            throw invalidPreferences();
        }
        for (const [profileId, columns] of Object.entries(input.builderColumns)) {
            if (!validProfileId(profileId))
                throw invalidPreferences();
            const validatedColumns = knownColumns(columns);
            if (!ids || ids.has(profileId))
                builderColumns[profileId] = validatedColumns;
        }
    }

    if (input.selectedProfileId !== undefined && input.selectedProfileId !== null &&
        !validProfileId(input.selectedProfileId)) {
        throw invalidPreferences();
    }
    if (input.selectedVariant !== undefined && input.selectedVariant !== null &&
        (typeof input.selectedVariant !== "string" || !input.selectedVariant ||
        input.selectedVariant.length > 255)) {
        throw invalidPreferences();
    }
    const selectedProfileId = input.selectedProfileId &&
        (!ids || ids.has(input.selectedProfileId))
        ? input.selectedProfileId
        : null;
    const selectedVariant = selectedProfileId && typeof input.selectedVariant === "string"
        ? input.selectedVariant
        : null;

    return {
        version: 1,
        theme: input.theme || DEFAULT_PREFERENCES.theme,
        itemsPerPage: input.itemsPerPage || DEFAULT_PREFERENCES.itemsPerPage,
        itemColumns,
        builderColumns,
        selectedProfileId,
        selectedVariant
    };
}

module.exports = {DEFAULT_PREFERENCES, validatePreferences};
