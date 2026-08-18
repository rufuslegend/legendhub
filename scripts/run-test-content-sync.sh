#!/usr/bin/env bash
set -euo pipefail

validate_compose_project() {
  local line
  local project_definitions=0
  local literal_definitions=0
  local project_pattern='^[[:space:]]*(export[[:space:]]+)?COMPOSE_PROJECT_NAME'

  [[ -f .env ]] || {
    printf 'content-sync: required file is missing: .env\n' >&2
    exit 1
  }
  unset COMPOSE_PROJECT_NAME
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" =~ $project_pattern ]]; then
      project_definitions=$((project_definitions + 1))
    fi
    if [[ "$line" == COMPOSE_PROJECT_NAME=legendhub ]]; then
      literal_definitions=$((literal_definitions + 1))
    fi
  done < .env

  if [[ "$project_definitions" -ne 1 || "$literal_definitions" -ne 1 ]]; then
    printf '%s\n' \
      'content-sync: Compose project in .env must be exactly COMPOSE_PROJECT_NAME=legendhub' >&2
    exit 1
  fi
  export COMPOSE_PROJECT_NAME=legendhub
}

case "$#:${1:-}" in
  0:) sync_args=(--once) ;;
  1:--dry-run) sync_args=(--once --dry-run) ;;
  *) printf 'Usage: %s [--dry-run]\n' "${0##*/}" >&2; exit 64 ;;
esac

cd /home/rufus/legendhub
validate_compose_project
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
