"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const {chromium} = require("@playwright/test");

async function tableStyles(theme) {
    const stylesheet = await fs.readFile(path.resolve(
        __dirname, `../src/public/css/bootstrap-${theme}.min.css`), "utf8");
    const browser = await chromium.launch({headless: true});
    try {
        const page = await browser.newPage();
        const rows = Array.from({length: 7}, function(_, index) {
            const band = index >= 3 && index <= 5 ? "glass-table-band" : "";
            return `<tr class="${band}"><td>Row ${index + 1}</td><td>Value</td></tr>`;
        }).join("");
        await page.setContent(`
            <style>${stylesheet}</style>
            <table class="table table-striped table-bordered table-hover glass-banded-table">
                <tbody>${rows}</tbody>
            </table>
        `);
        const rowStyles = await page.locator("tbody tr").evaluateAll(elements => elements.map(row => ({
            background: getComputedStyle(row).backgroundColor,
            color: getComputedStyle(row).color
        })));
        const cellStyles = await page.locator("tbody td").first().evaluate(cell => ({
            bottom: getComputedStyle(cell).borderBottomWidth,
            left: getComputedStyle(cell).borderLeftWidth,
            right: getComputedStyle(cell).borderRightWidth,
            top: getComputedStyle(cell).borderTopWidth
        }));
        await page.locator("tbody tr").nth(4).hover();
        const hovered = await page.locator("tbody tr").nth(4).evaluate(row => ({
            background: getComputedStyle(row).backgroundColor,
            color: getComputedStyle(row).color
        }));
        return {cellStyles, hovered, rowStyles};
    } finally {
        await browser.close();
    }
}

// Catches the targeted Glass tables restoring horizontal grid lines, ordinary
// zebra stripes, or a band color that masks the established hover highlight.
test("Glass result tables use vertical separators and alternating three-row bands", async function() {
    const {cellStyles, hovered, rowStyles} = await tableStyles("glass-blue");

    assert.deepEqual(rowStyles.map(row => row.background), [
        "rgba(0, 0, 0, 0)",
        "rgba(0, 0, 0, 0)",
        "rgba(0, 0, 0, 0)",
        "rgba(74, 143, 221, 0.08)",
        "rgba(74, 143, 221, 0.08)",
        "rgba(74, 143, 221, 0.08)",
        "rgba(0, 0, 0, 0)"
    ]);
    assert.deepEqual(cellStyles, {bottom: "0px", left: "1px", right: "1px", top: "0px"});
    assert.deepEqual(hovered, {
        background: "rgba(88, 170, 255, 0.14)",
        color: "rgb(255, 255, 255)"
    });
});

// Catches the Glass-specific density class changing the established grid and
// zebra behavior when a player uses a non-Glass theme.
test("non-Glass result tables retain their normal borders and striping", async function() {
    const {cellStyles, rowStyles} = await tableStyles("dark");

    assert.notEqual(rowStyles[0].background, rowStyles[1].background);
    assert.equal(cellStyles.top, "1px");
    assert.equal(cellStyles.bottom, "1px");
});
