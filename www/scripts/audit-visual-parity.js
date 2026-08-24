#!/usr/bin/env node
"use strict";

const {parseVisualParityArgs} = require("./visual-parity/config");
const {runVisualParity} = require("./visual-parity/capture");

const HELP = `Usage: npm run parity:visual -- [options]

Deployment URLs and identities:
  --reference-base-url=URL  HTTPS URL for the frozen Angular reference
  --candidate-base-url=URL  HTTPS URL for the React candidate
  --reference-sha=SHA       Exact 40-character reference commit
  --candidate-sha=SHA       Exact 40-character candidate commit

Capture matrix:
  --mode=smoke|full         Glass Blue only or all nine themes (default: smoke)

Report output:
  --output-dir=PATH         Directory beneath data/parity-report

Failure behavior:
  --fail-on-diff            Exit 1 for findings; harness errors always exit 2
  --help                    Show this help
`;

function printSummary(io, run) {
    io.log(`Report: ${run.reportPaths.indexPath}`);
    io.log(`Findings: ${run.findingCount}`);
    io.log(`Errors: ${run.errorCount}`);
    io.log(`Exit: ${run.exitCode} (${run.exitCode === 0 ? "report complete" : run.exitCode === 1 ? "differences found" : "harness error"})`);
}

async function main(argv = process.argv.slice(2), io = console) {
    if (argv.includes("--help")) {
        io.log(HELP.trimEnd());
        return 0;
    }

    try {
        const run = await runVisualParity(parseVisualParityArgs(argv));
        printSummary(io, run);
        return run.exitCode;
    } catch (_error) {
        io.error("Errors: 1");
        io.error("Exit: 2 (harness error)");
        return 2;
    }
}

if (require.main === module) {
    main().then(function(exitCode) {
        process.exitCode = exitCode;
    });
}

module.exports = {HELP, main, printSummary};
