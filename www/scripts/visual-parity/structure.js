"use strict";

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

function normalizedText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function selectorFor(target, side) {
    return typeof target.selector === "string" ? target.selector : target.selector[side];
}

async function captureStructuralTargets(page, scenario, side, identity) {
    const snapshots = [];
    for (const target of scenario.structuralTargets) {
        const locator = page.locator(selectorFor(target, side));
        if (await locator.count() === 0) {
            snapshots.push({
                ...identity,
                target: target.name,
                checks: target.checks,
                present: false
            });
            continue;
        }
        const snapshot = await locator.first().evaluate(function(element, properties) {
            function normalize(value) {
                return String(value || "").replace(/\s+/g, " ").trim();
            }
            function iconIdentity(icon) {
                const dataIcon = icon.getAttribute("data-icon");
                if (dataIcon)
                    return dataIcon.startsWith("fa-") ? dataIcon : `fa-${dataIcon}`;
                return Array.from(icon.classList).find(function(className) {
                    return className.startsWith("fa-") && className !== "fa-fw";
                }) || icon.tagName.toLowerCase();
            }
            function childIdentity(child) {
                const text = normalize(child.innerText);
                if (text)
                    return text;
                if (child.getAttribute("aria-label"))
                    return child.getAttribute("aria-label");
                const icon = child.matches("i[class], svg[data-icon]")
                    ? child
                    : child.querySelector("i[class], svg[data-icon]");
                return icon ? iconIdentity(icon) : child.tagName.toLowerCase();
            }
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return {
                ...properties.identity,
                target: properties.target.name,
                checks: properties.target.checks,
                present: true,
                text: element.innerText.replace(/\s+/g, " ").trim(),
                icons: Array.from(element.querySelectorAll("i[class], svg[data-icon]"), iconIdentity),
                childOrder: Array.from(element.children, childIdentity),
                visible: Boolean(element.getClientRects().length) && style.visibility !== "hidden",
                wrapping: {
                    lineCount: Math.max(1, Math.round(rect.height / parseFloat(style.lineHeight))),
                    scrollWidth: element.scrollWidth,
                    clientWidth: element.clientWidth
                },
                styles: Object.fromEntries(properties.styleProperties.map(function(name) {
                    return [name, style[name]];
                })),
                rect: {x: rect.x, y: rect.y, width: rect.width, height: rect.height}
            };
        }, {identity, target, styleProperties: STYLE_PROPERTIES});
        snapshots.push(snapshot);
    }
    return snapshots;
}

function snapshotKey(snapshot) {
    return [snapshot.scenario, snapshot.target, snapshot.theme, snapshot.viewport].join("\u0000");
}

function comparableNumber(value) {
    return Math.round(Number(value) * 100) / 100;
}

function sameValue(reference, candidate) {
    return JSON.stringify(reference) === JSON.stringify(candidate);
}

function strictCheck(reference, candidate, name) {
    return reference.checks?.[name] === true || candidate.checks?.[name] === true;
}

function consolidateFindings(findings) {
    const consolidated = new Map();
    for (const finding of findings) {
        const key = [
            finding.scenario,
            finding.target,
            finding.property,
            JSON.stringify(finding.reference),
            JSON.stringify(finding.candidate)
        ].join("\u0000");
        if (!consolidated.has(key)) {
            consolidated.set(key, {
                scenario: finding.scenario,
                target: finding.target,
                property: finding.property,
                reference: finding.reference,
                candidate: finding.candidate,
                occurrences: []
            });
        }
        consolidated.get(key).occurrences.push(finding.occurrence);
    }
    return Array.from(consolidated.values())
        .map(function(finding) {
            return {
                ...finding,
                occurrences: finding.occurrences.sort(function(left, right) {
                    return `${left.theme}\u0000${left.viewport}`.localeCompare(`${right.theme}\u0000${right.viewport}`);
                })
            };
        })
        .sort(function(left, right) {
            return `${left.scenario}\u0000${left.target}\u0000${left.property}`
                .localeCompare(`${right.scenario}\u0000${right.target}\u0000${right.property}`);
        });
}

function compareStructuralSnapshots(referenceSnapshots, candidateSnapshots, options = {}) {
    const geometryTolerance = options.geometryTolerance ?? 1;
    const referenceByKey = new Map(referenceSnapshots.map(function(snapshot) {
        return [snapshotKey(snapshot), snapshot];
    }));
    const candidateByKey = new Map(candidateSnapshots.map(function(snapshot) {
        return [snapshotKey(snapshot), snapshot];
    }));
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
        const referencePresent = Boolean(reference) && reference.present !== false;
        const candidatePresent = Boolean(candidate) && candidate.present !== false;
        if (!referencePresent || !candidatePresent) {
            addDifference(identity, "target", referencePresent ? "present" : "missing", candidatePresent ? "present" : "missing");
            continue;
        }

        for (const property of ["text", "icons", "childOrder"]) {
            if (!strictCheck(reference, candidate, property))
                continue;
            const referenceValue = property === "text" ? normalizedText(reference.text) : (reference[property] ?? "missing");
            const candidateValue = property === "text" ? normalizedText(candidate.text) : (candidate[property] ?? "missing");
            if (!sameValue(referenceValue, candidateValue))
                addDifference(reference, property, referenceValue, candidateValue);
        }

        if (strictCheck(reference, candidate, "wrapping")) {
            const referenceValue = reference.wrapping?.lineCount ?? "missing";
            const candidateValue = candidate.wrapping?.lineCount ?? "missing";
            if (referenceValue !== candidateValue)
                addDifference(reference, "wrapping.lineCount", referenceValue, candidateValue);
        }

        const referenceVisible = reference.visible ?? "missing";
        const candidateVisible = candidate.visible ?? "missing";
        if (referenceVisible !== candidateVisible)
            addDifference(reference, "visible", referenceVisible, candidateVisible);

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
    return consolidateFindings(differences);
}

module.exports = {
    STYLE_PROPERTIES,
    captureStructuralTargets,
    compareStructuralSnapshots,
    consolidateFindings
};
