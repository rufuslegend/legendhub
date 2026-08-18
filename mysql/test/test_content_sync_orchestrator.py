import hashlib
import io
import pathlib
import tempfile
import unittest
from unittest import mock

import sys

sys.path.insert(0, str(pathlib.Path(__file__).parents[1]))

from content_sync.contract import Manifest, PUBLIC_TABLES, SyncValidationError
from content_sync.sync import (
    SyncConfig,
    SyncResult,
    run_once,
    run_loop,
    run_one_loop_iteration,
    ssh_command,
    main,
)


def manifest_for(digest):
    return Manifest(
        version=1,
        content_sha256=digest,
        artifact_sha256="f" * 64,
        artifact_bytes=42,
        schema_sha256="e" * 64,
        created_at="2026-08-18T16:00:00Z",
        row_counts={table: 0 for table in PUBLIC_TABLES},
    )


def test_config(interval_seconds=3600):
    return SyncConfig.for_test(pathlib.Path(tempfile.mkdtemp()), interval_seconds)


class Lock:
    def __enter__(self):
        return self

    def __exit__(self, _type, _value, _traceback):
        return False


class FakeDependencies:
    def __init__(self, source_digest="a" * 64, applied_digest=None,
                 target_digest=None, cached_digest=None, failure=None,
                 target_after_apply=None, lock_available=True):
        self.manifest = manifest_for(source_digest)
        self.applied_digest = applied_digest
        self.current_target_digest = target_digest or source_digest
        self.cached_digest = cached_digest
        self.failure = failure
        self.target_after_apply = target_after_apply or source_digest
        self.lock_available = lock_available
        self.downloads = 0
        self.applies = 0
        self.state_writes = 0
        self.stagings = 0
        self.stderr = ""

    def try_exclusive_lock(self):
        return Lock() if self.lock_available else None

    def fetch_manifest(self):
        if self.failure == "invalid-manifest":
            return "not json"
        return self.manifest.serialize()

    def target_digest(self):
        return self.current_target_digest

    def read_state(self):
        if self.applied_digest is None:
            return None
        return SyncResult("state", self.applied_digest)

    def record_verified(self, _digest):
        self.state_writes += 1

    def verified_cache(self, manifest):
        return "cached" if self.cached_digest == manifest.content_sha256 else None

    def download_and_verify(self, _manifest):
        self.downloads += 1
        if self.failure in ("truncated-artifact", "artifact-sha-mismatch",
                            "content-sha-mismatch"):
            raise SyncValidationError("artifact verification failed")
        return "downloaded"

    def prepare_and_validate_staging(self, _artifact, _manifest):
        self.stagings += 1

    def apply_staging(self, _manifest):
        self.applies += 1
        self.current_target_digest = self.target_after_apply

    def monotonic(self):
        return 0

    def sleep(self, _seconds):
        raise StopLoop()

    def write_stderr(self, message):
        self.stderr += message


class StopLoop(Exception):
    pass


class FakeClock(FakeDependencies):
    def __init__(self, monotonic_values):
        super().__init__()
        self.monotonic_values = iter(monotonic_values)
        self.sleep_calls = []

    def monotonic(self):
        return next(self.monotonic_values)

    def sleep(self, seconds):
        self.sleep_calls.append(seconds)
        if len(self.sleep_calls) == 2:
            raise StopLoop()


class OrchestratorTests(unittest.TestCase):
    def test_noop_requires_source_applied_and_target_digests_to_match(self):
        dependencies = FakeDependencies(
            source_digest="a" * 64,
            applied_digest="a" * 64,
            target_digest="a" * 64,
        )
        result = run_once(test_config(), dependencies=dependencies)
        self.assertEqual(result.action, "noop")
        self.assertEqual(dependencies.downloads, 0)
        self.assertEqual(dependencies.applies, 0)

    def test_target_drift_reapplies_cached_snapshot(self):
        dependencies = FakeDependencies(
            source_digest="a" * 64,
            applied_digest="a" * 64,
            target_digest="b" * 64,
            cached_digest="a" * 64,
        )
        result = run_once(test_config(), dependencies=dependencies)
        self.assertEqual(result.action, "repaired-target-drift")
        self.assertEqual(dependencies.downloads, 0)
        self.assertEqual(dependencies.applies, 1)

    def test_dry_run_never_applies_or_advances_state(self):
        dependencies = FakeDependencies(source_digest="b" * 64,
                                        applied_digest="a" * 64,
                                        target_digest="a" * 64)
        result = run_once(test_config(), dry_run=True,
                          dependencies=dependencies)
        self.assertEqual(result.action, "dry-run")
        self.assertEqual(dependencies.applies, 0)
        self.assertEqual(dependencies.state_writes, 0)
        self.assertEqual(dependencies.stagings, 1)

    def test_dry_run_validates_even_an_already_synced_target(self):
        dependencies = FakeDependencies(source_digest="a" * 64,
                                        applied_digest="a" * 64,
                                        target_digest="a" * 64)
        result = run_once(test_config(), dry_run=True,
                          dependencies=dependencies)
        self.assertEqual(result.action, "dry-run")
        self.assertEqual((dependencies.downloads, dependencies.stagings,
                          dependencies.state_writes), (1, 1, 0))

    def test_source_change_downloads_and_applies(self):
        deps = FakeDependencies(source_digest="b" * 64,
                                applied_digest="a" * 64,
                                target_digest="a" * 64)
        result = run_once(test_config(), dependencies=deps)
        self.assertEqual((result.action, deps.downloads, deps.applies),
                         ("applied-source-change", 1, 1))

    def test_result_retains_verified_artifact_size_for_success_logging(self):
        deps = FakeDependencies(source_digest="b" * 64,
                                applied_digest="a" * 64,
                                target_digest="a" * 64)
        result = run_once(test_config(), dependencies=deps)
        self.assertEqual(result.artifact_bytes, 42)

    def test_untrusted_source_inputs_never_apply(self):
        for failure in ("invalid-manifest", "truncated-artifact",
                        "artifact-sha-mismatch", "content-sha-mismatch"):
            deps = FakeDependencies(failure=failure)
            with self.subTest(failure=failure), self.assertRaises(
                    (SyncValidationError, ValueError)):
                run_once(test_config(), dependencies=deps)
            self.assertEqual((deps.applies, deps.state_writes), (0, 0))

    def test_missing_cache_redownloads_current_digest(self):
        deps = FakeDependencies(source_digest="a" * 64,
                                applied_digest="a" * 64,
                                target_digest="b" * 64,
                                cached_digest=None)
        run_once(test_config(), dependencies=deps)
        self.assertEqual((deps.downloads, deps.applies), (1, 1))

    def test_post_commit_mismatch_does_not_advance_state(self):
        deps = FakeDependencies(source_digest="b" * 64,
                                target_after_apply="c" * 64)
        with self.assertRaisesRegex(SyncValidationError, "post-commit"):
            run_once(test_config(), dependencies=deps)
        self.assertEqual(deps.state_writes, 0)

    def test_lock_contention_skips_successfully_without_work(self):
        deps = FakeDependencies(lock_available=False)
        result = run_once(test_config(), dependencies=deps)
        self.assertEqual(result.action, "skipped-overlap")
        self.assertEqual((deps.downloads, deps.applies), (0, 0))

    def test_loop_uses_configured_monotonic_deadlines(self):
        clock = FakeClock(monotonic_values=[0, 15, 3600, 3610])
        with self.assertRaises(StopLoop):
            run_loop(test_config(interval_seconds=3600), dependencies=clock)
        self.assertEqual(clock.sleep_calls, [3585, 3590])

    def test_logged_failure_omits_credentials_and_sql(self):
        deps = FakeDependencies()
        deps.fetch_manifest = lambda: (_ for _ in ()).throw(RuntimeError(
            "MYSQL_PASSWORD=secret INSERT INTO Areas VALUES (1)"))
        run_one_loop_iteration(test_config(), dependencies=deps)
        self.assertNotIn("secret", deps.stderr)
        self.assertNotIn("INSERT INTO", deps.stderr)

    def test_manual_failure_logs_only_a_fixed_sanitized_message(self):
        stderr = io.StringIO()
        with mock.patch("content_sync.sync.SyncConfig.from_environment",
                        side_effect=RuntimeError(
                            "MYSQL_PASSWORD=secret INSERT INTO Areas")), \
                mock.patch("content_sync.sync.sys.stderr", stderr):
            self.assertEqual(main(["--once"]), 1)
        self.assertNotIn("secret", stderr.getvalue())
        self.assertNotIn("INSERT INTO", stderr.getvalue())

    def test_environment_validates_interval_and_ssh_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            key = root / "key"
            hosts = root / "known_hosts"
            key.write_text("key")
            hosts.write_text("host")
            key.chmod(0o600)
            hosts.chmod(0o600)
            environment = {
                "MYSQL_PORT": "3306", "MYSQL_USER": "sync",
                "MYSQL_PASSWORD": "password", "MYSQL_DATABASE": "legendhub",
                "CONTENT_SYNC_SOURCE": "sync@source",
                "CONTENT_SYNC_SSH_KEY": str(key),
                "CONTENT_SYNC_KNOWN_HOSTS": str(hosts),
                "CONTENT_SYNC_STATE_DIR": str(root / "state"),
                "CONTENT_SYNC_INTERVAL_SECONDS": "17",
            }
            config = SyncConfig.from_environment(environment)
            self.assertEqual(config.interval_seconds, 17)
            self.assertEqual(ssh_command(config, "snapshot", "a" * 64)[-2:],
                             ["sync@source", "snapshot " + "a" * 64])
            environment["CONTENT_SYNC_INTERVAL_SECONDS"] = "0"
            with self.assertRaisesRegex(ValueError, "CONTENT_SYNC_INTERVAL_SECONDS"):
                SyncConfig.from_environment(environment)
            environment["CONTENT_SYNC_INTERVAL_SECONDS"] = "17"
            key.chmod(0o622)
            with self.assertRaisesRegex(ValueError, "private"):
                SyncConfig.from_environment(environment)

    def test_cache_verification_requires_exact_artifact_and_content_hashes(self):
        with tempfile.TemporaryDirectory() as directory:
            config = test_config()
            config = config.with_state_dir(pathlib.Path(directory))
            deps = __import__("content_sync.sync", fromlist=["Dependencies"]).Dependencies.real(config)
            manifest = manifest_for("a" * 64)
            path = deps.cache_path(manifest.content_sha256)
            path.parent.mkdir(mode=0o700)
            path.write_bytes(b"not a gzip stream")
            path.chmod(0o600)
            self.assertIsNone(deps.verified_cache(manifest))


if __name__ == "__main__":
    unittest.main()
