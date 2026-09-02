"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const {chromium} = require("@playwright/test");

const themes = [
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

async function columnStyles(page, theme) {
    const stylesheet = await fs.readFile(path.resolve(
        __dirname, `../src/public/css/bootstrap-${theme}.min.css`), "utf8");
    await page.setContent(`
        <style>${stylesheet}</style>
        <table class="table table-sm" style="width: 800px">
            <thead><tr><th class="item-slot-column">Slot</th><th>Name</th></tr></thead>
            <tbody><tr>
                <td class="item-slot-column">About Body</td>
                <td>Plain iron breastplate</td>
            </tr></tbody>
        </table>
    `);
    return page.locator("tbody td").evaluateAll(cells => cells.map(cell => ({
        whiteSpace: getComputedStyle(cell).whiteSpace,
        width: cell.getBoundingClientRect().width
    })));
}

// Catches any generated theme omitting the shared compact-column rule, which
// would let Slot absorb spare width or wrap its readable label.
test("every theme keeps Slot narrow and readable", async function() {
    const browser = await chromium.launch({headless: true});
    try {
        const page = await browser.newPage();
        for (const theme of themes) {
            const [slot, name] = await columnStyles(page, theme);
            assert.equal(slot.whiteSpace, "nowrap", `${theme} must not wrap Slot labels`);
            assert.ok(slot.width < name.width,
                `${theme} Slot column must remain narrower than Name`);
            assert.ok(slot.width < 150,
                `${theme} Slot column expanded to ${slot.width}px`);
        }
    }
    finally {
        await browser.close();
    }
});
