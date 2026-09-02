"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const {chromium} = require("@playwright/test");

async function loadPreviewModule() {
    const {createServer} = await import("vite");
    const vite = await createServer({
        appType: "custom",
        root: path.resolve(__dirname, "../.."),
        server: {hmr: false, middlewareMode: true, ws: false}
    });
    return {
        module: await vite.ssrLoadModule("/client/components/ItemPreview.jsx"),
        close: () => vite.close()
    };
}

function fakeClock() {
    let now = 0;
    let sequence = 0;
    const tasks = [];
    return {
        cancel(task) { task.cancelled = true; },
        schedule(callback, delay) {
            const task = {callback, cancelled: false, due: now + delay, sequence: sequence++};
            tasks.push(task);
            return task;
        },
        tick(milliseconds) {
            now += milliseconds;
            for (const task of tasks
                .filter(candidate => !candidate.cancelled && candidate.due <= now)
                .sort((left, right) => left.due - right.due || left.sequence - right.sequence)) {
                task.cancelled = true;
                task.callback();
            }
        }
    };
}

// Catches the preview opening early, surviving an abandoned hover, or closing
// while focus still keeps the item active.
test("item preview waits two seconds and remains open while any trigger is active", async function() {
    const loaded = await loadPreviewModule();
    const module = loaded.module;
    await loaded.close();
    assert.equal(typeof module.createItemPreviewController, "function");
    const clock = fakeClock();
    const events = [];
    const controller = module.createItemPreviewController({
        cancel: clock.cancel,
        onClose: () => events.push("close"),
        onOpen: () => events.push("open"),
        schedule: clock.schedule
    });

    controller.enter("pointer");
    clock.tick(1999);
    assert.deepEqual(events, []);
    controller.leave("pointer");
    clock.tick(1);
    assert.deepEqual(events, []);

    controller.enter("pointer");
    controller.enter("focus");
    clock.tick(2000);
    assert.deepEqual(events, ["open"]);
    controller.leave("pointer");
    clock.tick(1000);
    assert.deepEqual(events, ["open"]);
    controller.leave("focus");
    clock.tick(99);
    assert.deepEqual(events, ["open"]);
    clock.tick(1);
    assert.deepEqual(events, ["open", "close"]);
});

// Catches Escape and unmount cleanup leaving a pending or visible preview.
test("item preview dismissal cancels pending work and closes immediately", async function() {
    const loaded = await loadPreviewModule();
    const module = loaded.module;
    await loaded.close();
    assert.equal(typeof module.createItemPreviewController, "function");
    const clock = fakeClock();
    const events = [];
    const controller = module.createItemPreviewController({
        cancel: clock.cancel,
        onClose: () => events.push("close"),
        onOpen: () => events.push("open"),
        schedule: clock.schedule
    });

    controller.enter("focus");
    controller.dismiss();
    clock.tick(2000);
    assert.deepEqual(events, ["close"]);

    controller.enter("focus");
    clock.tick(2000);
    controller.dispose();
    assert.deepEqual(events, ["close", "open", "close"]);
});

// Catches pointer-anchored previews reverting to screen centering or spilling
// beyond the viewport instead of flipping beside the pointer.
test("item preview placement stays beside the pointer and flips at viewport edges", async function() {
    const loaded = await loadPreviewModule();
    const module = loaded.module;
    await loaded.close();
    assert.equal(typeof module.placeItemPreview, "function");

    assert.deepEqual(module.placeItemPreview({
        height: 300,
        pointerX: 300,
        pointerY: 200,
        viewportHeight: 800,
        viewportWidth: 1000,
        width: 400
    }), {left: 312, top: 212});
    assert.deepEqual(module.placeItemPreview({
        height: 300,
        pointerX: 950,
        pointerY: 750,
        viewportHeight: 800,
        viewportWidth: 1000,
        width: 400
    }), {left: 538, top: 438});
});

// Catches the label and value columns drifting between rows or reverting to
// right-aligned values in the compact preview.
test("preview stat rows use equal left-aligned columns", async function() {
    const stylesheet = await fs.readFile(
        path.resolve(__dirname, "../../src/public/css/bootstrap-dark.min.css"),
        "utf8"
    );
    const browser = await chromium.launch({headless: true});
    try {
        const page = await browser.newPage({viewport: {height: 300, width: 400}});
        await page.setContent(`
            <style>${stylesheet}</style>
            <body class="item-preview-document">
                <div class="container">
                    <dl class="item-preview-stats">
                        <div class="item-preview-stat"><dt>AC</dt><dd>-3</dd></div>
                        <div class="item-preview-stat"><dt>Melee Mitigation</dt><dd>5</dd></div>
                    </dl>
                </div>
            </body>
        `);

        const rows = await page.locator(".item-preview-stat").evaluateAll(elements => elements.map(row => {
            const label = row.querySelector("dt");
            const value = row.querySelector("dd");
            const labelBox = label.getBoundingClientRect();
            const valueBox = value.getBoundingClientRect();
            return {
                labelAlign: getComputedStyle(label).textAlign,
                labelWidth: labelBox.width,
                valueAlign: getComputedStyle(value).textAlign,
                valueLeft: valueBox.left
            };
        }));

        assert.deepEqual(rows.map(row => row.labelAlign), ["left", "left"]);
        assert.deepEqual(rows.map(row => row.valueAlign), ["left", "left"]);
        assert.equal(rows[0].labelWidth, rows[1].labelWidth);
        assert.equal(rows[0].valueLeft, rows[1].valueLeft);
    } finally {
        await browser.close();
    }
});
