"use strict";

const crypto = require("node:crypto");
const {ImportValidationError} = require("./errors");

const MAX_FILE_BYTES = 256 * 1024;
const INT32_MIN = -(2 ** 31);
const INT32_MAX = (2 ** 31) - 1;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SERVER_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/;

const SLOT_VALUES = new Set([
    "light", "finger", "neck", "body", "head", "face", "legs", "feet",
    "hands", "arms", "shield", "about", "waist", "wrist", "wield", "hold",
    "ear", "arm", "amulet", "aux", "familiar", "other"
]);
const ALIGNMENTS = new Set([
    "none", "good-only", "neutral-only", "evil-only", "non-good",
    "non-neutral", "non-evil"
]);
const WEAPON_TYPES = new Set(["bladed", "piercing", "blunt"]);
const WEAPON_ATTRIBUTES = new Set(["strength", "dexterity", "constitution"]);

const ROOT_KEYS = ["schema_version", "event_type", "submission", "source", "item"];
const SUBMISSION_KEYS = ["id", "submitted_at", "submitted_by"];
const SUBMITTER_KEYS = ["character", "account_id"];
const SOURCE_KEYS = ["server"];
const ITEM_KEYS = [
    "vnum", "name", "slots", "alignment", "flags", "requirements",
    "attributes", "attribute_caps", "resources", "combat", "weapon",
    "economy", "casts", "raw_text"
];
const FLAG_KEYS = [
    "unique_wear", "limited", "heroic", "soulbound", "bonded", "light",
    "holdable", "two_handed"
];
const REQUIREMENT_KEYS = ["level"];
const ATTRIBUTE_KEYS = [
    "strength", "mind", "dexterity", "constitution", "perception", "spirit"
];
const RESOURCE_KEYS = [
    "hp", "mana", "movement", "hp_regen", "mana_regen", "movement_regen"
];
const COMBAT_KEYS = [
    "armor_class", "hitroll", "damroll", "spell_damage", "spell_critical",
    "mana_reduction", "concentration", "mitigation", "parry", "damage_shield",
    "melee_critical_percent", "melee_critical", "melee_damage_cap"
];
const WEAPON_KEYS = [
    "type", "governing_attribute", "accuracy", "ranged_accuracy", "ammo_limit",
    "quality", "speed_factor", "minimum_damage", "maximum_damage", "average_damage"
];
const ECONOMY_KEYS = ["rent", "value", "weight"];

function failure(code, message, path) {
    throw new ImportValidationError(code, message, path ? [path] : []);
}

function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertClosedObject(value, requiredKeys, optionalKeys, path) {
    if (!isObject(value))
        failure("contract_invalid", "The equipment observation is invalid.", path);
    const allowed = new Set([...requiredKeys, ...optionalKeys]);
    for (const key of Object.keys(value)) {
        if (!allowed.has(key))
            failure("contract_invalid", "The equipment observation contains an unknown field.", `${path}.${key}`);
    }
    for (const key of requiredKeys) {
        if (!Object.hasOwn(value, key))
            failure("contract_invalid", "The equipment observation is missing a required field.", `${path}.${key}`);
    }
}

function codePointLength(value) {
    return Array.from(value).length;
}

function assertString(value, path, {minimum = 0, maximum, pattern} = {}) {
    if (typeof value !== "string")
        failure("contract_invalid", "The equipment observation contains invalid text.", path);
    const length = codePointLength(value);
    if (length < minimum || (maximum !== undefined && length > maximum) ||
        (pattern && !pattern.test(value))) {
        failure("contract_invalid", "The equipment observation contains invalid text.", path);
    }
}

function normalizeText(value) {
    return value.trim().normalize("NFC");
}

function assertNormalizedText(value, path, maximum) {
    assertString(value, path);
    const normalized = normalizeText(value);
    if (codePointLength(normalized) < 1 || codePointLength(normalized) > maximum)
        failure("contract_invalid", "The equipment observation contains invalid text.", path);
    return normalized;
}

function assertInt32(value, path, minimum = INT32_MIN) {
    if (!Number.isInteger(value) || value < minimum || value > INT32_MAX)
        failure("contract_invalid", "The equipment observation contains an invalid integer.", path);
}

function validateTimestamp(value, path) {
    assertString(value, path);
    const match = TIMESTAMP_PATTERN.exec(value);
    if (!match)
        failure("contract_invalid", "The equipment observation contains an invalid timestamp.", path);
    const [, year, month, day, hour, minute, second] = match;
    const timestamp = new Date(value);
    if (Number.isNaN(timestamp.getTime()) ||
        timestamp.getUTCFullYear() !== Number(year) ||
        timestamp.getUTCMonth() + 1 !== Number(month) ||
        timestamp.getUTCDate() !== Number(day) ||
        timestamp.getUTCHours() !== Number(hour) ||
        timestamp.getUTCMinutes() !== Number(minute) ||
        timestamp.getUTCSeconds() !== Number(second)) {
        failure("contract_invalid", "The equipment observation contains an invalid timestamp.", path);
    }
    return timestamp;
}

function assertBooleanFields(object, keys, path) {
    assertClosedObject(object, keys, [], path);
    for (const key of keys) {
        if (typeof object[key] !== "boolean")
            failure("contract_invalid", "The equipment observation contains an invalid flag.", `${path}.${key}`);
    }
}

function assertIntegerFields(object, keys, path) {
    assertClosedObject(object, keys, [], path);
    for (const key of keys)
        assertInt32(object[key], `${path}.${key}`);
}

function normalizeEnum(value, values, path, nullable = false) {
    if (nullable && value === null)
        return null;
    assertString(value, path);
    const normalized = normalizeText(value).toLowerCase();
    if (!values.has(normalized))
        failure("contract_invalid", "The equipment observation contains an invalid enum value.", path);
    return normalized;
}

function normalizeSlots(value) {
    if (!Array.isArray(value) || value.length < 1 || value.length > 20)
        failure("contract_invalid", "The equipment observation contains invalid slots.", "item.slots");
    const normalized = [];
    for (let index = 0; index < value.length; ++index)
        normalized.push(normalizeEnum(value[index], SLOT_VALUES, `item.slots.${index}`));
    const unique = [...new Set(normalized)].sort();
    if (unique.includes("other") && unique.length !== 1)
        failure("contract_invalid", "Other cannot be combined with another slot.", "item.slots");
    return unique;
}

function normalizeCasts(value) {
    if (!Array.isArray(value))
        failure("contract_invalid", "The equipment observation contains invalid casts.", "item.casts");
    const normalized = value.map((cast, index) =>
        assertNormalizedText(cast, `item.casts.${index}`, 50));
    return [...new Set(normalized)].sort();
}

function validateWeight(value) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 999.99 ||
        Math.abs((value * 100) - Math.round(value * 100)) > Number.EPSILON * 100) {
        failure("contract_invalid", "The equipment observation contains an invalid weight.", "item.economy.weight");
    }
    return Object.is(value, -0) ? "0.00" : value.toFixed(2);
}

function validateDocument(document) {
    assertClosedObject(document, ROOT_KEYS, [], "$" );
    if (document.schema_version !== 1)
        failure("contract_invalid", "The equipment observation uses an unsupported schema version.", "schema_version");
    if (document.event_type !== "equipment.observed")
        failure("contract_invalid", "The equipment observation uses an unsupported event type.", "event_type");

    assertClosedObject(document.submission, SUBMISSION_KEYS, [], "submission");
    assertString(document.submission.id, "submission.id", {pattern: ID_PATTERN});
    const sourceTimestamp = validateTimestamp(document.submission.submitted_at,
        "submission.submitted_at");
    assertClosedObject(document.submission.submitted_by, ["character"], ["account_id"],
        "submission.submitted_by");
    assertNormalizedText(document.submission.submitted_by.character,
        "submission.submitted_by.character", 60);
    if (Object.hasOwn(document.submission.submitted_by, "account_id"))
        assertNormalizedText(document.submission.submitted_by.account_id,
            "submission.submitted_by.account_id", 128);

    assertClosedObject(document.source, SOURCE_KEYS, [], "source");
    assertString(document.source.server, "source.server", {
        minimum: 1, maximum: 32, pattern: SERVER_PATTERN
    });

    assertClosedObject(document.item, ITEM_KEYS.filter(key => key !== "raw_text"),
        ["raw_text"], "item");
    assertInt32(document.item.vnum, "item.vnum", 0);
    assertNormalizedText(document.item.name, "item.name", 255);
    normalizeSlots(document.item.slots);
    normalizeEnum(document.item.alignment, ALIGNMENTS, "item.alignment");
    assertBooleanFields(document.item.flags, FLAG_KEYS, "item.flags");
    assertIntegerFields(document.item.requirements, REQUIREMENT_KEYS, "item.requirements");
    assertIntegerFields(document.item.attributes, ATTRIBUTE_KEYS, "item.attributes");
    assertIntegerFields(document.item.attribute_caps, ATTRIBUTE_KEYS, "item.attribute_caps");
    assertIntegerFields(document.item.resources, RESOURCE_KEYS, "item.resources");
    assertIntegerFields(document.item.combat, COMBAT_KEYS, "item.combat");
    assertClosedObject(document.item.weapon, WEAPON_KEYS, [], "item.weapon");
    normalizeEnum(document.item.weapon.type, WEAPON_TYPES, "item.weapon.type", true);
    normalizeEnum(document.item.weapon.governing_attribute, WEAPON_ATTRIBUTES,
        "item.weapon.governing_attribute", true);
    for (const key of WEAPON_KEYS.slice(2))
        assertInt32(document.item.weapon[key], `item.weapon.${key}`);
    assertClosedObject(document.item.economy, ECONOMY_KEYS, [], "item.economy");
    assertInt32(document.item.economy.rent, "item.economy.rent");
    assertInt32(document.item.economy.value, "item.economy.value");
    validateWeight(document.item.economy.weight);
    normalizeCasts(document.item.casts);
    if (Object.hasOwn(document.item, "raw_text"))
        assertString(document.item.raw_text, "item.raw_text", {maximum: 65535});
    return sourceTimestamp;
}

function normalizeIntegerObject(object, keys) {
    return Object.fromEntries(keys.map(key => [key, Object.is(object[key], -0) ? 0 : object[key]]));
}

function normalizeItem(item) {
    return {
        vnum: item.vnum,
        name: normalizeText(item.name),
        slots: normalizeSlots(item.slots),
        alignment: normalizeEnum(item.alignment, ALIGNMENTS, "item.alignment"),
        flags: Object.fromEntries(FLAG_KEYS.map(key => [key, item.flags[key]])),
        requirements: normalizeIntegerObject(item.requirements, REQUIREMENT_KEYS),
        attributes: normalizeIntegerObject(item.attributes, ATTRIBUTE_KEYS),
        attribute_caps: normalizeIntegerObject(item.attribute_caps, ATTRIBUTE_KEYS),
        resources: normalizeIntegerObject(item.resources, RESOURCE_KEYS),
        combat: normalizeIntegerObject(item.combat, COMBAT_KEYS),
        weapon: {
            type: normalizeEnum(item.weapon.type, WEAPON_TYPES, "item.weapon.type", true),
            governing_attribute: normalizeEnum(item.weapon.governing_attribute,
                WEAPON_ATTRIBUTES, "item.weapon.governing_attribute", true),
            ...normalizeIntegerObject(item.weapon, WEAPON_KEYS.slice(2))
        },
        economy: {
            rent: Object.is(item.economy.rent, -0) ? 0 : item.economy.rent,
            value: Object.is(item.economy.value, -0) ? 0 : item.economy.value,
            weight: validateWeight(item.economy.weight)
        },
        casts: normalizeCasts(item.casts)
    };
}

function stableValue(value) {
    if (Array.isArray(value))
        return value.map(stableValue);
    if (isObject(value)) {
        return Object.fromEntries(Object.keys(value).sort()
            .map(key => [key, stableValue(value[key])]));
    }
    return value;
}

function stableStringify(value) {
    return JSON.stringify(stableValue(value));
}

function sha256(value) {
    return crypto.createHash("sha256").update(value, "utf8").digest();
}

function decodeUtf8(buffer) {
    if (!Buffer.isBuffer(buffer))
        failure("contract_invalid", "The equipment observation must be a file buffer.");
    if (buffer.length > MAX_FILE_BYTES)
        failure("file_too_large", "The equipment observation exceeds the file-size limit.");
    try {
        return new TextDecoder("utf-8", {fatal: true}).decode(buffer);
    }
    catch (error) {
        failure("invalid_utf8", "The equipment observation is not valid UTF-8.");
    }
}

function parseObservation(buffer) {
    const text = decodeUtf8(buffer);
    let document;
    try {
        document = JSON.parse(text);
    }
    catch (error) {
        failure("invalid_json", "The equipment observation is not valid JSON.");
    }
    const sourceTimestamp = validateDocument(document);
    const canonicalPayload = stableStringify(document);
    const normalizedItem = normalizeItem(document.item);
    return {
        document,
        canonicalPayload,
        payloadHash: sha256(canonicalPayload),
        normalizedItem,
        itemFingerprint: sha256(stableStringify(normalizedItem)),
        sourceTimestamp
    };
}

module.exports = {
    ImportValidationError,
    MAX_FILE_BYTES,
    parseObservation,
    stableStringify
};
