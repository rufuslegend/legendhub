# Database migrations

Migrations 1–7 predate the migration safety contract and must not be edited.
The runner treats migrations 1 and 6 as legacy, non-transactional migrations
because they contain MySQL DDL. A failed legacy DDL migration requires manual
inspection before startup can continue.

Every new migration must export an explicit `mode`.

## Transactional migrations

Use `transactional` for DML that MySQL can roll back. The `up` function returns
one or more SQL statements:

```js
exports.mode = "transactional";

exports.up = function() {
    return `
        UPDATE Example
        SET Enabled = 1
        WHERE Enabled IS NULL;
    `;
}
```

The data changes, completion history, and run status are committed together.

## Non-transactional migrations

Use `non-transactional` for DDL. The migration must inspect the current schema
before each change, execute only missing changes, and verify the complete target
state:

```js
exports.mode = "non-transactional";

exports.up = async function({query}) {
    const columns = await query(
        "inspect Example.NewColumn",
        `
            SELECT COLUMN_TYPE, IS_NULLABLE
            FROM information_schema.columns
            WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = 'Example'
                AND COLUMN_NAME = 'NewColumn'
        `
    );

    if (columns.length === 0) {
        await query(
            "add Example.NewColumn",
            "ALTER TABLE Example ADD COLUMN NewColumn INT NOT NULL DEFAULT 0"
        );
    }
};

exports.verify = async function({query}) {
    const columns = await query(
        "verify Example.NewColumn",
        `
            SELECT COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
            FROM information_schema.columns
            WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME = 'Example'
                AND COLUMN_NAME = 'NewColumn'
        `
    );

    return columns.length === 1 &&
        columns[0].COLUMN_TYPE === "int(11)" &&
        columns[0].IS_NULLABLE === "NO" &&
        columns[0].COLUMN_DEFAULT === "0";
};
```

The runner records `started`, `failed`, and `completed` states in
`MigrationRuns`. On retry, `verify` runs before `up`, allowing a migration that
finished its DDL but lost its completion record to be safely reconciled.

## Integration test

The migration integration test requires a dedicated MySQL database whose name
ends in `_migration_test`. Set `MYSQL_MIGRATION_TEST_DATABASE` together with the
normal MySQL connection variables, then run:

```sh
npm run test:migrations:integration
```

The test drops and recreates only its own tables inside that dedicated database.
It deliberately fails after a real DDL implicit commit, then verifies that the
next run safely resumes and completes.
