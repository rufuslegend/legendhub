"use strict";

const crypto = require("crypto");

function hashValidator(validator) {
    return crypto.createHash("sha256").update(validator).digest("hex");
}

function createActionToken(options = {}) {
    const random = options.randomBytes || crypto.randomBytes;
    const selector = random(6).toString("hex");
    const validator = random(24).toString("hex");
    const expiresOn = new Date((options.now || new Date()).getTime() + options.lifetimeMs);

    return {
        selector,
        validator,
        expiresOn,
        token: `${selector}-${validator}`,
        hashedValidator: hashValidator(validator)
    };
}

function parseActionToken(token) {
    const separatorIndex = token.indexOf("-");
    return {
        selector: token.slice(0, separatorIndex),
        validator: token.slice(separatorIndex + 1)
    };
}

module.exports = {createActionToken, hashValidator, parseActionToken};
