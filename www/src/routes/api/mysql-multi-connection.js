const mysql = require("mysql");
const {createMySqlConfig} = require("./mysql-config");

let pool;
let closed = false;

function createMigrationPool(mysqlClient = mysql, environment = process.env) {
    return mysqlClient.createPool({
        ...createMySqlConfig(environment),
        connectionLimit: 1,
        charset: "utf8mb4",
        localInfile: false,
        multipleStatements: true
    });
}

function getPool() {
    if (closed)
        throw new Error("The migration database pool is closed");
    if (!pool)
        pool = createMigrationPool();

    return pool;
}

exports.getConnection = function(callback) {
    getPool().getConnection(callback);
};

exports.end = function(callback) {
    if (closed) {
        process.nextTick(callback);
        return;
    }

    closed = true;
    if (!pool) {
        process.nextTick(callback);
        return;
    }

    pool.end(callback);
};

exports.createMigrationPool = createMigrationPool;
