import contextlib
import gzip
import hashlib
import io
import os
import pathlib
import stat
import tempfile
import time
import unittest
from unittest import mock

import sys

sys.path.insert(0, str(pathlib.Path(__file__).parents[1]))

from content_sync.contract import Manifest, MySqlConfig, PUBLIC_TABLES, SyncValidationError
from content_sync.source import (
    SourceConfig,
    capture_consistent_dump,
    create_snapshot,
    exclusive_lock,
    prune_expired_snapshots,
    row_counts,
    serve,
)


PASSWORD_ENVIRONMENT = {"MYSQL_PASSWORD": "never-log-this"}
FIXED_TIME = 1_700_000_000
EXPECTED_LOCK_SQL = (
    "LOCK TABLES `legendhub`.`Areas` READ, "
    "`legendhub`.`Categories` READ, "
    "`legendhub`.`ChangelogVersions` READ, "
    "`legendhub`.`ChangelogVersions_AuditTrail` READ, "
    "`legendhub`.`Eras` READ, "
    "`legendhub`.`ItemMobMap` READ, "
    "`legendhub`.`ItemStatCategories` READ, "
    "`legendhub`.`ItemStatInfo` READ, "
    "`legendhub`.`Items` READ, "
    "`legendhub`.`Items_AuditTrail` READ, "
    "`legendhub`.`Mobs` READ, "
    "`legendhub`.`Mobs_AuditTrail` READ, "
    "`legendhub`.`Quests` READ, "
    "`legendhub`.`Quests_AuditTrail` READ, "
    "`legendhub`.`SubCategories` READ, "
    "`legendhub`.`WikiPages` READ, "
    "`legendhub`.`WikiPages_AuditTrail` READ"
)


class RecordingCursor:
    def __init__(self, connection):
        self.connection = connection
        self.rows = []

    def __enter__(self):
        return self

    def __exit__(self, _type, _value, _traceback):
        return False

    def execute(self, query, parameters=()):
        self.connection.events.append(
            ("sql", self.connection.name, query, parameters))
        if self.connection.fail_metadata and "INFORMATION_SCHEMA.COLUMNS" in query:
            raise RuntimeError("metadata failed")
        if "INFORMATION_SCHEMA.TABLES" in query:
            self.rows = [
                {"TABLE_NAME": table, "ENGINE": "InnoDB"}
                for table in PUBLIC_TABLES
            ]
        elif "INFORMATION_SCHEMA.COLUMNS" in query:
            self.rows = [{
                "TABLE_NAME": "Areas",
                "ORDINAL_POSITION": 1,
                "COLUMN_NAME": "Id",
                "COLUMN_TYPE": "int(11)",
                "IS_NULLABLE": "NO",
                "COLUMN_DEFAULT": None,
            }]
        elif query.startswith("SELECT COUNT(*)"):
            self.rows = [{"content_count": 1}]
        else:
            self.rows = []

    def fetchall(self):
        return self.rows


class RecordingConnection:
    def __init__(self, name="connection", events=None, fail_metadata=False):
        self.name = name
        self.events = events if events is not None else []
        self.fail_metadata = fail_metadata

    def cursor(self):
        return RecordingCursor(self)

    def close(self):
        self.events.append(("close", self.name))


def test_config(directory):
    return SourceConfig.for_test(pathlib.Path(directory))


def write_dump(contents):
    def write(_mysql, _database, path):
        path.write_bytes(contents)
    return write


def snapshot_dependencies(contents=b"INSERT INTO `Areas` VALUES (1,'one');\n"):
    def capture(_mysql, _database, path):
        path.write_bytes(contents)
        return "c" * 64, {table: 0 for table in PUBLIC_TABLES}
    return mock.patch("content_sync.source.capture_consistent_dump",
                      side_effect=capture)


class SourceTests(unittest.TestCase):
    def test_from_environment_uses_required_values_and_safe_defaults(self):
        config = SourceConfig.from_environment({
            "MYSQL_PORT": "3307",
            "MYSQL_USER": "exporter",
            "MYSQL_PASSWORD": "secret",
            "MYSQL_DATABASE": "legendhub",
        })
        self.assertEqual(config.mysql.host, "mysql")
        self.assertEqual(config.mysql.port, 3307)
        self.assertEqual(config.mysql.user, "exporter")
        self.assertEqual(config.database, "legendhub")
        self.assertEqual(config.snapshot_dir,
                         pathlib.Path("/backups/content-sync"))

    def test_consistent_dump_keeps_metadata_off_lock_holder(self):
        events = []
        holder = RecordingConnection("holder", events)
        metadata = RecordingConnection("metadata", events)
        mysql = MySqlConfig("mysql", 3306, "exporter", "secret")
        with tempfile.TemporaryDirectory() as directory:
            raw_path = pathlib.Path(directory) / "snapshot.sql"

            def write_dump(_mysql, _database, path):
                events.append(("dump",))
                path.write_bytes(b"INSERT INTO `Areas` VALUES (1);\n")

            with mock.patch("content_sync.source.open_database_connection",
                            side_effect=[holder, metadata]) as connect, \
                    mock.patch("content_sync.source.dump_to_path",
                               side_effect=write_dump):
                schema, counts = capture_consistent_dump(
                    mysql, "legendhub", raw_path)

        self.assertRegex(schema, r"^[0-9a-f]{64}$")
        self.assertEqual(counts, {table: 1 for table in PUBLIC_TABLES})
        self.assertEqual(connect.call_args_list, [
            mock.call(mysql, "legendhub"), mock.call(mysql, "legendhub"),
        ])
        holder_sql = [event[2] for event in events
                      if event[:2] == ("sql", "holder")]
        metadata_sql = [event[2] for event in events
                        if event[:2] == ("sql", "metadata")]
        self.assertEqual(holder_sql, [EXPECTED_LOCK_SQL, "UNLOCK TABLES"])
        self.assertIn("INFORMATION_SCHEMA.TABLES", metadata_sql[0])
        self.assertIn("INFORMATION_SCHEMA.COLUMNS", metadata_sql[1])
        self.assertEqual(len(metadata_sql), 2 + len(PUBLIC_TABLES))
        self.assertLess(events.index(("sql", "holder", EXPECTED_LOCK_SQL, ())),
                        events.index(("sql", "metadata", metadata_sql[0],
                                      ("legendhub",) + PUBLIC_TABLES)))
        self.assertLess(events.index(("dump",)),
                        events.index(("close", "metadata")))
        self.assertLess(events.index(("close", "metadata")),
                        events.index(("sql", "holder", "UNLOCK TABLES", ())))
        self.assertEqual(events[-1], ("close", "holder"))

    def test_consistent_dump_unlocks_when_metadata_fails(self):
        events = []
        holder = RecordingConnection("holder", events)
        metadata = RecordingConnection("metadata", events, fail_metadata=True)
        mysql = MySqlConfig("mysql", 3306, "exporter", "secret")
        with tempfile.TemporaryDirectory() as directory, \
                mock.patch("content_sync.source.open_database_connection",
                           side_effect=[holder, metadata]), \
                mock.patch("content_sync.source.dump_to_path") as dump:
            with self.assertRaisesRegex(RuntimeError, "metadata failed"):
                capture_consistent_dump(mysql, "legendhub",
                                        pathlib.Path(directory) / "snapshot.sql")
        self.assertIn(("close", "metadata"), events)
        self.assertIn(("sql", "holder", "UNLOCK TABLES", ()), events)
        self.assertEqual(events[-1], ("close", "holder"))
        dump.assert_not_called()

    def test_consistent_dump_unlocks_when_dump_fails(self):
        events = []
        holder = RecordingConnection("holder", events)
        metadata = RecordingConnection("metadata", events)
        mysql = MySqlConfig("mysql", 3306, "exporter", "secret")
        with tempfile.TemporaryDirectory() as directory, \
                mock.patch("content_sync.source.open_database_connection",
                           side_effect=[holder, metadata]), \
                mock.patch("content_sync.source.dump_to_path",
                           side_effect=RuntimeError("dump failed")):
            with self.assertRaisesRegex(RuntimeError, "dump failed"):
                capture_consistent_dump(mysql, "legendhub",
                                        pathlib.Path(directory) / "snapshot.sql")
        self.assertIn(("close", "metadata"), events)
        self.assertIn(("sql", "holder", "UNLOCK TABLES", ()), events)
        self.assertEqual(events[-1], ("close", "holder"))

    def test_consistent_dump_unlocks_holder_when_metadata_connection_fails(self):
        events = []
        holder = RecordingConnection("holder", events)
        mysql = MySqlConfig("mysql", 3306, "exporter", "secret")
        with tempfile.TemporaryDirectory() as directory, \
                mock.patch("content_sync.source.open_database_connection",
                           side_effect=[holder,
                                        RuntimeError("metadata open failed")]), \
                mock.patch("content_sync.source.dump_to_path") as dump:
            with self.assertRaisesRegex(RuntimeError, "metadata open failed"):
                capture_consistent_dump(mysql, "legendhub",
                                        pathlib.Path(directory) / "snapshot.sql")
        self.assertEqual(events, [
            ("sql", "holder", EXPECTED_LOCK_SQL, ()),
            ("sql", "holder", "UNLOCK TABLES", ()),
            ("close", "holder"),
        ])
        dump.assert_not_called()

    def test_same_content_produces_same_content_and_artifact_digests(self):
        with tempfile.TemporaryDirectory() as directory, \
                mock.patch.dict(os.environ, PASSWORD_ENVIRONMENT):
            config = test_config(directory)
            dump = b"INSERT INTO `Areas` VALUES (1,'one');\n"
            with snapshot_dependencies(dump):
                first = create_snapshot(config, "2026-08-17T14:00:00Z")
                second = create_snapshot(config, "2026-08-17T15:00:00Z")
            self.assertEqual(first.content_sha256, second.content_sha256)
            self.assertEqual(first.artifact_sha256, second.artifact_sha256)
            artifact = config.snapshot_path(first.content_sha256)
            os.utime(artifact, (FIXED_TIME, FIXED_TIME))
            with gzip.open(artifact, "rb") as source:
                self.assertEqual(source.read(), dump)

    def test_failed_export_preserves_promoted_manifest(self):
        with tempfile.TemporaryDirectory() as directory, \
                mock.patch.dict(os.environ, PASSWORD_ENVIRONMENT):
            config = test_config(directory)
            old_digest = "d" * 64
            old_artifact = config.snapshot_path(old_digest)
            old_artifact.parent.mkdir(parents=True)
            old_artifact.write_bytes(b"old-artifact")
            os.utime(old_artifact, (FIXED_TIME, FIXED_TIME))
            old_manifest = Manifest(
                version=1,
                content_sha256=old_digest,
                artifact_sha256="e" * 64,
                artifact_bytes=len(b"old-artifact"),
                schema_sha256="f" * 64,
                created_at="2026-08-17T13:00:00Z",
                row_counts={table: 0 for table in PUBLIC_TABLES},
            ).serialize().encode()
            manifest_path = config.snapshot_dir / "current.manifest"
            manifest_path.write_bytes(old_manifest)
            os.utime(manifest_path, (FIXED_TIME, FIXED_TIME))
            with mock.patch("content_sync.source.capture_consistent_dump",
                            side_effect=RuntimeError("dump failed")):
                with self.assertRaisesRegex(RuntimeError, "dump failed"):
                    create_snapshot(config, "2026-08-17T14:00:00Z")
            self.assertEqual(manifest_path.read_bytes(), old_manifest)
            self.assertEqual(old_artifact.read_bytes(), b"old-artifact")

    def test_snapshot_command_rejects_non_digest_arguments(self):
        for args in (["snapshot"], ["snapshot", "../secret"],
                     ["snapshot", "a" * 63], ["shell"]):
            with self.subTest(args=args):
                self.assertEqual(serve(args), 64)

    def test_snapshot_command_streams_a_recent_retained_artifact(self):
        raw = b"INSERT INTO `Areas` VALUES (1,'one');\n"
        digest = hashlib.sha256(raw).hexdigest()
        with tempfile.TemporaryDirectory() as directory, \
                mock.patch.dict(os.environ, PASSWORD_ENVIRONMENT):
            config = test_config(directory)
            config.snapshot_dir.mkdir()
            artifact = config.snapshot_path(digest)
            with gzip.GzipFile(artifact, "wb", mtime=0) as compressed:
                compressed.write(raw)
            os.chmod(artifact, 0o600)
            os.utime(artifact, (FIXED_TIME, FIXED_TIME))
            current_manifest = Manifest(
                version=1,
                content_sha256="a" * 64,
                artifact_sha256="b" * 64,
                artifact_bytes=1,
                schema_sha256="c" * 64,
                created_at="2026-08-17T14:00:00Z",
                row_counts={table: 0 for table in PUBLIC_TABLES},
            )
            (config.snapshot_dir / "current.manifest").write_text(
                current_manifest.serialize())
            environment = {
                "MYSQL_PORT": "3306",
                "MYSQL_USER": "exporter",
                "MYSQL_PASSWORD": "never-log-this",
                "MYSQL_DATABASE": "legendhub",
                "CONTENT_SYNC_SNAPSHOT_DIR": str(config.snapshot_dir),
            }
            destination = type("BinaryOutput", (), {"buffer": io.BytesIO()})()
            with mock.patch.dict(os.environ, environment, clear=True), \
                    mock.patch("content_sync.source.sys.stdout", destination), \
                    contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(serve(["snapshot", digest]), 0)
            self.assertEqual(destination.buffer.getvalue(), artifact.read_bytes())

    def test_promoted_files_are_private(self):
        with tempfile.TemporaryDirectory() as directory, \
                mock.patch.dict(os.environ, PASSWORD_ENVIRONMENT):
            config = test_config(directory)
            with snapshot_dependencies():
                manifest = create_snapshot(config, "2026-08-17T14:00:00Z")
            paths = (config.snapshot_path(manifest.content_sha256),
                     config.snapshot_dir / "current.manifest")
            for path in paths:
                os.utime(path, (FIXED_TIME, FIXED_TIME))
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)

    def test_row_counts_follow_public_table_order(self):
        expected = {table: index for index, table in enumerate(PUBLIC_TABLES)}

        def rows(_mysql, _database, query, _parameters):
            table = next(table for table in PUBLIC_TABLES
                         if "`{}`".format(table) in query)
            return [{"content_count": expected[table]}]

        with mock.patch("content_sync.source.query_rows", side_effect=rows):
            actual = row_counts(MySqlConfig("mysql", 3306, "test", "secret"),
                                "legendhub")
        self.assertEqual(tuple(actual), PUBLIC_TABLES)
        self.assertEqual(actual, expected)

    def test_recent_artifact_is_retained(self):
        with tempfile.TemporaryDirectory() as directory, \
                mock.patch.dict(os.environ, PASSWORD_ENVIRONMENT):
            config = test_config(directory)
            config.snapshot_dir.mkdir()
            artifact = config.snapshot_path("a" * 64)
            artifact.write_bytes(b"recent")
            os.chmod(artifact, 0o600)
            os.utime(artifact, (FIXED_TIME, FIXED_TIME))
            with mock.patch("content_sync.source.time.time",
                            return_value=FIXED_TIME + 7199):
                prune_expired_snapshots(config, keep=set())
            self.assertTrue(artifact.exists())

    def test_old_unreferenced_artifact_is_pruned(self):
        with tempfile.TemporaryDirectory() as directory, \
                mock.patch.dict(os.environ, PASSWORD_ENVIRONMENT):
            config = test_config(directory)
            config.snapshot_dir.mkdir()
            artifact = config.snapshot_path("b" * 64)
            artifact.write_bytes(b"old")
            os.chmod(artifact, 0o600)
            os.utime(artifact, (FIXED_TIME, FIXED_TIME))
            with mock.patch("content_sync.source.time.time",
                            return_value=FIXED_TIME + 7201):
                prune_expired_snapshots(config, keep=set())
            self.assertFalse(artifact.exists())

    def test_lock_contention_fails(self):
        with tempfile.TemporaryDirectory() as directory, \
                mock.patch.dict(os.environ, PASSWORD_ENVIRONMENT):
            config = test_config(directory)
            config.snapshot_dir.mkdir()
            lock_path = config.snapshot_dir / "export.lock"
            with exclusive_lock(lock_path, blocking=False):
                os.utime(lock_path, (FIXED_TIME, FIXED_TIME))
                with self.assertRaises(BlockingIOError):
                    create_snapshot(config, "2026-08-17T14:00:00Z")

    def test_failure_message_omits_password(self):
        environment = {
            "MYSQL_PORT": "3306",
            "MYSQL_USER": "exporter",
            "MYSQL_PASSWORD": "never-log-this",
            "MYSQL_DATABASE": "legendhub",
            "CONTENT_SYNC_SNAPSHOT_DIR": tempfile.mkdtemp(),
        }
        try:
            output = io.StringIO()
            with mock.patch.dict(os.environ, environment, clear=True), \
                    mock.patch("content_sync.source.create_snapshot",
                               side_effect=RuntimeError("never-log-this")), \
                    contextlib.redirect_stderr(output):
                self.assertEqual(serve(["manifest"]), 1)
            self.assertNotIn("never-log-this", output.getvalue())
        finally:
            pathlib.Path(environment["CONTENT_SYNC_SNAPSHOT_DIR"]).rmdir()

    def test_non_transactional_allowlisted_table_fails_before_dump(self):
        with tempfile.TemporaryDirectory() as directory, \
                mock.patch.dict(os.environ, PASSWORD_ENVIRONMENT):
            config = test_config(directory)
            engines = {table: "InnoDB" for table in PUBLIC_TABLES}
            engines["Items"] = "MyISAM"
            connection = RecordingConnection()
            with mock.patch("content_sync.source.table_engines",
                            return_value=engines), \
                    mock.patch("content_sync.source.open_database_connection",
                               return_value=connection), \
                    mock.patch("content_sync.source.run_checked") as run:
                with self.assertRaisesRegex(SyncValidationError,
                                            r"Items") as error:
                    create_snapshot(config, "2026-08-17T14:00:00Z")
            self.assertNotRegex(str(error.exception),
                                r"Areas|Categories|Mobs|Quests")
            run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
