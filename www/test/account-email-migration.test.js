const assert = require("node:assert/strict");
const test = require("node:test");

function createSchemaContext() {
    const memberColumns = new Map();
    const memberIndexes = new Map();
    const tables = new Set();
    let storageNamespacesWithNull = 0;

    return {
        memberColumns: function() {
            return [...memberColumns.keys()].sort();
        },
        memberColumn: function(name) {
            return memberColumns.get(name);
        },
        memberIndexes: function() {
            return [...memberIndexes.keys()].sort();
        },
        tables: function() {
            return [...tables].sort();
        },
        query: async function(_operation, sql) {
            if (sql.includes("information_schema.columns")) {
                const columnName = /COLUMN_NAME = '([^']+)'/.exec(sql)?.[1];
                if (columnName) {
                    const column = memberColumns.get(columnName);
                    return column ? [column] : [];
                }

                if (sql.includes("TABLE_NAME = 'Members'"))
                    return [...memberColumns.values()];
            }

            if (sql.includes("information_schema.statistics")) {
                const indexName = /INDEX_NAME = '([^']+)'/.exec(sql)?.[1];
                if (indexName) {
                    const index = memberIndexes.get(indexName);
                    return index ? [index] : [];
                }

                if (sql.includes("TABLE_NAME = 'Members'"))
                    return [...memberIndexes.values()];
            }

            if (sql.includes("information_schema.tables")) {
                const tableName = /TABLE_NAME = '([^']+)'/.exec(sql)?.[1];
                return tables.has(tableName) ? [{TABLE_NAME: tableName}] : [];
            }

            if (sql.includes("COUNT(*) AS NullStorageNamespaces"))
                return [{NullStorageNamespaces: storageNamespacesWithNull}];

            if (sql.includes("ALTER TABLE Members ADD COLUMN")) {
                const match = /ADD COLUMN (\w+) ([^,;]+)/.exec(sql);
                memberColumns.set(match[1], {
                    COLUMN_NAME: match[1],
                    COLUMN_TYPE: match[2]
                        .replace(/ CHARACTER SET ascii/, "")
                        .replace(/ (?:NOT )?NULL$/, "")
                        .toLowerCase(),
                    IS_NULLABLE: match[2].includes("NOT NULL") ? "NO" : "YES",
                    CHARACTER_SET_NAME: match[2].includes("CHARACTER SET ascii") ? "ascii" : null
                });
                return [];
            }

            if (sql.includes("ALTER TABLE Members MODIFY COLUMN StorageNamespace")) {
                const column = memberColumns.get("StorageNamespace");
                memberColumns.set("StorageNamespace", {...column, IS_NULLABLE: "NO"});
                return [];
            }

            if (sql.includes("UPDATE Members") && sql.includes("RANDOM_BYTES(16)")) {
                storageNamespacesWithNull = 0;
                return {affectedRows: 0};
            }

            if (sql.includes("CREATE UNIQUE INDEX")) {
                const match = /CREATE UNIQUE INDEX (\w+)\s+ON Members \((\w+)\)/.exec(sql);
                memberIndexes.set(match[1], {
                    INDEX_NAME: match[1],
                    NON_UNIQUE: 0,
                    COLUMN_NAME: match[2]
                });
                return [];
            }

            if (sql.includes("CREATE TABLE")) {
                const match = /CREATE TABLE (\w+)/.exec(sql);
                tables.add(match[1]);
                return [];
            }

            throw new Error(`Unexpected SQL: ${sql}`);
        }
    };
}

test("email migration declares recoverable non-transactional DDL", async function() {
    const migration = require("../src/routes/api/migrations/8");
    assert.equal(migration.mode, "non-transactional");
    assert.equal(typeof migration.up, "function");
    assert.equal(typeof migration.verify, "function");
});

test("email migration creates every column, index, and action table", async function() {
    const migration = require("../src/routes/api/migrations/8");
    const context = createSchemaContext();

    await migration.up(context);

    assert.deepEqual(context.memberColumns(), [
        "Email", "EmailVerifiedOn", "NormalizedEmail",
        "PendingEmail", "PendingNormalizedEmail", "StorageNamespace"
    ]);
    assert.deepEqual(context.memberIndexes(), [
        "UX_Members_NormalizedEmail",
        "UX_Members_PendingNormalizedEmail",
        "UX_Members_StorageNamespace"
    ]);
    assert.deepEqual(context.tables(), ["AccountActionAttempts", "AccountActionTokens"]);
    assert.equal(context.memberColumn("StorageNamespace").IS_NULLABLE, "YES",
        "v3.0 registration must be able to omit StorageNamespace after rollback");
    assert.equal(await migration.verify(context), true);
});
