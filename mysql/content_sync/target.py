"""Validate and atomically apply an allowlisted public-content snapshot."""

from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

from content_sync.contract import (
    Manifest,
    MySqlConfig,
    PUBLIC_TABLES,
    SyncValidationError,
    canonical_dump_args,
    required_environment,
)


IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def quote_identifier(identifier):
    if type(identifier) is not str or not IDENTIFIER_RE.fullmatch(identifier):
        raise ValueError("invalid SQL identifier")
    return "`" + identifier + "`"


def qualified(database, table):
    return quote_identifier(database) + "." + quote_identifier(table)


@dataclass(frozen=True)
class TargetConfig:
    mysql: MySqlConfig
    target_database: str
    staging_database: str

    def __post_init__(self):
        quote_identifier(self.target_database)
        quote_identifier(self.staging_database)
        if self.target_database == self.staging_database:
            raise ValueError("content sync requires a dedicated staging database")

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
            target_database=values["MYSQL_DATABASE"],
            staging_database=environment.get(
                "CONTENT_SYNC_STAGING_DATABASE", "legendhub_content_sync"),
        )


def _command_environment(mysql):
    environment = os.environ.copy()
    environment["MYSQL_PWD"] = mysql.password
    return environment


class PyMySqlDatabase:
    """One control connection plus password-safe mysql client boundaries."""

    def __init__(self, config, connection):
        self.config = config
        self.connection = connection

    @classmethod
    def connect(cls, config):
        import pymysql

        connection = pymysql.connect(
            host=config.mysql.host,
            port=config.mysql.port,
            user=config.mysql.user,
            password=config.mysql.password,
            database=config.target_database,
            cursorclass=pymysql.cursors.DictCursor,
            autocommit=True,
        )
        return cls(config, connection)

    def _rows(self, query, parameters=()):
        with self.connection.cursor() as cursor:
            cursor.execute(query, parameters)
            return cursor.fetchall()

    def execute(self, query):
        self._rows(query)

    def scalar(self, query):
        rows = self._rows(query)
        if len(rows) != 1 or len(rows[0]) != 1:
            raise SyncValidationError("scalar query returned an invalid result")
        return int(next(iter(rows[0].values())))

    def begin(self):
        self.connection.begin()

    def commit(self):
        self.connection.commit()

    def rollback(self):
        self.connection.rollback()

    def close(self):
        self.connection.close()

    def schema_digest(self, database):
        placeholders = ", ".join(["%s"] * len(PUBLIC_TABLES))
        rows = self._rows(
            "SELECT TABLE_NAME, ORDINAL_POSITION, COLUMN_NAME, COLUMN_TYPE, "
            "IS_NULLABLE, COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS "
            "WHERE TABLE_SCHEMA = %s AND TABLE_NAME IN (" + placeholders + ") "
            "ORDER BY TABLE_NAME, ORDINAL_POSITION",
            (database,) + PUBLIC_TABLES,
        )
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

    def table_engines(self, database):
        placeholders = ", ".join(["%s"] * len(PUBLIC_TABLES))
        rows = self._rows(
            "SELECT TABLE_NAME, ENGINE FROM INFORMATION_SCHEMA.TABLES "
            "WHERE TABLE_SCHEMA = %s AND TABLE_NAME IN (" + placeholders + ") "
            "ORDER BY TABLE_NAME",
            (database,) + PUBLIC_TABLES,
        )
        engines = {}
        for row in rows:
            table = row["TABLE_NAME"]
            if table not in PUBLIC_TABLES or table in engines:
                raise SyncValidationError(
                    "allowlisted table engine validation failed")
            engines[table] = row["ENGINE"]
        if set(engines) != set(PUBLIC_TABLES):
            raise SyncValidationError("allowlisted table engine validation failed")
        return engines

    def counts(self, database):
        return {
            table: self.scalar(
                "SELECT COUNT(*) AS content_count FROM "
                + qualified(database, table))
            for table in PUBLIC_TABLES
        }

    def columns(self, database, table):
        rows = self._rows(
            "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
            "WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s "
            "ORDER BY ORDINAL_POSITION",
            (database, table),
        )
        columns = tuple(row["COLUMN_NAME"] for row in rows)
        if not columns:
            raise SyncValidationError("no columns found for " + table)
        return columns

    def recreate_staging_tables(self, target_database, staging_database,
                                tables):
        for table in tables:
            staging = qualified(staging_database, table)
            target = qualified(target_database, table)
            self.execute("DROP TABLE IF EXISTS " + staging)
            self.execute("CREATE TABLE " + staging + " LIKE " + target)

    def import_sql(self, database, path):
        arguments = [
            "mysql",
            "--host=" + self.config.mysql.host,
            "--port=" + str(self.config.mysql.port),
            "--user=" + self.config.mysql.user,
            "--database=" + database,
        ]
        try:
            with Path(path).open("rb") as source:
                subprocess.run(
                    arguments,
                    stdin=source,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    env=_command_environment(self.config.mysql),
                    check=True,
                )
        except (OSError, subprocess.CalledProcessError) as error:
            raise ImportError("mysql snapshot import failed") from error

    def dump_digest(self, database):
        try:
            process = subprocess.Popen(
                canonical_dump_args(self.config.mysql, database),
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                env=_command_environment(self.config.mysql),
            )
        except OSError as error:
            raise SyncValidationError("content digest command failed") from error
        digest = hashlib.sha256()
        assert process.stdout is not None
        for block in iter(lambda: process.stdout.read(1024 * 1024), b""):
            digest.update(block)
        process.stdout.close()
        if process.wait() != 0:
            raise SyncValidationError("content digest command failed")
        return digest.hexdigest()


def _database(config, database):
    return database if database is not None else PyMySqlDatabase.connect(config)


def _validate_schema(actual, expected, label):
    if actual != expected:
        raise SyncValidationError(label + " schema digest mismatch")


def _validate_counts(actual, expected):
    if set(actual) != set(PUBLIC_TABLES):
        raise SyncValidationError("allowlisted row count validation failed")
    for table in PUBLIC_TABLES:
        if actual[table] != expected[table]:
            raise SyncValidationError(
                "row count mismatch for " + table + ": expected "
                + str(expected[table]) + ", got " + str(actual[table]))


def _validate_engines(engines):
    if set(engines) != set(PUBLIC_TABLES):
        raise SyncValidationError("allowlisted table engine validation failed")
    for table in PUBLIC_TABLES:
        if engines[table] != "InnoDB":
            raise SyncValidationError("non-InnoDB allowlisted table: " + table)


def _validate_staging(database, config, manifest):
    _validate_schema(
        database.schema_digest(config.staging_database),
        manifest.schema_sha256,
        "staging",
    )
    _validate_counts(
        database.counts(config.staging_database), manifest.row_counts)
    digest = database.dump_digest(config.staging_database)
    if digest != manifest.content_sha256:
        raise SyncValidationError("content digest mismatch")


def prepare_staging(config, sql_path, manifest, database=None):
    manifest.validate()
    db = _database(config, database)
    try:
        _validate_schema(
            db.schema_digest(config.target_database),
            manifest.schema_sha256,
            "target",
        )
        _validate_engines(db.table_engines(config.target_database))
        db.recreate_staging_tables(
            config.target_database, config.staging_database, PUBLIC_TABLES)
        db.import_sql(config.staging_database, sql_path)
        _validate_staging(db, config, manifest)
    finally:
        db.close()


def apply_staging(config, manifest, database=None):
    manifest.validate()
    db = _database(config, database)
    transaction_started = False
    try:
        _validate_engines(db.table_engines(config.target_database))
        _validate_schema(
            db.schema_digest(config.target_database),
            manifest.schema_sha256,
            "target",
        )
        _validate_staging(db, config, manifest)

        statements = []
        for table in PUBLIC_TABLES:
            columns = db.columns(config.target_database, table)
            quoted_columns = ",".join(
                quote_identifier(column) for column in columns)
            statements.append((
                table,
                "DELETE FROM " + qualified(config.target_database, table),
                "INSERT INTO " + qualified(config.target_database, table)
                + " (" + quoted_columns + ") SELECT " + quoted_columns
                + " FROM " + qualified(config.staging_database, table),
            ))

        db.begin()
        transaction_started = True
        db.execute("SET SESSION SQL_MODE='NO_AUTO_VALUE_ON_ZERO'")
        db.execute("SET @DISABLE_NOTIFICATIONS=1")
        for table, delete_sql, insert_sql in statements:
            db.execute(delete_sql)
            db.execute(insert_sql)
            actual = db.scalar(
                "SELECT COUNT(*) FROM "
                + qualified(config.target_database, table))
            expected = manifest.row_counts[table]
            if actual != expected:
                raise SyncValidationError(
                    "row count mismatch for " + table + ": expected "
                    + str(expected) + ", got " + str(actual))
        db.commit()
        transaction_started = False
    except Exception:
        if transaction_started:
            db.rollback()
        raise
    finally:
        db.close()


def staging_digest(config, database=None):
    db = _database(config, database)
    try:
        return db.dump_digest(config.staging_database)
    finally:
        db.close()


def target_digest(config, database=None):
    db = _database(config, database)
    try:
        return db.dump_digest(config.target_database)
    finally:
        db.close()
