async function readColumns(query) {
    return query(
        "inspect the retry target",
        `
            SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
            FROM information_schema.columns
            WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = 'MigrationRetryTarget'
                AND COLUMN_NAME IN ('FirstStep', 'SecondStep')
        `
    );
}

exports.mode = "non-transactional";

exports.up = async function({query}) {
    const columns = await readColumns(query);
    if (!columns.find((column) => column.COLUMN_NAME === "FirstStep")) {
        await query(
            "apply the first retry step",
            `
                ALTER TABLE MigrationRetryTarget
                ADD COLUMN FirstStep INT NOT NULL DEFAULT 0
            `
        );
    }

    const attempts = await query(
        "read the retry attempt",
        "SELECT Attempts FROM MigrationRetryControl"
    );
    await query(
        "increment the retry attempt",
        "UPDATE MigrationRetryControl SET Attempts = Attempts + 1"
    );
    if (attempts[0].Attempts === 0)
        throw new Error("Intentional failure after the first DDL step");

    const updatedColumns = await readColumns(query);
    if (!updatedColumns.find((column) => column.COLUMN_NAME === "SecondStep")) {
        await query(
            "apply the second retry step",
            `
                ALTER TABLE MigrationRetryTarget
                ADD COLUMN SecondStep VARCHAR(32) NOT NULL DEFAULT 'ready'
            `
        );
    }
};

exports.verify = async function({query}) {
    const columns = await readColumns(query);
    const firstStep = columns.find((column) => column.COLUMN_NAME === "FirstStep");
    const secondStep = columns.find((column) => column.COLUMN_NAME === "SecondStep");

    return Boolean(
        firstStep &&
        firstStep.COLUMN_TYPE === "int(11)" &&
        firstStep.IS_NULLABLE === "NO" &&
        String(firstStep.COLUMN_DEFAULT) === "0" &&
        secondStep &&
        secondStep.COLUMN_TYPE === "varchar(32)" &&
        secondStep.IS_NULLABLE === "NO" &&
        secondStep.COLUMN_DEFAULT === "ready"
    );
};
