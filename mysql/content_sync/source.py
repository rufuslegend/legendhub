"""Read-only production exporter for allowlisted public content."""

from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
import fcntl
import gzip
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

from content_sync.contract import (
    Manifest,
    MySqlConfig,
    PUBLIC_TABLES,
    SHA256_RE,
    SyncValidationError,
    canonical_dump_args,
    required_environment,
    sha256_file,
)


@dataclass(frozen=True)
class SourceConfig:
    mysql: MySqlConfig
    database: str
    snapshot_dir: Path
    retention_seconds: int = 7200

    @classmethod
    def from_environment(cls, environment):
        values = required_environment(
            ("MYSQL_PORT", "MYSQL_USER", "MYSQL_PASSWORD", "MYSQL_DATABASE"),
            environment,
        )
        try:
            port = int(values["MYSQL_PORT"])
        except (TypeError, ValueError):
            raise ValueError("invalid MYSQL_PORT")
        if port < 1 or port > 65535:
            raise ValueError("invalid MYSQL_PORT")
        return cls(
            mysql=MySqlConfig(
                host=environment.get("MYSQL_HOST", "mysql"),
                port=port,
                user=values["MYSQL_USER"],
                password=values["MYSQL_PASSWORD"],
            ),
            database=values["MYSQL_DATABASE"],
            snapshot_dir=Path(environment.get(
                "CONTENT_SYNC_SNAPSHOT_DIR", "/backups/content-sync")),
        )

    @classmethod
    def for_test(cls, directory):
        return cls(
            mysql=MySqlConfig("mysql", 3306, "test", "test-password"),
            database="legendhub",
            snapshot_dir=Path(directory) / "snapshots",
        )

    def snapshot_path(self, digest):
        if not SHA256_RE.fullmatch(digest):
            raise ValueError("invalid snapshot digest")
        return self.snapshot_dir / (digest + ".sql.gz")


@contextmanager
def exclusive_lock(path, blocking=False):
    descriptor = os.open(str(path), os.O_CREAT | os.O_RDWR, 0o600)
    try:
        lock_flags = fcntl.LOCK_EX
        if not blocking:
            lock_flags |= fcntl.LOCK_NB
        try:
            fcntl.flock(descriptor, lock_flags)
        except OSError as error:
            if error.errno in (11, 13):
                raise BlockingIOError("content export already running")
            raise
        yield
    finally:
        os.close(descriptor)


def private_temporary(directory, suffix):
    descriptor, name = tempfile.mkstemp(
        prefix=".content-export-", suffix=suffix, dir=str(directory))
    os.close(descriptor)
    path = Path(name)
    os.chmod(path, 0o600)
    return path


def atomic_write(path, contents, mode=0o600):
    temporary = private_temporary(path.parent, ".tmp")
    try:
        temporary.write_bytes(contents)
        os.chmod(temporary, mode)
        os.replace(str(temporary), str(path))
    finally:
        temporary.unlink(missing_ok=True)


def promote_digest_named(temporary, destination):
    os.chmod(temporary, 0o600)
    os.replace(str(temporary), str(destination))
    os.chmod(destination, 0o600)


def command_environment(mysql):
    environment = os.environ.copy()
    environment["MYSQL_PWD"] = mysql.password
    return environment


def run_checked(arguments, stdout, environment=None):
    with Path(stdout).open("wb") as output:
        subprocess.run(arguments, check=True, stdout=output, env=environment)


def open_database_connection(mysql, database):
    """Open the read-only control connection lazily."""
    import pymysql

    return pymysql.connect(
        host=mysql.host,
        port=mysql.port,
        user=mysql.user,
        password=mysql.password,
        database=database,
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=True,
    )


def query_connection_rows(connection, query, parameters):
    with connection.cursor() as cursor:
        cursor.execute(query, parameters)
        return cursor.fetchall()


def query_rows(mysql, database, query, parameters):
    """Run one read-only query with PyMySQL imported only when needed."""
    connection = open_database_connection(mysql, database)
    try:
        return query_connection_rows(connection, query, parameters)
    finally:
        connection.close()


def table_engines(mysql, database, connection=None):
    placeholders = ", ".join(["%s"] * len(PUBLIC_TABLES))
    query = (
        "SELECT TABLE_NAME, ENGINE "
        "FROM INFORMATION_SCHEMA.TABLES "
        "WHERE TABLE_SCHEMA = %s AND TABLE_NAME IN (" + placeholders + ") "
        "ORDER BY TABLE_NAME"
    )
    parameters = (database,) + PUBLIC_TABLES
    if connection is None:
        rows = query_rows(mysql, database, query, parameters)
    else:
        rows = query_connection_rows(connection, query, parameters)
    engines = {}
    for row in rows:
        table = row["TABLE_NAME"]
        if table not in PUBLIC_TABLES or table in engines:
            raise SyncValidationError("allowlisted table engine validation failed")
        engines[table] = row["ENGINE"]
    if set(engines) != set(PUBLIC_TABLES):
        raise SyncValidationError("allowlisted table engine validation failed")
    return engines


def validate_table_engines(engines):
    if set(engines) != set(PUBLIC_TABLES):
        raise SyncValidationError("allowlisted table engine validation failed")
    for table in PUBLIC_TABLES:
        if engines[table] != "InnoDB":
            raise SyncValidationError("non-InnoDB allowlisted table: " + table)


def dump_to_path(mysql, database, path):
    run_checked(
        canonical_dump_args(mysql, database),
        stdout=path,
        environment=command_environment(mysql),
    )


def schema_digest(mysql, database, connection=None):
    placeholders = ", ".join(["%s"] * len(PUBLIC_TABLES))
    query = (
        "SELECT TABLE_NAME, ORDINAL_POSITION, COLUMN_NAME, COLUMN_TYPE, "
        "IS_NULLABLE, COLUMN_DEFAULT "
        "FROM INFORMATION_SCHEMA.COLUMNS "
        "WHERE TABLE_SCHEMA = %s AND TABLE_NAME IN (" + placeholders + ") "
        "ORDER BY TABLE_NAME, ORDINAL_POSITION"
    )
    parameters = (database,) + PUBLIC_TABLES
    if connection is None:
        rows = query_rows(mysql, database, query, parameters)
    else:
        rows = query_connection_rows(connection, query, parameters)
    columns = [
        {
            "TABLE_NAME": row["TABLE_NAME"],
            "ORDINAL_POSITION": row["ORDINAL_POSITION"],
            "COLUMN_NAME": row["COLUMN_NAME"],
            "COLUMN_TYPE": row["COLUMN_TYPE"],
            "IS_NULLABLE": row["IS_NULLABLE"],
            "COLUMN_DEFAULT": row["COLUMN_DEFAULT"],
        }
        for row in rows
    ]
    return hashlib.sha256(json.dumps(
        columns, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")).hexdigest()


def row_counts(mysql, database, connection=None):
    counts = {}
    for table in PUBLIC_TABLES:
        query = "SELECT COUNT(*) AS content_count FROM `" + table + "`"
        if connection is None:
            rows = query_rows(mysql, database, query, ())
        else:
            rows = query_connection_rows(connection, query, ())
        if len(rows) != 1 or "content_count" not in rows[0]:
            raise SyncValidationError("row count query failed for " + table)
        counts[table] = int(rows[0]["content_count"])
    return counts


def quote_identifier(identifier):
    return "`" + identifier.replace("`", "``") + "`"


def lock_tables(connection, database):
    statement = "LOCK TABLES " + ", ".join(
        quote_identifier(database) + "." + quote_identifier(table) + " READ"
        for table in PUBLIC_TABLES
    )
    query_connection_rows(connection, statement, ())


def unlock_tables(connection):
    query_connection_rows(connection, "UNLOCK TABLES", ())


def capture_consistent_dump(mysql, database, path):
    """Capture metadata and dump while a dedicated connection holds read locks."""
    lock_holder = open_database_connection(mysql, database)
    metadata_connection = None
    locked = False
    try:
        lock_tables(lock_holder, database)
        locked = True
        metadata_connection = open_database_connection(mysql, database)
        validate_table_engines(
            table_engines(mysql, database, metadata_connection))
        schema = schema_digest(mysql, database, metadata_connection)
        counts = row_counts(mysql, database, metadata_connection)
        dump_to_path(mysql, database, path)
        return schema, counts
    finally:
        try:
            if metadata_connection is not None:
                metadata_connection.close()
        finally:
            try:
                if locked:
                    unlock_tables(lock_holder)
            finally:
                lock_holder.close()


def prune_expired_snapshots(config, keep):
    threshold = time.time() - config.retention_seconds
    for artifact in config.snapshot_dir.glob("*.sql.gz"):
        digest = artifact.name[:-7]
        if not SHA256_RE.fullmatch(digest) or digest in keep:
            continue
        if artifact.stat().st_mtime < threshold:
            artifact.unlink()


def create_snapshot(config, created_at):
    config.snapshot_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(config.snapshot_dir, 0o700)
    with exclusive_lock(config.snapshot_dir / "export.lock", blocking=False):
        raw_path = private_temporary(config.snapshot_dir, ".sql")
        gzip_path = private_temporary(config.snapshot_dir, ".sql.gz")
        try:
            schema, counts = capture_consistent_dump(
                config.mysql, config.database, raw_path)
            content_digest = sha256_file(raw_path)
            run_checked(["gzip", "-n", "-c", str(raw_path)], stdout=gzip_path)
            artifact_digest = sha256_file(gzip_path)
            manifest = Manifest(
                version=1,
                content_sha256=content_digest,
                artifact_sha256=artifact_digest,
                artifact_bytes=gzip_path.stat().st_size,
                schema_sha256=schema,
                created_at=created_at,
                row_counts=counts,
            )
            manifest.validate()
            promote_digest_named(gzip_path, config.snapshot_path(content_digest))
            atomic_write(
                config.snapshot_dir / "current.manifest",
                manifest.serialize().encode("utf-8"),
                mode=0o600,
            )
            prune_expired_snapshots(config, keep={content_digest})
            return manifest
        finally:
            raw_path.unlink(missing_ok=True)
            gzip_path.unlink(missing_ok=True)


def load_current_manifest(config):
    return Manifest.parse((config.snapshot_dir / "current.manifest").read_text())


def gzip_content_digest(path):
    digest = hashlib.sha256()
    try:
        with gzip.open(path, "rb") as source:
            for block in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(block)
    except OSError:
        raise SyncValidationError("snapshot artifact verification failed")
    return digest.hexdigest()


def stream_snapshot(config, digest):
    artifact = config.snapshot_path(digest)
    if not artifact.is_file() or artifact.stat().st_size <= 0:
        raise SyncValidationError("snapshot artifact verification failed")
    if gzip_content_digest(artifact) != digest:
        raise SyncValidationError("snapshot artifact verification failed")
    manifest_path = config.snapshot_dir / "current.manifest"
    if manifest_path.is_file():
        manifest = load_current_manifest(config)
        if manifest.content_sha256 == digest and (
                artifact.stat().st_size != manifest.artifact_bytes
                or sha256_file(artifact) != manifest.artifact_sha256):
            raise SyncValidationError("snapshot artifact verification failed")
    output = getattr(sys.stdout, "buffer", sys.stdout)
    with artifact.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            output.write(block)


def utc_timestamp():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def serve(arguments):
    if arguments == ["manifest"]:
        try:
            manifest = create_snapshot(
                SourceConfig.from_environment(os.environ), utc_timestamp())
            sys.stdout.write(manifest.serialize())
            print("content-export: snapshot refreshed", file=sys.stderr)
            return 0
        except Exception:
            print("content-export: snapshot failed", file=sys.stderr)
            return 1
    if len(arguments) == 2 and arguments[0] == "snapshot" \
            and SHA256_RE.fullmatch(arguments[1]):
        try:
            stream_snapshot(SourceConfig.from_environment(os.environ),
                            arguments[1])
            print("content-export: snapshot streamed", file=sys.stderr)
            return 0
        except Exception:
            print("content-export: snapshot failed", file=sys.stderr)
            return 1
    print("content-export: command rejected", file=sys.stderr)
    return 64


def main():
    return serve(sys.argv[1:])


if __name__ == "__main__":
    sys.exit(main())
