from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
import re


PUBLIC_TABLES = (
    "Areas", "Categories", "ChangelogVersions",
    "ChangelogVersions_AuditTrail", "Eras", "ItemMobMap",
    "ItemStatCategories", "ItemStatInfo", "Items", "Items_AuditTrail",
    "Mobs", "Mobs_AuditTrail", "Quests", "Quests_AuditTrail",
    "SubCategories", "WikiPages", "WikiPages_AuditTrail",
)
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
UTC_TIMESTAMP_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")


class SyncValidationError(RuntimeError):
    pass


@dataclass(frozen=True)
class Manifest:
    version: int
    content_sha256: str
    artifact_sha256: str
    artifact_bytes: int
    schema_sha256: str
    created_at: str
    row_counts: dict[str, int]

    def validate(self):
        if type(self.version) is not int or self.version != 1:
            raise ValueError("unsupported manifest version")
        for value in (self.content_sha256, self.artifact_sha256,
                      self.schema_sha256):
            if not SHA256_RE.fullmatch(value):
                raise ValueError("invalid manifest digest")
        if type(self.artifact_bytes) is not int or self.artifact_bytes <= 0:
            raise ValueError("invalid artifact size")
        if type(self.created_at) is not str \
                or not UTC_TIMESTAMP_RE.fullmatch(self.created_at):
            raise ValueError("invalid creation timestamp")
        if type(self.row_counts) is not dict:
            raise ValueError("invalid row counts")
        if tuple(self.row_counts) != PUBLIC_TABLES:
            raise ValueError("manifest table set or order is invalid")
        if any(type(value) is not int or value < 0
               for value in self.row_counts.values()):
            raise ValueError("invalid manifest row count")

    def serialize(self):
        self.validate()
        return json.dumps(self.__dict__, sort_keys=True,
                          separators=(",", ":")) + "\n"

    @classmethod
    def parse(cls, text):
        data = json.loads(text)
        expected = {"version", "content_sha256", "artifact_sha256",
                    "artifact_bytes", "schema_sha256", "created_at",
                    "row_counts"}
        if type(data) is not dict or set(data) != expected:
            raise ValueError("invalid manifest fields")
        if type(data["row_counts"]) is not dict:
            raise ValueError("invalid row counts")
        if set(data["row_counts"]) == set(PUBLIC_TABLES):
            data["row_counts"] = {
                table: data["row_counts"][table] for table in PUBLIC_TABLES
            }
        manifest = cls(**data)
        manifest.validate()
        return manifest


@dataclass(frozen=True)
class MySqlConfig:
    host: str
    port: int
    user: str
    password: str


CANONICAL_DUMP_FLAGS = (
    "--single-transaction", "--quick", "--skip-lock-tables",
    "--no-tablespaces", "--no-create-info", "--skip-triggers",
    "--skip-comments", "--skip-add-locks", "--skip-disable-keys",
    "--order-by-primary", "--complete-insert", "--hex-blob",
)


def canonical_dump_args(config, database):
    return [
        "mysqldump", f"--host={config.host}", f"--port={config.port}",
        f"--user={config.user}", *CANONICAL_DUMP_FLAGS,
        database, *PUBLIC_TABLES,
    ]


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def required_environment(names, environment):
    missing = [name for name in names if not environment.get(name)]
    if missing:
        raise ValueError("missing required environment: " + ", ".join(missing))
    return {name: environment[name] for name in names}
