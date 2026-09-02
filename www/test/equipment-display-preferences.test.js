"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

test("equipment table zero hiding applies only to non-Rent numeric stats", async function() {
    const {createServer} = await import("vite");
    const vite = await createServer({
        appType: "custom",
        root,
        server: {hmr: false, middlewareMode: true, ws: false}
    });
    try {
        const {equipmentTableValue} = await vite.ssrLoadModule(
            "/client/lib/equipment-display-preferences.js"
        );
        const integer = {type: "int", var: "strength"};
        const decimal = {type: "decimal", var: "weight"};

        assert.equal(equipmentTableValue(0, integer, true), "");
        assert.equal(equipmentTableValue("0.00", decimal, true), "");
        assert.equal(equipmentTableValue("1.50", decimal, true), "1.50");
        assert.equal(equipmentTableValue(0, {type: "int", var: "rent"}, true), 0);
        assert.equal(equipmentTableValue(0, {type: "bool", var: "unique"}, true), 0);
        assert.equal(equipmentTableValue(0, {type: "select", var: "slot"}, true), 0);
        assert.equal(equipmentTableValue(null, integer, true), "");
        assert.equal(equipmentTableValue(undefined, integer, true), "");
        assert.equal(equipmentTableValue("0.00", decimal, false), "0.00");
    }
    finally {
        await vite.close();
    }
});
