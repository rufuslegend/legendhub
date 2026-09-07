"use strict";

const {defineConfig, devices} = require("@playwright/test");

module.exports = defineConfig({
    testDir: "./e2e",
    outputDir: "./test-results/e2e",
    reporter: "list",
    workers: 1,
    timeout: 60_000,
    expect: {timeout: 10_000},
    use: {actionTimeout: 10_000, trace: "retain-on-failure", screenshot: "only-on-failure"},
    projects: [{name: "chromium", use: {...devices["Desktop Chrome"]}}]
});
