"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const Module = require("node:module");
const test = require("node:test");

const authApiPath = require.resolve("../src/routes/api/auth");

function loadAuthApi(mysql) {
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
        if (request === "./mysql-connection" && parent?.filename === authApiPath)
            return mysql;

        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        delete require.cache[authApiPath];
        return require(authApiPath);
    }
    finally {
        Module._load = originalLoad;
    }
}

// Catches renewed session credentials being written to process diagnostics.
test("renewing an auth token does not write credentials to the console", async function(t) {
    const validator = "testvalidator";
    const statements = [];
    const auth = loadAuthApi({
        query: function(sql, values, callback) {
            statements.push(sql);
            if (sql.startsWith("SELECT AT.Id")) {
                callback(null, [{
                    Id: 41,
                    MemberId: 73,
                    Username: "TestMember",
                    HashedValidator: crypto.createHash("sha256").update(validator).digest("hex"),
                    Expires: new Date("2030-01-01T00:00:00.000Z"),
                    StayLoggedIn: false,
                    Banned: false
                }]);
                return;
            }
            callback(null, {affectedRows: 1});
        }
    });
    let consoleWrites = 0;
    t.mock.method(console, "log", function() {
        consoleWrites += 1;
    });

    await auth.utils.authToken(`testselector-${validator}`, "test-ip", true, false);

    assert.equal(statements.some(sql => sql.startsWith("INSERT INTO AuthTokens")), true);
    assert.equal(consoleWrites, 0, "renewal must not write credentials to process diagnostics");
});
