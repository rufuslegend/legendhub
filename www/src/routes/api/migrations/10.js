"use strict";

const SLOT_MASK_TYPE = "int unsigned";
const VALID_SLOT_MASK = (2 ** 22) - 1;
const OTHER_SLOT_MASK = 2 ** 21;
const NOTIFICATION_STATEMENT_MARKERS = [
    "INSERT INTO NotificationQueue",
    "SELECT M.Id, OLD.Id, 'item', 'items', OLD.Name, 'updated', NOW()",
    "FROM Members M",
    "WHERE Username = NEW.ModifiedBy"
];

exports.mode = "non-transactional";

exports.up = async function({query}) {
    const itemColumn = await readSlotMaskColumn(query, "Items");
    if (!itemColumn) {
        await query(
            "add Items.SlotMask",
            "ALTER TABLE Items ADD COLUMN SlotMask INT UNSIGNED NULL"
        );
    }

    const auditColumn = await readSlotMaskColumn(query, "Items_AuditTrail");
    if (!auditColumn) {
        await query(
            "add Items_AuditTrail.SlotMask",
            "ALTER TABLE Items_AuditTrail ADD COLUMN SlotMask INT UNSIGNED NULL"
        );
    }

    await backfillSlotMasks(query, "Items");
    await assertValidSlotMasks(query, "Items");
    if (!columnIsRequiredSlotMask(itemColumn))
        await makeSlotMaskRequired(query, "Items");

    await backfillSlotMasks(query, "Items_AuditTrail");
    await assertValidSlotMasks(query, "Items_AuditTrail");
    if (!columnIsRequiredSlotMask(auditColumn))
        await makeSlotMaskRequired(query, "Items_AuditTrail");

    const trigger = await readAuditTrigger(query);
    if (!triggerHasExpectedBehavior(trigger))
        await replaceAuditTrigger(query);
};

exports.verify = async function({query}) {
    const itemColumn = await readSlotMaskColumn(query, "Items");
    const auditColumn = await readSlotMaskColumn(query, "Items_AuditTrail");
    if (!columnIsRequiredSlotMask(itemColumn) || !columnIsRequiredSlotMask(auditColumn))
        return false;
    if (!await slotMasksAreValid(query, "Items") ||
        !await slotMasksAreValid(query, "Items_AuditTrail")) {
        return false;
    }

    const trigger = await readAuditTrigger(query);
    return triggerHasExpectedBehavior(trigger);
};

function readSlotMaskColumn(query, tableName) {
    return query(
        `inspect ${tableName}.SlotMask`,
        `
            SELECT COLUMN_TYPE, IS_NULLABLE
            FROM information_schema.columns
            WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = '${tableName}'
                AND COLUMN_NAME = 'SlotMask'
        `
    ).then((columns) => columns[0]);
}

function columnIsRequiredSlotMask(column) {
    return Boolean(column) &&
        normalizeIntegerDisplayWidth(column.COLUMN_TYPE) === SLOT_MASK_TYPE &&
        column.IS_NULLABLE === "NO";
}

function normalizeIntegerDisplayWidth(type) {
    return type.replace(
        /^(tinyint|smallint|mediumint|int|bigint)\(\d+\)( unsigned)?$/,
        "$1$2"
    );
}

function backfillSlotMasks(query, tableName) {
    return query(
        `backfill ${tableName}.SlotMask`,
        `
            UPDATE ${tableName}
            SET SlotMask = (1 << Slot) |
                IF(Slot = 14 AND Holdable = 1, (1 << 15), 0)
            WHERE SlotMask IS NULL
        `
    );
}

async function assertValidSlotMasks(query, tableName) {
    if (!await slotMasksAreValid(query, tableName))
        throw new Error(`${tableName}.SlotMask contains invalid slot capability data`);
}

async function slotMasksAreValid(query, tableName) {
    const invalidRows = await query(
        `validate ${tableName}.SlotMask`,
        `
            SELECT Id
            FROM ${tableName}
            WHERE SlotMask IS NULL
                OR SlotMask = 0
                OR (SlotMask & ~${VALID_SLOT_MASK}) <> 0
                OR ((SlotMask & ${OTHER_SLOT_MASK}) <> 0 AND SlotMask <> ${OTHER_SLOT_MASK})
                OR Slot IS NULL
                OR Slot < 0
                OR Slot > 21
                OR (SlotMask & (1 << Slot)) = 0
            LIMIT 1
        `
    );
    return invalidRows.length === 0;
}

function makeSlotMaskRequired(query, tableName) {
    return query(
        `require ${tableName}.SlotMask`,
        `ALTER TABLE ${tableName} MODIFY COLUMN SlotMask INT UNSIGNED NOT NULL`
    );
}

function readAuditTrigger(query) {
    return query(
        "inspect Items_BEFORE_UPDATE",
        `
            SELECT ACTION_STATEMENT
            FROM information_schema.triggers
            WHERE TRIGGER_SCHEMA = DATABASE()
                AND TRIGGER_NAME = 'Items_BEFORE_UPDATE'
        `
    ).then((triggers) => triggers[0]);
}

function triggerHasExpectedBehavior(trigger) {
    return Boolean(trigger) &&
        trigger.ACTION_STATEMENT.includes("OLD.`SlotMask`") &&
        NOTIFICATION_STATEMENT_MARKERS.every((marker) => trigger.ACTION_STATEMENT.includes(marker));
}

async function replaceAuditTrigger(query) {
    const itemColumns = await readColumns(query, "Items");
    const auditColumns = await readColumns(query, "Items_AuditTrail");
    const auditNames = new Set(auditColumns.map((column) => column.COLUMN_NAME));
    const sharedNames = itemColumns
        .map((column) => column.COLUMN_NAME)
        .filter((name) => name !== "Id" && auditNames.has(name));
    const insertNames = ["ItemId", ...sharedNames].map(quoteIdentifier).join(", ");
    const oldValues = ["OLD.`Id`", ...sharedNames.map((name) => `OLD.${quoteIdentifier(name)}`)]
        .join(", ");
    const createTriggerSql = `
        CREATE TRIGGER Items_BEFORE_UPDATE BEFORE UPDATE ON Items FOR EACH ROW
        BEGIN
            IF (@DISABLE_NOTIFICATIONS IS NULL AND NEW.Deleted = OLD.Deleted) THEN
                INSERT INTO Items_AuditTrail (${insertNames}) VALUES (${oldValues});

                INSERT INTO NotificationQueue (ActorId, ObjectId, ObjectType, ObjectPage, ObjectName, Verb, CreatedOn)
                SELECT M.Id, OLD.Id, 'item', 'items', OLD.Name, 'updated', NOW()
                FROM Members M
                    WHERE Username = NEW.ModifiedBy;
            END IF;
        END`;

    await query("drop Items_BEFORE_UPDATE", "DROP TRIGGER IF EXISTS Items_BEFORE_UPDATE");
    await query("create Items_BEFORE_UPDATE", createTriggerSql);
}

function readColumns(query, tableName) {
    return query(
        `read ${tableName} columns`,
        `
            SELECT COLUMN_NAME
            FROM information_schema.columns
            WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = '${tableName}'
            ORDER BY ORDINAL_POSITION
        `
    );
}

function quoteIdentifier(identifier) {
    return `\`${identifier.replace(/`/g, "``")}\``;
}
