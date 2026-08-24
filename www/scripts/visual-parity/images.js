"use strict";

const {PNG} = require("pngjs");

async function comparePngBuffers(referenceBuffer, candidateBuffer, options = {}) {
    const reference = PNG.sync.read(referenceBuffer);
    const candidate = PNG.sync.read(candidateBuffer);
    const dimensionMismatch = reference.width !== candidate.width || reference.height !== candidate.height;
    const width = Math.max(reference.width, candidate.width);
    const height = Math.max(reference.height, candidate.height);
    const diff = new PNG({width, height});

    if (dimensionMismatch) {
        for (let offset = 0; offset < diff.data.length; offset += 4) {
            diff.data[offset] = 255;
            diff.data[offset + 1] = 0;
            diff.data[offset + 2] = 255;
            diff.data[offset + 3] = 255;
        }
        return {
            width,
            height,
            diffPixels: width * height,
            diffRatio: 1,
            dimensionMismatch,
            diffPng: PNG.sync.write(diff)
        };
    }

    const {default: pixelmatch} = await import("pixelmatch");
    const diffPixels = pixelmatch(reference.data, candidate.data, diff.data, width, height, {
        threshold: options.threshold ?? 0.1,
        includeAA: false
    });
    return {
        width,
        height,
        diffPixels,
        diffRatio: diffPixels / (width * height),
        dimensionMismatch,
        diffPng: PNG.sync.write(diff)
    };
}

module.exports = {comparePngBuffers};
