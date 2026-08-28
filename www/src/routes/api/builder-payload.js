"use strict";

const {isDeepStrictEqual} = require("node:util");
const gameStats = require("../../public/js/services/game-stats");
const {BadRequestError} = require("./utils");

let codecPromise;
const characterName = /^[A-Za-z0-9 ]+$/;
const runeCharm = /^[A-Y]{5}$/;
const ATTRIBUTE_NAMES = [
    "strength", "mind", "dexterity", "constitution", "perception", "spirit"
];
const SLOT_ORDER = [
    0, 1, 1, 2, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 13, 14, 15,
    15, 16, 16, 17, 18, 19, 20, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21
];
const RUNE_CHARM_ID = -5;
const RUNE_CHARM_ITEM_INDEX = new Map([
    [3, "charm1"], [4, "charm2"], [14, "charm3"], [15, "charm4"]
]);
const MAX_BASE_STAT = (62 ** 2) - 1;
const MAX_KSM_STAT = 61;
const MAX_COMPACT_ITEM = (62 ** 3) - 1;

function loadCodec() {
    codecPromise ||= import("../../../shared/builder-codec.mjs");
    return codecPromise;
}

function invalidProfile() {
    return new BadRequestError("The Builder profile is invalid.");
}

function validateCharacterName(name) {
    if (typeof name !== "string" || name !== name.trim() || !characterName.test(name))
        throw new BadRequestError("A character name may contain only letters, digits, and spaces.");
}

function validateVariantNames(variants) {
    if (!Array.isArray(variants) || variants.length === 0)
        throw new BadRequestError("A variant name may contain only letters, digits, and spaces.");

    const names = new Set();
    for (const variant of variants) {
        const name = variant?.name;
        if (typeof name !== "string" || name !== name.trim() ||
            !characterName.test(name) || names.has(name)) {
            throw new BadRequestError("A variant name may contain only letters, digits, and spaces.");
        }
        names.add(name);
    }
}

function integerInRange(value, minimum, maximum) {
    return Number.isInteger(value) && value >= minimum && value <= maximum;
}

function validateRepresentableStats(variant) {
    if (!variant?.baseStats || !variant.ksmStats)
        throw invalidProfile();

    for (const stat of ATTRIBUTE_NAMES) {
        if (!integerInRange(variant.baseStats[stat], -MAX_BASE_STAT, MAX_BASE_STAT) ||
            !integerInRange(variant.ksmStats[stat], -MAX_KSM_STAT, MAX_KSM_STAT)) {
            throw invalidProfile();
        }
    }
    for (const selection of ["longhouse", "amulet", "hazelnut"]) {
        if (!integerInRange(variant.baseStats[selection], -1, MAX_KSM_STAT))
            throw invalidProfile();
    }
    for (const resource of ["quest_hp", "quest_mana", "quest_move"]) {
        if (!integerInRange(variant.baseStats[resource], 0, MAX_COMPACT_ITEM))
            throw invalidProfile();
    }
    for (const ability of gameStats.getEraAbilities()) {
        if (!integerInRange(variant.eraAbilities?.[ability.key], 0, ability.maxRank))
            throw invalidProfile();
    }
}

function validateRepresentableItems(variant) {
    if (!Array.isArray(variant?.items) || variant.items.length !== SLOT_ORDER.length ||
        !variant.runeCharms || typeof variant.runeCharms !== "object") {
        throw invalidProfile();
    }

    for (let index = 0; index < variant.items.length; index += 1) {
        const item = variant.items[index];
        if (!item || item.slot !== SLOT_ORDER[index] || typeof item.locked !== "boolean")
            throw invalidProfile();

        if (item.id === RUNE_CHARM_ID) {
            const charmSlot = RUNE_CHARM_ITEM_INDEX.get(index);
            const charm = charmSlot && variant.runeCharms[charmSlot];
            if (!charmSlot || charm === "AAAAA" || !runeCharm.test(charm))
                throw invalidProfile();
        }
        else if (item.id !== 0 && !integerInRange(item.id, 1, MAX_COMPACT_ITEM)) {
            throw invalidProfile();
        }
    }

    for (const [index, charmSlot] of RUNE_CHARM_ITEM_INDEX) {
        const charm = variant.runeCharms[charmSlot];
        if (typeof charm !== "string" || !runeCharm.test(charm) ||
            (variant.items[index].id === RUNE_CHARM_ID) !== (charm !== "AAAAA")) {
            throw invalidProfile();
        }
    }
}

function canonicalize(codec, lists) {
    try {
        const canonical = codec.encodeBuilderLists(lists);
        const decoded = codec.decodeBuilderLists(canonical);
        if (!isDeepStrictEqual(decoded, lists) ||
            codec.encodeBuilderLists(decoded) !== canonical) {
            throw invalidProfile();
        }
        return canonical;
    }
    catch (error) {
        if (error instanceof BadRequestError)
            throw error;
        throw invalidProfile();
    }
}

async function validateBuilderProfile({name, payload}) {
    validateCharacterName(name);
    const codec = await loadCodec();
    const lists = codec.decodeBuilderLists(payload);
    if (lists.length !== 1)
        throw new BadRequestError("A profile must contain exactly one character.");
    if (!characterName.test(lists[0].name) || lists[0].name !== name)
        throw new BadRequestError("The encoded character name does not match.");
    validateVariantNames(lists[0].variants);
    for (const variant of lists[0].variants) {
        validateRepresentableStats(variant);
        validateRepresentableItems(variant);
    }
    const canonical = canonicalize(codec, lists);
    return {
        name,
        payload: canonical,
        payloadVersion: codec.readBuilderFormatVersion(canonical),
        byteLength: Buffer.byteLength(canonical),
        decoded: lists[0]
    };
}

async function renameValidatedBuilderProfile(validated, name) {
    validateCharacterName(name);
    if (!validated?.decoded || validated.decoded.name !== validated.name ||
        !Array.isArray(validated.decoded.variants)) {
        throw new BadRequestError("A validated Builder profile is required.");
    }
    const codec = await loadCodec();
    const payload = codec.encodeBuilderLists([{
        ...validated.decoded,
        name
    }]);
    return validateBuilderProfile({name, payload});
}

module.exports.renameValidatedBuilderProfile = renameValidatedBuilderProfile;
module.exports.validateBuilderProfile = validateBuilderProfile;
