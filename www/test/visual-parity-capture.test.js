"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {PNG} = require("pngjs");

const {runVisualParity} = require("../scripts/visual-parity/capture");

const REFERENCE_SHA = "0cab3ac95826a53de19b3146d277e7056495210f";
const CANDIDATE_SHA = "1111111111111111111111111111111111111111";
const SCENARIO = {
    name: "controlled-card",
    route: "/",
    ready: "#target",
    capture: {kind: "locator", selector: "#target"},
    structuralTargets: [{
        name: "target",
        selector: "#target",
        checks: {text: true}
    }]
};
const STATE_SCENARIO = {
    name: "deterministic-state",
    route: "/",
    ready: "#target",
    capture: {kind: "locator", selector: "#target"},
    structuralTargets: [{
        name: "target",
        selector: "#target",
        checks: {text: true}
    }]
};
const PAGE_SCENARIO = {
    name: "controlled-page",
    route: "/",
    ready: "#target",
    capture: {kind: "page"},
    structuralTargets: [{
        name: "target",
        selector: "#target",
        checks: {text: true}
    }]
};

function html(background) {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>html,body{margin:0}#target{background:${background};color:#000;display:block;font:16px/20px sans-serif;height:64px;width:64px}</style></head><body><main id="target">Stable</main></body></html>`;
}

function stateHtml() {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>html,body{margin:0}#target{display:block;font:16px/20px sans-serif}</style></head><body><main id="target"></main><script>
    const cookies = Object.fromEntries(document.cookie.split("; ").map(value => value.split("=")));
    document.querySelector("#target").textContent = [
        innerWidth + "x" + innerHeight,
        devicePixelRatio,
        navigator.language,
        Intl.DateTimeFormat().resolvedOptions().timeZone,
        matchMedia("(prefers-reduced-motion: reduce)").matches ? "reduce" : "motion",
        cookies.theme,
        cookies["cookie-consent"],
        localStorage.getItem("cln") === ${JSON.stringify("6*Hero~Tank~1c0K0K0K0J0J1-10000___00H00N00T00000100.00s00o00o-BHKAA_00t00u00v00w_______00p00q01b________________*Hero~Caster~0U0m0U0U0U0U000000___0000000000000000000f__00g_______________________________*Scout~Original~0X0X0X0X0X0X000000___0000000000000000000f__________________________________*")} ? "lists" : "missing-lists",
        localStorage.getItem("scl")
    ].join("|");
    </script></body></html>`;
}

function externalAssetHtml(withApplicationError) {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="https://use.fontawesome.com/releases/v5.0.13/css/all.css"><style>#target{height:20px;width:64px}</style></head><body><main id="target">Stable</main>${withApplicationError ? "<script>console.error('application failure')</script>" : ""}</body></html>`;
}

function legacyAngularHtml() {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body><main id="target">Loading</main>
    <script src="https://ajax.googleapis.com/ajax/libs/angularjs/1.8.0/angular.min.js"></script>
    <script src="https://ajax.googleapis.com/ajax/libs/angularjs/1.8.0/angular-cookies.min.js"></script>
    <script>
    document.querySelector("#target").textContent = typeof angular === "undefined"
        ? "blocked"
        : angular.version.full + "|" + angular.module("ngCookies").name;
    </script></body></html>`;
}

function delayedLayoutHtml() {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>html,body{margin:0}#target{height:20px}</style></head><body><main id="target">Stable</main><script>
    const observer = new MutationObserver(function(records) {
        const captureStyleAdded = records.some(function(record) {
            return Array.from(record.addedNodes).some(function(node) {
                return node.tagName === "STYLE" && node.textContent.includes("caret-color");
            });
        });
        if (!captureStyleAdded)
            return;
        observer.disconnect();
        let remaining = 8;
        function grow() {
            const block = document.createElement("div");
            block.style.height = "100px";
            document.body.append(block);
            remaining -= 1;
            if (remaining > 0)
                requestAnimationFrame(grow);
        }
        requestAnimationFrame(grow);
    });
    observer.observe(document.head, {childList: true});
    </script></body></html>`;
}

function structuralHtml(includeTarget) {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body><div id="ready">Ready</div>${includeTarget ? '<main id="target">Stable</main>' : ""}</body></html>`;
}

async function startServer(render) {
    const server = http.createServer(function(_request, response) {
        const rendered = render();
        const status = typeof rendered === "object" ? rendered.status : 200;
        const body = typeof rendered === "object" ? rendered.body : rendered;
        response.writeHead(status, {"content-type": "text/html; charset=utf-8"});
        response.end(body);
    });
    await new Promise(function(resolve, reject) {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    return {
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        close: function() {
            return new Promise(function(resolve, reject) {
                server.close(function(error) {
                    if (error)
                        reject(error);
                    else
                        resolve();
                });
            });
        }
    };
}

async function startErrorServer(status) {
    return startServer(function() {
        return {status, body: "server failure"};
    });
}

test("browser capture reports a controlled visual and structural difference", async function(t) {
    let candidateBackground = "#f00";
    const reference = await startServer(function() { return html("#fff"); });
    const candidate = await startServer(function() { return html(candidateBackground); });
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "legendhub-capture-"));
    t.after(async function() {
        await Promise.all([reference.close(), candidate.close()]);
        fs.rmSync(outputDir, {recursive: true, force: true});
    });

    const differing = await runVisualParity({
        referenceBaseUrl: reference.baseUrl,
        candidateBaseUrl: candidate.baseUrl,
        referenceSha: REFERENCE_SHA,
        candidateSha: CANDIDATE_SHA,
        mode: "smoke",
        outputDir: path.join(outputDir, "different"),
        failOnDiff: false,
        scenarios: [SCENARIO]
    });

    assert.equal(differing.exitCode, 0);
    assert.equal(differing.results.length, 2);
    assert.equal(differing.results.every(result => result.image.diffPixels > 0), true);
    assert.equal(differing.results.flatMap(result => result.structuralFindings).length, 1);
    assert.deepEqual(differing.results.flatMap(result => result.structuralFindings)[0].occurrences, [
        {theme: "glass-blue", viewport: "desktop"},
        {theme: "glass-blue", viewport: "mobile"}
    ]);
    assert.equal(fs.existsSync(differing.reportPaths.indexPath), true);
    assert.equal(fs.existsSync(differing.reportPaths.findingsPath), true);

    for (const viewport of ["desktop", "mobile"]) {
        const stem = `controlled-card--glass-blue--${viewport}`;
        assert.equal(fs.existsSync(path.join(outputDir, "different", "reference", `${stem}.png`)), true);
        assert.equal(fs.existsSync(path.join(outputDir, "different", "candidate", `${stem}.png`)), true);
        assert.equal(fs.statSync(path.join(outputDir, "different", "diff", `${stem}.png`)).size > 0, true);
        assert.equal(fs.existsSync(path.join(outputDir, "different", "structure", "reference", `${stem}.json`)), true);
        assert.equal(fs.existsSync(path.join(outputDir, "different", "structure", "candidate", `${stem}.json`)), true);
    }

    candidateBackground = "#fff";
    const identical = await runVisualParity({
        referenceBaseUrl: reference.baseUrl,
        candidateBaseUrl: candidate.baseUrl,
        referenceSha: REFERENCE_SHA,
        candidateSha: CANDIDATE_SHA,
        mode: "smoke",
        outputDir: path.join(outputDir, "identical"),
        failOnDiff: true,
        scenarios: [SCENARIO]
    });

    assert.equal(identical.exitCode, 0);
    assert.equal(identical.results.every(result => result.image.diffPixels === 0), true);
    assert.equal(identical.results.flatMap(result => result.structuralFindings).length, 0);

    candidateBackground = "#f00";
    const failing = await runVisualParity({
        referenceBaseUrl: reference.baseUrl,
        candidateBaseUrl: candidate.baseUrl,
        referenceSha: REFERENCE_SHA,
        candidateSha: CANDIDATE_SHA,
        mode: "smoke",
        outputDir: path.join(outputDir, "fail-on-diff"),
        failOnDiff: true,
        scenarios: [SCENARIO]
    });
    assert.equal(failing.exitCode, 1);
});

test("visual parity CLI help documents URL, mode, output, and failure options", function() {
    const result = childProcess.spawnSync(process.execPath, [
        path.join(__dirname, "..", "scripts", "audit-visual-parity.js"),
        "--help"
    ], {encoding: "utf8"});

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /--reference-base-url/);
    assert.match(result.stdout, /--candidate-base-url/);
    assert.match(result.stdout, /--mode=smoke\|full/);
    assert.match(result.stdout, /--output-dir/);
    assert.match(result.stdout, /--fail-on-diff/);
});

test("scenario HTTP errors are recorded and force harness exit 2", async function(t) {
    const reference = await startServer(function() { return html("#fff"); });
    const candidate = await startErrorServer(500);
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "legendhub-capture-error-"));
    t.after(async function() {
        await Promise.all([reference.close(), candidate.close()]);
        fs.rmSync(outputDir, {recursive: true, force: true});
    });

    const run = await runVisualParity({
        referenceBaseUrl: reference.baseUrl,
        candidateBaseUrl: candidate.baseUrl,
        referenceSha: REFERENCE_SHA,
        candidateSha: CANDIDATE_SHA,
        mode: "smoke",
        outputDir,
        failOnDiff: false,
        scenarios: [SCENARIO]
    });

    assert.equal(run.exitCode, 2);
    assert.equal(run.errorCount > 0, true);
    const findingsReport = JSON.parse(fs.readFileSync(run.reportPaths.findingsPath, "utf8"));
    assert.equal(findingsReport.results.every(result => result.errors.length > 0), true);
    assert.match(fs.readFileSync(run.reportPaths.indexPath, "utf8"), /Scenario errors/);
});

test("browser contexts expose the required deterministic state", async function(t) {
    const reference = await startServer(stateHtml);
    const candidate = await startServer(stateHtml);
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "legendhub-capture-state-"));
    t.after(async function() {
        await Promise.all([reference.close(), candidate.close()]);
        fs.rmSync(outputDir, {recursive: true, force: true});
    });

    const run = await runVisualParity({
        referenceBaseUrl: reference.baseUrl,
        candidateBaseUrl: candidate.baseUrl,
        referenceSha: REFERENCE_SHA,
        candidateSha: CANDIDATE_SHA,
        mode: "smoke",
        outputDir,
        failOnDiff: true,
        scenarios: [STATE_SCENARIO]
    });

    assert.equal(run.exitCode, 0);
    assert.deepEqual(run.results.map(function(result) {
        return result.referenceStructuralSnapshots[0].text;
    }), [
        "1280x720|1|en-US|America/Chicago|reduce|glass-blue|true|lists|Hero!Tank",
        "375x667|1|en-US|America/Chicago|reduce|glass-blue|true|lists|Hero!Tank"
    ]);
    assert.deepEqual(run.results.map(function(result) {
        return result.candidateStructuralSnapshots[0].text;
    }), [
        "1280x720|1|en-US|America/Chicago|reduce|glass-blue|true|lists|Hero!Tank",
        "375x667|1|en-US|America/Chicago|reduce|glass-blue|true|lists|Hero!Tank"
    ]);
});

test("blocked third-party diagnostics are ignored while application console errors fail", async function(t) {
    let withApplicationError = false;
    const reference = await startServer(function() { return externalAssetHtml(withApplicationError); });
    const candidate = await startServer(function() { return externalAssetHtml(withApplicationError); });
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "legendhub-capture-console-"));
    t.after(async function() {
        await Promise.all([reference.close(), candidate.close()]);
        fs.rmSync(outputDir, {recursive: true, force: true});
    });

    const options = {
        referenceBaseUrl: reference.baseUrl,
        candidateBaseUrl: candidate.baseUrl,
        referenceSha: REFERENCE_SHA,
        candidateSha: CANDIDATE_SHA,
        mode: "smoke",
        failOnDiff: true,
        scenarios: [SCENARIO]
    };
    const policyOnly = await runVisualParity({...options, outputDir: path.join(outputDir, "policy-only")});
    assert.equal(policyOnly.exitCode, 0);
    assert.equal(policyOnly.errorCount, 0);

    withApplicationError = true;
    const applicationError = await runVisualParity({...options, outputDir: path.join(outputDir, "application-error")});
    assert.equal(applicationError.exitCode, 2);
    assert.equal(applicationError.results.every(result => result.errors.some(error => error.message === "browser console error")), true);
});

test("frozen reference receives pinned AngularJS while the candidate stays blocked", async function(t) {
    const reference = await startServer(legacyAngularHtml);
    const candidate = await startServer(legacyAngularHtml);
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "legendhub-capture-angularjs-"));
    t.after(async function() {
        await Promise.all([reference.close(), candidate.close()]);
        fs.rmSync(outputDir, {recursive: true, force: true});
    });

    const run = await runVisualParity({
        referenceBaseUrl: reference.baseUrl,
        candidateBaseUrl: candidate.baseUrl,
        referenceSha: REFERENCE_SHA,
        candidateSha: CANDIDATE_SHA,
        mode: "smoke",
        outputDir,
        failOnDiff: false,
        scenarios: [SCENARIO]
    });

    assert.equal(run.exitCode, 0);
    assert.equal(run.results[0].referenceStructuralSnapshots[0].text, "1.8.0|ngCookies");
    assert.equal(run.results[0].candidateStructuralSnapshots[0].text, "blocked");
});

test("vendored AngularJS reference fixtures match upstream 1.8.0", function() {
    const vendorRoot = path.join(__dirname, "../../scripts/fixtures/visual-parity/angularjs-1.8.0");
    const fixtures = [
        ["angular.min.js", "566f18cb8bc23558701c2cc4f934fe50bcc85629d1aaf5d589f835f2b3e57a9f"],
        ["angular-cookies.min.js", "eed97b74e2128f3d340325dd9cbfb9b8f70a1a5ade70eccca990d45483aa8700"]
    ];

    for (const [filename, expectedHash] of fixtures) {
        const filePath = path.join(vendorRoot, filename);
        assert.equal(fs.existsSync(filePath), true, `${filename} must be vendored`);
        assert.equal(crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex"), expectedHash);
    }
    assert.match(fs.readFileSync(path.join(vendorRoot, "LICENSE.md"), "utf8"), /The MIT License/);
});

test("full-page capture waits for delayed document layout to settle", async function(t) {
    const reference = await startServer(delayedLayoutHtml);
    const candidate = await startServer(delayedLayoutHtml);
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "legendhub-capture-layout-"));
    t.after(async function() {
        await Promise.all([reference.close(), candidate.close()]);
        fs.rmSync(outputDir, {recursive: true, force: true});
    });

    const run = await runVisualParity({
        referenceBaseUrl: reference.baseUrl,
        candidateBaseUrl: candidate.baseUrl,
        referenceSha: REFERENCE_SHA,
        candidateSha: CANDIDATE_SHA,
        mode: "smoke",
        outputDir,
        failOnDiff: true,
        scenarios: [PAGE_SCENARIO]
    });

    assert.equal(run.exitCode, 0);
    assert.deepEqual(run.results.map(result => PNG.sync.read(result.referencePng).height), [820, 820]);
    assert.deepEqual(run.results.map(result => PNG.sync.read(result.candidatePng).height), [820, 820]);
});

test("one-side and both-side missing structural targets are findings and scenario errors", async function(t) {
    let referenceHasTarget = true;
    let candidateHasTarget = false;
    const reference = await startServer(function() { return structuralHtml(referenceHasTarget); });
    const candidate = await startServer(function() { return structuralHtml(candidateHasTarget); });
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "legendhub-capture-missing-"));
    t.after(async function() {
        await Promise.all([reference.close(), candidate.close()]);
        fs.rmSync(outputDir, {recursive: true, force: true});
    });
    const scenario = {
        ...PAGE_SCENARIO,
        name: "missing-structural-target",
        ready: "#ready"
    };
    const options = {
        referenceBaseUrl: reference.baseUrl,
        candidateBaseUrl: candidate.baseUrl,
        referenceSha: REFERENCE_SHA,
        candidateSha: CANDIDATE_SHA,
        mode: "smoke",
        failOnDiff: false,
        scenarios: [scenario]
    };

    const oneSide = await runVisualParity({...options, outputDir: path.join(outputDir, "one-side")});
    assert.equal(oneSide.exitCode, 2);
    assert.equal(oneSide.errorCount, 2);
    assert.equal(oneSide.results.flatMap(result => result.structuralFindings).length, 1);
    assert.deepEqual(oneSide.results.flatMap(result => result.structuralFindings)[0], {
        scenario: "missing-structural-target",
        target: "target",
        property: "target",
        reference: "present",
        candidate: "missing",
        occurrences: [
            {theme: "glass-blue", viewport: "desktop"},
            {theme: "glass-blue", viewport: "mobile"}
        ]
    });

    referenceHasTarget = false;
    const bothSides = await runVisualParity({...options, outputDir: path.join(outputDir, "both-sides")});
    assert.equal(bothSides.exitCode, 2);
    assert.equal(bothSides.errorCount, 4);
    assert.equal(bothSides.results.flatMap(result => result.structuralFindings).length, 1);
    assert.deepEqual(bothSides.results.flatMap(result => result.structuralFindings)[0], {
        scenario: "missing-structural-target",
        target: "target",
        property: "target",
        reference: "missing",
        candidate: "missing",
        occurrences: [
            {theme: "glass-blue", viewport: "desktop"},
            {theme: "glass-blue", viewport: "mobile"}
        ]
    });
});

test("stored navigation errors redact URL credentials, queries, and fragments", async function(t) {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "legendhub-capture-redaction-"));
    t.after(function() {
        fs.rmSync(outputDir, {recursive: true, force: true});
    });
    const secretUrl = "https://user:CREDENTIAL_SECRET@example.test/private/path?QUERY_SECRET=1#FRAGMENT_SECRET";
    const run = await runVisualParity({
        referenceBaseUrl: "http://127.0.0.1:1",
        candidateBaseUrl: "http://127.0.0.1:2",
        referenceSha: REFERENCE_SHA,
        candidateSha: CANDIDATE_SHA,
        mode: "smoke",
        outputDir,
        failOnDiff: false,
        scenarios: [PAGE_SCENARIO],
        browserType: {
            launch: async function() {
                throw new Error(`page.goto: navigation failed at ${secretUrl}`);
            }
        }
    });

    assert.equal(run.exitCode, 2);
    const findings = fs.readFileSync(run.reportPaths.findingsPath, "utf8");
    const htmlReport = fs.readFileSync(run.reportPaths.indexPath, "utf8");
    for (const contents of [findings, htmlReport]) {
        assert.match(contents, /page\.goto: navigation failed at https:\/\/example\.test\/private\/path/);
        assert.doesNotMatch(contents, /user|CREDENTIAL_SECRET|QUERY_SECRET|FRAGMENT_SECRET/);
    }
});

test("malformed navigation URLs are conservatively redacted in results and reports", async function(t) {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "legendhub-capture-malformed-redaction-"));
    t.after(function() {
        fs.rmSync(outputDir, {recursive: true, force: true});
    });
    const secretUrl = "https://user:CREDENTIAL_SECRET@example.test:bad/private/path?token=QUERY_SECRET#FRAGMENT_SECRET";
    const run = await runVisualParity({
        referenceBaseUrl: "http://127.0.0.1:1",
        candidateBaseUrl: "http://127.0.0.1:2",
        referenceSha: REFERENCE_SHA,
        candidateSha: CANDIDATE_SHA,
        mode: "smoke",
        outputDir,
        failOnDiff: false,
        scenarios: [PAGE_SCENARIO],
        browserType: {
            launch: async function() {
                throw new Error(`page.goto: navigation failed at ${secretUrl}`);
            }
        }
    });

    assert.equal(run.exitCode, 2);
    const returnedErrors = JSON.stringify(run.results.flatMap(result => result.errors));
    const findings = fs.readFileSync(run.reportPaths.findingsPath, "utf8");
    const htmlReport = fs.readFileSync(run.reportPaths.indexPath, "utf8");
    for (const contents of [returnedErrors, findings, htmlReport]) {
        assert.match(contents, /page\.goto: navigation failed at https:\/\/example\.test:bad\/private\/path/);
        assert.doesNotMatch(contents, /user|CREDENTIAL_SECRET|QUERY_SECRET|FRAGMENT_SECRET/);
    }
});
