"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const sourceRoot = path.join(root, "css/scss");
const distRoot = path.join(root, "css/dist/css");
const publicRoot = path.join(root, "www/src/public/css");

const palettes = {
    blue: {
        line: "#3a6a99", glow: "70, 140, 220", wash: "88, 170, 255",
        ink: "#eaf4ff", backdrop: "#05070b", surface: "#060b12",
        well: "#02050a", category: "#0a1522", accent: "#7fc4ff",
        bright: "#58aaff", headerBase: "#0d1f30",
        header: "#8fb8dd 0%, #4a7dab 8%, #2b5580 45%, #12293f 50%, #0d1f30 100%",
        button: "rgba(150, 190, 230, .35) 0%, rgba(70, 110, 160, .25) 45%, rgba(8, 20, 38, .55) 50%, rgba(3, 10, 22, .65) 100%",
        buttonHover: "rgba(170, 205, 240, .45) 0%, rgba(90, 130, 180, .35) 45%, rgba(12, 28, 50, .6) 50%, rgba(5, 14, 28, .7) 100%"
    },
    emerald: {
        line: "#3a996a", glow: "70, 220, 140", wash: "88, 255, 170",
        ink: "#eafff4", backdrop: "#050b07", surface: "#06120b",
        well: "#020a05", category: "#0a2215", accent: "#7fffc4",
        bright: "#58ffaa", headerBase: "#0d301f",
        header: "#8fddb8 0%, #4aab7d 8%, #2b8055 45%, #123f29 50%, #0d301f 100%",
        button: "rgba(150, 230, 190, .35) 0%, rgba(70, 160, 110, .25) 45%, rgba(8, 38, 20, .55) 50%, rgba(3, 22, 10, .65) 100%",
        buttonHover: "rgba(170, 240, 205, .45) 0%, rgba(90, 180, 130, .35) 45%, rgba(12, 50, 28, .6) 50%, rgba(5, 28, 14, .7) 100%"
    },
    ruby: {
        line: "#993a55", glow: "220, 70, 120", wash: "255, 88, 140",
        ink: "#ffeaf0", backdrop: "#0b0507", surface: "#12060a",
        well: "#0a0205", category: "#220a13", accent: "#ff7fa6",
        bright: "#ff5888", headerBase: "#300d18",
        header: "#dd8fa3 0%, #ab4a63 8%, #802b44 45%, #3f121f 50%, #300d18 100%",
        button: "rgba(230, 150, 180, .35) 0%, rgba(160, 70, 105, .25) 45%, rgba(38, 8, 20, .55) 50%, rgba(22, 3, 11, .65) 100%",
        buttonHover: "rgba(240, 170, 198, .45) 0%, rgba(180, 90, 125, .35) 45%, rgba(50, 12, 28, .6) 50%, rgba(28, 5, 15, .7) 100%"
    },
    amethyst: {
        line: "#6a3a99", glow: "140, 70, 220", wash: "170, 88, 255",
        ink: "#f4eaff", backdrop: "#07050b", surface: "#0b0612",
        well: "#05020a", category: "#150a22", accent: "#c47fff",
        bright: "#aa58ff", headerBase: "#1f0d30",
        header: "#b88fdd 0%, #7d4aab 8%, #552b80 45%, #29123f 50%, #1f0d30 100%",
        button: "rgba(190, 150, 230, .35) 0%, rgba(110, 70, 160, .25) 45%, rgba(20, 8, 38, .55) 50%, rgba(10, 3, 22, .65) 100%",
        buttonHover: "rgba(205, 170, 240, .45) 0%, rgba(130, 90, 180, .35) 45%, rgba(28, 12, 50, .6) 50%, rgba(14, 5, 28, .7) 100%"
    },
    amber: {
        line: "#99763a", glow: "220, 160, 70", wash: "255, 190, 88",
        ink: "#fff6ea", backdrop: "#0b0805", surface: "#120e06",
        well: "#0a0602", category: "#221a0a", accent: "#ffd77f",
        bright: "#ffc258", headerBase: "#30240d",
        header: "#ddc48f 0%, #ab8a4a 8%, #80622b 45%, #3f2d12 50%, #30240d 100%",
        button: "rgba(230, 200, 150, .35) 0%, rgba(160, 125, 70, .25) 45%, rgba(38, 28, 8, .55) 50%, rgba(22, 16, 3, .65) 100%",
        buttonHover: "rgba(240, 215, 170, .45) 0%, rgba(180, 145, 90, .35) 45%, rgba(50, 38, 12, .6) 50%, rgba(28, 20, 5, .7) 100%"
    }
};

function compact(value) {
    return value.replace(/\s+/g, " ").trim();
}

test("Glass palettes preserve the approved lmproxy hue contracts", function() {
    for (const [hue, expected] of Object.entries(palettes)) {
        const source = compact(fs.readFileSync(path.join(
            sourceRoot, `custom/themes/_glass-${hue}-palette.scss`), "utf8"));

        for (const [variable, value] of [
            ["glass-line", expected.line],
            ["glass-glow-rgb", expected.glow],
            ["glass-wash-rgb", expected.wash],
            ["glass-ink", expected.ink],
            ["glass-backdrop", expected.backdrop],
            ["glass-surface", expected.surface],
            ["glass-well", expected.well],
            ["gray-800", expected.category],
            ["glass-accent", expected.accent],
            ["glass-accent-bright", expected.bright],
            ["glass-header-bg", expected.headerBase]
        ]) {
            assert.ok(source.includes(`$${variable}: ${value};`),
                `${hue} must define $${variable}: ${value}`);
        }

        assert.ok(source.includes(
            `$glass-header-gradient: linear-gradient(to bottom, ${expected.header});`));
        assert.ok(source.includes(
            `$glass-button-gradient: linear-gradient(to bottom, ${expected.button});`));
        assert.ok(source.includes(
            `$glass-button-hover-gradient: linear-gradient(to bottom, ${expected.buttonHover});`));
        assert.doesNotMatch(source, /\.(?:navbar|card|btn|modal|dropdown)/,
            `${hue} palette must not copy structural component rules`);
    }
});

test("every Glass entrypoint uses its palette and the shared skin", function() {
    const packageJson = JSON.parse(fs.readFileSync(path.join(
        root, "css/package.json"), "utf8"));
    const chrome = fs.readFileSync(path.join(
        sourceRoot, "custom/themes/_glass-chrome.scss"), "utf8");

    for (const hue of Object.keys(palettes)) {
        const entry = fs.readFileSync(path.join(
            sourceRoot, `bootstrap-glass-${hue}.scss`), "utf8");
        const palette = entry.indexOf(`custom/themes/glass-${hue}-palette`);
        const theme = entry.indexOf("custom/themes/glass-theme");
        const bootstrap = entry.indexOf("bootstrap/functions");
        const custom = entry.indexOf("custom/custom");
        const sharedChrome = entry.indexOf("custom/themes/glass-chrome");

        assert.ok(palette >= 0 && palette < theme);
        assert.ok(theme < bootstrap && bootstrap < custom);
        assert.ok(custom < sharedChrome);
        assert.match(packageJson.scripts["build:minify"], new RegExp(
            `bootstrap-glass-${hue}\\.min\\.css`));
    }

    for (const selector of [".navbar", ".card", ".btn", ".modal-content"])
        assert.ok(chrome.includes(selector), `shared chrome missing ${selector}`);
});

test("every Glass bundle and public copy is complete", function() {
    for (const [hue, expected] of Object.entries(palettes)) {
        for (const filename of [
            `bootstrap-glass-${hue}.css`,
            `bootstrap-glass-${hue}.css.map`,
            `bootstrap-glass-${hue}.min.css`,
            `bootstrap-glass-${hue}.min.css.map`
        ]) {
            const artifact = path.join(distRoot, filename);
            assert.ok(fs.statSync(artifact).size > 0,
                `missing or empty ${path.relative(root, artifact)}`);
        }

        for (const filename of [
            `bootstrap-glass-${hue}.min.css`,
            `bootstrap-glass-${hue}.min.css.map`
        ]) {
            assert.equal(
                fs.readFileSync(path.join(distRoot, filename), "utf8"),
                fs.readFileSync(path.join(publicRoot, filename), "utf8"),
                `${filename} public copy must match dist`
            );
        }

        const expandedFilename = `bootstrap-glass-${hue}.css`;
        const minifiedFilename = `bootstrap-glass-${hue}.min.css`;
        const minifiedMapFilename = `${minifiedFilename}.map`;
        const expanded = fs.readFileSync(path.join(
            distRoot, expandedFilename), "utf8");
        const minified = fs.readFileSync(path.join(
            distRoot, minifiedFilename), "utf8");
        const expandedMap = JSON.parse(fs.readFileSync(path.join(
            distRoot, `${expandedFilename}.map`), "utf8"));
        const minifiedMap = JSON.parse(fs.readFileSync(path.join(
            distRoot, minifiedMapFilename), "utf8"));
        const sourceMapReference = minified.match(
            /sourceMappingURL=([^\s*]+)\s*\*\//);

        assert.ok(sourceMapReference,
            `${hue} minified CSS must reference its map`);
        assert.equal(sourceMapReference[1], minifiedMapFilename);
        assert.match(minified, new RegExp(
            `--glass-line:${expected.line}`));
        assert.ok(expandedMap.sources.some(function(source) {
            return source.endsWith(`_glass-${hue}-palette.scss`);
        }), `${hue} expanded map must include its palette`);
        assert.deepEqual(minifiedMap.sources, [expandedFilename]);
        assert.deepEqual(minifiedMap.sourcesContent, [expanded]);
    }
});
