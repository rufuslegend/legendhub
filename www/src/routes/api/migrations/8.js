const MEMBER_COLUMNS = [
    {name: "Email", definition: "VARCHAR(254) NULL", type: "varchar(254)", nullable: "YES"},
    {
        name: "NormalizedEmail",
        definition: "VARCHAR(254) NULL",
        type: "varchar(254)",
        nullable: "YES"
    },
    {
        name: "EmailVerifiedOn",
        definition: "DATETIME NULL",
        type: "datetime",
        nullable: "YES"
    },
    {
        name: "PendingEmail",
        definition: "VARCHAR(254) NULL",
        type: "varchar(254)",
        nullable: "YES"
    },
    {
        name: "PendingNormalizedEmail",
        definition: "VARCHAR(254) NULL",
        type: "varchar(254)",
        nullable: "YES"
    },
    {
        name: "StorageNamespace",
        definition: "CHAR(32) CHARACTER SET ascii NULL",
        type: "char(32)",
        nullable: "NO",
        characterSet: "ascii"
    }
];

const MEMBER_INDEXES = [
    {name: "UX_Members_NormalizedEmail", column: "NormalizedEmail"},
    {name: "UX_Members_PendingNormalizedEmail", column: "PendingNormalizedEmail"},
    {name: "UX_Members_StorageNamespace", column: "StorageNamespace"}
];

const ACTION_TABLES = {
    AccountActionTokens: `
        CREATE TABLE AccountActionTokens (
            Id BIGINT NOT NULL AUTO_INCREMENT,
            MemberId INT NOT NULL,
            Purpose VARCHAR(32) CHARACTER SET ascii NOT NULL,
            Selector CHAR(12) CHARACTER SET ascii NOT NULL,
            HashedValidator CHAR(64) CHARACTER SET ascii NOT NULL,
            PendingEmail VARCHAR(254) NULL,
            PendingNormalizedEmail VARCHAR(254) NULL,
            RequestIPHash CHAR(40) CHARACTER SET ascii NOT NULL,
            CreatedOn DATETIME NOT NULL,
            ExpiresOn DATETIME NOT NULL,
            ConsumedOn DATETIME NULL,
            PRIMARY KEY (Id),
            UNIQUE KEY UX_AccountActionTokens_Selector (Selector),
            KEY IX_AccountActionTokens_MemberPurpose (MemberId, Purpose, CreatedOn),
            KEY IX_AccountActionTokens_Expiry (ExpiresOn),
            CONSTRAINT FK_AccountActionTokens_Members
                FOREIGN KEY (MemberId) REFERENCES Members (Id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `,
    AccountActionAttempts: `
        CREATE TABLE AccountActionAttempts (
            Id BIGINT NOT NULL AUTO_INCREMENT,
            Purpose VARCHAR(32) CHARACTER SET ascii NOT NULL,
            IdentityHash CHAR(64) CHARACTER SET ascii NOT NULL,
            RequestIPHash CHAR(40) CHARACTER SET ascii NOT NULL,
            CreatedOn DATETIME NOT NULL,
            PRIMARY KEY (Id),
            KEY IX_AccountActionAttempts_Identity (Purpose, IdentityHash, CreatedOn),
            KEY IX_AccountActionAttempts_IP (Purpose, RequestIPHash, CreatedOn)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `
};

const STORAGE_NAMESPACE_BATCH_SIZE = 500;

exports.mode = "non-transactional";

exports.up = async function({query}) {
    for (const column of MEMBER_COLUMNS) {
        if (!await memberColumnExists(query, column.name)) {
            await query(
                `add Members.${column.name}`,
                `ALTER TABLE Members ADD COLUMN ${column.name} ${column.definition}`
            );
        }
    }

    await populateStorageNamespaces(query);

    const storageNamespace = await readMemberColumn(query, "StorageNamespace");
    if (storageNamespace && storageNamespace.IS_NULLABLE !== "NO") {
        await query(
            "require Members.StorageNamespace",
            "ALTER TABLE Members MODIFY COLUMN StorageNamespace CHAR(32) CHARACTER SET ascii NOT NULL"
        );
    }

    for (const index of MEMBER_INDEXES) {
        if (!await memberIndexExists(query, index.name)) {
            await query(
                `create Members.${index.name}`,
                `CREATE UNIQUE INDEX ${index.name} ON Members (${index.column})`
            );
        }
    }

    for (const [tableName, sql] of Object.entries(ACTION_TABLES)) {
        if (!await tableExists(query, tableName))
            await query(`create ${tableName}`, sql);
    }
};

exports.verify = async function({query}) {
    const columns = await readMemberColumns(query);
    if (!MEMBER_COLUMNS.every(function(expected) {
        const column = columns.find((candidate) => candidate.COLUMN_NAME === expected.name);
        return column &&
            column.COLUMN_TYPE === expected.type &&
            column.IS_NULLABLE === expected.nullable &&
            (expected.characterSet === undefined || column.CHARACTER_SET_NAME === expected.characterSet);
    })) {
        return false;
    }

    for (const index of MEMBER_INDEXES) {
        const indexes = await readMemberIndex(query, index.name);
        if (indexes.length !== 1 || indexes[0].NON_UNIQUE !== 0 || indexes[0].COLUMN_NAME !== index.column)
            return false;
    }

    for (const tableName of Object.keys(ACTION_TABLES)) {
        if (!await tableExists(query, tableName))
            return false;
    }

    const nullStorageNamespaces = await query(
        "verify Members.StorageNamespace values",
        "SELECT COUNT(*) AS NullStorageNamespaces FROM Members WHERE StorageNamespace IS NULL"
    );
    return nullStorageNamespaces.length === 1 &&
        Number(nullStorageNamespaces[0].NullStorageNamespaces) === 0;
};

async function populateStorageNamespaces(query) {
    let affectedRows;

    do {
        const result = await query(
            "populate Members.StorageNamespace batch",
            `
                UPDATE Members
                SET StorageNamespace = LOWER(HEX(RANDOM_BYTES(16)))
                WHERE StorageNamespace IS NULL
                LIMIT ${STORAGE_NAMESPACE_BATCH_SIZE}
            `
        );
        affectedRows = Number(result.affectedRows);
    } while (affectedRows > 0);
}

async function memberColumnExists(query, columnName) {
    return Boolean(await readMemberColumn(query, columnName));
}

async function readMemberColumn(query, columnName) {
    const columns = await query(
        `inspect Members.${columnName}`,
        `
            SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, CHARACTER_SET_NAME
            FROM information_schema.columns
            WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = 'Members'
                AND COLUMN_NAME = '${columnName}'
        `
    );
    return columns[0];
}

function readMemberColumns(query) {
    return query(
        "verify Members email columns",
        `
            SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, CHARACTER_SET_NAME
            FROM information_schema.columns
            WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = 'Members'
                AND COLUMN_NAME IN (
                    'Email', 'NormalizedEmail', 'EmailVerifiedOn',
                    'PendingEmail', 'PendingNormalizedEmail', 'StorageNamespace'
                )
        `
    );
}

async function memberIndexExists(query, indexName) {
    return (await readMemberIndex(query, indexName)).length > 0;
}

function readMemberIndex(query, indexName) {
    return query(
        `inspect Members.${indexName}`,
        `
            SELECT INDEX_NAME, NON_UNIQUE, COLUMN_NAME
            FROM information_schema.statistics
            WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = 'Members'
                AND INDEX_NAME = '${indexName}'
            ORDER BY SEQ_IN_INDEX
        `
    );
}

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
