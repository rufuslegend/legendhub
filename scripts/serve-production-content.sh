#!/usr/bin/env bash
set -euo pipefail

if [[ "${SSH_ORIGINAL_COMMAND:-}" == "manifest" ]]; then
  export_args=(manifest)
elif [[ "${SSH_ORIGINAL_COMMAND:-}" =~ ^snapshot\ [0123456789abcdef]{64}$ ]]; then
  digest="${SSH_ORIGINAL_COMMAND#snapshot }"
  export_args=(snapshot "$digest")
else
  printf 'content-export: command rejected\n' >&2
  exit 64
fi

mapfile -t containers < <(docker ps --quiet \
  --filter label=com.docker.compose.project=legendhub260 \
  --filter label=com.docker.compose.service=mysql-backup)
[[ "${#containers[@]}" -eq 1 ]] || {
  printf 'content-export: expected one backup container\n' >&2
  exit 1
}

exec docker exec "${containers[0]}" \
  /usr/local/bin/export-public-content "${export_args[@]}"
