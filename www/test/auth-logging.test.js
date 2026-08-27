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
                    Email: "Private@Example.com",
                    EmailVerifiedOn: new Date("2026-08-25T00:00:00.000Z"),
                    PendingEmail: null,
                    StorageNamespace: "00112233445566778899aabbccddeeff",
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

    const result = await auth.utils.authToken(
        `testselector-${validator}`, "test-ip", true, false);

    assert.equal(statements.some(sql => sql.startsWith("INSERT INTO AuthTokens")), true);
    assert.equal(result.email, "Private@Example.com");
    assert.equal(result.emailVerified, true);
    assert.equal(result.pendingEmail, null);
    assert.equal(result.storageNamespace, "00112233445566778899aabbccddeeff");
    assert.equal(consoleWrites, 0, "renewal must not write credentials to process diagnostics");
});

// Catches database diagnostics exposing a submitted email or password through
// the public authentication failure or process logs.
test("email authentication failures keep the exact generic public message and write no credentials", async function(t) {
    const privateEmail = "private@example.com";
    const privatePassword = "not-for-diagnostics";
    const auth = loadAuthApi({
        query: function(sql, values, callback) {
            callback({
                sqlMessage: `lookup failed for ${privateEmail} using ${privatePassword}`
            });
        }
    });
    const writes = [];
    for (const method of ["log", "warn", "error"])
        t.mock.method(console, method, (...values) => writes.push(values));

    await assert.rejects(
        auth.utils.authLogin(privateEmail, privatePassword, false, "test-ip"),
        error => error.message === "Invalid username or password."
    );

    assert.equal(writes.length, 0);
});

// Catches selector or validator material being reflected from database
// diagnostics through the session-token error boundary.
test("session token database failures expose only the generic invalid-token error", async function() {
    const rawToken = "privateselector-privatevalidator";
    const auth = loadAuthApi({
        query: function(sql, values, callback) {
            callback({sqlMessage: `query failed while processing ${rawToken}`});
        }
    });

    await assert.rejects(
        auth.utils.authToken(rawToken, "test-ip", false, false),
        error => error.message === "Invalid token" && !error.message.includes(rawToken)
    );
});

// Catches permission-query driver diagnostics crossing authToken/authApi's
// forwarded rejection boundary into a public GraphQL error.
test("permission lookup failures expose only a stable generic error", async function() {
    const privateDiagnostic = "permission SQL failed near private table metadata";
    const auth = loadAuthApi({
        query: function(sql, values, callback) {
            callback({sqlMessage: privateDiagnostic});
        }
    });

    await assert.rejects(
        auth.utils.getPermissions(73),
        error => error.message === "Unable to load permissions." &&
            !error.message.includes(privateDiagnostic)
    );
});
