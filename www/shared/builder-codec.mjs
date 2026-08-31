import gameStats from "../src/public/js/services/game-stats.js";

const BASE_62_DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const BUILDER_LIST_VERSION = 7;
const RUNE_CHARM_ID = -5;
const ATTRIBUTE_NAMES = [
    "strength", "mind", "dexterity", "constitution", "perception", "spirit"
];
export const LEGACY_SLOT_ORDER = [
    0, 1, 1, 2, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 13, 14, 15,
    15, 16, 16, 17, 18, 19, 20, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21
];
export const SLOT_ORDER = [
    0, 1, 1, 2, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 13, 14,
    15, 15, 15, 16, 16, 17, 18, 19, 20, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21
];
const EMPTY_RUNE_CHARMS = {
    charm1: "AAAAA", charm2: "AAAAA", charm3: "AAAAA", charm4: "AAAAA"
};
const LEGACY_RUNE_CHARM_ITEM_INDEX = {
    3: "charm1", 4: "charm2", 14: "charm3", 15: "charm4"
};
const RUNE_CHARM_ITEM_INDEX = {
    3: "charm1", 4: "charm2", 15: "charm3", 16: "charm4"
};

export function fromBase62(number, minLength) {
    if (!Number.isFinite(Number(number)) || number === null)
        number = 0;
    const negative = number < 0;
    let residual = Math.floor(Math.abs(number));
    let result = "";
    do {
        result = BASE_62_DIGITS[residual % BASE_62_DIGITS.length] + result;
        residual = Math.floor(residual / BASE_62_DIGITS.length);
    } while (residual > 0);
    result = result.padStart(minLength || 0, "0");
    return negative ? `-${result}` : result;
}

export function toBase62(value) {
    const characters = String(value).split("");
    const negative = characters[0] === "-";
    if (negative)
        characters.shift();
    const number = characters.reduce(function(total, character) {
        return (total * BASE_62_DIGITS.length) + BASE_62_DIGITS.indexOf(character);
    }, 0);
    return negative ? -number : number;
}

function invalidList() {
    throw new Error("Invalid list.");
}

function defaultRanks() {
    return gameStats.getDefaultEraAbilityRanks();
}

function blankItem(index, slotOrder) {
    return {id: 0, slot: slotOrder[index], locked: false};
}

function readLegacyNumber(value) {
    if (value === undefined || value.trim() === "" ||
        (value !== "NaN" && !Number.isFinite(Number(value))))
        invalidList();
    return value === "NaN" ? 0 : Number(value);
}

function readLegacyItem(value, index) {
    const locked = value[0] === "!";
    const id = locked ? value.slice(1) : value;
    if (id.trim() === "" || !Number.isFinite(Number(id)))
        invalidList();
    return {id: Number(id), slot: LEGACY_SLOT_ORDER[index], locked};
}

function decodeLegacy(encoded) {
    const fields = encoded.split("_");
    const [name, variantName = "Original"] = fields.shift().split("!");
    if (!/^[A-Za-z\s\d]+$/.test(name) || !/^[A-Za-z\s\d]+$/.test(variantName))
        invalidList();
    const baseStats = {};
    for (const stat of ATTRIBUTE_NAMES) {
        const value = fields.shift();
        baseStats[stat] = readLegacyNumber(value);
    }
    baseStats.longhouse = readLegacyNumber(fields.shift());
    baseStats.amulet = readLegacyNumber(fields.shift());
    baseStats.hazelnut = readLegacyNumber(fields.shift());
    baseStats.quest_hp = 0;
    baseStats.quest_mana = 0;
    baseStats.quest_move = 0;
    const items = fields.slice(0, LEGACY_SLOT_ORDER.length).map(readLegacyItem);
    while (items.length < LEGACY_SLOT_ORDER.length)
        items.push(blankItem(items.length, LEGACY_SLOT_ORDER));
    return {
        name,
        variants: [{
            name: variantName,
            baseStats,
            ksmStats: Object.fromEntries(ATTRIBUTE_NAMES.map(stat => [stat, 0])),
            eraAbilities: defaultRanks(),
            runeCharms: {...EMPTY_RUNE_CHARMS},
            items
        }]
    };
}

function takeName(encoded) {
    const index = encoded.indexOf("~");
    if (index < 0)
        invalidList();
    const value = encoded.slice(0, index);
    if (!/^[A-Za-z\s\d]+$/.test(value))
        invalidList();
    return [value, encoded.slice(index + 1)];
}

function takeBase62(encoded, length) {
    const width = encoded[0] === "-" ? length + 1 : length;
    const value = encoded.slice(0, width);
    if (!(new RegExp(`^-?[0-9A-Za-z]{${length}}$`)).test(value))
        invalidList();
    return [toBase62(value), encoded.slice(width)];
}

function takeSelection(encoded) {
    const value = encoded[0];
    if (!/^[0-9A-Za-z_]$/.test(value))
        invalidList();
    return [value === "_" ? -1 : toBase62(value), encoded.slice(1)];
}

function decodeCompact(encoded, version) {
    const slotOrder = version >= 7 ? SLOT_ORDER : LEGACY_SLOT_ORDER;
    const runeCharmItemIndex = version >= 7
        ? RUNE_CHARM_ITEM_INDEX
        : LEGACY_RUNE_CHARM_ITEM_INDEX;
    let name;
    let variantName;
    [name, encoded] = takeName(encoded);
    [variantName, encoded] = takeName(encoded);
    const baseStats = {};
    const ksmStats = {};

    for (const stat of ATTRIBUTE_NAMES) {
        [baseStats[stat], encoded] = takeBase62(encoded, 2);
    }
    for (const stat of ATTRIBUTE_NAMES) {
        [ksmStats[stat], encoded] = takeBase62(encoded, 1);
    }

    [baseStats.longhouse, encoded] = takeSelection(encoded);
    [baseStats.amulet, encoded] = takeSelection(encoded);
    if (version >= 3)
        [baseStats.hazelnut, encoded] = takeSelection(encoded);
    else
        baseStats.hazelnut = 5;
    baseStats.quest_hp = 0;
    baseStats.quest_mana = 0;
    baseStats.quest_move = 0;

    if (version >= 5) {
        const resources = encoded.slice(0, 9);
        if (!/^[0-9A-Za-z]{9}$/.test(resources))
            invalidList();
        baseStats.quest_hp = toBase62(resources.slice(0, 3));
        baseStats.quest_mana = toBase62(resources.slice(3, 6));
        baseStats.quest_move = toBase62(resources.slice(6, 9));
        encoded = encoded.slice(9);
    }

    const eraAbilities = defaultRanks();
    if (version >= 6) {
        const abilities = gameStats.getEraAbilities();
        const ranks = encoded.slice(0, abilities.length);
        if (!(new RegExp(`^[0-9A-Za-z]{${abilities.length}}$`)).test(ranks))
            invalidList();
        abilities.forEach(function(ability, index) {
            const rank = toBase62(ranks[index]);
            if (rank > ability.maxRank)
                invalidList();
            eraAbilities[ability.key] = rank;
        });
        encoded = encoded.slice(abilities.length);
    }

    const runeCharms = {...EMPTY_RUNE_CHARMS};
    const items = [];
    while (encoded.length > 0) {
        const index = items.length;
        if (version >= 5 && index >= slotOrder.length)
            invalidList();
        let locked = false;
        if (encoded[0] === ".") {
            locked = true;
            encoded = encoded.slice(1);
        }
        if (!encoded)
            invalidList();
        if (encoded[0] === "_") {
            items.push({...blankItem(index, slotOrder), locked});
            encoded = encoded.slice(1);
        } else if (encoded[0] === "-") {
            if (encoded.length < 6 || (version >= 5 && !/^-[A-Y]{5}/.test(encoded)))
                invalidList();
            items.push({id: RUNE_CHARM_ID, slot: slotOrder[index], locked});
            const charmSlot = runeCharmItemIndex[index];
            if (charmSlot)
                runeCharms[charmSlot] = encoded.slice(1, 6);
            encoded = encoded.slice(6);
        } else {
            if (!/^[0-9A-Za-z]{3}/.test(encoded))
                invalidList();
            items.push({id: toBase62(encoded.slice(0, 3)), slot: slotOrder[index], locked});
            encoded = encoded.slice(3);
        }
    }
    if (version >= 5 && items.length !== slotOrder.length)
        invalidList();
    if (items.length > slotOrder.length)
        invalidList();
    while (items.length < slotOrder.length)
        items.push(blankItem(items.length, slotOrder));

    return {
        name,
        variants: [{name: variantName, baseStats, ksmStats, eraAbilities, runeCharms, items}]
    };
}

function upgradeLegacyItems(items) {
    const upgraded = items.map(item => ({...item}));
    upgraded.splice(12, 0, {id: 0, slot: 10, locked: false});
    upgraded.splice(20, 0, {id: 0, slot: 15, locked: false});
    return upgraded;
}

function mergeVariant(lists, decoded) {
    const current = lists.find(list => list.name === decoded.name);
    if (current)
        current.variants.push(decoded.variants[0]);
    else
        lists.push(decoded);
}

export function readBuilderFormatVersion(value) {
    const match = String(value).match(/^(\d+)\*/);
    return match ? Number(match[1]) : null;
}

function decodeEntries(value) {
    if (!value)
        return [];
    let encoded = value;
    const version = readBuilderFormatVersion(encoded);
    if (version !== null)
        encoded = encoded.slice(encoded.indexOf("*") + 1);
    if (version !== null && (version < 1 || version > BUILDER_LIST_VERSION))
        invalidList();

    const entries = [];
    for (const listString of encoded.split("*").filter(Boolean)) {
        let decoded;
        if (version === 1)
            decoded = decodeLegacy(listString);
        else if (version > 1)
            decoded = decodeCompact(listString, version);
        else {
            try {
                decoded = decodeCompact(listString, 2);
            } catch (error) {
                decoded = decodeLegacy(listString);
            }
        }
        if (version === null || version <= 6)
            decoded.variants[0].items = upgradeLegacyItems(decoded.variants[0].items);
        entries.push(decoded);
    }
    return entries;
}

export function decodeBuilderEntries(value) {
    return decodeEntries(value);
}

export function decodeBuilderLists(value) {
    const lists = [];
    for (const decoded of decodeEntries(value))
        mergeVariant(lists, decoded);
    return lists;
}

export function encodeBuilderVariant(listName, list) {
    let encoded = `${listName}~${list.name}~`;
    for (const stat of ATTRIBUTE_NAMES)
        encoded += fromBase62(list.baseStats[stat], 2);
    for (const stat of ATTRIBUTE_NAMES)
        encoded += fromBase62(list.ksmStats[stat], 1);
    for (const selection of ["longhouse", "amulet", "hazelnut"])
        encoded += list.baseStats[selection] >= 0 ? fromBase62(list.baseStats[selection], 1) : "_";
    for (const resource of ["quest_hp", "quest_mana", "quest_move"])
        encoded += fromBase62(gameStats.normalizeQuestResourceBonus(list.baseStats[resource]), 3);
    const ranks = gameStats.normalizeEraAbilityRanks(list.eraAbilities);
    for (const ability of gameStats.getEraAbilities())
        encoded += fromBase62(ranks[ability.key], 1);

    list.items.forEach(function(item, index) {
        const locked = item.locked ? "." : "";
        if (item.id > 0)
            encoded += `${locked}${fromBase62(item.id, 3)}`;
        else if (item.id === RUNE_CHARM_ID) {
            const charmSlot = RUNE_CHARM_ITEM_INDEX[index];
            const charm = charmSlot ? list.runeCharms[charmSlot] : "AAAAA";
            encoded += charm === "AAAAA" ? `${locked}_` : `${locked}-${charm}`;
        } else
            encoded += `${locked}_`;
    });
    return encoded;
}

export function encodeBuilderLists(lists) {
    let encoded = `${BUILDER_LIST_VERSION}*`;
    for (const list of lists) {
        for (const variant of list.variants)
            encoded += `${encodeBuilderVariant(list.name, variant)}*`;
    }
    return encoded;
}
