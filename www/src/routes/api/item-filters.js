"use strict";

const identifierPattern = /^[a-z][A-Za-z0-9]*$/;
const numericClausePattern = /^(?:=|<>|!=|>=|<=|>|<) -?\d+(?:\.\d+)?$/;
const stringClausePattern = /^(?:=|<>|!=) ''$/;
const selectClausePattern = /^(=|<>|!=|>=|<=|>|<) \{0\}$/;

function trustedClause(metadata) {
    if (!identifierPattern.test(metadata.Var || ""))
        return null;

    if (metadata.Type === "select") {
        const match = selectClausePattern.exec(metadata.FilterString || "");
        return match ? `${match[1]} ?` : null;
    }
    if (metadata.Type === "string")
        return stringClausePattern.test(metadata.FilterString || "") ?
            metadata.FilterString : null;
    if (["bool", "decimal", "int"].includes(metadata.Type))
        return numericClausePattern.test(metadata.FilterString || "") ?
            metadata.FilterString : null;
    return null;
}

function resolveItemFilters(filterString, metadataRows) {
    const metadataByVar = new Map();
    for (const metadata of metadataRows || [])
        metadataByVar.set(metadata.Var, metadata);

    let clause = "";
    const values = [];
    for (const filter of (filterString || "").split(",")) {
        if (!filter)
            continue;

        const parts = filter.split("_");
        const requestedVar = parts[0];
        const filterVar = requestedVar ?
            requestedVar[0].toLowerCase() + requestedVar.slice(1) : "";
        const metadata = metadataByVar.get(filterVar);
        const filterClause = metadata && trustedClause(metadata);
        if (!filterClause)
            continue;

        if (metadata.Type === "select") {
            if (parts.length !== 2 || !/^\d+$/.test(parts[1]))
                continue;
            const value = Number(parts[1]);
            if (!Number.isSafeInteger(value))
                continue;
            values.push(value);
        }
        else if (parts.length !== 1) {
            continue;
        }

        const column = filterVar[0].toUpperCase() + filterVar.slice(1);
        clause += ` AND (${column} ${filterClause})`;
    }

    return {clause, values};
}

module.exports = {resolveItemFilters};
