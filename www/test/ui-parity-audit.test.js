"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
    buildAuditResult,
    compareSnapshots,
    parseArguments
} = require("../scripts/audit-ui-parity");

function snapshot(theme, viewport, overrides = {}) {
    return {
        scenario: "builder",
        target: "equipment slot",
        theme,
        viewport,
        styles: {
            textAlign: "center",
            whiteSpace: "nowrap",
            ...overrides.styles
        },
        rect: {
            x: 12,
            y: 48,
            width: 64,
            height: 24,
            ...overrides.rect
        }
    };
}

// Catches noisy sub-pixel geometry changes being reported as parity defects.
test("UI parity comparison ignores geometry within the configured tolerance", function() {
    const reference = [snapshot("light", "desktop")];
    const candidate = [snapshot("light", "desktop", {rect: {width: 64.75, height: 23.25}})];

    assert.deepEqual(compareSnapshots(reference, candidate, {geometryTolerance: 1}), []);
});

// Catches a control moving materially while retaining the same dimensions.
test("UI parity comparison reports positional geometry differences", function() {
    const reference = [snapshot("light", "desktop")];
    const candidate = [snapshot("light", "desktop", {rect: {x: 18}})];

    assert.deepEqual(compareSnapshots(reference, candidate, {geometryTolerance: 1}), [{
        scenario: "builder",
        target: "equipment slot",
        property: "x",
        reference: 12,
        candidate: 18,
        occurrences: [{theme: "light", viewport: "desktop"}]
    }]);
});

// Catches one omitted utility class becoming nine-theme-by-two-viewport spam
// instead of one actionable finding with its complete occurrence list.
test("UI parity comparison consolidates repeated style differences", function() {
    const reference = [
        snapshot("light", "desktop"),
        snapshot("glass-blue", "mobile")
    ];
    const candidate = [
        snapshot("light", "desktop", {styles: {textAlign: "left"}}),
        snapshot("glass-blue", "mobile", {styles: {textAlign: "left"}})
    ];

    assert.deepEqual(compareSnapshots(reference, candidate), [{
        scenario: "builder",
        target: "equipment slot",
        property: "textAlign",
        reference: "center",
        candidate: "left",
        occurrences: [
            {theme: "glass-blue", viewport: "mobile"},
            {theme: "light", viewport: "desktop"}
        ]
    }]);
});

// Catches a selector disappearing from one deployment without being surfaced
// as an explicit missing-target finding.
test("UI parity comparison reports missing mapped targets", function() {
    assert.deepEqual(compareSnapshots([snapshot("dark", "desktop")], []), [{
        scenario: "builder",
        target: "equipment slot",
        property: "target",
        reference: "present",
        candidate: "missing",
        occurrences: [{theme: "dark", viewport: "desktop"}]
    }]);
});

test("UI parity CLI requires both deployments and accepts explicit failure mode", function() {
    assert.deepEqual(parseArguments([
        "--reference-base-url=https://www.legendhub.org",
        "--candidate-base-url", "https://legendhub.dunwichmass.com/",
        "--fail-on-diff"
    ]), {
        candidateBaseUrl: "https://legendhub.dunwichmass.com",
        failOnDiff: true,
        referenceBaseUrl: "https://www.legendhub.org"
    });

    assert.throws(
        () => parseArguments(["--reference-base-url=https://www.legendhub.org"]),
        /--candidate-base-url is required/
    );
});

test("UI parity audit fails only when requested and differences exist", function() {
    const reference = [snapshot("light", "desktop")];
    const different = [snapshot("light", "desktop", {styles: {textAlign: "left"}})];

    assert.equal(buildAuditResult(reference, different, {failOnDiff: false}).exitCode, 0);
    assert.equal(buildAuditResult(reference, different, {failOnDiff: true}).exitCode, 1);
    assert.equal(buildAuditResult(reference, reference, {failOnDiff: true}).exitCode, 0);
});

// Keeps the legacy export on the shared structural comparator so operator
// scripts can adopt declared checks without changing their output contract.
test("UI parity comparison exposes declared structural findings through its compatibility export", function() {
    const reference = [{
        ...snapshot("light", "desktop"),
        checks: {text: true},
        text: "Slot Lock Name Str"
    }];
    const candidate = [{
        ...snapshot("light", "desktop"),
        checks: {text: true},
        text: "Slot Lock Title Str"
    }];

    assert.deepEqual(compareSnapshots(reference, candidate), [{
        scenario: "builder",
        target: "equipment slot",
        property: "text",
        reference: "Slot Lock Name Str",
        candidate: "Slot Lock Title Str",
        occurrences: [{theme: "light", viewport: "desktop"}]
    }]);
});
