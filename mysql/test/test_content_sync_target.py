import pathlib
import tempfile
import unittest

import sys

sys.path.insert(0, str(pathlib.Path(__file__).parents[1]))

from content_sync.contract import (
    Manifest,
    MySqlConfig,
    PUBLIC_TABLES,
    SyncValidationError,
)
from content_sync.target import (
    TargetConfig,
    apply_staging,
    prepare_staging,
    quote_identifier,
    staging_digest,
    target_digest,
)


SCHEMA_DIGEST = "e" * 64
CONTENT_DIGEST = "c" * 64


def manifest_with_counts(count=2, schema=SCHEMA_DIGEST,
                         content=CONTENT_DIGEST):
    return Manifest(
        version=1,
        content_sha256=content,
        artifact_sha256="a" * 64,
        artifact_bytes=123,
        schema_sha256=schema,
        created_at="2026-08-17T14:00:00Z",
        row_counts={table: count for table in PUBLIC_TABLES},
    )


def test_config():
    return TargetConfig(
        mysql=MySqlConfig("mysql", 3306, "test", "test-password"),
        target_database="legendhub",
        staging_database="legendhub_content_sync",
    )


class RecordingDatabase:
    def __init__(self, *, columns=None, target_schema=SCHEMA_DIGEST,
                 staging_schema=SCHEMA_DIGEST, staging_counts=None,
                 applied_counts=None, staging_content=CONTENT_DIGEST,
                 engines=None, import_failure=None, execute_failure=None):
        self.connection_id = "target-connection"
        self.events = []
        self.validation_events = []
        self._columns = columns or {
            table: ("Id", "Name") for table in PUBLIC_TABLES
        }
        self._schemas = {
            "legendhub": target_schema,
            "legendhub_content_sync": staging_schema,
        }
        self._staging_counts = staging_counts or {
            table: 2 for table in PUBLIC_TABLES
        }
        self._applied_counts = applied_counts or {
            table: 2 for table in PUBLIC_TABLES
        }
        self._staging_content = staging_content
        self._engines = engines or {
            table: "InnoDB" for table in PUBLIC_TABLES
        }
        self._import_failure = import_failure
        self._execute_failure = execute_failure

    def schema_digest(self, database):
        self.validation_events.append(("SCHEMA", database))
        return self._schemas[database]

    def table_engines(self, database):
        self.validation_events.append(("ENGINES", database))
        return self._engines.copy()

    def counts(self, database):
        self.validation_events.append(("COUNTS", database))
        if database == "legendhub_content_sync":
            return self._staging_counts.copy()
        return self._applied_counts.copy()

    def dump_digest(self, database):
        self.validation_events.append(("DIGEST", database))
        return self._staging_content

    def recreate_staging_tables(self, target_database, staging_database,
                                tables):
        self.validation_events.append((
            "RECREATE", target_database, staging_database, tuple(tables)))

    def import_sql(self, database, path):
        self.validation_events.append(("IMPORT", database, pathlib.Path(path)))
        if self._import_failure is not None:
            raise self._import_failure

    def columns(self, database, table):
        self.validation_events.append(("COLUMNS", database, table))
        return self._columns[table]

    def begin(self):
        self.events.append(("BEGIN", self.connection_id))

    def execute(self, sql):
        self.events.append(("EXECUTE", sql, self.connection_id))
        if self._execute_failure and self._execute_failure in sql:
            raise RuntimeError("forced SQL failure")

    def scalar(self, sql):
        self.events.append(("SCALAR", sql, self.connection_id))
        table = next(table for table in PUBLIC_TABLES
                     if "`" + table + "`" in sql)
        return self._applied_counts[table]

    def commit(self):
        self.events.append(("COMMIT", self.connection_id))

    def rollback(self):
        self.events.append(("ROLLBACK", self.connection_id))

    def close(self):
        self.events.append(("CLOSE", self.connection_id))

    def connection_ids_for(self, *fragments):
        return {
            event[2]
            for event in self.events
            if event[0] == "EXECUTE"
            and any(fragment in event[1] for fragment in fragments)
        }


class TargetTests(unittest.TestCase):
    def test_environment_builds_target_and_dedicated_staging_config(self):
        config = TargetConfig.from_environment({
            "MYSQL_HOST": "db",
            "MYSQL_PORT": "3307",
            "MYSQL_USER": "sync",
            "MYSQL_PASSWORD": "secret",
            "MYSQL_DATABASE": "legendhub",
            "CONTENT_SYNC_STAGING_DATABASE": "legendhub_stage",
        })

        self.assertEqual(config.mysql, MySqlConfig("db", 3307, "sync", "secret"))
        self.assertEqual(config.target_database, "legendhub")
        self.assertEqual(config.staging_database, "legendhub_stage")

    def test_environment_rejects_target_as_staging_database(self):
        with self.assertRaisesRegex(ValueError, "dedicated staging"):
            TargetConfig.from_environment({
                "MYSQL_PORT": "3306",
                "MYSQL_USER": "sync",
                "MYSQL_PASSWORD": "secret",
                "MYSQL_DATABASE": "legendhub",
                "CONTENT_SYNC_STAGING_DATABASE": "legendhub",
            })

    def test_prepare_recreates_exact_allowlist_only_in_staging(self):
        database = RecordingDatabase()
        with tempfile.TemporaryDirectory() as directory:
            sql_path = pathlib.Path(directory) / "snapshot.sql"
            sql_path.write_text("INSERT INTO `Areas` VALUES (1, 'x');\n")

            prepare_staging(test_config(), sql_path, manifest_with_counts(),
                            database=database)

        self.assertIn(("RECREATE", "legendhub", "legendhub_content_sync",
                       PUBLIC_TABLES), database.validation_events)
        self.assertIn(("IMPORT", "legendhub_content_sync", sql_path),
                      database.validation_events)
        self.assertNotIn("BEGIN", [event[0] for event in database.events])
        self.assertEqual(database.events[-1][0], "CLOSE")

    def test_schema_mismatch_fails_before_staging_ddl(self):
        database = RecordingDatabase(target_schema="f" * 64)
        with self.assertRaisesRegex(SyncValidationError,
                                    "target schema digest mismatch"):
            prepare_staging(test_config(), pathlib.Path("snapshot.sql"),
                            manifest_with_counts(), database=database)

        self.assertNotIn("RECREATE",
                         [event[0] for event in database.validation_events])
        self.assertNotIn("BEGIN", [event[0] for event in database.events])

    def test_staging_schema_mismatch_fails_after_import(self):
        database = RecordingDatabase(staging_schema="f" * 64)
        with self.assertRaisesRegex(SyncValidationError,
                                    "staging schema digest mismatch"):
            prepare_staging(test_config(), pathlib.Path("snapshot.sql"),
                            manifest_with_counts(), database=database)

        self.assertIn("IMPORT", [event[0] for event in database.validation_events])
        self.assertNotIn("BEGIN", [event[0] for event in database.events])

    def test_staging_import_or_digest_failure_never_opens_transaction(self):
        cases = (
            RecordingDatabase(import_failure=ImportError("mysql exited 1")),
            RecordingDatabase(staging_content="d" * 64),
        )
        for database in cases:
            with self.subTest(database=database):
                with self.assertRaises((ImportError, SyncValidationError)):
                    prepare_staging(
                        test_config(), pathlib.Path("snapshot.sql"),
                        manifest_with_counts(), database=database)
                self.assertNotIn("BEGIN", [event[0] for event in database.events])

    def test_prepare_rejects_any_staging_row_count_mismatch(self):
        counts = {table: 2 for table in PUBLIC_TABLES}
        counts["Items"] = 1
        database = RecordingDatabase(staging_counts=counts)

        with self.assertRaisesRegex(SyncValidationError,
                                    "row count mismatch for Items"):
            prepare_staging(test_config(), pathlib.Path("snapshot.sql"),
                            manifest_with_counts(), database=database)

    def test_apply_replaces_only_allowlisted_tables_and_suppresses_triggers(self):
        database = RecordingDatabase()

        apply_staging(test_config(), manifest_with_counts(), database=database)

        self.assertEqual(database.events[0][0], "BEGIN")
        self.assertIn(("EXECUTE", "SET @DISABLE_NOTIFICATIONS=1",
                       database.connection_id), database.events)
        self.assertEqual(database.events[-2][0], "COMMIT")
        self.assertEqual(database.events[-1][0], "CLOSE")
        rendered = "\n".join(
            event[1] for event in database.events if event[0] == "EXECUTE")
        for table in PUBLIC_TABLES:
            self.assertIn("DELETE FROM `legendhub`.`" + table + "`", rendered)
            self.assertIn(
                "INSERT INTO `legendhub`.`" + table + "` (`Id`,`Name`) "
                "SELECT `Id`,`Name` FROM `legendhub_content_sync`.`" + table + "`",
                rendered,
            )
        for private_table in ("Members", "AuthTokens", "Notifications",
                              "Migrations"):
            self.assertNotIn(private_table, rendered)

    def test_all_preconditions_are_checked_before_target_transaction(self):
        database = RecordingDatabase()

        apply_staging(test_config(), manifest_with_counts(), database=database)

        self.assertEqual(database.events[0][0], "BEGIN")
        self.assertEqual(database.validation_events[:6], [
            ("ENGINES", "legendhub"),
            ("SCHEMA", "legendhub"),
            ("SCHEMA", "legendhub_content_sync"),
            ("COUNTS", "legendhub_content_sync"),
            ("DIGEST", "legendhub_content_sync"),
            ("COLUMNS", "legendhub", "Areas"),
        ])

    def test_non_innodb_target_fails_before_begin(self):
        engines = {table: "InnoDB" for table in PUBLIC_TABLES}
        engines["Items"] = "MyISAM"
        database = RecordingDatabase(engines=engines)

        with self.assertRaisesRegex(SyncValidationError, "non-InnoDB.*Items"):
            apply_staging(test_config(), manifest_with_counts(), database=database)

        self.assertNotIn("BEGIN", [event[0] for event in database.events])

    def test_apply_schema_or_staging_digest_mismatch_fails_before_begin(self):
        cases = (
            RecordingDatabase(target_schema="f" * 64),
            RecordingDatabase(staging_schema="f" * 64),
            RecordingDatabase(staging_content="f" * 64),
        )
        for database in cases:
            with self.subTest(database=database):
                with self.assertRaises(SyncValidationError):
                    apply_staging(test_config(), manifest_with_counts(),
                                  database=database)
                self.assertNotIn("BEGIN", [event[0] for event in database.events])

    def test_count_mismatch_rolls_back(self):
        counts = {table: 2 for table in PUBLIC_TABLES}
        counts["Items"] = 1
        database = RecordingDatabase(applied_counts=counts)

        with self.assertRaisesRegex(SyncValidationError,
                                    "row count mismatch for Items"):
            apply_staging(test_config(), manifest_with_counts(), database=database)

        self.assertEqual(database.events[-2][0], "ROLLBACK")
        self.assertEqual(database.events[-1][0], "CLOSE")

    def test_forced_copy_failure_rolls_back(self):
        database = RecordingDatabase(
            execute_failure="INSERT INTO `legendhub`.`Categories`")

        with self.assertRaisesRegex(RuntimeError, "forced SQL failure"):
            apply_staging(test_config(), manifest_with_counts(), database=database)

        self.assertEqual(database.events[-2][0], "ROLLBACK")
        self.assertEqual(database.events[-1][0], "CLOSE")
        self.assertNotIn("COMMIT", [event[0] for event in database.events])

    def test_notification_suppression_and_copy_share_one_connection(self):
        database = RecordingDatabase()

        apply_staging(test_config(), manifest_with_counts(), database=database)

        self.assertEqual(database.connection_ids_for(
            "SET @DISABLE_NOTIFICATIONS=1", "INSERT INTO"),
            {database.connection_id})

    def test_identifier_quoting_rejects_unsafe_names(self):
        self.assertEqual(quote_identifier("ModifiedOn"), "`ModifiedOn`")
        with self.assertRaises(ValueError):
            quote_identifier("Items`; DROP TABLE Members; --")

    def test_digest_helpers_use_the_requested_database_and_close(self):
        staging_database = RecordingDatabase()
        target_database = RecordingDatabase(staging_content="d" * 64)

        self.assertEqual(staging_digest(test_config(), database=staging_database),
                         CONTENT_DIGEST)
        self.assertEqual(target_digest(test_config(), database=target_database),
                         "d" * 64)
        self.assertIn(("DIGEST", "legendhub_content_sync"),
                      staging_database.validation_events)
        self.assertIn(("DIGEST", "legendhub"),
                      target_database.validation_events)
        self.assertEqual(staging_database.events[-1][0], "CLOSE")
        self.assertEqual(target_database.events[-1][0], "CLOSE")


if __name__ == "__main__":
    unittest.main()
