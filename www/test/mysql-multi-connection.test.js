const assert = require("node:assert/strict");
const test = require("node:test");
const {
    createMigrationPool
} = require("../src/routes/api/mysql-multi-connection");
const {createMySqlConfig} = require("../src/routes/api/mysql-config");

const validEnvironment = {
    MYSQL_HOST: "mysql",
    MYSQL_PORT: "3306",
    MYSQL_USER: "legendhub",
    MYSQL_PASSWORD: "test password",
    MYSQL_DATABASE: "legendhub"
};

test("migration pool uses validated, restricted connection options", function() {
    let poolOptions;
    const expectedPool = {};
    const mysql = {
        createPool: function(options) {
            poolOptions = options;
            return expectedPool;
        }
    };

    const pool = createMigrationPool(mysql, validEnvironment);

    assert.equal(pool, expectedPool);
    assert.deepEqual(poolOptions, {
        host: "mysql",
        port: 3306,
        user: "legendhub",
        password: "test password",
        database: "legendhub",
        connectionLimit: 1,
        charset: "utf8mb4",
        localInfile: false,
        multipleStatements: true
    });
});

test("database configuration requires every connection setting", async function(t) {
    const requiredSettings = [
        "MYSQL_HOST",
        "MYSQL_PORT",
        "MYSQL_USER",
        "MYSQL_PASSWORD",
        "MYSQL_DATABASE"
    ];

    for (const setting of requiredSettings) {
        await t.test(setting, function() {
            const environment = {...validEnvironment};
            delete environment[setting];

            assert.throws(
                () => createMySqlConfig(environment),
                new RegExp(`${setting} must be a non-empty string`)
            );
        });
    }
});

test("database configuration rejects invalid ports", async function(t) {
    const invalidPorts = ["0", "65536", "3306.5", "not-a-port"];

    for (const port of invalidPorts) {
        await t.test(port, function() {
            assert.throws(
                () => createMySqlConfig({...validEnvironment, MYSQL_PORT: port}),
                /MYSQL_PORT must be an integer between 1 and 65535/
            );
        });
    }
});
