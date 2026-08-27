"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {validateBuilderProfile} = require("../src/routes/api/builder-payload");

const baseStats = "0U0U0U0U0U0U";
const blanks35 = "_".repeat(35);
const legacyHero = "Hero!Original_30_30_30_30_30_30_-1_-1_-1_101_" +
    Array(34).fill("0").join("_");
const encodedHero = `6*Hero~Original~${baseStats}000000___00000000000000000${blanks35}*`;
const twoCharacters = `${legacyHero}*${legacyHero.replace("Hero", "Other")}`;

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
