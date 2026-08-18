import io
import json
import pathlib
import tempfile
import unittest
from contextlib import redirect_stdout
from types import SimpleNamespace

import sys

sys.path.insert(0, str(pathlib.Path(__file__).parents[1]))

from content_sync.health import health_status, main


def state(verified_at_epoch):
    return SimpleNamespace(verified_at_epoch=verified_at_epoch)


class HealthTests(unittest.TestCase):
    def test_starting_without_state(self):
        self.assertEqual(health_status(None, now=7200), (1, "starting"))

    def test_healthy_at_exact_two_hour_boundary(self):
        self.assertEqual(health_status(state(verified_at_epoch=100), now=7300),
                         (0, "healthy"))

    def test_unhealthy_after_two_hours(self):
        self.assertEqual(health_status(state(verified_at_epoch=100), now=7301),
                         (1, "unhealthy"))

    def test_unhealthy_when_state_timestamp_is_in_the_future(self):
        self.assertEqual(health_status(state(verified_at_epoch=7301), now=7300),
                         (1, "unhealthy"))

    def test_cli_uses_max_age_independently_from_sync_interval(self):
        with tempfile.TemporaryDirectory() as directory:
            state_path = pathlib.Path(directory) / "state.json"
            state_path.write_text(json.dumps({
                "content_sha256": "a" * 64,
                "verified_at_epoch": 100,
            }), encoding="utf-8")
            output = io.StringIO()
            environment = {
                "CONTENT_SYNC_INTERVAL_SECONDS": "1",
                "CONTENT_SYNC_MAX_AGE_SECONDS": "7200",
                "CONTENT_SYNC_STATE_DIR": directory,
            }
            with redirect_stdout(output):
                status = main(environment=environment, now=7300)
            self.assertEqual((status, output.getvalue()), (0, "healthy\n"))

    def test_cli_reports_starting_when_state_file_is_absent(self):
        with tempfile.TemporaryDirectory() as directory:
            output = io.StringIO()
            with redirect_stdout(output):
                status = main(
                    environment={"CONTENT_SYNC_STATE_DIR": directory}, now=7300)
            self.assertEqual((status, output.getvalue()), (1, "starting\n"))

    def test_cli_fails_closed_on_malformed_state_without_echoing_it(self):
        with tempfile.TemporaryDirectory() as directory:
            secret = "do-not-print-state-content"
            (pathlib.Path(directory) / "state.json").write_text(
                secret, encoding="utf-8")
            output = io.StringIO()
            with redirect_stdout(output):
                status = main(
                    environment={"CONTENT_SYNC_STATE_DIR": directory}, now=7300)
            self.assertEqual((status, output.getvalue()), (1, "unhealthy\n"))
            self.assertNotIn(secret, output.getvalue())

    def test_cli_fails_closed_on_invalid_max_age(self):
        with tempfile.TemporaryDirectory() as directory:
            output = io.StringIO()
            with redirect_stdout(output):
                status = main(environment={
                    "CONTENT_SYNC_MAX_AGE_SECONDS": "0",
                    "CONTENT_SYNC_STATE_DIR": directory,
                }, now=7300)
            self.assertEqual((status, output.getvalue()), (1, "unhealthy\n"))


if __name__ == "__main__":
    unittest.main()
