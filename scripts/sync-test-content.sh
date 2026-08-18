#!/usr/bin/env bash
set -euo pipefail

case "$#:${1:-}" in
  0:) remote_args=() ;;
  1:--dry-run) remote_args=(--dry-run) ;;
  *) printf 'Usage: %s [--dry-run]\n' "${0##*/}" >&2; exit 64 ;;
esac

exec ssh -a dunwichmass \
  /home/rufus/legendhub/scripts/run-test-content-sync.sh "${remote_args[@]}"
