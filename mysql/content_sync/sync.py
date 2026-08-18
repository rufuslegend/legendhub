"""Safely retrieve, validate, and apply public-content snapshots."""

import argparse
from contextlib import suppress
from dataclasses import dataclass
from datetime import datetime, timezone
import gzip
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import time
from typing import NoReturn, Optional

from content_sync.contract import Manifest, MySqlConfig, SHA256_RE, SyncValidationError
from content_sync.source import exclusive_lock, gzip_content_digest
from content_sync.target import TargetConfig, apply_staging, prepare_staging, target_digest
from content_sync.contract import required_environment, sha256_file


@dataclass(frozen=True)
class SyncResult:
    action: str
    content_sha256: Optional[str]
    artifact_bytes: Optional[int] = None


@dataclass(frozen=True)
class SyncState:
    content_sha256: str
    verified_at_epoch: int


@dataclass(frozen=True)
class SyncConfig:
    target: TargetConfig
    source: str
    state_dir: Path
    ssh_key: Path
    known_hosts: Path
    interval_seconds: int = 3600

    @classmethod
    def from_environment(cls, environment):
        values = required_environment(
            ("CONTENT_SYNC_SOURCE", "CONTENT_SYNC_SSH_KEY",
             "CONTENT_SYNC_KNOWN_HOSTS"), environment)
        try:
            interval = int(environment.get("CONTENT_SYNC_INTERVAL_SECONDS", "3600"))
        except (TypeError, ValueError):
            raise ValueError("invalid CONTENT_SYNC_INTERVAL_SECONDS")
        if interval <= 0:
            raise ValueError("invalid CONTENT_SYNC_INTERVAL_SECONDS")
        key = Path(values["CONTENT_SYNC_SSH_KEY"])
        hosts = Path(values["CONTENT_SYNC_KNOWN_HOSTS"])
        _validate_private_file(key, "SSH key")
        _validate_private_file(hosts, "known-hosts")
        return cls(
            target=TargetConfig.from_environment(environment),
            source=values["CONTENT_SYNC_SOURCE"],
            state_dir=Path(environment.get(
                "CONTENT_SYNC_STATE_DIR", "/var/lib/legendhub-content-sync")),
            ssh_key=key,
            known_hosts=hosts,
            interval_seconds=interval,
        )

    @classmethod
    def for_test(cls, directory, interval_seconds=3600):
        directory = Path(directory)
        return cls(
            target=TargetConfig(
                mysql=MySqlConfig("mysql", 3306, "sync", "test-password"),
                target_database="legendhub",
                staging_database="legendhub_content_sync",
            ),
            source="sync@source",
            state_dir=directory / "state",
            ssh_key=directory / "key",
            known_hosts=directory / "known_hosts",
            interval_seconds=interval_seconds,
        )

    def with_state_dir(self, state_dir):
        return SyncConfig(self.target, self.source, Path(state_dir), self.ssh_key,
                          self.known_hosts, self.interval_seconds)


def _validate_private_file(path, label):
    try:
        details = path.stat()
    except OSError as error:
        raise ValueError("invalid " + label + " file") from error
    if not stat.S_ISREG(details.st_mode) or details.st_mode & 0o022:
        raise ValueError("invalid private " + label + " file")


def ssh_command(config, *remote_arguments):
    return [
        "ssh", "-T", "-i", str(config.ssh_key),
        "-o", "BatchMode=yes",
        "-o", "IdentitiesOnly=yes",
        "-o", "UserKnownHostsFile=" + str(config.known_hosts),
        "-o", "StrictHostKeyChecking=yes",
        config.source,
        " ".join(remote_arguments),
    ]


def _ssh_environment():
    return {"PATH": os.defpath, "LC_ALL": "C"}


def _utc_now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _failure_line(error):
    return (_utc_now() + " stage=sync error=" + type(error).__name__
            + " message=content sync failed")


class Dependencies:
    def __init__(self, config):
        self.config = config
        self._ensure_private_state_directory()

    @classmethod
    def real(cls, config):
        return cls(config)

    def _ensure_private_state_directory(self):
        self.config.state_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(self.config.state_dir, 0o700)

    @property
    def state_path(self):
        return self.config.state_dir / "state.json"

    @property
    def cache_dir(self):
        return self.config.state_dir / "cache"

    def cache_path(self, digest):
        if not SHA256_RE.fullmatch(digest):
            raise SyncValidationError("invalid cache digest")
        return self.cache_dir / (digest + ".sql.gz")

    def try_exclusive_lock(self):
        try:
            return exclusive_lock(self.config.state_dir / "sync.lock", blocking=False)
        except BlockingIOError:
            return None

    def _run_ssh(self, remote_arguments, output):
        try:
            subprocess.run(
                ssh_command(self.config, *remote_arguments),
                stdin=subprocess.DEVNULL,
                stdout=output,
                stderr=subprocess.DEVNULL,
                env=_ssh_environment(),
                check=True,
            )
        except (OSError, subprocess.CalledProcessError) as error:
            raise SyncValidationError("source retrieval failed") from error

    def fetch_manifest(self):
        from io import BytesIO

        output = BytesIO()
        self._run_ssh(("manifest",), output)
        try:
            return output.getvalue().decode("utf-8")
        except UnicodeDecodeError as error:
            raise SyncValidationError("manifest validation failed") from error

    def target_digest(self):
        return target_digest(self.config.target)

    def read_state(self):
        if not self.state_path.exists():
            return None
        try:
            state = json.loads(self.state_path.read_text(encoding="utf-8"))
            if type(state) is not dict or set(state) != {
                    "content_sha256", "verified_at_epoch"}:
                raise ValueError("invalid state")
            digest = state["content_sha256"]
            epoch = state["verified_at_epoch"]
            if not SHA256_RE.fullmatch(digest) or type(epoch) is not int:
                raise ValueError("invalid state")
            return SyncState(digest, epoch)
        except (OSError, ValueError, json.JSONDecodeError) as error:
            raise SyncValidationError("state validation failed") from error

    def record_verified(self, digest):
        if not SHA256_RE.fullmatch(digest):
            raise SyncValidationError("invalid state digest")
        payload = json.dumps({
            "content_sha256": digest,
            "verified_at_epoch": int(time.time()),
        }, sort_keys=True, separators=(",", ":")).encode("utf-8")
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=".state-", suffix=".tmp", dir=str(self.config.state_dir))
        temporary = Path(temporary_name)
        try:
            os.chmod(descriptor, 0o600)
            with os.fdopen(descriptor, "wb") as destination:
                destination.write(payload)
                destination.flush()
                os.fsync(destination.fileno())
            os.replace(str(temporary), str(self.state_path))
            os.chmod(self.state_path, 0o600)
            self._prune_cache(digest)
        finally:
            temporary.unlink(missing_ok=True)

    def _verify_artifact(self, path, manifest):
        try:
            exact_size = path.stat().st_size == manifest.artifact_bytes
            exact_artifact = sha256_file(path) == manifest.artifact_sha256
            exact_content = gzip_content_digest(path) == manifest.content_sha256
        except OSError as error:
            raise SyncValidationError("snapshot artifact verification failed") from error
        if not (exact_size and exact_artifact and exact_content):
            raise SyncValidationError("snapshot artifact verification failed")

    def verified_cache(self, manifest):
        path = self.cache_path(manifest.content_sha256)
        if not path.is_file():
            return None
        try:
            self._verify_artifact(path, manifest)
        except SyncValidationError:
            path.unlink(missing_ok=True)
            return None
        return path

    def download_and_verify(self, manifest):
        self.cache_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(self.cache_dir, 0o700)
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=".download-", suffix=".sql.gz", dir=str(self.cache_dir))
        temporary = Path(temporary_name)
        try:
            os.chmod(descriptor, 0o600)
            with os.fdopen(descriptor, "wb") as output:
                self._run_ssh(("snapshot", manifest.content_sha256), output)
                output.flush()
                os.fsync(output.fileno())
            self._verify_artifact(temporary, manifest)
            destination = self.cache_path(manifest.content_sha256)
            os.replace(str(temporary), str(destination))
            os.chmod(destination, 0o600)
            return destination
        finally:
            temporary.unlink(missing_ok=True)

    def prepare_and_validate_staging(self, artifact, manifest):
        self._verify_artifact(artifact, manifest)
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=".staging-", suffix=".sql", dir=str(self.config.state_dir))
        temporary = Path(temporary_name)
        try:
            os.chmod(descriptor, 0o600)
            with os.fdopen(descriptor, "wb") as destination, \
                    gzip.open(artifact, "rb") as source:
                shutil.copyfileobj(source, destination)
            if sha256_file(temporary) != manifest.content_sha256:
                raise SyncValidationError("snapshot artifact verification failed")
            prepare_staging(self.config.target, temporary, manifest)
        except OSError as error:
            raise SyncValidationError("staging validation failed") from error
        finally:
            temporary.unlink(missing_ok=True)

    def apply_staging(self, manifest):
        apply_staging(self.config.target, manifest)

    def _prune_cache(self, keep_digest):
        if not self.cache_dir.is_dir():
            return
        for artifact in self.cache_dir.glob("*.sql.gz"):
            if artifact.name != keep_digest + ".sql.gz":
                artifact.unlink(missing_ok=True)

    def monotonic(self):
        return time.monotonic()

    def sleep(self, seconds):
        time.sleep(seconds)

    def write_stderr(self, message):
        print(message, file=sys.stderr)

    def log_success(self, result, duration_seconds):
        print(
            _utc_now() + " action=" + result.action + " content_sha256="
            + str(result.content_sha256) + " artifact_bytes="
            + str(result.artifact_bytes) + " public_tables=17 duration_seconds="
            + "{:.3f}".format(duration_seconds), file=sys.stderr)


def run_once(config, dry_run=False, dependencies=None):
    deps = dependencies or Dependencies.real(config)
    lock = deps.try_exclusive_lock()
    if lock is None:
        return SyncResult("skipped-overlap", None)
    with lock:
        try:
            manifest = Manifest.parse(deps.fetch_manifest())
        except (ValueError, TypeError, json.JSONDecodeError) as error:
            raise SyncValidationError("manifest validation failed") from error
        target_content = deps.target_digest()
        state = deps.read_state()
        applied_digest = state.content_sha256 if state is not None else None
        if not dry_run and (applied_digest == manifest.content_sha256
                            and target_content == manifest.content_sha256):
            deps.record_verified(manifest.content_sha256)
            return SyncResult("noop", manifest.content_sha256,
                              manifest.artifact_bytes)
        artifact = deps.verified_cache(manifest)
        if artifact is None:
            artifact = deps.download_and_verify(manifest)
        deps.prepare_and_validate_staging(artifact, manifest)
        if dry_run:
            return SyncResult("dry-run", manifest.content_sha256,
                              manifest.artifact_bytes)
        deps.apply_staging(manifest)
        if deps.target_digest() != manifest.content_sha256:
            raise SyncValidationError("post-commit target digest mismatch")
        deps.record_verified(manifest.content_sha256)
        action = ("repaired-target-drift"
                  if applied_digest == manifest.content_sha256
                  else "applied-source-change")
        return SyncResult(action, manifest.content_sha256, manifest.artifact_bytes)


def run_one_loop_iteration(config, dependencies=None):
    deps = dependencies or Dependencies.real(config)
    started = deps.monotonic()
    try:
        result = run_once(config, dependencies=deps)
        if hasattr(deps, "log_success"):
            deps.log_success(result, deps.monotonic() - started)
        return result
    except Exception as error:
        deps.write_stderr(_failure_line(error))
        return None


def run_loop(config, dependencies=None) -> NoReturn:
    deps = dependencies or Dependencies.real(config)
    deadline = deps.monotonic()
    while True:
        started = deadline
        try:
            result = run_once(config, dependencies=deps)
            current = deps.monotonic()
            if hasattr(deps, "log_success"):
                deps.log_success(result, max(0, current - started))
        except Exception as error:
            current = deps.monotonic()
            deps.write_stderr(_failure_line(error))
        deadline += config.interval_seconds
        while True:
            remaining = deadline - current
            if remaining <= 0:
                break
            deps.sleep(remaining)
            current = deps.monotonic()


def main(arguments=None):
    parser = argparse.ArgumentParser(prog="sync-public-content")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--once", action="store_true")
    group.add_argument("--loop", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    options = parser.parse_args(arguments)
    if options.dry_run and not options.once:
        parser.error("--dry-run requires --once")
    try:
        config = SyncConfig.from_environment(os.environ)
        if options.loop:
            run_loop(config)
        result = run_once(config, dry_run=options.dry_run)
        Dependencies.real(config).log_success(result, 0.0)
        return 0
    except Exception as error:
        print(_failure_line(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
