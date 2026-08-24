"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
    captureStructuralTargets,
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

function capturePage(selector, element) {
    function locator(entries) {
        return {
            filter(options) {
                return locator(options.visible ? entries.filter(function(entry) {
                    return entry.locatorVisible;
                }) : entries);
            },
            async count() {
                return entries.length;
            },
            first() {
                return {
                    async evaluate(callback, properties) {
                        return callback(entries[0], properties);
                    }
                };
            }
        };
    }
    return {
        locator(requestedSelector) {
            return locator(requestedSelector === selector && element ? [element] : []);
        }
    };
}

function captureElement({locatorVisible = true, visible = true} = {}) {
    return {
        locatorVisible,
        innerText: "Slot Lock Name Str",
        querySelectorAll() {
            return [];
        },
        children: [],
        getClientRects() {
            return visible ? [{}] : [];
        },
        getBoundingClientRect() {
            return {x: 10, y: 20, width: 420, height: 32};
        },
        scrollWidth: 420,
        clientWidth: 420
    };
}

async function capture(page, side = "reference") {
    const getComputedStyle = globalThis.getComputedStyle;
    globalThis.getComputedStyle = function(element) {
        return {lineHeight: "16px", visibility: element.locatorVisible ? "visible" : "hidden"};
    };
    try {
        return await captureStructuralTargets(page, {
            structuralTargets: [{name: "equipment headers", selector: "#equipment-headers", checks: {}}]
        }, side, {
            scenario: "builder-populated",
            theme: "glass-blue",
            viewport: "desktop"
        });
    }
    finally {
        globalThis.getComputedStyle = getComputedStyle;
    }
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

test("capture retains an absent declared target and comparison reports it on both sides", async function() {
    const reference = await capture(capturePage("#equipment-headers"));
    const candidate = await capture(capturePage("#equipment-headers"));

    assert.equal(reference.length, 1);
    assert.equal(reference[0].present, false);
    assert.doesNotThrow(function() {
        JSON.stringify(reference[0]);
    });
    assert.deepEqual(compareStructuralSnapshots(reference, candidate), [{
        scenario: "builder-populated",
        target: "equipment headers",
        property: "target",
        reference: "missing",
        candidate: "missing",
        occurrences: [{theme: "glass-blue", viewport: "desktop"}]
    }]);
});

test("capture retains a hidden target as present so comparison reports visibility", async function() {
    const reference = await capture(capturePage("#equipment-headers", captureElement()));
    const candidate = await capture(capturePage("#equipment-headers", captureElement({locatorVisible: false})));

    assert.equal(candidate[0].present, true);
    assert.equal(candidate[0].visible, false);
    assert.deepEqual(compareStructuralSnapshots(reference, candidate), [{
        scenario: "builder-populated",
        target: "equipment headers",
        property: "visible",
        reference: true,
        candidate: false,
        occurrences: [{theme: "glass-blue", viewport: "desktop"}]
    }]);
});

test("capture preserves a one-side absence as an explicit target finding", async function() {
    const reference = await capture(capturePage("#equipment-headers"));
    const candidate = await capture(capturePage("#equipment-headers", captureElement()));

    assert.deepEqual(compareStructuralSnapshots(reference, candidate), [{
        scenario: "builder-populated",
        target: "equipment headers",
        property: "target",
        reference: "missing",
        candidate: "present",
        occurrences: [{theme: "glass-blue", viewport: "desktop"}]
    }]);
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
