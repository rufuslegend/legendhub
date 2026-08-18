"""Report content-sync health from its last verified private state."""

import json
import os
from pathlib import Path
import sys
import time

from content_sync.contract import SHA256_RE
from content_sync.sync import SyncState


DEFAULT_MAX_AGE_SECONDS = 7200
DEFAULT_STATE_DIR = "/var/lib/legendhub-content-sync"


def health_status(state, now, max_age_seconds=DEFAULT_MAX_AGE_SECONDS):
    if state is None:
        return 1, "starting"
    age = now - state.verified_at_epoch
    return ((0, "healthy") if 0 <= age <= max_age_seconds
            else (1, "unhealthy"))


def _read_state(state_path):
    if not state_path.exists():
        return None
    data = json.loads(state_path.read_text(encoding="utf-8"))
    if type(data) is not dict or set(data) != {
            "content_sha256", "verified_at_epoch"}:
        raise ValueError("invalid state")
    digest = data["content_sha256"]
    epoch = data["verified_at_epoch"]
    if not SHA256_RE.fullmatch(digest) or type(epoch) is not int:
        raise ValueError("invalid state")
    return SyncState(digest, epoch)


def _max_age_seconds(environment):
    try:
        maximum = int(environment.get(
            "CONTENT_SYNC_MAX_AGE_SECONDS", str(DEFAULT_MAX_AGE_SECONDS)))
    except (TypeError, ValueError):
        raise ValueError("invalid CONTENT_SYNC_MAX_AGE_SECONDS")
    if maximum <= 0:
        raise ValueError("invalid CONTENT_SYNC_MAX_AGE_SECONDS")
    return maximum


def main(environment=None, now=None):
    environment = os.environ if environment is None else environment
    try:
        state_dir = environment.get("CONTENT_SYNC_STATE_DIR", DEFAULT_STATE_DIR)
        if not state_dir:
            raise ValueError("invalid CONTENT_SYNC_STATE_DIR")
        state = _read_state(Path(state_dir) / "state.json")
        checked_at = time.time() if now is None else now
        status, label = health_status(
            state, checked_at, _max_age_seconds(environment))
    except (OSError, TypeError, ValueError):
        status, label = 1, "unhealthy"
    print(label)
    return status


if __name__ == "__main__":
    sys.exit(main())
