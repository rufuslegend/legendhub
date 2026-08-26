"use strict";

function normalizeReturnUrl(value) {
    if (typeof value !== "string" ||
        !value.startsWith("/") ||
        value.startsWith("//") ||
        value.includes("\\") ||
        /[\u0000-\u001f\u007f]/.test(value)) {
        return "/";
    }

    return value;
}

function requireSameOrigin(req, res, next) {
    const origin = req.get("origin");
    const expectedOrigin = `${req.protocol}://${req.get("host")}`;

    if (origin !== expectedOrigin)
        return res.sendStatus(403);

    return next();
}

module.exports = {normalizeReturnUrl, requireSameOrigin};
