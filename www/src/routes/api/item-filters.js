"use strict";

const {SLOT_COUNT, slotBit} = require("./item-slots");

const identifierPattern = /^[a-z][A-Za-z0-9]*$/;
const numericClausePattern = /^(?:=|<>|!=|>=|<=|>|<) -?\d+(?:\.\d+)?$/;
const stringClausePattern = /^(?:=|<>|!=) ''$/;
const selectClausePattern = /^(=|<>|!=|>=|<=|>|<) \{0\}$/;
const MAX_ITEM_SEARCH_LENGTH = 1000;
const MAX_ITEM_SEARCH_TOKENS = 256;
const MAX_ITEM_SEARCH_DEPTH = 32;

class ItemSearchSyntaxError extends TypeError {}

function syntaxError(message) {
    return new ItemSearchSyntaxError(message);
}

function normalizedStatName(value) {
    return typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, " ") : "";
}

function numericStatLookup(metadataRows) {
    const lookup = new Map();
    for (const metadata of metadataRows || []) {
        if (!identifierPattern.test(metadata.Var || "") ||
            !["bool", "decimal", "int"].includes(metadata.Type)) {
            continue;
        }
        const stat = {
            column: metadata.Var[0].toUpperCase() + metadata.Var.slice(1)
        };
        for (const name of [metadata.Var, metadata.Short, metadata.Display]) {
            const normalized = normalizedStatName(name);
            if (normalized)
                lookup.set(normalized, stat);
        }
    }
    return lookup;
}

function tokenizeSearchExpression(expression) {
    const tokens = [];
    let index = 0;
    while (index < expression.length) {
        const rest = expression.slice(index);
        const whitespace = rest.match(/^\s+/);
        if (whitespace) {
            index += whitespace[0].length;
            continue;
        }
        const character = expression[index];
        if (["(", ")", ","].includes(character)) {
            tokens.push({type: character, value: character});
            index += 1;
            continue;
        }
        const operator = rest.match(/^(?:>=|<=|=|>|<)/);
        if (operator) {
            tokens.push({type: "operator", value: operator[0]});
            index += operator[0].length;
            continue;
        }
        const word = rest.match(/^(?=[A-Za-z0-9_]*[A-Za-z_])[A-Za-z0-9_]+/);
        if (word) {
            tokens.push({type: "word", value: word[0]});
            index += word[0].length;
            continue;
        }
        const number = rest.match(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)/);
        if (number) {
            const value = Number(number[0]);
            if (!Number.isFinite(value))
                throw syntaxError("Item search number is too large.");
            tokens.push({type: "number", value});
            index += number[0].length;
            continue;
        }
        throw syntaxError(`Unexpected character "${character}".`);
    }
    if (tokens.length > MAX_ITEM_SEARCH_TOKENS)
        throw syntaxError("Item search expression is too complex.");
    return tokens;
}

function compileSearchExpression(expression, metadataRows) {
    const tokens = tokenizeSearchExpression(expression);
    const stats = numericStatLookup(metadataRows);
    let index = 0;
    const peek = () => tokens[index];
    const take = () => tokens[index++];

    function comparison() {
        const words = [];
        while (peek()?.type === "word")
            words.push(take().value);
        const statName = words.join(" ");
        const stat = stats.get(normalizedStatName(statName));
        if (!stat)
            throw syntaxError(`Unknown numeric item stat "${statName}".`);
        const operator = take();
        if (!operator || operator.type !== "operator")
            throw syntaxError(`Expected a comparison after "${statName}".`);
        const number = take();
        if (!number || number.type !== "number") {
            throw syntaxError(
                `Expected a number after "${statName} ${operator.value}".`
            );
        }
        return {sql: `(${stat.column} ${operator.value} ?)`, values: [number.value]};
    }

    function primary(depth) {
        if (peek()?.type !== "(")
            return comparison();
        if (depth >= MAX_ITEM_SEARCH_DEPTH)
            throw syntaxError("Item search grouping is too deeply nested.");
        take();
        const result = orExpression(depth + 1);
        if (take()?.type !== ")")
            throw syntaxError("Expected a closing parenthesis.");
        return result;
    }

    function andExpression(depth) {
        let result = primary(depth);
        while (peek()?.type === "," ||
            (peek()?.type === "word" && peek().value.toLowerCase() === "and")) {
            take();
            const right = primary(depth);
            result = {
                sql: `(${result.sql} AND ${right.sql})`,
                values: [...result.values, ...right.values]
            };
        }
        return result;
    }

    function orExpression(depth) {
        let result = andExpression(depth);
        while (peek()?.type === "word" && peek().value.toLowerCase() === "or") {
            take();
            const right = andExpression(depth);
            result = {
                sql: `(${result.sql} OR ${right.sql})`,
                values: [...result.values, ...right.values]
            };
        }
        return result;
    }

    const result = orExpression(0);
    if (peek())
        throw syntaxError(`Unexpected "${peek().value}".`);
    return result;
}

function resolveItemSearch(searchString, metadataRows) {
    if (typeof searchString === "string" && searchString.length > MAX_ITEM_SEARCH_LENGTH)
        throw syntaxError("Item search query is too long.");
    const query = (searchString || "").trim();
    if (!/[<>=]/.test(query))
        return {name: query, clause: "", values: []};

    const comma = query.indexOf(",");
    const hasNameClause = comma >= 0 && !/[<>=]/.test(query.slice(0, comma));
    const name = hasNameClause ? query.slice(0, comma).trim() : "";
    const expression = hasNameClause ? query.slice(comma + 1) : query;
    const compiled = compileSearchExpression(expression, metadataRows);
    return {name, clause: ` AND ${compiled.sql}`, values: compiled.values};
}

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
            if (metadata.Var === "slot") {
                if (value < 0 || value >= SLOT_COUNT)
                    continue;
                clause += " AND ((SlotMask & ?) <> 0)";
                values.push(slotBit(value));
                continue;
            }
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

module.exports = {ItemSearchSyntaxError, resolveItemFilters, resolveItemSearch};
