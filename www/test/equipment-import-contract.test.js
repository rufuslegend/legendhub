"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
    MAX_FILE_BYTES,
    ImportValidationError,
    parseObservation
} = require("../src/equipment-importer/contract");

const fixturePath = path.join(__dirname, "..", "test-fixtures", "equipment-spool", "valid.json");

function fixtureBuffer() {
    return fs.readFileSync(fixturePath);
}

function fixtureDocument() {
    return JSON.parse(fixtureBuffer().toString("utf8"));
}

function parseDocument(document) {
    return parseObservation(Buffer.from(JSON.stringify(document)));
}

function invalid(document, code = "contract_invalid") {
    assert.throws(() => parseDocument(document), function(error) {
        assert.equal(error instanceof ImportValidationError, true);
        assert.equal(error.code, code);
        assert.equal(Array.isArray(error.paths), true);
        return true;
    });
}

test("parses and fingerprints the live-sample-shaped v1 observation", () => {
    const parsed = parseObservation(fixtureBuffer());
    assert.equal(parsed.document.item.name, "Cuchullain's shield");
    assert.equal(parsed.normalizedItem.economy.weight, "10.00");
    assert.equal(parsed.payloadHash.length, 32);
    assert.equal(parsed.itemFingerprint.length, 32);
    assert.equal(parsed.sourceTimestamp.toISOString(), "2026-08-31T22:23:03.000Z");
});

test("optional mitigation cap modifiers affect item identity while omitted and zero stay compatible", () => {
    const document = fixtureDocument();
    const original = parseDocument(document);
    document.item.combat.mitigation_cap = 0;
    assert.deepEqual(parseDocument(document).itemFingerprint, original.itemFingerprint);
    for (const modifier of [5, -10]) {
        document.item.combat.mitigation_cap = modifier;
        const parsed = parseDocument(document);
        assert.equal(parsed.normalizedItem.combat.mitigation_cap, modifier);
        assert.notDeepEqual(parsed.itemFingerprint, original.itemFingerprint);
    }
    for (const invalidValue of [null, "5", 1.5, 2147483648, -2147483649]) {
        document.item.combat.mitigation_cap = invalidValue;
        invalid(document);
    }
});

test("payload hashing ignores object key order and insignificant whitespace", () => {
    const document = fixtureDocument();
    const reordered = {
        item: document.item,
        source: document.source,
        submission: document.submission,
        event_type: document.event_type,
        schema_version: document.schema_version
    };
    assert.deepEqual(parseDocument(document).payloadHash, parseObservation(
        Buffer.from(`\n  ${JSON.stringify(reordered)}\n`)).payloadHash);
});

test("item fingerprint applies contract normalization and excludes raw text", () => {
    const left = fixtureDocument();
    left.item.slots = ["hold", "arm", "hold"];
    left.item.casts = ["  bless  ", "aura", "bless"];
    left.item.weapon.type = "BLUNT";
    left.item.economy.weight = -0;
    left.item.raw_text = "first observation";

    const right = fixtureDocument();
    right.item.slots = ["arm", "hold"];
    right.item.casts = ["aura", "bless"];
    right.item.weapon.type = "blunt";
    right.item.economy.weight = 0;
    right.item.raw_text = "different diagnostics";

    assert.deepEqual(parseDocument(left).itemFingerprint,
        parseDocument(right).itemFingerprint);
    assert.deepEqual(parseDocument(left).normalizedItem.slots, ["arm", "hold"]);
    assert.deepEqual(parseDocument(left).normalizedItem.casts, ["aura", "bless"]);
});

test("accepts every slot, alignment, weapon type, and governing attribute enum", () => {
    const slots = [
        "light", "finger", "neck", "body", "head", "face", "legs", "feet",
        "hands", "arms", "shield", "about", "waist", "wrist", "wield", "hold",
        "ear", "arm", "amulet", "aux", "familiar"
    ];
    const alignments = [
        "none", "good-only", "neutral-only", "evil-only", "non-good",
        "non-neutral", "non-evil"
    ];
    const weaponTypes = [null, "bladed", "piercing", "blunt"];
    const governingAttributes = [null, "strength", "dexterity", "constitution"];

    for (const slot of slots) {
        const document = fixtureDocument();
        document.item.slots = [slot];
        parseDocument(document);
    }
    const other = fixtureDocument();
    other.item.slots = ["other"];
    parseDocument(other);
    for (const alignment of alignments) {
        const document = fixtureDocument();
        document.item.alignment = alignment;
        parseDocument(document);
    }
    for (const type of weaponTypes) {
        const document = fixtureDocument();
        document.item.weapon.type = type;
        parseDocument(document);
    }
    for (const attribute of governingAttributes) {
        const document = fixtureDocument();
        document.item.weapon.governing_attribute = attribute;
        parseDocument(document);
    }
});

test("rejects malformed, non-UTF-8, and oversized files before contract work", () => {
    assert.throws(() => parseObservation(Buffer.from("{")), {code: "invalid_json"});
    assert.throws(() => parseObservation(Buffer.from([0xc3, 0x28])), {code: "invalid_utf8"});
    assert.throws(() => parseObservation(Buffer.alloc(MAX_FILE_BYTES + 1)), {code: "file_too_large"});
    assert.throws(() => parseObservation("not a buffer"), {code: "contract_invalid"});
});

test("rejects unknown and missing fields at every closed-object boundary", () => {
    for (const mutate of [
        document => { document.unknown = true; },
        document => { delete document.event_type; },
        document => { document.submission.unknown = true; },
        document => { delete document.submission.submitted_by; },
        document => { document.submission.submitted_by.unknown = true; },
        document => { document.source.unknown = true; },
        document => { document.item.unknown = true; },
        document => { document.item.flags.unknown = true; },
        document => { document.item.requirements.unknown = true; },
        document => { document.item.attributes.unknown = true; },
        document => { document.item.attribute_caps.unknown = true; },
        document => { document.item.resources.unknown = true; },
        document => { document.item.combat.unknown = true; },
        document => { document.item.weapon.unknown = true; },
        document => { document.item.economy.unknown = true; }
    ]) {
        const document = fixtureDocument();
        mutate(document);
        invalid(document);
    }
});

test("rejects invalid identities, timestamps, source, names, slots, and enums", () => {
    const cases = [
        document => { document.schema_version = 2; },
        document => { document.event_type = "equipment.changed"; },
        document => { document.submission.id = "bad/id"; },
        document => { document.submission.id = "x".repeat(129); },
        document => { document.submission.submitted_at = "2026-08-31T22:23:03+01:00"; },
        document => { document.submission.submitted_by.character = " "; },
        document => { document.submission.submitted_by.account_id = ""; },
        document => { document.source.server = "TestMUD"; },
        document => { document.item.vnum = -1; },
        document => { document.item.name = "x".repeat(256); },
        document => { document.item.slots = []; },
        document => { document.item.slots = ["other", "arm"]; },
        document => { document.item.slots = ["not-a-slot"]; },
        document => { document.item.alignment = "lawful"; },
        document => { document.item.weapon.type = "axe"; },
        document => { document.item.weapon.governing_attribute = "mind"; }
    ];
    for (const mutate of cases) {
        const document = fixtureDocument();
        mutate(document);
        invalid(document);
    }
});

test("rejects wrong primitive types, out-of-range numbers, and invalid nulls", () => {
    const cases = [
        document => { document.item.flags.light = 1; },
        document => { document.item.attributes.strength = 1.5; },
        document => { document.item.attributes.strength = 2 ** 31; },
        document => { document.item.requirements.level = null; },
        document => { document.item.economy.weight = -1; },
        document => { document.item.economy.weight = 1000; },
        document => { document.item.economy.weight = 1.234; },
        document => { document.item.casts = [""]; },
        document => { document.item.casts = ["x".repeat(51)]; },
        document => { document.item.raw_text = "x".repeat(65536); },
        document => { document.item.name = null; }
    ];
    for (const mutate of cases) {
        const document = fixtureDocument();
        mutate(document);
        invalid(document);
    }
});
