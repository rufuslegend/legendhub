"use strict";

const {inspectDatabaseEngine, normalizeActualDefault, normalizeIntegerDisplayWidth} = require("./schema-metadata");

const TABLES = ["Items", "Items_AuditTrail"];
const METADATA = {
    Display: "Mitigation Cap", Short: "MitCap", Var: "mitigationCap", Type: "int",
    FilterString: "> 0", DefaultValue: "0", NetStat: 0, ShowColumnDefault: 0,
    Editable: 1, CategoryId: 6, SortNumber: 703
};

exports.mode = "non-transactional";

exports.up = async function({query}) {
    // Legacy item timestamps can contain zero dates. Restore the caller's mode
    // even if DDL fails, as these additive steps must be safe to resume.
    const [{SqlMode: originalMode}] = await query("read session SQL mode", "SELECT @@SESSION.sql_mode AS SqlMode");
    const ddlMode = originalMode.split(",").filter(mode => !["NO_ZERO_DATE", "NO_ZERO_IN_DATE"].includes(mode)).join(",");
    if (ddlMode !== originalMode)
        await query("permit legacy zero dates", "SET SESSION sql_mode = ?", [ddlMode]);
    try {
        for (const table of TABLES) {
            if (!await readColumn(query, table))
                await query(`add ${table}.MitigationCap`, `ALTER TABLE ${table} ADD COLUMN MitigationCap INT NOT NULL DEFAULT 0`);
        }
    }
    finally {
        if (ddlMode !== originalMode)
            await query("restore session SQL mode", "SET SESSION sql_mode = ?", [originalMode]);
    }

    const metadata = await readMetadata(query);
    if (metadata.length > 1)
        throw new Error("Multiple mitigation cap metadata rows require correction.");
    const keys = Object.keys(METADATA);
    if (metadata.length === 0) {
        await query("add mitigation cap metadata",
            `INSERT INTO ItemStatInfo (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`,
            Object.values(METADATA));
    }
    else if (!metadataMatches(metadata)) {
        await query("repair mitigation cap metadata",
            `UPDATE ItemStatInfo SET ${keys.map(key => `${key} = ?`).join(", ")} WHERE Var = 'mitigationCap'`,
            Object.values(METADATA));
    }

    if (!triggerMatches(await readTrigger(query)))
        await replaceAuditTrigger(query);
};

exports.verify = async function({query}) {
    const engine = await inspectDatabaseEngine(query);
    for (const table of TABLES) {
        const column = await readColumn(query, table);
        if (!column || normalizeIntegerDisplayWidth(column.COLUMN_TYPE) !== "int" ||
            column.IS_NULLABLE !== "NO" || normalizeActualDefault(column.COLUMN_DEFAULT, engine) !== "0")
            return false;
    }
    return metadataMatches(await readMetadata(query)) && triggerMatches(await readTrigger(query));
};

function readColumn(query, table) {
    return query(`inspect ${table}.MitigationCap`, `
        SELECT COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM information_schema.columns
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'MitigationCap'
    `, [table]).then(rows => rows[0]);
}

function readMetadata(query) {
    return query("inspect mitigation cap metadata", `
        SELECT ${Object.keys(METADATA).join(", ")} FROM ItemStatInfo WHERE Var = 'mitigationCap'
    `);
}

function metadataMatches(rows) {
    return rows.length === 1 && Object.entries(METADATA).every(([key, value]) => String(rows[0][key]) === String(value));
}

function readTrigger(query) {
    return query("inspect Items_BEFORE_UPDATE", `
        SELECT ACTION_STATEMENT FROM information_schema.triggers
        WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME = 'Items_BEFORE_UPDATE'
    `).then(rows => rows[0]?.ACTION_STATEMENT);
}

function triggerMatches(statement) {
    return Boolean(statement) && [
        "OLD.`MitigationCap`", "OLD.`Official`",
        "INSERT INTO Items_AuditTrail", "INSERT INTO NotificationQueue",
        "@DISABLE_NOTIFICATIONS IS NULL AND NEW.Deleted = OLD.Deleted"
    ].every(marker => statement.includes(marker));
}

async function replaceAuditTrigger(query) {
    const columns = {};
    for (const table of TABLES) {
        columns[table] = (await query(`read ${table} columns`, `
            SELECT COLUMN_NAME FROM information_schema.columns
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION
        `, [table])).map(column => column.COLUMN_NAME);
    }
    const shared = columns.Items.filter(name => name !== "Id" && columns.Items_AuditTrail.includes(name));
    const quote = name => `\`${name.replace(/`/g, "``")}\``;
    const names = ["ItemId", ...shared].map(quote).join(", ");
    const values = ["Id", ...shared].map(name => `OLD.${quote(name)}`).join(", ");
    await query("drop Items_BEFORE_UPDATE", "DROP TRIGGER IF EXISTS Items_BEFORE_UPDATE");
    await query("create Items_BEFORE_UPDATE", `
        CREATE TRIGGER Items_BEFORE_UPDATE BEFORE UPDATE ON Items FOR EACH ROW
        BEGIN
            IF (@DISABLE_NOTIFICATIONS IS NULL AND NEW.Deleted = OLD.Deleted) THEN
                INSERT INTO Items_AuditTrail (${names}) VALUES (${values});
                INSERT INTO NotificationQueue
                    (ActorId, ObjectId, ObjectType, ObjectPage, ObjectName, Verb, CreatedOn)
                SELECT M.Id, OLD.Id, 'item', 'items', OLD.Name, 'updated', NOW()
                FROM Members M WHERE Username = NEW.ModifiedBy;
            END IF;
        END
    `);
}
