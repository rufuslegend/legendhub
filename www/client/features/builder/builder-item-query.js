function statLookup(statInfo) {
    const lookup = new Map();
    for (const stat of statInfo) {
        for (const name of [stat.var, stat.short, stat.display]) {
            if (name)
                lookup.set(name.trim().toLowerCase().replace(/\s+/g, " "), stat.var);
        }
    }
    return lookup;
}

function tokenize(expression) {
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
        if (character === "(" || character === ")" || character === ",") {
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
            tokens.push({type: "number", value: Number(number[0])});
            index += number[0].length;
            continue;
        }
        throw new Error(`Unexpected character "${character}".`);
    }
    return tokens;
}

function parseExpression(expression, statInfo) {
    const tokens = tokenize(expression);
    const stats = statLookup(statInfo);
    let index = 0;
    const peek = () => tokens[index];
    const take = () => tokens[index++];

    function parseComparison() {
        const words = [];
        while (peek()?.type === "word")
            words.push(take().value);
        const statName = words.join(" ").toLowerCase();
        const stat = stats.get(statName);
        if (!stat)
            throw new Error(`Unknown item stat "${words.join(" ")}".`);
        const operator = take();
        if (!operator || operator.type !== "operator")
            throw new Error(`Expected a comparison after "${words.join(" ")}".`);
        const number = take();
        if (!number || number.type !== "number")
            throw new Error(`Expected a number after "${words.join(" ")} ${operator.value}".`);
        return item => {
            const value = Number(item[stat]);
            if (operator.value === ">") return value > number.value;
            if (operator.value === ">=") return value >= number.value;
            if (operator.value === "<") return value < number.value;
            if (operator.value === "<=") return value <= number.value;
            return value === number.value;
        };
    }

    function parsePrimary() {
        if (peek()?.type !== "(")
            return parseComparison();
        take();
        const predicate = parseOr();
        if (take()?.type !== ")")
            throw new Error("Expected a closing parenthesis.");
        return predicate;
    }

    function parseAnd() {
        let predicate = parsePrimary();
        while (peek()?.type === "," || (peek()?.type === "word" && peek().value.toLowerCase() === "and")) {
            take();
            const right = parsePrimary();
            const left = predicate;
            predicate = item => left(item) && right(item);
        }
        return predicate;
    }

    function parseOr() {
        let predicate = parseAnd();
        while (peek()?.type === "word" && peek().value.toLowerCase() === "or") {
            take();
            const right = parseAnd();
            const left = predicate;
            predicate = item => left(item) || right(item);
        }
        return predicate;
    }

    const predicate = parseOr();
    if (peek())
        throw new Error(`Unexpected "${peek().value}".`);
    return predicate;
}

export function compileBuilderItemQuery(searchString, statInfo) {
    const query = searchString.trim();
    if (!/[<>=]/.test(query)) {
        const name = query.toLowerCase();
        return item => item.name.toLowerCase().includes(name);
    }

    const comma = query.indexOf(",");
    const hasNameClause = comma >= 0 && !/[<>=]/.test(query.slice(0, comma));
    const name = hasNameClause ? query.slice(0, comma).trim().toLowerCase() : "";
    const expression = hasNameClause ? query.slice(comma + 1) : query;
    const matchesStats = parseExpression(expression, statInfo);
    return item => (!name || item.name.toLowerCase().includes(name)) && matchesStats(item);
}

export function parseBuilderItemQuery(searchString, statInfo) {
    try {
        return {error: null, matches: compileBuilderItemQuery(searchString, statInfo)};
    }
    catch (error) {
        return {error: error.message, matches: () => true};
    }
}
