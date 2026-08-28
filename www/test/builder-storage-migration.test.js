const assert = require("node:assert/strict");
const test = require("node:test");

const migration = require("../src/routes/api/migrations/9");

const EXPECTED_TABLES = {
    BuilderProfiles: {
        columns: [
            ["Id", "bigint", "NO", null], ["PublicId", "char(36)", "NO", "ascii"],
            ["MemberId", "int", "NO", null], ["Name", "text", "NO", "utf8mb4"],
            ["ActiveNameHash", "binary(32)", "YES", null], ["Payload", "mediumtext", "YES", "utf8mb4"],
            ["PayloadVersion", "smallint", "YES", null], ["PayloadBytes", "int", "NO", null],
            ["Revision", "bigint", "NO", null], ["CreatedOn", "datetime", "NO", null],
            ["UpdatedOn", "datetime", "NO", null], ["DeletedOn", "datetime", "YES", null]
        ],
        indexes: [
            ["PRIMARY", 0, "Id"], ["UX_BuilderProfiles_PublicId", 0, "PublicId"],
            ["UX_BuilderProfiles_ActiveName", 0, "MemberId"],
            ["UX_BuilderProfiles_ActiveName", 0, "ActiveNameHash"],
            ["IX_BuilderProfiles_MemberUpdated", 1, "MemberId"],
            ["IX_BuilderProfiles_MemberUpdated", 1, "UpdatedOn"]
        ],
        foreignKeys: [["FK_BuilderProfiles_Members", "MemberId", "Members", "Id"]]
    },
    AccountPreferences: {
        columns: [
            ["MemberId", "int", "NO", null], ["DocumentVersion", "int", "NO", null],
            ["Payload", "json", "NO", "utf8mb4"], ["Revision", "bigint", "NO", null],
            ["StorageGeneration", "bigint", "NO", null], ["UpdatedOn", "datetime", "NO", null]
        ],
        indexes: [["PRIMARY", 0, "MemberId"]],
        foreignKeys: [["FK_AccountPreferences_Members", "MemberId", "Members", "Id"]]
    },
    BuilderImportReceipts: {
        columns: [
            ["Id", "bigint", "NO", null], ["MemberId", "int", "NO", null],
            ["IdempotencyKey", "char(64)", "NO", "ascii", "ascii_bin"],
            ["ResultPayload", "json", "NO", "utf8mb4"], ["CreatedOn", "datetime", "NO", null]
        ],
        indexes: [
            ["PRIMARY", 0, "Id"], ["UX_BuilderImportReceipts_Key", 0, "MemberId"],
            ["UX_BuilderImportReceipts_Key", 0, "IdempotencyKey"],
            ["IX_BuilderImportReceipts_Created", 1, "CreatedOn"]
        ],
        foreignKeys: [["FK_BuilderImportReceipts_Members", "MemberId", "Members", "Id"]]
    }
};

const COLUMN_DEFAULTS = {
    "BuilderProfiles.PayloadBytes": "0",
    "BuilderProfiles.Revision": "1",
    "AccountPreferences.DocumentVersion": "1",
    "AccountPreferences.Revision": "1",
    "AccountPreferences.StorageGeneration": "1"
};
const AUTO_INCREMENT_COLUMNS = new Set(["BuilderProfiles.Id", "BuilderImportReceipts.Id"]);

function createSchemaContext({tables = [], mutateSchema} = {}) {
    const schemas = new Map(tables.map((tableName) => [tableName, schemaFromExpectation(tableName)]));
    if (mutateSchema)
        mutateSchema(schemas);

    return {
        tables: function() { return [...schemas.keys()].sort(); },
        query: async function(_operation, sql) {
            const tableName = /TABLE_NAME = '([^']+)'/.exec(sql)?.[1];
            if (sql.includes("information_schema.tables"))
                return schemas.has(tableName) ? [{TABLE_NAME: tableName}] : [];
            if (sql.includes("information_schema.columns"))
                return schemas.get(tableName)?.columns || [];
            if (sql.includes("information_schema.statistics"))
                return schemas.get(tableName)?.indexes || [];
            if (sql.includes("information_schema.key_column_usage"))
                return schemas.get(tableName)?.foreignKeys || [];
            if (sql.includes("CREATE TABLE")) {
                const createdTable = /CREATE TABLE (\w+)/.exec(sql)[1];
                schemas.set(createdTable, parseTableDefinition(sql));
                return [];
            }
            throw new Error(`Unexpected SQL: ${sql}`);
        }
    };
}

function schemaFromExpectation(tableName) {
    const expected = EXPECTED_TABLES[tableName];
    return {
        columns: expected.columns.map((column) => expectedColumnMetadata(tableName, column)),
        indexes: expected.indexes.map(([INDEX_NAME, NON_UNIQUE, COLUMN_NAME], index) => ({
            INDEX_NAME, NON_UNIQUE, COLUMN_NAME,
            SEQ_IN_INDEX: expected.indexes.slice(0, index).filter((item) => item[0] === INDEX_NAME).length + 1
        })),
        foreignKeys: expected.foreignKeys.map(([
            CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
        ]) => ({CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME}))
    };
}

function expectedColumnMetadata(tableName, [
    COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, CHARACTER_SET_NAME, COLLATION_NAME
]) {
    const key = `${tableName}.${COLUMN_NAME}`;
    const metadata = {
        COLUMN_NAME,
        COLUMN_TYPE: mysql57ColumnType(COLUMN_TYPE),
        IS_NULLABLE,
        CHARACTER_SET_NAME,
        COLUMN_DEFAULT: COLUMN_DEFAULTS[key] || null,
        EXTRA: AUTO_INCREMENT_COLUMNS.has(key) ? "auto_increment" : ""
    };
    if (COLLATION_NAME !== undefined)
        metadata.COLLATION_NAME = COLLATION_NAME;
    return metadata;
}

function mysql57ColumnType(type) {
    return {bigint: "bigint(20)", int: "int(11)", smallint: "smallint(6)"}[type] || type;
}

function parseTableDefinition(sql) {
    const definition = sql.replace(/\s+/g, " ");
    const columns = [];
    const indexes = [];
    const foreignKeys = [];
    const body = definition.slice(definition.indexOf("(") + 1, definition.lastIndexOf(") ENGINE"));

    for (const rawEntry of body.split(/, (?=(?:(?:[A-Za-z]\w*) [A-Z]+|PRIMARY KEY|UNIQUE KEY|KEY |CONSTRAINT ))/)) {
        const entry = rawEntry.trim();
        const primary = /^PRIMARY KEY \((\w+)\)$/.exec(entry);
        const unique = /^UNIQUE KEY (\w+) \(([^)]+)\)$/.exec(entry);
        const index = /^KEY (\w+) \(([^)]+)\)$/.exec(entry);
        const foreignKey = /^CONSTRAINT (\w+) FOREIGN KEY \((\w+)\) REFERENCES (\w+) \((\w+)\)$/.exec(entry);
        if (primary)
            indexes.push({INDEX_NAME: "PRIMARY", NON_UNIQUE: 0, COLUMN_NAME: primary[1], SEQ_IN_INDEX: 1});
        else if (unique || index) {
            const [, INDEX_NAME, names] = unique || index;
            names.split(", ").forEach((COLUMN_NAME, position) => indexes.push({
                INDEX_NAME, NON_UNIQUE: unique ? 0 : 1, COLUMN_NAME, SEQ_IN_INDEX: position + 1
            }));
        }
        else if (foreignKey) {
            const [, CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME] = foreignKey;
            foreignKeys.push({CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME});
        }
        else {
            const column = /^(\w+) ([A-Z]+(?:\(\d+\))?)(.*)$/.exec(entry);
            if (!column)
                throw new Error(`Unexpected table DDL entry: ${entry}`);
            const [, COLUMN_NAME, type, rest] = column;
            columns.push({
                COLUMN_NAME, COLUMN_TYPE: mysql57ColumnType(type.toLowerCase()),
                IS_NULLABLE: rest.includes("NOT NULL") ? "NO" : "YES",
                CHARACTER_SET_NAME: rest.includes("CHARACTER SET ascii") ? "ascii" :
                    ["TEXT", "MEDIUMTEXT", "JSON"].includes(type) ? "utf8mb4" : null,
                COLUMN_DEFAULT: /DEFAULT (\S+)/.exec(rest)?.[1] || null,
                EXTRA: rest.includes("AUTO_INCREMENT") ? "auto_increment" : ""
            });
            const collation = /COLLATE (\w+)/.exec(rest)?.[1];
            if (collation)
                columns.at(-1).COLLATION_NAME = collation;
        }
    }
    return {columns, indexes, foreignKeys};
}

test("storage migration creates all tables and verifies a partial retry", async function() {
    const context = createSchemaContext({tables: ["BuilderProfiles"]});

    assert.equal(migration.mode, "non-transactional");
    await migration.up(context);
    assert.deepEqual(context.tables(), [
        "AccountPreferences",
        "BuilderImportReceipts",
        "BuilderProfiles"
    ]);
    assert.equal(await migration.verify(context), true);
    await migration.up(context);
    assert.equal(await migration.verify(context), true);
});

test("storage migration produces the required MySQL 5.7 table contracts", async function() {
    const context = createSchemaContext();
    await migration.up(context);

    for (const [tableName, expected] of Object.entries(EXPECTED_TABLES)) {
        assert.deepEqual(await context.query("test columns", `
            SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, CHARACTER_SET_NAME, COLUMN_DEFAULT, EXTRA
            FROM information_schema.columns WHERE TABLE_NAME = '${tableName}'
        `), expected.columns.map((column) => expectedColumnMetadata(tableName, column)));
        assert.deepEqual(await context.query("test indexes", `
            SELECT INDEX_NAME, NON_UNIQUE, COLUMN_NAME, SEQ_IN_INDEX
            FROM information_schema.statistics WHERE TABLE_NAME = '${tableName}'
        `), expected.indexes.map(([INDEX_NAME, NON_UNIQUE, COLUMN_NAME], index) => ({
            INDEX_NAME, NON_UNIQUE, COLUMN_NAME,
            SEQ_IN_INDEX: expected.indexes.slice(0, index).filter((item) => item[0] === INDEX_NAME).length + 1
        })));
        assert.deepEqual(await context.query("test foreign keys", `
            SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
            FROM information_schema.key_column_usage WHERE TABLE_NAME = '${tableName}'
        `), expected.foreignKeys.map(([
            CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
        ]) => ({CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME})));
    }
    assert.equal(await migration.verify(context), true);
});

test("storage migration verification rejects a missing active-name uniqueness key", async function() {
    const context = createSchemaContext({
        tables: Object.keys(EXPECTED_TABLES),
        mutateSchema: function(schemas) {
            schemas.get("BuilderProfiles").indexes = schemas.get("BuilderProfiles").indexes.filter(
                (index) => index.INDEX_NAME !== "UX_BuilderProfiles_ActiveName"
            );
        }
    });

    assert.equal(await migration.verify(context), false);
});

test("storage migration verification accepts MySQL 5.7 integer display widths", async function() {
    const context = createSchemaContext({
        tables: Object.keys(EXPECTED_TABLES),
        mutateSchema: function(schemas) {
            for (const schema of schemas.values()) {
                for (const column of schema.columns) {
                    column.COLUMN_TYPE = {
                        bigint: "bigint(20)",
                        int: "int(11)",
                        smallint: "smallint(6)"
                    }[column.COLUMN_TYPE] || column.COLUMN_TYPE;
                }
            }
        }
    });

    assert.equal(await migration.verify(context), true);
});

test("storage migration verification rejects an incorrect column default", async function() {
    const context = createSchemaContext({
        tables: Object.keys(EXPECTED_TABLES),
        mutateSchema: function(schemas) {
            schemas.get("BuilderProfiles").columns.find(
                (column) => column.COLUMN_NAME === "PayloadBytes"
            ).COLUMN_DEFAULT = "1";
        }
    });

    assert.equal(await migration.verify(context), false);
});

test("storage migration verification rejects a missing auto-increment column property", async function() {
    const context = createSchemaContext({
        tables: Object.keys(EXPECTED_TABLES),
        mutateSchema: function(schemas) {
            schemas.get("BuilderProfiles").columns.find(
                (column) => column.COLUMN_NAME === "Id"
            ).EXTRA = "";
        }
    });

    assert.equal(await migration.verify(context), false);
});

test("storage migration verification rejects a case-insensitive import key collation", async function() {
    const context = createSchemaContext({
        tables: Object.keys(EXPECTED_TABLES),
        mutateSchema: function(schemas) {
            schemas.get("BuilderImportReceipts").columns.find(
                column => column.COLUMN_NAME === "IdempotencyKey"
            ).COLLATION_NAME = "ascii_general_ci";
        }
    });

    assert.equal(await migration.verify(context), false);
});

test("storage migration verification rejects unexpected columns and indexes", async function(t) {
    await t.test("column", async function() {
        const context = createSchemaContext({
            tables: Object.keys(EXPECTED_TABLES),
            mutateSchema: function(schemas) {
                schemas.get("AccountPreferences").columns.push({
                    COLUMN_NAME: "Unexpected", COLUMN_TYPE: "int", IS_NULLABLE: "YES",
                    CHARACTER_SET_NAME: null
                });
            }
        });

        assert.equal(await migration.verify(context), false);
    });

    await t.test("index", async function() {
        const context = createSchemaContext({
            tables: Object.keys(EXPECTED_TABLES),
            mutateSchema: function(schemas) {
                schemas.get("AccountPreferences").indexes.push({
                    INDEX_NAME: "IX_Unexpected", NON_UNIQUE: 1, COLUMN_NAME: "UpdatedOn", SEQ_IN_INDEX: 1
                });
            }
        });

        assert.equal(await migration.verify(context), false);
    });
});
