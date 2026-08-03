function readRequired(environment, name, preserveWhitespace = false) {
    const value = environment[name];
    if (typeof value !== "string" || value.trim() === "")
        throw new Error(`${name} must be a non-empty string`);

    return preserveWhitespace ? value : value.trim();
}

function readPort(environment) {
    const value = readRequired(environment, "MYSQL_PORT");
    if (!/^\d+$/.test(value))
        throw new Error("MYSQL_PORT must be an integer between 1 and 65535");

    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
        throw new Error("MYSQL_PORT must be an integer between 1 and 65535");

    return port;
}

exports.createMySqlConfig = function(environment = process.env) {
    return {
        host: readRequired(environment, "MYSQL_HOST"),
        port: readPort(environment),
        user: readRequired(environment, "MYSQL_USER"),
        password: readRequired(environment, "MYSQL_PASSWORD", true),
        database: readRequired(environment, "MYSQL_DATABASE")
    };
};
