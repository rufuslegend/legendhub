"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

async function loadEncoding() {
    return import("../../client/features/builder/builder-encoding.js");
}

async function loadSharedCodec() {
    return import("../../shared/builder-codec.mjs");
}

async function loadReducer() {
    return import("../../client/features/builder/builder-reducer.js");
}

const blanks29 = "_".repeat(29);
const blanks35 = "_".repeat(35);
const baseStats = "0U0U0U0U0U0U";

function compactItems(count, itemIndex, token) {
    const items = Array(count).fill("_");
    items[itemIndex] = token;
    return items.join("");
}

const fixtures = [
    {
        label: "unversioned legacy",
        encoded: "Legacy!Original_30_30_30_30_30_30_-1_-1_-1_101_" +
            Array(34).fill("0").join("_"),
        name: "Legacy",
        itemId: 101,
        itemIndex: 0
    },
    {
        label: "version 1 legacy",
        encoded: "1*One!Original_30_30_30_30_30_30_-1_-1_-1_0_202_" +
            Array(33).fill("0").join("_"),
        name: "One",
        itemId: 202,
        itemIndex: 1
    },
    {
        label: "version 2 compact",
        encoded: `2*Two~Original~${baseStats}000000__${compactItems(29, 5, "03G")}`,
        name: "Two",
        itemId: 202,
        itemIndex: 5
    },
    {
        label: "version 3 compact",
        encoded: `3*Three~Original~${baseStats}000000___${compactItems(35, 11, "04t")}`,
        name: "Three",
        itemId: 303,
        itemIndex: 11
    },
    {
        label: "version 4 compact",
        encoded: `4*Four~Original~${baseStats}000000___${compactItems(35, 16, "06W")}`,
        name: "Four",
        itemId: 404,
        itemIndex: 16
    },
    {
        label: "version 5 quest resources",
        encoded: `5*Five~Original~${baseStats}000000___00H00N04q${blanks35.slice(0, 7)}0D2${blanks35.slice(8)}`,
        name: "Five",
        itemId: 808,
        itemIndex: 7,
        resources: {quest_hp: 17, quest_mana: 23, quest_move: 300}
    },
    {
        label: "version 6 era abilities",
        encoded: `6*Six~Original~${baseStats}000000___00H00N04q25431123${blanks35.slice(0, 3)}.0IS${blanks35.slice(4)}`,
        name: "Six",
        itemId: 1144,
        itemIndex: 3,
        locked: true,
        expectedHp: 428,
        resources: {quest_hp: 17, quest_mana: 23, quest_move: 300},
        eraAbilities: {
            mentalEnhancement: 2,
            arcaneFocus: 5,
            hardenedSkin: 4,
            increasedPotential: 3,
            physicalEnhancement: 1,
            weaponFocus: 1,
            innateRegeneration: 2,
            physicalEndurance: 3
        }
    }
];

// Catches the client compatibility layer diverging from the server's source of truth
// for any deployed import format.
test("shared Builder codec matches the client compatibility module for every supported version", async function() {
    const compatibility = await loadEncoding();
    const shared = await loadSharedCodec();

    for (const fixture of fixtures) {
        const compatibilityDecoded = compatibility.decodeBuilderLists(fixture.encoded);
        const sharedDecoded = shared.decodeBuilderLists(fixture.encoded);
        assert.deepEqual(sharedDecoded, compatibilityDecoded, fixture.label);
        assert.equal(
            shared.encodeBuilderLists(sharedDecoded),
            compatibility.encodeBuilderLists(compatibilityDecoded),
            fixture.label
        );
    }
});

// Catches removal or field-shifting in any deployed Builder encoding and proves every decoded fixture remains calculable.
test("builder decodes every supported list version with stable items and derived totals", async function() {
    const {decodeBuilderLists} = await loadEncoding();
    const {selectStatTotal} = await loadReducer();

    for (const fixture of fixtures) {
        const lists = decodeBuilderLists(fixture.encoded);
        const variant = lists[0].variants[0];
        assert.equal(lists[0].name, fixture.name, fixture.label);
        assert.equal(variant.name, "Original", fixture.label);
        assert.equal(variant.items.length, 35, fixture.label);
        assert.equal(variant.items[fixture.itemIndex].id, fixture.itemId, fixture.label);
        assert.equal(Boolean(variant.items[fixture.itemIndex].locked), Boolean(fixture.locked), fixture.label);
        assert.deepEqual(
            {
                quest_hp: variant.baseStats.quest_hp,
                quest_mana: variant.baseStats.quest_mana,
                quest_move: variant.baseStats.quest_move
            },
            fixture.resources || {quest_hp: 0, quest_mana: 0, quest_move: 0},
            fixture.label
        );
        assert.equal(
            selectStatTotal({selectedList: variant}, "hp"),
            fixture.expectedHp || (fixture.resources ? 398 : 381),
            fixture.label
        );
    }
});

// Catches an encoder that writes a shape the decoder cannot consume or whose canonical output changes after one round trip.
test("every supported fixture upgrades to a stable version-6 round trip", async function() {
    const {decodeBuilderLists, encodeBuilderLists} = await loadEncoding();

    for (const fixture of fixtures) {
        const decoded = decodeBuilderLists(fixture.encoded);
        const encoded = encodeBuilderLists(decoded);
        const roundTripped = decodeBuilderLists(encoded);
        assert.deepEqual(roundTripped, decoded, fixture.label);
        assert.equal(encodeBuilderLists(roundTripped), encoded, fixture.label);
        assert.match(encoded, /^6\*/);
    }
});

// Catches symmetric encoder/decoder defects by comparing every variable-width v6 field with an independently derived literal.
test("builder encoding emits the canonical literal v6 payload", async function() {
    const {encodeBuilderLists} = await loadEncoding();
    const {createDefaultVariant} = await loadReducer();
    const variant = createDefaultVariant("Variant");
    Object.assign(variant.baseStats, {
        strength: 30, mind: 31, dexterity: 32,
        constitution: 33, perception: 34, spirit: 35,
        longhouse: 2, amulet: 3, hazelnut: 4,
        quest_hp: 17, quest_mana: 23, quest_move: 300
    });
    Object.assign(variant.ksmStats, {
        strength: -1, mind: 1, dexterity: -2,
        constitution: 2, perception: -3, spirit: 3
    });
    Object.assign(variant.eraAbilities, {
        mentalEnhancement: 2, arcaneFocus: 5, hardenedSkin: 4,
        increasedPotential: 3, physicalEnhancement: 1, weaponFocus: 1,
        innateRegeneration: 2, physicalEndurance: 3
    });
    variant.items[0] = {id: 1144, slot: 0, locked: true};
    variant.items[3] = {id: -5, slot: 2, locked: true};
    variant.runeCharms.charm1 = "BCDEF";

    assert.equal(
        encodeBuilderLists([{name: "Hero", variants: [variant]}]),
        "6*Hero~Variant~0U0V0W0X0Y0Z-11-22-3323400H00N04q25431123" +
            ".0IS__.-BCDEF_______________________________*"
    );
});

// Catches grouping logic that drops or merges same-character variants during import/export.
test("builder preserves representative character variants in one encoded collection", async function() {
    const {decodeBuilderLists, encodeBuilderLists} = await loadEncoding();
    const input = `6*Hero~Tank~${baseStats}000000___00000000000000000${blanks35}*` +
        `Hero~Caster~${baseStats}000000___00000000000000000${blanks35}*`;
    const decoded = decodeBuilderLists(input);

    assert.equal(decoded.length, 1);
    assert.deepEqual(decoded[0].variants.map(variant => variant.name), ["Tank", "Caster"]);
    assert.deepEqual(decodeBuilderLists(encodeBuilderLists(decoded)), decoded);
});

// Catches import preview regrouping that changes the submitted entry order or hides a same-character variant row.
test("builder exposes encoded entries in their original import order", async function() {
    const {decodeBuilderEntries} = await loadEncoding();
    const input = `6*Hero~Tank~${baseStats}000000___00000000000000000${blanks35}*` +
        `Other~Original~${baseStats}000000___00000000000000000${blanks35}*` +
        `Hero~Caster~${baseStats}000000___00000000000000000${blanks35}*`;

    assert.deepEqual(
        decodeBuilderEntries(input).map(list => [list.name, list.variants[0].name]),
        [["Hero", "Tank"], ["Other", "Original"], ["Hero", "Caster"]]
    );
});

// Catches silent acceptance of malformed v5/v6 fixed-width data that shifts the remaining equipment slots.
test("builder rejects malformed fixed-width compact lists", async function() {
    const {decodeBuilderLists} = await loadEncoding();

    assert.throws(
        () => decodeBuilderLists(`5*Broken~Original~${baseStats}000000___000000${blanks35}`),
        /Invalid list/
    );
    assert.throws(
        () => decodeBuilderLists(`6*Broken~Original~${baseStats}000000___000000000000_0000${blanks35}`),
        /Invalid list/
    );
});
