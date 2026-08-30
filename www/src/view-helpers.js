"use strict";

const THEMES = new Set([
    "glass-blue",
    "glass-emerald",
    "glass-ruby",
    "glass-amethyst",
    "glass-amber",
    "light",
    "dark",
    "solarized-dark",
    "high-contrast"
]);

function normalizeTheme(value) {
    return typeof value === "string" && THEMES.has(value) ? value : "dark";
}

function serializeJsonForHtml(value) {
    const serialized = JSON.stringify(value);

    if (serialized === undefined)
        throw new TypeError("Value cannot be serialized as JSON.");

    return serialized.replace(/[<>&\u2028\u2029]/g, function(character) {
        return {
            "<": "\\u003c",
            ">": "\\u003e",
            "&": "\\u0026",
            "\u2028": "\\u2028",
            "\u2029": "\\u2029"
        }[character];
    });
}

module.exports = {normalizeTheme, serializeJsonForHtml};
