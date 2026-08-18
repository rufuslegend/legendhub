#!/usr/bin/env bash
set -euo pipefail

validate_release_sha() {
  local release_sha="$1"

  [[ "$release_sha" =~ ^[a-f0-9]{12}$ ]] || {
    printf 'Release must be a 12-character lowercase Git SHA.\n' >&2
    exit 2
  }
}

require_file() {
  local file="$1"

  [[ -f "$file" ]] || {
    printf 'Required deployment file is missing: %s\n' "$file" >&2
    exit 1
  }
}

deploy_remote() {
  local release_sha="$1"
  local deploy_root="$2"
  local full_sha
  local checked_out_sha
  local tracked_content_sync
  local content_sync_containers

  validate_release_sha "$release_sha"
  cd "$deploy_root"

  require_file .env
  require_file docker-compose.test.yaml

  git fetch origin
  full_sha="$(git rev-parse --verify "${release_sha}^{commit}")"
  [[ "$full_sha" =~ ^[a-f0-9]{40}$ ]] || {
    printf 'Release did not resolve to a full Git commit: %s\n' "$release_sha" >&2
    exit 1
  }

  git checkout --detach "$full_sha"
  checked_out_sha="$(git rev-parse --short=12 HEAD)"
  [[ "$checked_out_sha" == "$release_sha" ]] || {
    printf 'Checked-out commit does not match requested release: %s\n' "$release_sha" >&2
    exit 1
  }

  require_file .env
  require_file docker-compose.test.yaml
  require_file docker-compose.registry.yaml

  if ! tracked_content_sync="$(git ls-tree --name-only "$full_sha" -- \
      docker-compose.content-sync.yaml)"; then
    printf 'Could not inspect target Compose tree.\n' >&2
    exit 1
  fi
  case "$tracked_content_sync" in
    docker-compose.content-sync.yaml) ;;
    '') ;;
    *)
      printf 'Target Compose tree returned an unexpected overlay path.\n' >&2
      exit 1
      ;;
  esac

  export LEGENDHUB_IMAGE_TAG="$release_sha"
  compose=(
    docker compose
    -f docker-compose.yaml
    -f docker-compose.test.yaml
    -f docker-compose.registry.yaml
  )

  if [[ "$tracked_content_sync" == docker-compose.content-sync.yaml ]]; then
    require_file docker-compose.content-sync.yaml
    compose+=(-f docker-compose.content-sync.yaml)
    "${compose[@]}" config --quiet
    "${compose[@]}" pull www python mysql-backup content-sync
    "${compose[@]}" up -d --no-build
    return
  fi

  "${compose[@]}" config --quiet
  content_sync_containers="$(docker ps --all --quiet --no-trunc \
    --filter label=com.docker.compose.project=legendhub \
    --filter label=com.docker.compose.service=content-sync)"
  if [[ "$content_sync_containers" == *$'\n'* ]]; then
    printf 'Legacy rollback expected at most one legacy content-sync container.\n' >&2
    exit 1
  fi
  if [[ -n "$content_sync_containers" &&
        ! "$content_sync_containers" =~ ^[abcdef0123456789]{64}$ ]]; then
    printf 'Legacy rollback found an invalid content-sync container identity.\n' >&2
    exit 1
  fi

  "${compose[@]}" pull www python mysql-backup
  if [[ -n "$content_sync_containers" ]]; then
    docker rm --force -- "$content_sync_containers" >/dev/null
  fi
  "${compose[@]}" up -d --no-build
}

if [[ "${1:-}" == "--remote" ]]; then
  [[ "$#" -eq 3 ]] || {
    printf 'Invalid remote deployment invocation.\n' >&2
    exit 2
  }
  deploy_remote "$2" "$3"
  exit
fi

[[ "$#" -eq 1 ]] || {
  printf 'Usage: %s <12-character-release-sha>\n' "${0##*/}" >&2
  exit 2
}

release_sha="$1"
validate_release_sha "$release_sha"

ssh -A dunwichmass bash -s -- \
  --remote "$release_sha" /home/rufus/legendhub < "${BASH_SOURCE[0]}"
