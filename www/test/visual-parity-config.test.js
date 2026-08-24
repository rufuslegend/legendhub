const assert = require("node:assert/strict");
const test = require("node:test");

const {
    ACTION_TYPES,
    REFERENCE_SHA,
    THEMES,
    VIEWPORTS,
    buildCaptureMatrix,
    parseVisualParityArgs,
    validateManifest
} = require("../scripts/visual-parity/config");
const {SCENARIOS} = require("../scripts/visual-parity/scenarios");

const validScenario = {
    name: "valid-scenario",
    route: "/",
    ready: "main",
    capture: {kind: "page"},
    structuralTargets: [{name: "main", selector: "main"}]
};

function scenarioWith(change) {
    return [{...validScenario, ...change}];
}

test("parseVisualParityArgs accepts the documented CLI contract", function() {
    assert.deepEqual(parseVisualParityArgs([
        "--reference-base-url=https://localhost:7443",
        "--candidate-base-url=https://localhost:7444/",
        "--reference-sha=0cab3ac95826a53de19b3146d277e7056495210f",
        "--candidate-sha=1111111111111111111111111111111111111111",
        "--mode=smoke",
        "--output-dir=data/parity-report/test-run",
        "--fail-on-diff"
    ]), {
        referenceBaseUrl: "https://localhost:7443",
        candidateBaseUrl: "https://localhost:7444",
        referenceSha: "0cab3ac95826a53de19b3146d277e7056495210f",
        candidateSha: "1111111111111111111111111111111111111111",
        mode: "smoke",
        outputDir: "data/parity-report/test-run",
        failOnDiff: true
    });
});

test("parseVisualParityArgs applies the documented defaults", function() {
    const args = parseVisualParityArgs([
        "--reference-base-url=https://localhost:7443/",
        "--candidate-base-url=https://localhost:7444/",
        `--reference-sha=${REFERENCE_SHA}`,
        "--candidate-sha=1111111111111111111111111111111111111111"
    ]);

    assert.equal(args.mode, "smoke");
    assert.match(args.outputDir, /^data\/parity-report\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/);
    assert.equal(args.failOnDiff, false);
});

test("parseVisualParityArgs rejects invalid CLI input", function() {
    const valid = [
        "--reference-base-url=https://localhost:7443",
        "--candidate-base-url=https://localhost:7444",
        `--reference-sha=${REFERENCE_SHA}`,
        "--candidate-sha=1111111111111111111111111111111111111111"
    ];

    assert.throws(() => parseVisualParityArgs(valid.slice(1)), /reference-base-url/);
    assert.throws(() => parseVisualParityArgs([
        "--reference-base-url=http://localhost:7443",
        ...valid.slice(1)
    ]), /reference-base-url.*HTTPS/);
    assert.throws(() => parseVisualParityArgs([
        ...valid.slice(0, 2),
        "--reference-sha=not-a-sha",
        valid[3]
    ]), /reference-sha.*40-character SHA/);
    assert.throws(() => parseVisualParityArgs([
        ...valid.slice(0, 2),
        "--reference-sha=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        valid[3]
    ]), /reference-sha.*REFERENCE_SHA/);
    assert.throws(() => parseVisualParityArgs([...valid, "--unknown=value"]), /Unknown option/);
    assert.throws(() => parseVisualParityArgs([...valid, "--mode=all"]), /mode.*smoke\|full/);
});

test("parseVisualParityArgs keeps supplied output directories under data/parity-report", function() {
    const valid = [
        "--reference-base-url=https://localhost:7443",
        "--candidate-base-url=https://localhost:7444",
        `--reference-sha=${REFERENCE_SHA}`,
        "--candidate-sha=1111111111111111111111111111111111111111"
    ];

    assert.equal(
        parseVisualParityArgs([...valid, "--output-dir=data/parity-report/test-run/nested"]).outputDir,
        "data/parity-report/test-run/nested"
    );
    assert.throws(() => parseVisualParityArgs([...valid, "--output-dir=/tmp/outside"]), /output-dir.*data\/parity-report/);
    assert.throws(() => parseVisualParityArgs([...valid, "--output-dir=data/parity-report/../../outside"]), /output-dir.*data\/parity-report/);
});

test("buildCaptureMatrix expands smoke and full modes exactly", function() {
    assert.deepEqual(
        buildCaptureMatrix({mode: "smoke", scenarios: [{name: "home"}]}),
        [
            {scenario: {name: "home"}, theme: "glass-blue", viewportName: "desktop", viewport: {width: 1280, height: 720}},
            {scenario: {name: "home"}, theme: "glass-blue", viewportName: "mobile", viewport: {width: 375, height: 667}}
        ]
    );
    assert.equal(buildCaptureMatrix({mode: "full", scenarios: [{name: "home"}]}).length, 18);
    assert.deepEqual(THEMES, [
        "light", "dark", "solarized-dark", "high-contrast", "glass-blue",
        "glass-emerald", "glass-ruby", "glass-amethyst", "glass-amber"
    ]);
    assert.deepEqual(VIEWPORTS, {
        desktop: {width: 1280, height: 720},
        mobile: {width: 375, height: 667}
    });
    assert.deepEqual([...ACTION_TYPES], ["click", "fill", "hover", "press", "select", "set-builder-state"]);
});

test("validateManifest returns valid scenarios and rejects invalid schema paths", function() {
    assert.deepEqual(validateManifest([validScenario]), [validScenario]);
    assert.throws(() => validateManifest([validScenario, {...validScenario}]), /valid-scenario\.name/);
    assert.throws(() => validateManifest(scenarioWith({actions: [{type: "navigate", target: "button"}]})), /valid-scenario\.actions\[0\]\.type/);
    assert.throws(() => validateManifest(scenarioWith({ready: undefined})), /valid-scenario\.ready/);
    assert.throws(() => validateManifest(scenarioWith({capture: {kind: "locator"}})), /valid-scenario\.capture\.selector/);
    assert.throws(() => validateManifest(scenarioWith({ready: {reference: "main"}})), /valid-scenario\.ready\.candidate/);
    assert.throws(() => validateManifest(scenarioWith({
        masks: [{kind: "timestamp", selector: "body"}]
    })), /valid-scenario\.masks\[0\]\.selector/);
});

test("SCENARIOS declares the fixed initial visual parity surface", function() {
    assert.equal(SCENARIOS.length, 31);
    assert.deepEqual(SCENARIOS.map(function(scenario) {
        return [scenario.name, scenario.route];
    }), [
        ["home-shell", "/"],
        ["login", "/login.html"],
        ["registration-panel", "/login.html"],
        ["notifications-popover", "/"],
        ["notifications-list", "/notifications/"],
        ["account-settings", "/account/"],
        ["changelog", "/changelog/"],
        ["builder-populated", "/builder/"],
        ["builder-columns", "/builder/"],
        ["builder-item-picker", "/builder/"],
        ["builder-warning", "/builder/"],
        ["items-results", "/items/?search=Parity"],
        ["items-columns", "/items/?search=Parity"],
        ["items-filters", "/items/?search=Parity"],
        ["item-details", "/items/details.html?id=900001"],
        ["item-history", "/items/history.html?id=900001"],
        ["item-editor", "/items/edit.html?id=900001"],
        ["mobs-results", "/mobs/?search=Parity"],
        ["mob-details", "/mobs/details.html?id=900001"],
        ["mob-history", "/mobs/history.html?id=900001"],
        ["mob-editor", "/mobs/edit.html?id=900001"],
        ["quests-results", "/quests/?search=Parity"],
        ["quest-details", "/quests/details.html?id=900001"],
        ["quest-history", "/quests/history.html?id=900001"],
        ["quest-editor", "/quests/edit.html?id=900001"],
        ["wiki-results", "/wiki/?search=Parity"],
        ["wiki-details", "/wiki/details.html?id=900001"],
        ["wiki-history", "/wiki/history.html?id=900001"],
        ["wiki-editor", "/wiki/edit.html?id=900001"],
        ["wiki-smithing-format", "/wiki/details.html?id=900002"],
        ["responsive-navigation", "/"]
    ]);
    assert.deepEqual(validateManifest(SCENARIOS), SCENARIOS);
});
