#!/usr/bin/env node
"use strict";

const THEMES = [
    "light",
    "dark",
    "solarized-dark",
    "high-contrast",
    "glass-blue",
    "glass-emerald",
    "glass-ruby",
    "glass-amethyst",
    "glass-amber"
];

const VIEWPORTS = {
    desktop: {width: 1280, height: 720},
    mobile: {width: 375, height: 667}
};

const STYLE_PROPERTIES = [
    "backgroundColor",
    "borderRadius",
    "borderTopColor",
    "borderTopWidth",
    "boxShadow",
    "color",
    "display",
    "fontSize",
    "fontWeight",
    "lineHeight",
    "maxWidth",
    "overflowY",
    "paddingBottom",
    "paddingLeft",
    "paddingRight",
    "paddingTop",
    "textAlign",
    "whiteSpace"
];

const SCENARIOS = [
    {
        name: "home",
        path: "/",
        readySelector: ".navbar",
        targets: [
            {name: "navbar", selector: ".navbar"},
            {name: "brand", selector: ".navbar-brand"},
            {name: "footer", selector: ".footer"}
        ]
    },
    {
        name: "builder",
        path: "/builder/",
        readySelector: ".builder-equipment-table tbody tr:nth-child(2)",
        referenceReadySelector: ".row[ng-show='statInfo != null'] .table-responsive > table.table-bordered tbody tr:nth-child(2)",
        targets: [
            {name: "character card", selector: "main .card", referenceSelector: "body[ng-controller='builder'] .card"},
            {name: "equipment table", selector: ".builder-equipment-table", referenceSelector: ".row[ng-show='statInfo != null'] .table-responsive > table.table-bordered"},
            {name: "equipment slot", selector: ".builder-equipment-table tbody tr:nth-child(2) > :nth-child(1)", referenceSelector: ".row[ng-show='statInfo != null'] .table-responsive > table.table-bordered tbody tr:nth-child(2) > :nth-child(1)"},
            {name: "equipment lock", selector: ".builder-equipment-table tbody tr:nth-child(2) > :nth-child(2)", referenceSelector: ".row[ng-show='statInfo != null'] .table-responsive > table.table-bordered tbody tr:nth-child(2) > :nth-child(2)"},
            {name: "equipment name", selector: ".builder-equipment-table tbody tr:nth-child(2) > :nth-child(3)", referenceSelector: ".row[ng-show='statInfo != null'] .table-responsive > table.table-bordered tbody tr:nth-child(2) > :nth-child(3)"},
            {name: "equipment stat", selector: ".builder-equipment-table tbody tr:nth-child(2) > :nth-child(4)", referenceSelector: ".row[ng-show='statInfo != null'] .table-responsive > table.table-bordered tbody tr:nth-child(2) > :nth-child(4)"},
            {name: "total label", selector: ".builder-equipment-table tbody tr:first-child > :nth-child(3)", referenceSelector: ".row[ng-show='statInfo != null'] .table-responsive > table.table-bordered tbody tr:first-child > :nth-child(3)"},
            {name: "total stat", selector: ".builder-equipment-table tbody tr:first-child > :nth-child(4)", referenceSelector: ".row[ng-show='statInfo != null'] .table-responsive > table.table-bordered tbody tr:first-child > :nth-child(4)"}
        ]
    },
    {
        name: "items",
        path: "/items/",
        readySelector: "input[placeholder='Search by name...']",
        targets: [
            {name: "search input", selector: "input[placeholder='Search by name...']"},
            {name: "columns control", selector: "button:has(.fa-columns)"},
            {name: "filters control", selector: "button:has(.fa-filter)"},
            {name: "search control", selector: "button[type='submit']:has(.fa-search)"},
            {name: "results table", selector: "table.table"}
        ]
    },
    {
        name: "builder columns",
        path: "/builder/",
        readySelector: "button:has-text('Hide/Show Columns')",
        actionSelector: "button:has-text('Hide/Show Columns')",
        targets: [
            {name: "dialog", selector: "[role='dialog'][aria-labelledby='columnsModalLabel']"},
            {name: "dialog content", selector: "[role='dialog'][aria-labelledby='columnsModalLabel'] .modal-content"},
            {name: "dialog toolbar", selector: "[role='dialog'][aria-labelledby='columnsModalLabel'] .columns-picker-toolbar"},
            {name: "dialog option", selector: "[role='dialog'][aria-labelledby='columnsModalLabel'] .columns-picker-option"}
        ]
    },
    {
        name: "items columns",
        path: "/items/",
        readySelector: "button:has(.fa-columns)",
        actionSelector: "button:has(.fa-columns)",
        targets: [
            {name: "dialog", selector: "[role='dialog'][aria-labelledby='columnsModalLabel']"},
            {name: "dialog content", selector: "[role='dialog'][aria-labelledby='columnsModalLabel'] .modal-content"},
            {name: "dialog toolbar", selector: "[role='dialog'][aria-labelledby='columnsModalLabel'] .columns-picker-toolbar"},
            {name: "dialog option", selector: "[role='dialog'][aria-labelledby='columnsModalLabel'] .columns-picker-option"}
        ]
    },
    {
        name: "items filters",
        path: "/items/",
        readySelector: "button:has(.fa-filter)",
        actionSelector: "button:has(.fa-filter)",
        targets: [
            {name: "dialog", selector: "[role='dialog'][aria-labelledby='filtersModalLabel']"},
            {name: "dialog content", selector: "[role='dialog'][aria-labelledby='filtersModalLabel'] .modal-content"},
            {name: "dialog toolbar", selector: "[role='dialog'][aria-labelledby='filtersModalLabel'] .filters-picker-toolbar"},
            {name: "dialog option", selector: "[role='dialog'][aria-labelledby='filtersModalLabel'] .filters-picker-option"}
        ]
    }
];

function snapshotKey(snapshot) {
    return [snapshot.scenario, snapshot.target, snapshot.theme, snapshot.viewport].join("\u0000");
}

function comparableNumber(value) {
    return Math.round(Number(value) * 100) / 100;
}

function compareSnapshots(referenceSnapshots, candidateSnapshots, options = {}) {
    const geometryTolerance = options.geometryTolerance ?? 1;
    const referenceByKey = new Map(referenceSnapshots.map(snapshot => [snapshotKey(snapshot), snapshot]));
    const candidateByKey = new Map(candidateSnapshots.map(snapshot => [snapshotKey(snapshot), snapshot]));
    const keys = Array.from(new Set([...referenceByKey.keys(), ...candidateByKey.keys()])).sort();
    const differences = [];

    function addDifference(snapshot, property, reference, candidate) {
        differences.push({
            scenario: snapshot.scenario,
            target: snapshot.target,
            property,
            reference,
            candidate,
            occurrence: {theme: snapshot.theme, viewport: snapshot.viewport}
        });
    }

    for (const key of keys) {
        const reference = referenceByKey.get(key);
        const candidate = candidateByKey.get(key);
        const identity = reference || candidate;
        if (!reference || !candidate) {
            addDifference(identity, "target", reference ? "present" : "missing", candidate ? "present" : "missing");
            continue;
        }

        const styleProperties = Array.from(new Set([
            ...Object.keys(reference.styles || {}),
            ...Object.keys(candidate.styles || {})
        ])).sort();
        for (const property of styleProperties) {
            const referenceValue = reference.styles?.[property] ?? "missing";
            const candidateValue = candidate.styles?.[property] ?? "missing";
            if (referenceValue !== candidateValue)
                addDifference(reference, property, referenceValue, candidateValue);
        }

        for (const property of ["x", "y", "width", "height"]) {
            const referenceValue = comparableNumber(reference.rect?.[property]);
            const candidateValue = comparableNumber(candidate.rect?.[property]);
            if (!Number.isFinite(referenceValue) || !Number.isFinite(candidateValue)) {
                if (referenceValue !== candidateValue)
                    addDifference(reference, property, referenceValue, candidateValue);
            }
            else if (Math.abs(referenceValue - candidateValue) > geometryTolerance) {
                addDifference(reference, property, referenceValue, candidateValue);
            }
        }
    }

    const consolidated = new Map();
    for (const difference of differences) {
        const key = [
            difference.scenario,
            difference.target,
            difference.property,
            JSON.stringify(difference.reference),
            JSON.stringify(difference.candidate)
        ].join("\u0000");
        if (!consolidated.has(key)) {
            consolidated.set(key, {
                scenario: difference.scenario,
                target: difference.target,
                property: difference.property,
                reference: difference.reference,
                candidate: difference.candidate,
                occurrences: []
            });
        }
        consolidated.get(key).occurrences.push(difference.occurrence);
    }

    return Array.from(consolidated.values())
        .map(finding => ({
            ...finding,
            occurrences: finding.occurrences.sort((left, right) =>
                `${left.theme}\u0000${left.viewport}`.localeCompare(`${right.theme}\u0000${right.viewport}`))
        }))
        .sort((left, right) =>
            `${left.scenario}\u0000${left.target}\u0000${left.property}`.localeCompare(`${right.scenario}\u0000${right.target}\u0000${right.property}`));
}

function normalizedBaseUrl(value, optionName) {
    if (!value)
        throw new Error(`${optionName} is required`);
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol))
        throw new Error(`${optionName} must use http or https`);
    return url.toString().replace(/\/$/, "");
}

function parseArguments(argv) {
    const values = {};
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === "--fail-on-diff") {
            values.failOnDiff = true;
            continue;
        }
        if (argument === "--help") {
            values.help = true;
            continue;
        }
        const match = argument.match(/^--(reference-base-url|candidate-base-url)(?:=(.*))?$/);
        if (!match)
            throw new Error(`Unknown argument: ${argument}`);
        const value = match[2] === undefined ? argv[++index] : match[2];
        values[match[1]] = value;
    }
    if (values.help)
        return {help: true};
    return {
        candidateBaseUrl: normalizedBaseUrl(values["candidate-base-url"], "--candidate-base-url"),
        failOnDiff: values.failOnDiff === true,
        referenceBaseUrl: normalizedBaseUrl(values["reference-base-url"], "--reference-base-url")
    };
}

async function captureTarget(locator, identity) {
    if (await locator.count() === 0)
        return null;
    return locator.first().evaluate((element, properties) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {
            ...properties.identity,
            styles: Object.fromEntries(properties.names.map(name => [name, style[name]])),
            rect: {x: rect.x, y: rect.y, width: rect.width, height: rect.height}
        };
    }, {identity, names: STYLE_PROPERTIES});
}

async function captureDeployment(browser, baseUrl, side) {
    const snapshots = [];
    for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
        for (const theme of THEMES) {
            const context = await browser.newContext({viewport});
            await context.addCookies([{name: "theme", value: theme, url: baseUrl}]);
            const page = await context.newPage();
            for (const scenario of SCENARIOS) {
                await page.goto(`${baseUrl}${scenario.path}`, {waitUntil: "domcontentloaded"});
                const readySelector = side === "reference" && scenario.referenceReadySelector ? scenario.referenceReadySelector : scenario.readySelector;
                await page.locator(readySelector).filter({visible: true}).first().waitFor({state: "visible", timeout: 15000});
                if (scenario.actionSelector)
                    await page.locator(scenario.actionSelector).filter({visible: true}).first().click();
                for (const target of scenario.targets) {
                    const selector = side === "reference" && target.referenceSelector ? target.referenceSelector : target.selector;
                    const snapshot = await captureTarget(page.locator(selector), {
                        scenario: scenario.name,
                        target: target.name,
                        theme,
                        viewport: viewportName
                    });
                    if (snapshot)
                        snapshots.push(snapshot);
                }
            }
            await context.close();
        }
    }
    return snapshots;
}

function helpText() {
    return [
        "Compare mapped UI styles and geometry between two LegendHUB deployments.",
        "",
        "Usage:",
        "  npm run audit:ui-parity -- --reference-base-url=https://www.legendhub.org --candidate-base-url=https://legendhub.dunwichmass.com",
        "",
        "Options:",
        "  --fail-on-diff  Exit 1 when differences are found; reporting exits 0 by default."
    ].join("\n");
}

function buildAuditResult(reference, candidate, options = {}) {
    const findings = compareSnapshots(reference, candidate, options);
    return {
        exitCode: options.failOnDiff && findings.length > 0 ? 1 : 0,
        report: {
            summary: {
                scenarios: SCENARIOS.length,
                themes: THEMES.length,
                viewports: Object.keys(VIEWPORTS).length,
                referenceTargets: reference.length,
                candidateTargets: candidate.length,
                findings: findings.length
            },
            findings
        }
    };
}

async function main(argv) {
    const options = parseArguments(argv);
    if (options.help) {
        process.stdout.write(`${helpText()}\n`);
        return;
    }
    const {chromium} = require("@playwright/test");
    const browser = await chromium.launch({headless: true});
    try {
        const [reference, candidate] = await Promise.all([
            captureDeployment(browser, options.referenceBaseUrl, "reference"),
            captureDeployment(browser, options.candidateBaseUrl, "candidate")
        ]);
        const result = buildAuditResult(reference, candidate, options);
        process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
        process.exitCode = result.exitCode;
    }
    finally {
        await browser.close();
    }
}

module.exports = {
    buildAuditResult,
    compareSnapshots,
    parseArguments
};

if (require.main === module) {
    main(process.argv.slice(2)).catch(error => {
        process.stderr.write(`${error.stack || error.message}\n`);
        process.exitCode = 1;
    });
}
