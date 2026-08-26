"use strict";

function resolveItemSort(sortBy, noSearch, metadata) {
    const fallback = noSearch ? "ModifiedOn" : "Name";
    if (typeof sortBy !== "string")
        return fallback;

    const match = metadata.find(function(field) {
        return typeof field.Var === "string" &&
            field.Var.toLowerCase() === sortBy.toLowerCase();
    });
    return match ? match.Var : fallback;
}

module.exports = {resolveItemSort};
