const TABLES = {
    BuilderProfiles: {
        sql: `
            CREATE TABLE BuilderProfiles (
                Id BIGINT NOT NULL AUTO_INCREMENT,
                PublicId CHAR(36) CHARACTER SET ascii NOT NULL,
                MemberId INT NOT NULL,
                Name TEXT NOT NULL,
                ActiveNameHash BINARY(32) NULL,
                Payload MEDIUMTEXT NULL,
                PayloadVersion SMALLINT NULL,
                PayloadBytes INT NOT NULL DEFAULT 0,
                Revision BIGINT NOT NULL DEFAULT 1,
                CreatedOn DATETIME NOT NULL,
                UpdatedOn DATETIME NOT NULL,
                DeletedOn DATETIME NULL,
                PRIMARY KEY (Id),
                UNIQUE KEY UX_BuilderProfiles_PublicId (PublicId),
                UNIQUE KEY UX_BuilderProfiles_ActiveName (MemberId, ActiveNameHash),
                KEY IX_BuilderProfiles_MemberUpdated (MemberId, UpdatedOn),
                CONSTRAINT FK_BuilderProfiles_Members FOREIGN KEY (MemberId) REFERENCES Members (Id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `,
        columns: [
            {name: "Id", type: "bigint", nullable: "NO", autoIncrement: true},
            {name: "PublicId", type: "char(36)", nullable: "NO", characterSet: "ascii"},
            {name: "MemberId", type: "int", nullable: "NO"},
            {name: "Name", type: "text", nullable: "NO", characterSet: "utf8mb4"},
            {name: "ActiveNameHash", type: "binary(32)", nullable: "YES"},
            {name: "Payload", type: "mediumtext", nullable: "YES", characterSet: "utf8mb4"},
            {name: "PayloadVersion", type: "smallint", nullable: "YES"},
            {name: "PayloadBytes", type: "int", nullable: "NO", defaultValue: "0"},
            {name: "Revision", type: "bigint", nullable: "NO", defaultValue: "1"},
            {name: "CreatedOn", type: "datetime", nullable: "NO"},
            {name: "UpdatedOn", type: "datetime", nullable: "NO"},
            {name: "DeletedOn", type: "datetime", nullable: "YES"}
        ],
        indexes: [
            {name: "PRIMARY", unique: 0, columns: ["Id"]},
            {name: "UX_BuilderProfiles_PublicId", unique: 0, columns: ["PublicId"]},
            {name: "UX_BuilderProfiles_ActiveName", unique: 0, columns: ["MemberId", "ActiveNameHash"]},
            {name: "IX_BuilderProfiles_MemberUpdated", unique: 1, columns: ["MemberId", "UpdatedOn"]}
        ],
        foreignKey: {name: "FK_BuilderProfiles_Members", column: "MemberId"}
    },
    AccountPreferences: {
        sql: `
            CREATE TABLE AccountPreferences (
                MemberId INT NOT NULL,
                DocumentVersion INT NOT NULL DEFAULT 1,
                Payload JSON NOT NULL,
                Revision BIGINT NOT NULL DEFAULT 1,
                StorageGeneration BIGINT NOT NULL DEFAULT 1,
                UpdatedOn DATETIME NOT NULL,
                PRIMARY KEY (MemberId),
                CONSTRAINT FK_AccountPreferences_Members FOREIGN KEY (MemberId) REFERENCES Members (Id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `,
        columns: [
            {name: "MemberId", type: "int", nullable: "NO"},
            {name: "DocumentVersion", type: "int", nullable: "NO", defaultValue: "1"},
            {name: "Payload", type: "json", nullable: "NO", characterSet: "utf8mb4"},
            {name: "Revision", type: "bigint", nullable: "NO", defaultValue: "1"},
            {name: "StorageGeneration", type: "bigint", nullable: "NO", defaultValue: "1"},
            {name: "UpdatedOn", type: "datetime", nullable: "NO"}
        ],
        indexes: [{name: "PRIMARY", unique: 0, columns: ["MemberId"]}],
        foreignKey: {name: "FK_AccountPreferences_Members", column: "MemberId"}
    },
    BuilderImportReceipts: {
        sql: `
            CREATE TABLE BuilderImportReceipts (
                Id BIGINT NOT NULL AUTO_INCREMENT,
                MemberId INT NOT NULL,
                IdempotencyKey CHAR(64) CHARACTER SET ascii NOT NULL,
                ResultPayload JSON NOT NULL,
                CreatedOn DATETIME NOT NULL,
                PRIMARY KEY (Id),
                UNIQUE KEY UX_BuilderImportReceipts_Key (MemberId, IdempotencyKey),
                KEY IX_BuilderImportReceipts_Created (CreatedOn),
                CONSTRAINT FK_BuilderImportReceipts_Members FOREIGN KEY (MemberId) REFERENCES Members (Id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `,
        columns: [
            {name: "Id", type: "bigint", nullable: "NO", autoIncrement: true},
            {name: "MemberId", type: "int", nullable: "NO"},
            {name: "IdempotencyKey", type: "char(64)", nullable: "NO", characterSet: "ascii"},
            {name: "ResultPayload", type: "json", nullable: "NO", characterSet: "utf8mb4"},
            {name: "CreatedOn", type: "datetime", nullable: "NO"}
        ],
        indexes: [
            {name: "PRIMARY", unique: 0, columns: ["Id"]},
            {name: "UX_BuilderImportReceipts_Key", unique: 0, columns: ["MemberId", "IdempotencyKey"]},
            {name: "IX_BuilderImportReceipts_Created", unique: 1, columns: ["CreatedOn"]}
        ],
        foreignKey: {name: "FK_BuilderImportReceipts_Members", column: "MemberId"}
    }
};

exports.mode = "non-transactional";

exports.up = async function({query}) {
    for (const [tableName, table] of Object.entries(TABLES)) {
        if (!await tableExists(query, tableName))
            await query(`create ${tableName}`, table.sql);
    }
};

exports.verify = async function({query}) {
    for (const [tableName, table] of Object.entries(TABLES)) {
        if (!await tableExists(query, tableName))
            return false;
        if (!await tableColumnsMatch(query, tableName, table.columns))
            return false;
        if (!await tableIndexesMatch(query, tableName, table.indexes))
            return false;
        if (!await foreignKeyMatches(query, tableName, table.foreignKey))
            return false;
    }
    return true;
};

async function tableExists(query, tableName) {
    const tables = await query(
        `inspect ${tableName}`,
        `
            SELECT TABLE_NAME
            FROM information_schema.tables
            WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = '${tableName}'
        `
    );
    return tables.length === 1;
}

async function tableColumnsMatch(query, tableName, expectedColumns) {
    const columns = await query(
        `inspect ${tableName} columns`,
        `
            SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, CHARACTER_SET_NAME, COLUMN_DEFAULT, EXTRA
            FROM information_schema.columns
            WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = '${tableName}'
        `
    );
    const expectedSignatures = expectedColumns.map(columnSignature).sort();
    const actualSignatures = columns.map(columnSignature).sort();
    return actualSignatures.length === expectedSignatures.length &&
        actualSignatures.every((signature, index) => signature === expectedSignatures[index]);
}

async function tableIndexesMatch(query, tableName, expectedIndexes) {
    const indexes = await query(
        `inspect ${tableName} indexes`,
        `
            SELECT INDEX_NAME, NON_UNIQUE, COLUMN_NAME, SEQ_IN_INDEX
            FROM information_schema.statistics
            WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = '${tableName}'
            ORDER BY INDEX_NAME, SEQ_IN_INDEX
        `
    );
    const expectedSignatures = expectedIndexes.flatMap(function(expected) {
        return expected.columns.map(function(column, position) {
            return indexSignature({
                INDEX_NAME: expected.name,
                NON_UNIQUE: expected.unique,
                COLUMN_NAME: column,
                SEQ_IN_INDEX: position + 1
            });
        });
    }).sort();
    const actualSignatures = indexes.map(indexSignature).sort();
    return actualSignatures.length === expectedSignatures.length &&
        actualSignatures.every((signature, index) => signature === expectedSignatures[index]);
}

function columnSignature(column) {
    return [
        column.COLUMN_NAME || column.name,
        normalizeIntegerDisplayWidth(column.COLUMN_TYPE || column.type),
        column.IS_NULLABLE || column.nullable,
        column.CHARACTER_SET_NAME === undefined ? column.characterSet || null : column.CHARACTER_SET_NAME,
        normalizeColumnDefault(column.COLUMN_DEFAULT === undefined ? column.defaultValue : column.COLUMN_DEFAULT),
        column.EXTRA === undefined ? column.autoIncrement ? "auto_increment" : "" : column.EXTRA
    ].join("|");
}

function indexSignature(index) {
    return [index.INDEX_NAME, index.NON_UNIQUE, index.SEQ_IN_INDEX, index.COLUMN_NAME].join("|");
}

function normalizeIntegerDisplayWidth(type) {
    return type.replace(
        /^(tinyint|smallint|mediumint|int|bigint)\(\d+\)( unsigned)?$/,
        "$1$2"
    );
}

function normalizeColumnDefault(value) {
    return value === null || value === undefined ? null : String(value);
}

async function foreignKeyMatches(query, tableName, expected) {
    const foreignKeys = await query(
        `inspect ${tableName} foreign keys`,
        `
            SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
            FROM information_schema.key_column_usage
            WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = '${tableName}'
                AND REFERENCED_TABLE_NAME IS NOT NULL
        `
    );
    return foreignKeys.length === 1 &&
        foreignKeys[0].CONSTRAINT_NAME === expected.name &&
        foreignKeys[0].COLUMN_NAME === expected.column &&
        foreignKeys[0].REFERENCED_TABLE_NAME === "Members" &&
        foreignKeys[0].REFERENCED_COLUMN_NAME === "Id";
}
