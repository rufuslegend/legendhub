export const BUILDER_LIST_VERSION = 6;
export const RUNE_CHARM_ID = -5;
export const ITEMS_PER_PAGE_OPTIONS = [20, 50, 100, 200, 500, 1000];
export const ERA_ABILITY_ERAS = ["Ancient", "Medieval", "Industrial"];
export const ATTRIBUTE_NAMES = [
    "strength", "mind", "dexterity", "constitution", "perception", "spirit"
];
export const SLOT_ORDER = [
    0, 1, 1, 2, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 13, 14, 15,
    15, 16, 16, 17, 18, 19, 20, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21
];
export const SLOT_LABELS = ["Light", "Finger", "Neck", "Body", "Head", "Face", "Legs", "Feet", "Hands", "Arms", "Shield", "About", "Waist", "Wrist", "Wield", "Hold", "Ear", "Arm", "Amulet", "Aux", "Familiar", "Other"];
export const SELECT_SHORT_OPTIONS = {
    alignRestriction: ["     ", "G    ", "  N  ", "    E", "  N E", "G   E", "G N  "],
    weaponType: ["", "Bladed", "Piercing", "Blunt"],
    weaponStat: ["", "Str", "Dex", "Con"]
};
export const LONGHOUSE_OPTIONS = [
    "Bear   -- ( +5 spi - +3 min )",
    "Beaver -- ( +5 min - +3 dex )",
    "Eagle  -- ( +5 per / +3 str )",
    "Moose  -- ( +5 str / +3 con )",
    "Snake  -- ( +5 dex / +3 per )",
    "Turtle -- ( +5 con / +3 spi )",
    "Dragon -- ( +5 dex / +3 con )",
    "Hydra  -- ( +5 per / +3 dex )",
    "Wyvern -- ( +5 min / +3 spi )",
    "Beetle -- ( +8 spi )",
    "Falcon -- ( +8 dex )",
    "Sphinx -- ( +8 per )",
    "Merlin -- ( +10 min / -2 dex )"
];
export const AMULET_OPTIONS = [
    "Strength", "Mind", "Dexterity", "Constitution", "Perception", "Spirit"
];
export const HAZELNUT_OPTIONS = [...AMULET_OPTIONS];
export const EMPTY_RUNE_CHARMS = {
    charm1: "AAAAA", charm2: "AAAAA", charm3: "AAAAA", charm4: "AAAAA"
};
export const RUNE_CHARM_ITEM_INDEX = {
    3: "charm1", 4: "charm2", 14: "charm3", 15: "charm4"
};
export const CHARM_OPTIONS = {
    B: {id: "B", label: "1 str", name: "Uruz", stats: [{statVar: "strength", value: 1}, {statVar: "rent", value: 203}]},
    C: {id: "C", label: "1 min", name: "Isa", stats: [{statVar: "mind", value: 1}, {statVar: "rent", value: 203}]},
    D: {id: "D", label: "1 dex", name: "Algiz", stats: [{statVar: "dexterity", value: 1}, {statVar: "rent", value: 203}]},
    E: {id: "E", label: "1 con", name: "Ansuz", stats: [{statVar: "constitution", value: 1}, {statVar: "rent", value: 203}]},
    F: {id: "F", label: "1 per", name: "Mannaz", stats: [{statVar: "perception", value: 1}, {statVar: "rent", value: 203}]},
    G: {id: "G", label: "1 spi", name: "Tiwaz", stats: [{statVar: "spirit", value: 1}, {statVar: "rent", value: 203}]},
    H: {id: "H", label: "2 hit", name: "Eihwaz", stats: [{statVar: "hit", value: 2}, {statVar: "rent", value: 675}]},
    I: {id: "I", label: "2 dam", name: "Ehwaz", stats: [{statVar: "dam", value: 2}, {statVar: "rent", value: 675}]},
    J: {id: "J", label: "1 hit, 1 dam", name: "Laguz", stats: [{statVar: "hit", value: 1}, {statVar: "dam", value: 1}, {statVar: "rent", value: 675}]},
    K: {id: "K", label: "10 hp", name: "Gebo", stats: [{statVar: "hp", value: 10}, {statVar: "rent", value: 450}]},
    L: {id: "L", label: "10 ma", name: "Berkano", stats: [{statVar: "ma", value: 10}, {statVar: "rent", value: 225}]},
    M: {id: "M", label: "10 mv", name: "Raidho", stats: [{statVar: "mv", value: 10}, {statVar: "rent", value: 450}]},
    N: {id: "N", label: "5 mvr", name: "Fehu", stats: [{statVar: "mvr", value: 5}, {statVar: "rent", value: 450}]},
    O: {id: "O", label: "2 mar, 1 mvr", name: "Wunjo", stats: [{statVar: "mar", value: 2}, {statVar: "mvr", value: 1}, {statVar: "rent", value: 450}]},
    P: {id: "P", label: "2 hpr, 1 mvr", name: "Kenaz", stats: [{statVar: "hpr", value: 2}, {statVar: "mvr", value: 1}, {statVar: "rent", value: 450}]},
    Q: {id: "Q", label: "2 bonus accuracy", name: "Perthro", stats: [{statVar: "rangedAccuracy", value: 2}, {statVar: "rent", value: 360}]},
    R: {id: "R", label: "-3 ac", name: "Thurisaz", stats: [{statVar: "ac", value: -3}, {statVar: "rent", value: 95}]},
    S: {id: "S", label: "2 spell crit", name: "Hagalaz", stats: [{statVar: "spellcrit", value: 2}, {statVar: "rent", value: 103}]},
    T: {id: "T", label: "2 spell dam", name: "Nauthiz", stats: [{statVar: "spelldam", value: 2}, {statVar: "rent", value: 675}]},
    U: {id: "U", label: "2 mana reduction", name: "Sowilo", stats: [{statVar: "manaReduction", value: 2}, {statVar: "rent", value: 292}]},
    V: {id: "V", label: "detect invis", name: "Jera", stats: [{statVar: "rent", value: 900}]},
    W: {id: "W", label: "see dark", name: "Dagaz", stats: [{statVar: "rent", value: 900}]},
    X: {id: "X", label: "detect illusion", name: "Othala", stats: [{statVar: "rent", value: 675}]},
    Y: {id: "Y", label: "sneak", name: "Ingwaz", stats: [{statVar: "rent", value: 0}]}
};
