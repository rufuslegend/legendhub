"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

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
