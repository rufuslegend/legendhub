"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {writeParityReport} = require("../scripts/visual-parity/report");

function png(name) {
    return fs.readFileSync(path.join(__dirname, "fixtures", "visual-parity", name));
}

test("parity report persists image and structure artifacts with escaped grouped findings", function(t) {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "legendhub-visual-parity-"));
    t.after(function() {
        fs.rmSync(outputDir, {recursive: true, force: true});
    });
    const finding = {
        scenario: "builder-populated",
        target: "equipment headers",
        property: "text",
        reference: "Slot Lock Name Str",
        candidate: "<script>alert(1)</script>",
        occurrences: [
            {theme: "glass-blue", viewport: "desktop"},
            {theme: "glass-blue", viewport: "mobile"}
        ]
    };

    const paths = writeParityReport({
        outputDir,
        metadata: {
            referenceSha: "0cab3ac95826a53de19b3146d277e7056495210f",
            candidateSha: "1111111111111111111111111111111111111111",
            generatedAt: "2026-08-24T12:34:56.000Z",
            mode: "smoke",
            playwrightVersion: "1.62.1",
            chromiumVersion: "140.0.0",
            operatingSystem: "Linux x64"
        },
        results: [{
            scenario: "builder-populated",
            theme: "glass-blue",
            viewport: "desktop",
            referencePng: png("reference.png"),
            candidatePng: png("candidate.png"),
            diffPng: png("candidate.png"),
            image: {width: 4, height: 4, diffPixels: 1, diffRatio: 1 / 16, dimensionMismatch: false},
            structuralFindings: [finding]
        }]
    });

    assert.equal(paths.findingsPath, path.join(outputDir, "findings.json"));
    assert.equal(paths.indexPath, path.join(outputDir, "index.html"));
    assert.equal(fs.existsSync(path.join(outputDir, "findings.json")), true);
    assert.equal(fs.existsSync(path.join(outputDir, "index.html")), true);
    assert.equal(fs.existsSync(path.join(outputDir, "reference", "builder-populated--glass-blue--desktop.png")), true);
    assert.equal(fs.existsSync(path.join(outputDir, "candidate", "builder-populated--glass-blue--desktop.png")), true);
    assert.equal(fs.existsSync(path.join(outputDir, "diff", "builder-populated--glass-blue--desktop.png")), true);
    assert.equal(fs.existsSync(path.join(outputDir, "structure", "builder-populated--glass-blue--desktop.json")), true);

    const html = fs.readFileSync(paths.indexPath, "utf8");
    assert.match(html, /0cab3ac95826a53de19b3146d277e7056495210f/);
    assert.match(html, /reference\/builder-populated--glass-blue--desktop\.png/);
    assert.match(html, /candidate\/builder-populated--glass-blue--desktop\.png/);
    assert.match(html, /diff\/builder-populated--glass-blue--desktop\.png/);
    assert.equal((html.match(/equipment headers/g) || []).length, 1);
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);

    assert.deepEqual(JSON.parse(fs.readFileSync(paths.findingsPath, "utf8")).results[0].structuralFindings, [finding]);
});

test("parity report keeps generated artifact links relative and excludes undeclared metadata", function(t) {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "legendhub-visual-parity-"));
    t.after(function() {
        fs.rmSync(outputDir, {recursive: true, force: true});
    });

    const paths = writeParityReport({
        outputDir,
        metadata: {
            referenceSha: "0cab3ac95826a53de19b3146d277e7056495210f",
            candidateSha: "1111111111111111111111111111111111111111",
            generatedAt: "2026-08-24T12:34:56.000Z",
            mode: "smoke",
            playwrightVersion: "1.62.1",
            chromiumVersion: "140.0.0",
            operatingSystem: "Linux x64",
            token: "must-not-appear"
        },
        results: [{
            scenario: "../../outside",
            theme: "glass-blue",
            viewport: "desktop",
            referencePng: png("reference.png"),
            candidatePng: png("candidate.png"),
            diffPng: png("candidate.png"),
            image: {width: 4, height: 4, diffPixels: 1, diffRatio: 1 / 16, dimensionMismatch: false},
            structuralFindings: []
        }]
    });
    const html = fs.readFileSync(paths.indexPath, "utf8");
    const findings = fs.readFileSync(paths.findingsPath, "utf8");

    assert.doesNotMatch(html, /(?:href|src)="(?:\/|\.\.\/)/);
    assert.doesNotMatch(html, /must-not-appear/);
    assert.doesNotMatch(findings, /must-not-appear/);
    assert.equal(fs.existsSync(path.join(outputDir, "reference", "outside--glass-blue--desktop.png")), true);
});
