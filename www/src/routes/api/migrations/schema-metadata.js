"use strict";

async function inspectDatabaseEngine(query) {
    const rows = await query(
        "inspect database engine",
        "SELECT VERSION() AS VERSION"
    );
    const version = rows[0] && (rows[0].VERSION || rows[0].Version || rows[0].version);
    return typeof version === "string" && version.toLowerCase().includes("mariadb")
        ? "mariadb"
        : "mysql";
}

function normalizeActualDefault(value, engine) {
    if (value === null || value === undefined)
        return null;
    const normalized = String(value);
    if (engine !== "mariadb")
        return normalized;
    if (normalized === "NULL")
        return null;
    if (normalized.length >= 2 && normalized.startsWith("'") && normalized.endsWith("'"))
        return normalized.slice(1, -1).replace(/''/g, "'");
    return normalized;
}

function normalizeExpectedDefault(value) {
    return value === null || value === undefined ? null : String(value);
}

function normalizeIntegerDisplayWidth(value) {
    return value.replace(
        /^(tinyint|smallint|mediumint|int|bigint)\(\d+\)( unsigned)?$/,
        "$1$2"
    );
}

function hasExactJsonValidation(checks, columnName) {
    return checks.some(check => {
        const clause = check.CHECK_CLAUSE === undefined ? check.checkClause : check.CHECK_CLAUSE;
        if (typeof clause !== "string")
            return false;
        const expression = stripOuterParentheses(clause.trim());
        const match = /^json_valid\s*\(\s*(`(?:``|[^`])+`|[A-Za-z_$][A-Za-z0-9_$]*)\s*\)$/i
            .exec(expression);
        if (!match)
            return false;
        const identifier = match[1].startsWith("`")
            ? match[1].slice(1, -1).replace(/``/g, "`")
            : match[1];
        return identifier.toLowerCase() === columnName.toLowerCase();
    });
}

function stripOuterParentheses(value) {
    let result = value;
    while (result.startsWith("(") && matchingCloseParenthesis(result, 0) === result.length - 1)
        result = result.slice(1, -1).trim();
    return result;
}

function matchingCloseParenthesis(value, start) {
    let depth = 0;
    let quotedIdentifier = false;
    for (let index = start; index < value.length; index += 1) {
        const character = value[index];
        if (character === "`") {
            if (quotedIdentifier && value[index + 1] === "`") {
                index += 1;
                continue;
            }
            quotedIdentifier = !quotedIdentifier;
            continue;
        }
        if (quotedIdentifier)
            continue;
        if (character === "(")
            depth += 1;
        else if (character === ")") {
            depth -= 1;
            if (depth === 0)
                return index;
        }
    }
    return -1;
}

module.exports = {
    hasExactJsonValidation,
    inspectDatabaseEngine,
    normalizeActualDefault,
    normalizeExpectedDefault,
    normalizeIntegerDisplayWidth
};
