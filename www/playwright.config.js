"use strict";

const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
    testDir: "./accessibility",
    outputDir: "./test-results/accessibility",
    reporter: "list",
    projects: [
        {
            name: "chromium",
            use: {
                ...devices["Desktop Chrome"]
            }
        }
    ]
});
