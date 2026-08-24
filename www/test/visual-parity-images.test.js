"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {PNG} = require("pngjs");

const {comparePngBuffers} = require("../scripts/visual-parity/images");

const fixtures = path.join(__dirname, "fixtures", "visual-parity");
const reference = fs.readFileSync(path.join(fixtures, "reference.png"));
const candidate = fs.readFileSync(path.join(fixtures, "candidate.png"));
const differentSize = fs.readFileSync(path.join(fixtures, "different-size.png"));

test("PNG comparison reports a changed pixel with a valid diff image", async function() {
    const result = await comparePngBuffers(reference, candidate, {threshold: 0.1});

    assert.equal(result.width, 4);
    assert.equal(result.height, 4);
    assert.equal(result.diffPixels, 1);
    assert.equal(result.diffRatio, 1 / 16);
    assert.equal(result.dimensionMismatch, false);
    assert.ok(PNG.sync.read(result.diffPng).data.some(function(channel) {
        return channel !== 255;
    }));
});

test("PNG comparison writes a zero-difference PNG for identical images", async function() {
    const result = await comparePngBuffers(reference, reference);
    const diff = PNG.sync.read(result.diffPng);

    assert.equal(result.diffPixels, 0);
    assert.equal(result.diffRatio, 0);
    assert.equal(result.dimensionMismatch, false);
    assert.equal(diff.width, 4);
    assert.equal(diff.height, 4);
});

test("PNG comparison highlights the complete larger canvas when dimensions differ", async function() {
    const result = await comparePngBuffers(reference, differentSize);
    const diff = PNG.sync.read(result.diffPng);

    assert.equal(result.width, 5);
    assert.equal(result.height, 4);
    assert.equal(result.dimensionMismatch, true);
    assert.equal(result.diffPixels, 20);
    assert.equal(result.diffRatio, 1);
    assert.ok(diff.data.some(function(channel) {
        return channel !== 255;
    }));
});
