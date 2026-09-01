"use strict";

const ITEM_COLUMNS = [
    {
        table: "Items", name: "Official",
        expected: {type: "tinyint", nullable: "NO", defaultValue: "0"},
        add: "ALTER TABLE Items ADD COLUMN Official TINYINT NOT NULL DEFAULT 0",
        modify: "ALTER TABLE Items MODIFY COLUMN Official TINYINT NOT NULL DEFAULT 0"
    },
    {
        table: "Items_AuditTrail", name: "Official",
        expected: {type: "tinyint", nullable: "NO", defaultValue: "0"},
        add: "ALTER TABLE Items_AuditTrail ADD COLUMN Official TINYINT NOT NULL DEFAULT 0",
        modify: "ALTER TABLE Items_AuditTrail MODIFY COLUMN Official TINYINT NOT NULL DEFAULT 0"
    },
    {
        table: "Items", name: "Name",
        expected: {
            type: "varchar(255)", nullable: "NO", characterSet: "utf8mb4",
            collation: "utf8mb4_unicode_ci"
        },
        modify: "ALTER TABLE Items MODIFY COLUMN Name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL"
    },
    {
        table: "Items_AuditTrail", name: "Name",
        expected: {
            type: "varchar(255)", nullable: "NO", characterSet: "utf8mb4",
            collation: "utf8mb4_unicode_ci"
        },
        modify: "ALTER TABLE Items_AuditTrail MODIFY COLUMN Name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL"
    },
    {
        table: "Items", name: "Casts",
        expected: {
            type: "mediumtext", nullable: "YES", characterSet: "utf8mb4",
            collation: "utf8mb4_unicode_ci"
        },
        modify: "ALTER TABLE Items MODIFY COLUMN Casts MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL"
    },
    {
        table: "Items_AuditTrail", name: "Casts",
        expected: {
            type: "mediumtext", nullable: "YES", characterSet: "utf8mb4",
            collation: "utf8mb4_unicode_ci"
        },
        modify: "ALTER TABLE Items_AuditTrail MODIFY COLUMN Casts MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL"
    }
];

const TABLES = {
    OfficialItemVariants: {
        sql: `
            CREATE TABLE OfficialItemVariants (
                Id BIGINT NOT NULL AUTO_INCREMENT,
                ItemId INT NOT NULL,
                Server VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
                Vnum INT UNSIGNED NOT NULL,
                ItemFingerprint BINARY(32) NOT NULL,
                FirstSeenOn DATETIME NOT NULL,
                LastSeenOn DATETIME NOT NULL,
                ObservationCount BIGINT UNSIGNED NOT NULL DEFAULT 1,
                PRIMARY KEY (Id),
                UNIQUE KEY UX_OfficialItemVariants_Identity (Server, Vnum, ItemFingerprint),
                UNIQUE KEY UX_OfficialItemVariants_ItemId (ItemId)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `,
        columns: [
            column("Id", "bigint", "NO", null, null, "auto_increment"),
            column("ItemId", "int", "NO"),
            column("Server", "varchar(32)", "NO", null, "ascii", "", "ascii_bin"),
            column("Vnum", "int unsigned", "NO"),
            column("ItemFingerprint", "binary(32)", "NO"),
            column("FirstSeenOn", "datetime", "NO"),
            column("LastSeenOn", "datetime", "NO"),
            column("ObservationCount", "bigint unsigned", "NO", "1")
        ],
        indexes: [
            index("PRIMARY", 0, ["Id"]),
            index("UX_OfficialItemVariants_Identity", 0,
                ["Server", "Vnum", "ItemFingerprint"]),
            index("UX_OfficialItemVariants_ItemId", 0, ["ItemId"])
        ]
    },
    EquipmentSubmissions: {
        sql: `
            CREATE TABLE EquipmentSubmissions (
                Id BIGINT NOT NULL AUTO_INCREMENT,
                Server VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
                SubmissionId VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
                PayloadHash BINARY(32) NOT NULL,
                CanonicalPayload MEDIUMTEXT NOT NULL,
                SourceTimestamp DATETIME NOT NULL,
                ReceivedOn DATETIME NOT NULL,
                SubmittedByCharacter VARCHAR(60) NOT NULL,
                SubmittedByAccountId VARCHAR(128) NULL,
                ItemId INT NOT NULL,
                PRIMARY KEY (Id),
                UNIQUE KEY UX_EquipmentSubmissions_Identity (Server, SubmissionId),
                KEY IX_EquipmentSubmissions_ItemId (ItemId)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `,
        columns: [
            column("Id", "bigint", "NO", null, null, "auto_increment"),
            column("Server", "varchar(32)", "NO", null, "ascii", "", "ascii_bin"),
            column("SubmissionId", "varchar(128)", "NO", null, "ascii", "", "ascii_bin"),
            column("PayloadHash", "binary(32)", "NO"),
            column("CanonicalPayload", "mediumtext", "NO", null, "utf8mb4"),
            column("SourceTimestamp", "datetime", "NO"),
            column("ReceivedOn", "datetime", "NO"),
            column("SubmittedByCharacter", "varchar(60)", "NO", null, "utf8mb4"),
            column("SubmittedByAccountId", "varchar(128)", "YES", null, "utf8mb4"),
            column("ItemId", "int", "NO")
        ],
        indexes: [
            index("PRIMARY", 0, ["Id"]),
            index("UX_EquipmentSubmissions_Identity", 0, ["Server", "SubmissionId"]),
            index("IX_EquipmentSubmissions_ItemId", 1, ["ItemId"])
        ]
    }
};

const OFFICIAL_METADATA = {
    Display: "Official",
    Short: "Official",
    Var: "official",
    Type: "bool",
    FilterString: "= 1",
    DefaultValue: "false",
    NetStat: "0",
    ShowColumnDefault: "0",
    Editable: "0",
    CategoryId: "1",
    SortNumber: "1110"
};

const TRIGGER_MARKERS = [
    "OLD.`Official`",
    "INSERT INTO NotificationQueue",
    "SELECT M.Id, OLD.Id, 'item', 'items', OLD.Name, 'updated', NOW()"
];

exports.mode = "non-transactional";

exports.up = async function({query}) {
    for (const definition of ITEM_COLUMNS)
        await ensureItemColumn(query, definition);
    for (const [name, definition] of Object.entries(TABLES)) {
        if (!await tableExists(query, name))
            await query(`create ${name}`, definition.sql);
    }
    await ensureOfficialMetadata(query);
    const trigger = await readAuditTrigger(query);
    if (!triggerIsCurrent(trigger))
        await replaceAuditTrigger(query);
};

exports.verify = async function({query}) {
    for (const definition of ITEM_COLUMNS) {
        const actual = await readItemColumn(query, definition.table, definition.name);
        if (!columnMatches(actual, definition.expected))
            return false;
    }
    for (const [name, definition] of Object.entries(TABLES)) {
        if (!await tableExists(query, name) ||
            !await tableColumnsMatch(query, name, definition.columns) ||
            !await tableIndexesMatch(query, name, definition.indexes)) {
            return false;
        }
    }
    if (!metadataMatches((await readOfficialMetadata(query))[0]))
        return false;
    return triggerIsCurrent(await readAuditTrigger(query));
};

async function ensureItemColumn(query, definition) {
    const actual = await readItemColumn(query, definition.table, definition.name);
    if (!actual && definition.add) {
        await query(`add ${definition.table}.${definition.name}`, definition.add);
        return;
    }
    if (!columnMatches(actual, definition.expected))
        await query(`modify ${definition.table}.${definition.name}`, definition.modify);
}

function readItemColumn(query, tableName, columnName) {
    return query(
        `inspect ${tableName}.${columnName}`,
        `
            SELECT COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT,
                CHARACTER_SET_NAME, COLLATION_NAME
            FROM information_schema.columns
            WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = '${tableName}'
                AND COLUMN_NAME = '${columnName}'
        `
    ).then(rows => rows[0]);
}

function columnMatches(actual, expected) {
    if (!actual)
        return false;
    const type = normalizeIntegerDisplayWidth(actual.COLUMN_TYPE || actual.type);
    const nullable = actual.IS_NULLABLE || actual.nullable;
    const defaultValue = normalizeDefault(
        actual.COLUMN_DEFAULT === undefined ? actual.defaultValue : actual.COLUMN_DEFAULT);
    return type === expected.type && nullable === expected.nullable &&
        (expected.defaultValue === undefined || defaultValue === expected.defaultValue) &&
        (expected.characterSet === undefined ||
            (actual.CHARACTER_SET_NAME || actual.characterSet) === expected.characterSet) &&
        (expected.collation === undefined ||
            (actual.COLLATION_NAME || actual.collation) === expected.collation);
}

async function tableExists(query, tableName) {
    const rows = await query(
        `inspect ${tableName}`,
        `
            SELECT TABLE_NAME
            FROM information_schema.tables
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${tableName}'
        `
    );
    return rows.length === 1;
}

async function tableColumnsMatch(query, tableName, expected) {
    const actual = await query(
        `inspect ${tableName} columns`,
        `
            SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, CHARACTER_SET_NAME,
                COLLATION_NAME, COLUMN_DEFAULT, EXTRA
            FROM information_schema.columns
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${tableName}'
        `
    );
    const left = actual.map(columnSignature).sort();
    const right = expected.map(columnSignature).sort();
    if (left.length !== right.length || !left.every((value, index) => value === right[index]))
        return false;
    return expected.every(function(definition) {
        if (!definition.collation)
            return true;
        const column = actual.find(value => value.COLUMN_NAME === definition.name);
        return column && column.COLLATION_NAME === definition.collation;
    });
}

async function tableIndexesMatch(query, tableName, expected) {
    const actual = await query(
        `inspect ${tableName} indexes`,
        `
            SELECT INDEX_NAME, NON_UNIQUE, COLUMN_NAME, SEQ_IN_INDEX
            FROM information_schema.statistics
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${tableName}'
            ORDER BY INDEX_NAME, SEQ_IN_INDEX
        `
    );
    const left = actual.map(indexSignature).sort();
    const right = expected.flatMap(value => value.columns.map((name, position) =>
        indexSignature({
            INDEX_NAME: value.name,
            NON_UNIQUE: value.nonUnique,
            COLUMN_NAME: name,
            SEQ_IN_INDEX: position + 1
        }))).sort();
    return left.length === right.length && left.every((value, position) => value === right[position]);
}

function readOfficialMetadata(query) {
    return query(
        "inspect official item metadata",
        `
            SELECT Display, Short, Var, Type, FilterString, DefaultValue, NetStat,
                ShowColumnDefault, Editable, CategoryId, SortNumber
            FROM ItemStatInfo WHERE Var = 'official'
        `
    );
}

async function ensureOfficialMetadata(query) {
    const rows = await readOfficialMetadata(query);
    if (rows.length === 0) {
        await query(
            "insert official item metadata",
            `
                INSERT INTO ItemStatInfo
                    (Display, Short, Var, Type, FilterString, DefaultValue,
                        NetStat, ShowColumnDefault, Editable, CategoryId, SortNumber)
                VALUES
                    ('Official', 'Official', 'official', 'bool', '= 1', 'false',
                        0, 0, 0, 1, 1110)
            `
        );
    }
    else if (rows.length !== 1 || !metadataMatches(rows[0])) {
        await query(
            "repair official item metadata",
            `
                UPDATE ItemStatInfo SET
                    Display = 'Official', Short = 'Official', Type = 'bool',
                    FilterString = '= 1', DefaultValue = 'false', NetStat = 0,
                    ShowColumnDefault = 0, Editable = 0, CategoryId = 1,
                    SortNumber = 1110
                WHERE Var = 'official'
            `
        );
    }
}

function metadataMatches(actual) {
    return Boolean(actual) && Object.entries(OFFICIAL_METADATA).every(([key, value]) =>
        normalizeDefault(actual[key]) === value);
}

function readAuditTrigger(query) {
    return query(
        "inspect Items_BEFORE_UPDATE",
        `
            SELECT ACTION_STATEMENT FROM information_schema.triggers
            WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME = 'Items_BEFORE_UPDATE'
        `
    ).then(rows => rows[0]);
}

function triggerIsCurrent(trigger) {
    return Boolean(trigger) && TRIGGER_MARKERS.every(marker =>
        trigger.ACTION_STATEMENT.includes(marker));
}

async function replaceAuditTrigger(query) {
    const itemColumns = await readColumns(query, "Items");
    const auditColumns = await readColumns(query, "Items_AuditTrail");
    const auditNames = new Set(auditColumns.map(value => value.COLUMN_NAME));
    const sharedNames = itemColumns.map(value => value.COLUMN_NAME)
        .filter(name => name !== "Id" && auditNames.has(name));
    const insertNames = ["ItemId", ...sharedNames].map(quoteIdentifier).join(", ");
    const oldValues = ["OLD.`Id`", ...sharedNames.map(name => `OLD.${quoteIdentifier(name)}`)]
        .join(", ");
    await query("drop Items_BEFORE_UPDATE", "DROP TRIGGER IF EXISTS Items_BEFORE_UPDATE");
    await query("create Items_BEFORE_UPDATE", `
        CREATE TRIGGER Items_BEFORE_UPDATE BEFORE UPDATE ON Items FOR EACH ROW
        BEGIN
            IF (@DISABLE_NOTIFICATIONS IS NULL AND NEW.Deleted = OLD.Deleted) THEN
                INSERT INTO Items_AuditTrail (${insertNames}) VALUES (${oldValues});
                INSERT INTO NotificationQueue
                    (ActorId, ObjectId, ObjectType, ObjectPage, ObjectName, Verb, CreatedOn)
                SELECT M.Id, OLD.Id, 'item', 'items', OLD.Name, 'updated', NOW()
                FROM Members M WHERE Username = NEW.ModifiedBy;
            END IF;
        END
    `);
}

function readColumns(query, tableName) {
    return query(
        `read ${tableName} columns`,
        `
            SELECT COLUMN_NAME FROM information_schema.columns
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${tableName}'
            ORDER BY ORDINAL_POSITION
        `
    );
}

function quoteIdentifier(value) {
    return `\`${value.replace(/`/g, "``")}\``;
}

function normalizeIntegerDisplayWidth(value) {
    return value.replace(/^(tinyint|smallint|mediumint|int|bigint)\(\d+\)( unsigned)?$/,
        "$1$2");
}

function normalizeDefault(value) {
    return value === null || value === undefined ? null : String(value);
}

function column(name, type, nullable, defaultValue = null, characterSet = null,
    extra = "", collation = null) {
    return {name, type, nullable, defaultValue, characterSet, extra, collation};
}

function index(name, nonUnique, columns) {
    return {name, nonUnique, columns};
}

function columnSignature(value) {
    return [
        value.COLUMN_NAME || value.name,
        normalizeIntegerDisplayWidth(value.COLUMN_TYPE || value.type),
        value.IS_NULLABLE || value.nullable,
        value.CHARACTER_SET_NAME === undefined ? value.characterSet : value.CHARACTER_SET_NAME,
        normalizeDefault(value.COLUMN_DEFAULT === undefined ? value.defaultValue : value.COLUMN_DEFAULT),
        value.EXTRA === undefined ? value.extra : value.EXTRA
    ].join("|");
}

function indexSignature(value) {
    return [value.INDEX_NAME, value.NON_UNIQUE, value.SEQ_IN_INDEX, value.COLUMN_NAME].join("|");
}

function completeInspectionResponses() {
    const responses = {};
    for (const definition of ITEM_COLUMNS) {
        responses[`inspect ${definition.table}.${definition.name}`] = [{
            COLUMN_TYPE: definition.expected.type,
            IS_NULLABLE: definition.expected.nullable,
            COLUMN_DEFAULT: definition.expected.defaultValue ?? null,
            CHARACTER_SET_NAME: definition.expected.characterSet || null,
            COLLATION_NAME: definition.expected.collation || null
        }];
    }
    for (const [name, definition] of Object.entries(TABLES)) {
        responses[`inspect ${name}`] = [{TABLE_NAME: name}];
        responses[`inspect ${name} columns`] = definition.columns.map(value => ({
            COLUMN_NAME: value.name,
            COLUMN_TYPE: value.type,
            IS_NULLABLE: value.nullable,
            CHARACTER_SET_NAME: value.characterSet,
            COLLATION_NAME: value.collation,
            COLUMN_DEFAULT: value.defaultValue,
            EXTRA: value.extra
        }));
        responses[`inspect ${name} indexes`] = definition.indexes.flatMap(value =>
            value.columns.map((name, position) => ({
                INDEX_NAME: value.name,
                NON_UNIQUE: value.nonUnique,
                COLUMN_NAME: name,
                SEQ_IN_INDEX: position + 1
            })));
    }
    responses["inspect official item metadata"] = [{...OFFICIAL_METADATA}];
    responses["inspect Items_BEFORE_UPDATE"] = [{
        ACTION_STATEMENT: TRIGGER_MARKERS.join(" ")
    }];
    return responses;
}

exports.__test = {completeInspectionResponses};
