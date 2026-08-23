#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
state_dir="${LEGENDHUB_LOCAL_STATE_DIR:-${repo_root}/data/local-stack}"
environment_file="${state_dir}/local.env"

if [[ "$#" -eq 0 ]]; then
  printf 'Usage: %s <docker-compose arguments...>\n' "$0" >&2
  exit 64
fi

for required_file in \
  "$environment_file" \
  "${state_dir}/backups/dunwich-latest.sql.gz" \
  "${state_dir}/tls/localhost.pem" \
  "${state_dir}/tls/localhost-key.pem"; do
  if [[ ! -f "$required_file" || ! -s "$required_file" ]]; then
    printf 'local-stack: required local state is missing; run prepare-local-stack.sh first\n' >&2
    exit 1
  fi
done

exec docker compose \
  --project-directory "$repo_root" \
  --project-name legendhub-local \
  --env-file "$environment_file" \
  -f "$repo_root/docker-compose.yaml" \
  -f "$repo_root/docker-compose.local.yaml" \
  "$@"
