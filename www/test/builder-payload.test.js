"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
    renameValidatedBuilderProfile,
    validateBuilderProfile
} = require("../src/routes/api/builder-payload");

const baseStats = "0U0U0U0U0U0U";
const blanks35 = "_".repeat(35);
const legacyHero = "Hero!Original_30_30_30_30_30_30_-1_-1_-1_101_" +
    Array(34).fill("0").join("_");
const encodedHero = `6*Hero~Original~${baseStats}000000___00000000000000000${blanks35}*`;
const twoCharacters = `${legacyHero}*${legacyHero.replace("Hero", "Other")}`;
const multiVariantHero = `6*Hero~Tank~${baseStats}000000___00000000000000000${blanks35}*` +
    `Hero~Caster~${baseStats}000000___00000000000000000${blanks35}*`;

const supportedProfiles = [
    ["unversioned", legacyHero],
    ["format 1", `1*${legacyHero}`],
    ["format 2", `2*Hero~Original~${baseStats}000000__${"_".repeat(29)}`],
    ["format 3", `3*Hero~Original~${baseStats}000000___${blanks35}`],
    ["format 4", `4*Hero~Original~${baseStats}000000___${blanks35}`],
    ["format 5", `5*Hero~Original~${baseStats}000000___000000000${blanks35}`],
    ["format 6", encodedHero]
];

// Catches the server retaining a legacy payload instead of storing current canonical text.
test("server validator canonicalizes one legacy character", async function() {
    const result = await validateBuilderProfile({name: "Hero", payload: legacyHero});
    assert.equal(result.name, "Hero");
    assert.match(result.payload, /^6\*Hero~/);
    assert.equal(result.payloadVersion, 6);
    assert.equal(result.byteLength, Buffer.byteLength(result.payload, "utf8"));
});

// Catches accepting another character in a profile or trusting a separately supplied name.
test("server validator rejects collections and mismatched names", async function() {
    await assert.rejects(validateBuilderProfile({name: "Hero", payload: twoCharacters}), /exactly one character/);
    await assert.rejects(validateBuilderProfile({name: "Other", payload: encodedHero}), /name does not match/);
});

// Catches collapsing valid current-format variants while validating one character profile.
test("server validator retains all current-format variants for one character", async function() {
    const payload = `6*Hero 2~Tank~${baseStats}000000___00000000000000000${blanks35}*` +
        `Hero 2~Caster~${baseStats}000000___00000000000000000${blanks35}*`;
    const result = await validateBuilderProfile({name: "Hero 2", payload});

    assert.deepEqual(result.decoded.variants.map(variant => variant.name), ["Tank", "Caster"]);
    assert.equal(result.payload, payload);
});

// Catches a collision-safe row rename leaving any encoded variant under the
// original character name or retaining the pre-rename byte count.
test("validated profile rename re-encodes every variant canonically", async function() {
    const validated = await validateBuilderProfile({name: "Hero", payload: multiVariantHero});
    const renamed = await renameValidatedBuilderProfile(validated, "Hero Conflict 2");
    const codec = await import("../shared/builder-codec.mjs");

    assert.equal(renamed.name, "Hero Conflict 2");
    assert.deepEqual(codec.decodeBuilderEntries(renamed.payload).map(entry => entry.name), [
        "Hero Conflict 2", "Hero Conflict 2"
    ]);
    assert.deepEqual(renamed.decoded.variants.map(variant => variant.name), ["Tank", "Caster"]);
    assert.equal(renamed.payloadVersion, 6);
    assert.equal(renamed.byteLength, Buffer.byteLength(renamed.payload, "utf8"));
    assert.ok(renamed.byteLength > validated.byteLength);
});

// Catches the server converting truncated or non-numeric legacy/compact fields into zeroes.
test("server validator rejects missing and non-numeric required Builder fields", async function() {
    const truncatedPayloads = [
        "Hero",
        "1*Hero",
        "2*Hero~Original~",
        "3*Hero~Original~",
        "4*Hero~Original~",
        "5*Hero~Original~",
        "6*Hero~Original~"
    ];

    for (const payload of truncatedPayloads)
        await assert.rejects(validateBuilderProfile({name: "Hero", payload}), /Invalid list/);
    await assert.rejects(
        validateBuilderProfile({
            name: "Hero",
            payload: legacyHero.replace("_30_30_30_30_30_30_", "_30_30_30_30_30_not-a-number_")
        }),
        /Invalid list/
    );
    await assert.rejects(
        validateBuilderProfile({
            name: "Hero",
            payload: `2*Hero~Original~${baseStats.replace("0U", "@U")}000000__${"_".repeat(29)}`
        }),
        /Invalid list/
    );
    await assert.rejects(
        validateBuilderProfile({name: "Hero", payload: legacyHero.replace("_101_", "_not-a-number_")}),
        /Invalid list/
    );
});

// Catches server-side acceptance of whitespace that is not a literal ASCII space.
test("server validator limits character names to ASCII letters digits and spaces", async function() {
    for (const name of ["Hero\t", "Hero\n"]) {
        await assert.rejects(
            validateBuilderProfile({name, payload: legacyHero.replace("Hero", name)}),
            /character name/
        );
    }
});

// Catches any variant bypassing the server's literal-space name rule, which
// would let JSON escaping expand an otherwise quota-sized stored payload past
// the route-scoped request limit.
test("server validator applies the literal-space name rule to every variant", async function() {
    const valid = multiVariantHero.replace("Tank", "Tank Build");
    assert.deepEqual(
        (await validateBuilderProfile({name: "Hero", payload: valid}))
            .decoded.variants.map(variant => variant.name),
        ["Tank Build", "Caster"]
    );

    for (const whitespace of ["\t", "\n"]) {
        const invalid = multiVariantHero.replace("Caster", `Caster${whitespace}Private`);
        await assert.rejects(
            validateBuilderProfile({name: "Hero", payload: invalid}),
            /variant name/
        );
    }
});

// Catches hardening the current persistence boundary by dropping a deployed
// import format, or returning canonical text that changes on its own next
// decode/encode cycle.
test("server validator preserves every supported format through a stable canonical round trip", async function() {
    const codec = await import("../shared/builder-codec.mjs");

    for (const [label, payload] of supportedProfiles) {
        const result = await validateBuilderProfile({name: "Hero", payload});
        const decoded = codec.decodeBuilderLists(result.payload);

        assert.equal(result.payloadVersion, 6, label);
        assert.equal(codec.encodeBuilderLists(decoded), result.payload, label);
        assert.deepEqual(
            codec.decodeBuilderLists(codec.encodeBuilderLists(decoded)),
            decoded,
            label
        );
    }
});

// Catches legacy/current values that the preview decoder can read but the v6
// encoder cannot preserve as the same stat, item, or rune-charm state.
test("server validator rejects semantically unrepresentable data in every supported format", async function(t) {
    const v5Items = `${"_".repeat(3)}-AAAAA${"_".repeat(31)}`;
    const cases = [
        ["unversioned fractional stat", legacyHero.replace("_30_", "_30.5_")],
        ["format 1 oversized item ID", `1*${legacyHero.replace("_101_", "_238328_")}`],
        ["format 2 invalid rune charm", `2*Hero~Original~${baseStats}000000_____-ZZZZZ`],
        ["format 3 rune charm in a non-charm slot", `3*Hero~Original~${baseStats}000000___-BCDEF`],
        ["format 4 untrimmed variant", `4*Hero~Original ~${baseStats}000000___${blanks35}`],
        ["format 5 empty rune charm item", `5*Hero~Original~${baseStats}000000___000000000${v5Items}`],
        ["format 6 duplicate variant", multiVariantHero.replace("Caster", "Tank")]
    ];

    for (const [label, payload] of cases) {
        await t.test(label, async function() {
            await assert.rejects(
                validateBuilderProfile({name: "Hero", payload}),
                error => error.extensions?.code === 400
            );
        });
    }
});

// Catches leading/trailing character whitespace or duplicate current variant
// labels diverging from the Builder dialog's trimmed, exact-name uniqueness rules.
test("server validator requires trimmed character and unique variant names", async function() {
    await assert.rejects(
        validateBuilderProfile({
            name: " Hero",
            payload: encodedHero.replaceAll("Hero", " Hero")
        }),
        error => error.extensions?.code === 400
    );
    await assert.rejects(
        validateBuilderProfile({
            name: "Hero",
            payload: multiVariantHero.replace("Caster", "Tank")
        }),
        error => error.extensions?.code === 400
    );
});
