#!/usr/bin/env bash
set -euo pipefail

case "$#:${1:-}" in
  0:) sync_args=(--once) ;;
  1:--dry-run) sync_args=(--once --dry-run) ;;
  *) printf 'Usage: %s [--dry-run]\n' "${0##*/}" >&2; exit 64 ;;
esac

cd /home/rufus/legendhub
if ! release_sha="$(git rev-parse --short=12 HEAD)"; then
  printf 'content-sync: deployment image tag could not be resolved\n' >&2
  exit 1
fi
if [[ ! "$release_sha" =~ ^[abcdef0123456789]{12}$ ]]; then
  printf 'content-sync: deployment image tag is invalid\n' >&2
  exit 1
fi
export LEGENDHUB_IMAGE_TAG="$release_sha"

exec docker compose \
  -f docker-compose.yaml \
  -f docker-compose.test.yaml \
  -f docker-compose.registry.yaml \
  -f docker-compose.content-sync.yaml \
  run --rm --no-deps content-sync \
  /usr/local/bin/sync-public-content "${sync_args[@]}"
