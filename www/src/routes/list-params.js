"use strict";

function stringParam(value) {
    return typeof value === "string" ? value : null;
}

function integerParam(value) {
    if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value))
        return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
}

function pageParam(value) {
    const parsed = integerParam(value);
    return parsed && parsed > 0 ? parsed : 1;
}

function booleanParam(value) {
    if (value === "true") return true;
    if (value === "false") return false;
    return null;
}

function sortParam(value, allowed) {
    const parsed = stringParam(value);
    return parsed && allowed.includes(parsed) ? parsed : null;
}

function buildListUrl(path, params) {
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(params)) {
        if (value !== null && value !== undefined)
            query.set(name, String(value));
    }
    const serialized = query.toString();
    return `${path}${serialized ? `?${serialized}` : "?"}`;
}

module.exports = {
    booleanParam,
    buildListUrl,
    integerParam,
    pageParam,
    sortParam,
    stringParam
};
