"use strict";

const {BadRequestError} = require("./utils");

function normalizeEmail(value) {
    const display = typeof value === "string" ? value.trim() : "";
    if (Buffer.byteLength(display, "utf8") > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(display)) {
        throw new BadRequestError("Enter a valid email address.");
    }

    return {display, normalized: display.toLowerCase()};
}

module.exports = {normalizeEmail};
