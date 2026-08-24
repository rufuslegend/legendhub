const path = require("node:path");

const REFERENCE_SHA = "0cab3ac95826a53de19b3146d277e7056495210f";
const THEMES = [
    "light", "dark", "solarized-dark", "high-contrast", "glass-blue",
    "glass-emerald", "glass-ruby", "glass-amethyst", "glass-amber"
];
const VIEWPORTS = {
    desktop: {width: 1280, height: 720},
    mobile: {width: 375, height: 667}
};
const ACTION_TYPES = new Set(["click", "fill", "hover", "press", "select", "set-builder-state"]);
const STRUCTURAL_CHECKS = new Set(["text", "icons", "childOrder", "wrapping"]);
const MODES = new Set(["smoke", "full"]);
const REPORT_ROOT = "data/parity-report";

function timestamp() {
    return new Date().toISOString().replace(/[:.]/g, "-");
}

function normalizedHttpsUrl(value, option) {
    let parsed;
    try {
        parsed = new URL(value);
    } catch {
        throw new Error(`${option} must be an HTTPS URL`);
    }
    if (parsed.protocol !== "https:")
        throw new Error(`${option} must be an HTTPS URL`);
    return value.replace(/\/+$/, "");
}

function validateSha(value, option) {
    if (!/^[a-f0-9]{40}$/i.test(value || ""))
        throw new Error(`${option} must be a 40-character SHA`);
    return value;
}

function validateOutputDir(value) {
    const root = path.resolve(REPORT_ROOT);
    const outputDir = path.resolve(value);
    if (path.isAbsolute(value) || (outputDir !== root && !outputDir.startsWith(`${root}${path.sep}`)))
        throw new Error("output-dir must remain under data/parity-report");
    return value;
}

function parseVisualParityArgs(argv) {
    const values = {};
    const known = new Set([
        "reference-base-url", "candidate-base-url", "reference-sha", "candidate-sha",
        "mode", "output-dir", "fail-on-diff"
    ]);

    for (const argument of argv) {
        if (!argument.startsWith("--"))
            throw new Error(`Unknown option: ${argument}`);
        const [option, value] = argument.slice(2).split(/=(.*)/s, 2);
        if (!known.has(option))
            throw new Error(`Unknown option: --${option}`);
        if (Object.hasOwn(values, option))
            throw new Error(`Duplicate option: --${option}`);
        if (option === "fail-on-diff") {
            if (value !== undefined)
                throw new Error("--fail-on-diff does not accept a value");
            values[option] = true;
        } else {
            if (value === undefined || value === "")
                throw new Error(`--${option} requires a value`);
            values[option] = value;
        }
    }

    for (const option of ["reference-base-url", "candidate-base-url", "reference-sha", "candidate-sha"]) {
        if (!Object.hasOwn(values, option))
            throw new Error(`Missing required option: --${option}`);
    }

    const referenceSha = validateSha(values["reference-sha"], "reference-sha");
    if (referenceSha !== REFERENCE_SHA)
        throw new Error("reference-sha must equal REFERENCE_SHA");
    const mode = values.mode || "smoke";
    if (!MODES.has(mode))
        throw new Error("mode must be smoke|full");

    return {
        referenceBaseUrl: normalizedHttpsUrl(values["reference-base-url"], "reference-base-url"),
        candidateBaseUrl: normalizedHttpsUrl(values["candidate-base-url"], "candidate-base-url"),
        referenceSha,
        candidateSha: validateSha(values["candidate-sha"], "candidate-sha"),
        mode,
        outputDir: values["output-dir"] ? validateOutputDir(values["output-dir"]) : `data/parity-report/${timestamp()}`,
        failOnDiff: values["fail-on-diff"] === true
    };
}

function isSelector(value) {
    if (typeof value === "string")
        return value.trim().length > 0;
    return value !== null
        && typeof value === "object"
        && Object.keys(value).length === 2
        && typeof value.reference === "string"
        && value.reference.trim().length > 0
        && typeof value.candidate === "string"
        && value.candidate.trim().length > 0;
}

function sameSelector(left, right) {
    if (typeof left === "string" && typeof right === "string")
        return left === right;
    return left && right && typeof left === "object" && typeof right === "object"
        && left.reference === right.reference && left.candidate === right.candidate;
}

function assertSelector(value, path) {
    if (typeof value === "object" && value !== null) {
        if (typeof value.reference !== "string" || value.reference.trim() === "")
            throw new Error(`${path}.reference must be a selector`);
        if (typeof value.candidate !== "string" || value.candidate.trim() === "")
            throw new Error(`${path}.candidate must be a selector`);
        if (Object.keys(value).length !== 2)
            throw new Error(`${path} must be a selector string or reference/candidate pair`);
        return;
    }
    if (!isSelector(value))
        throw new Error(`${path} must be a selector`);
}

function assertStructuralChecks(value, path) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error(`${path} must be an object`);
    for (const [name, enabled] of Object.entries(value)) {
        if (!STRUCTURAL_CHECKS.has(name))
            throw new Error(`${path}.${name} must be text, icons, childOrder, or wrapping`);
        if (enabled !== true)
            throw new Error(`${path}.${name} must be true when declared`);
    }
}

function validateManifest(scenarios) {
    if (!Array.isArray(scenarios))
        throw new Error("scenarios must be an array");
    const names = new Set();

    scenarios.forEach(function(scenario, index) {
        const name = scenario?.name || `scenarios[${index}]`;
        const path = `${name}`;
        if (!scenario || typeof scenario !== "object")
            throw new Error(`${path} must be an object`);
        if (typeof scenario.name !== "string" || scenario.name.trim() === "")
            throw new Error(`${path}.name must be a non-empty string`);
        if (names.has(scenario.name))
            throw new Error(`${path}.name must be unique`);
        names.add(scenario.name);
        if (typeof scenario.route !== "string" || !scenario.route.startsWith("/"))
            throw new Error(`${path}.route must be an absolute route`);
        assertSelector(scenario.ready, `${path}.ready`);
        if (!scenario.capture || typeof scenario.capture !== "object")
            throw new Error(`${path}.capture is required`);
        if (!new Set(["page", "locator"]).has(scenario.capture.kind))
            throw new Error(`${path}.capture.kind must be page|locator`);
        if (scenario.capture.kind === "locator")
            assertSelector(scenario.capture.selector, `${path}.capture.selector`);
        if (!Array.isArray(scenario.structuralTargets) || scenario.structuralTargets.length === 0)
            throw new Error(`${path}.structuralTargets must contain at least one target`);
        scenario.structuralTargets.forEach(function(target, targetIndex) {
            const targetPath = `${path}.structuralTargets[${targetIndex}]`;
            if (!target || typeof target.name !== "string" || target.name.trim() === "")
                throw new Error(`${targetPath}.name must be a non-empty string`);
            assertSelector(target.selector, `${targetPath}.selector`);
            assertStructuralChecks(target.checks, `${targetPath}.checks`);
        });
        if (scenario.actions !== undefined) {
            if (!Array.isArray(scenario.actions))
                throw new Error(`${path}.actions must be an array`);
            scenario.actions.forEach(function(action, actionIndex) {
                const actionPath = `${path}.actions[${actionIndex}]`;
                if (!action || !ACTION_TYPES.has(action.type))
                    throw new Error(`${actionPath}.type must be a declared action type`);
                assertSelector(action.target, `${actionPath}.target`);
            });
        }
        if (scenario.masks !== undefined) {
            if (!Array.isArray(scenario.masks))
                throw new Error(`${path}.masks must be an array`);
            scenario.masks.forEach(function(mask, maskIndex) {
                const maskPath = `${path}.masks[${maskIndex}]`;
                if (!mask || !new Set(["captcha", "timestamp", "external-widget"]).has(mask.kind))
                    throw new Error(`${maskPath}.kind must be captcha, timestamp, or external-widget`);
                assertSelector(mask.selector, `${maskPath}.selector`);
                const declared = scenario.structuralTargets.some(function(target) {
                    return sameSelector(mask.selector, target.selector);
                }) || (scenario.capture.selector && sameSelector(mask.selector, scenario.capture.selector));
                if (!declared)
                    throw new Error(`${maskPath}.selector must not be broader than a declared selector`);
            });
        }
    });
    return scenarios;
}

function buildCaptureMatrix({mode, scenarios}) {
    if (!MODES.has(mode))
        throw new Error("mode must be smoke|full");
    const themes = mode === "smoke" ? ["glass-blue"] : THEMES;
    return scenarios.flatMap(function(scenario) {
        return themes.flatMap(function(theme) {
            return Object.entries(VIEWPORTS).map(function([viewportName, viewport]) {
                return {scenario, theme, viewportName, viewport};
            });
        });
    });
}

module.exports = {
    ACTION_TYPES,
    REFERENCE_SHA,
    STRUCTURAL_CHECKS,
    THEMES,
    VIEWPORTS,
    buildCaptureMatrix,
    parseVisualParityArgs,
    validateManifest
};
