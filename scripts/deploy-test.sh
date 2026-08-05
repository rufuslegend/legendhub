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

  export LEGENDHUB_IMAGE_TAG="$release_sha"
  compose=(
    docker compose
    -f docker-compose.yaml
    -f docker-compose.test.yaml
    -f docker-compose.registry.yaml
  )
  "${compose[@]}" config --quiet
  "${compose[@]}" pull www python mysql-backup
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
