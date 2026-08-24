"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
    compareStructuralSnapshots
} = require("../scripts/visual-parity/structure");

function snapshot(theme, overrides = {}) {
    return {
        scenario: "builder-populated",
        target: "equipment headers",
        theme,
        viewport: "desktop",
        checks: {text: true, icons: true, childOrder: true, wrapping: true},
        text: "Slot Lock Name Str",
        icons: ["fa-lock", "fa-search"],
        childOrder: ["Slot", "Lock", "Name", "Str"],
        visible: true,
        wrapping: {lineCount: 1, scrollWidth: 420, clientWidth: 420},
        styles: {textAlign: "center", whiteSpace: "nowrap"},
        rect: {x: 10, y: 20, width: 420, height: 32},
        ...overrides
    };
}

test("structural comparison reports every enabled strict difference independently", function() {
    const reference = [snapshot("glass-blue")];
    const candidate = [snapshot("glass-blue", {
        text: " Slot\nLock  Title Str ",
        icons: ["fa-lock", "fa-filter"],
        childOrder: ["Slot", "Name", "Lock", "Str"],
        visible: false,
        wrapping: {lineCount: 2, scrollWidth: 420, clientWidth: 420},
        styles: {textAlign: "left", whiteSpace: "nowrap"},
        rect: {x: 11.01, y: 20, width: 420, height: 32}
    })];

    const findings = compareStructuralSnapshots(reference, candidate, {geometryTolerance: 1});

    assert.deepEqual(findings.map(finding => finding.property), [
        "childOrder", "icons", "text", "textAlign", "visible", "wrapping.lineCount", "x"
    ]);
    assert.deepEqual(findings.find(finding => finding.property === "text"), {
        scenario: "builder-populated",
        target: "equipment headers",
        property: "text",
        reference: "Slot Lock Name Str",
        candidate: "Slot Lock Title Str",
        occurrences: [{theme: "glass-blue", viewport: "desktop"}]
    });
});

test("structural comparison reports a missing target and ignores sub-pixel geometry drift", function() {
    const reference = [snapshot("glass-blue")];
    const candidate = [snapshot("glass-blue", {rect: {x: 10.75, y: 20, width: 420, height: 32}})];

    assert.deepEqual(compareStructuralSnapshots(reference, [], {geometryTolerance: 1}), [{
        scenario: "builder-populated",
        target: "equipment headers",
        property: "target",
        reference: "present",
        candidate: "missing",
        occurrences: [{theme: "glass-blue", viewport: "desktop"}]
    }]);
    assert.deepEqual(compareStructuralSnapshots(reference, candidate, {geometryTolerance: 1}), []);
});

test("structural comparison only evaluates structural properties enabled by target checks", function() {
    const reference = [snapshot("glass-blue", {checks: {text: true}})];
    const candidate = [snapshot("glass-blue", {
        checks: {text: true},
        icons: ["fa-filter"],
        childOrder: ["Str"],
        wrapping: {lineCount: 3, scrollWidth: 1, clientWidth: 1}
    })];

    assert.deepEqual(compareStructuralSnapshots(reference, candidate), []);
});

test("structural comparison consolidates identical root differences with sorted occurrences", function() {
    const findings = compareStructuralSnapshots(
        [snapshot("light"), snapshot("glass-blue", {viewport: "mobile"})],
        [
            snapshot("light", {icons: ["fa-search"]}),
            snapshot("glass-blue", {viewport: "mobile", icons: ["fa-search"]})
        ]
    );

    assert.deepEqual(findings, [{
        scenario: "builder-populated",
        target: "equipment headers",
        property: "icons",
        reference: ["fa-lock", "fa-search"],
        candidate: ["fa-search"],
        occurrences: [
            {theme: "glass-blue", viewport: "mobile"},
            {theme: "light", viewport: "desktop"}
        ]
    }]);
});
