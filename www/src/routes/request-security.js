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

    if (origin && origin !== "null") {
        if (origin === expectedOrigin)
            return next();
        return res.sendStatus(403);
    }

    const referer = req.get("referer");
    if (referer) {
        try {
            if (new URL(referer).origin === expectedOrigin)
                return next();
        }
        catch (_error) {
            // Malformed referrers do not establish a same-origin request.
        }
        return res.sendStatus(403);
    }

    if (req.get("sec-fetch-site") === "same-origin")
        return next();

    return res.sendStatus(403);
}

module.exports = {normalizeReturnUrl, requireSameOrigin};
