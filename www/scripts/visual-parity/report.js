"use strict";

const fs = require("node:fs");
const path = require("node:path");

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, function(character) {
        return {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            "\"": "&quot;",
            "'": "&#39;"
        }[character];
    });
}

function artifactStem(result) {
    return [result.scenario, result.theme, result.viewport].map(function(value) {
        const normalized = String(value ?? "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "");
        return normalized || "unnamed";
    }).join("--");
}

function relativeArtifactPath(outputDir, ...parts) {
    const root = path.resolve(outputDir);
    const absolute = path.resolve(root, ...parts);
    const relative = path.relative(root, absolute);
    if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
        throw new Error("report artifact must remain beneath outputDir");
    return relative.split(path.sep).join("/");
}

function writeArtifact(outputDir, relativePath, contents) {
    const absolute = path.resolve(outputDir, relativePath);
    fs.mkdirSync(path.dirname(absolute), {recursive: true});
    fs.writeFileSync(absolute, contents);
}

function normalizeMatrix(values, name) {
    if (!Array.isArray(values))
        throw new Error(`${name} must be an array`);
    return Array.from(new Set(values.map(function(value) {
        if (typeof value !== "string" || value.trim() === "")
            throw new Error(`${name} entries must be non-empty strings`);
        return value.trim();
    }))).sort(function(left, right) {
        return left.localeCompare(right);
    });
}

function matrixValues(metadata, results, metadataName, resultName) {
    const derived = normalizeMatrix(results.map(function(result) {
        return result[resultName];
    }), resultName);
    if (metadata[metadataName] === undefined)
        return derived;
    const supplied = normalizeMatrix(metadata[metadataName], `metadata.${metadataName}`);
    for (const value of derived) {
        if (!supplied.includes(value))
            throw new Error(`metadata.${metadataName} must include result ${resultName} ${value}`);
    }
    return supplied;
}

function reportMetadata(metadata = {}, results = []) {
    return {
        referenceSha: metadata.referenceSha,
        candidateSha: metadata.candidateSha,
        generatedAt: metadata.generatedAt,
        mode: metadata.mode,
        playwrightVersion: metadata.playwrightVersion,
        chromiumVersion: metadata.chromiumVersion,
        operatingSystem: metadata.operatingSystem,
        themes: matrixValues(metadata, results, "themes", "theme"),
        viewports: matrixValues(metadata, results, "viewports", "viewport")
    };
}

function serializedImage(image = {}) {
    return {
        width: image.width,
        height: image.height,
        diffPixels: image.diffPixels,
        diffRatio: image.diffRatio,
        dimensionMismatch: image.dimensionMismatch
    };
}

function occurrenceText(occurrences) {
    return occurrences.map(function(occurrence) {
        return `${occurrence.theme}/${occurrence.viewport}`;
    }).join(", ");
}

function groupFindings(results) {
    const grouped = new Map();
    for (const result of results) {
        for (const finding of result.structuralFindings || []) {
            if (!grouped.has(finding.scenario))
                grouped.set(finding.scenario, new Map());
            const properties = grouped.get(finding.scenario);
            if (!properties.has(finding.property))
                properties.set(finding.property, []);
            properties.get(finding.property).push(finding);
        }
    }
    return Array.from(grouped.entries()).sort(function([left], [right]) {
        return String(left).localeCompare(String(right));
    }).map(function([scenario, properties]) {
        return {
            scenario,
            properties: Array.from(properties.entries()).sort(function([left], [right]) {
                return String(left).localeCompare(String(right));
            })
        };
    });
}

function renderFindings(results) {
    const groups = groupFindings(results);
    if (groups.length === 0)
        return "<p>No structural findings.</p>";
    return groups.map(function(group) {
        return `<section><h3>${escapeHtml(group.scenario)}</h3>${group.properties.map(function([property, findings]) {
            return `<h4>${escapeHtml(property)}</h4><ul>${findings.map(function(finding) {
                return `<li><strong>${escapeHtml(finding.target)}</strong>: ${escapeHtml(JSON.stringify(finding.reference))} → ${escapeHtml(JSON.stringify(finding.candidate))} (${escapeHtml(occurrenceText(finding.occurrences || []))})</li>`;
            }).join("")}</ul>`;
        }).join("")}</section>`;
    }).join("");
}

function renderArtifacts(results) {
    return results.map(function(result) {
        return `<section><h3>${escapeHtml(result.scenario)} — ${escapeHtml(result.theme)} — ${escapeHtml(result.viewport)}</h3><dl><dt>Pixels</dt><dd>${escapeHtml(result.image.diffPixels)} (${escapeHtml(result.image.diffRatio)})</dd><dt>Dimensions</dt><dd>${escapeHtml(result.image.width)} × ${escapeHtml(result.image.height)}${result.image.dimensionMismatch ? " (mismatch)" : ""}</dd></dl><div class="images"><figure><figcaption>Reference</figcaption><img src="${escapeHtml(result.artifacts.reference)}" alt="Reference screenshot"></figure><figure><figcaption>Candidate</figcaption><img src="${escapeHtml(result.artifacts.candidate)}" alt="Candidate screenshot"></figure><figure><figcaption>Diff</figcaption><img src="${escapeHtml(result.artifacts.diff)}" alt="Pixel difference"></figure></div><p><a href="${escapeHtml(result.artifacts.structure)}">Structural findings JSON</a></p></section>`;
    }).join("");
}

function displayTheme(theme) {
    return theme.split("-").map(function(word) {
        return `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`;
    }).join(" ");
}

function renderHtml(metadata, results) {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>LegendHUB visual parity report</title><style>body{font-family:system-ui,sans-serif;margin:2rem;max-width:1200px}dl{display:grid;grid-template-columns:max-content 1fr;gap:.25rem 1rem}.images{display:flex;gap:1rem;flex-wrap:wrap}.images figure{margin:0;max-width:31%}.images img{display:block;max-width:100%;border:1px solid #888}section{margin:2rem 0}li{overflow-wrap:anywhere}</style></head><body><h1>LegendHUB visual parity report</h1><dl><dt>Reference SHA</dt><dd>${escapeHtml(metadata.referenceSha)}</dd><dt>Candidate SHA</dt><dd>${escapeHtml(metadata.candidateSha)}</dd><dt>UTC time</dt><dd>${escapeHtml(metadata.generatedAt)}</dd><dt>Mode</dt><dd>${escapeHtml(metadata.mode)}</dd><dt>Playwright</dt><dd>${escapeHtml(metadata.playwrightVersion)}</dd><dt>Chromium</dt><dd>${escapeHtml(metadata.chromiumVersion)}</dd><dt>Operating system</dt><dd>${escapeHtml(metadata.operatingSystem)}</dd><dt>Themes</dt><dd>${escapeHtml(metadata.themes.map(displayTheme).join(", "))}</dd><dt>Viewports</dt><dd>${escapeHtml(metadata.viewports.join(", "))}</dd></dl><h2>Captures by scenario, theme, and viewport</h2>${renderArtifacts(results)}<h2>Structural findings by scenario and root property</h2>${renderFindings(results)}</body></html>`;
}

function writeParityReport({outputDir, metadata, results}) {
    const safeMetadata = reportMetadata(metadata, results);
    fs.mkdirSync(outputDir, {recursive: true});
    const normalizedResults = results.map(function(result) {
        const stem = artifactStem(result);
        const artifacts = {
            reference: relativeArtifactPath(outputDir, "reference", `${stem}.png`),
            candidate: relativeArtifactPath(outputDir, "candidate", `${stem}.png`),
            diff: relativeArtifactPath(outputDir, "diff", `${stem}.png`),
            structure: relativeArtifactPath(outputDir, "structure", `${stem}.json`)
        };
        writeArtifact(outputDir, artifacts.reference, result.referencePng);
        writeArtifact(outputDir, artifacts.candidate, result.candidatePng);
        writeArtifact(outputDir, artifacts.diff, result.diffPng);
        writeArtifact(outputDir, artifacts.structure, JSON.stringify(result.structuralFindings || [], null, 2));
        return {
            scenario: result.scenario,
            theme: result.theme,
            viewport: result.viewport,
            image: serializedImage(result.image),
            structuralFindings: result.structuralFindings || [],
            artifacts
        };
    });
    const findingsPath = path.join(outputDir, "findings.json");
    const indexPath = path.join(outputDir, "index.html");
    fs.writeFileSync(findingsPath, JSON.stringify({metadata: safeMetadata, results: normalizedResults}, null, 2));
    fs.writeFileSync(indexPath, renderHtml(safeMetadata, normalizedResults));
    return {findingsPath, indexPath};
}

module.exports = {writeParityReport};
