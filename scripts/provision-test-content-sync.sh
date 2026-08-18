#!/usr/bin/env bash
set -euo pipefail

readonly deploy_root=/home/rufus/legendhub
readonly staging_database=legendhub_content_sync

fail() {
  printf 'content-sync-provision: %s\n' "$1" >&2
  exit 1
}

require_file() {
  local file="$1"

  [[ -f "$file" ]] || fail "required file is missing: $file"
}

validate_staging_database() {
  local configured_value
  local line
  local matches=0

  if [[ "${CONTENT_SYNC_STAGING_DATABASE+x}" == x &&
        "$CONTENT_SYNC_STAGING_DATABASE" != "$staging_database" ]]; then
    fail 'CONTENT_SYNC_STAGING_DATABASE must be legendhub_content_sync'
  fi

  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?CONTENT_SYNC_STAGING_DATABASE[[:space:]]*=(.*)$ ]]; then
      matches=$((matches + 1))
      configured_value="${BASH_REMATCH[2]}"
      configured_value="${configured_value#"${configured_value%%[![:space:]]*}"}"
      configured_value="${configured_value%"${configured_value##*[![:space:]]}"}"
      case "$configured_value" in
        legendhub_content_sync|\"legendhub_content_sync\"|\'legendhub_content_sync\') ;;
        *) fail 'CONTENT_SYNC_STAGING_DATABASE must be legendhub_content_sync' ;;
      esac
    fi
  done < .env

  [[ "$matches" -le 1 ]] ||
    fail 'CONTENT_SYNC_STAGING_DATABASE must be defined at most once'
}

load_image_tag() {
  local release_sha

  if ! release_sha="$(git rev-parse --short=12 HEAD)"; then
    fail 'deployment image tag could not be resolved'
  fi
  if [[ ! "$release_sha" =~ ^[abcdef0123456789]{12}$ ]]; then
    fail 'deployment image tag is invalid'
  fi
  export LEGENDHUB_IMAGE_TAG="$release_sha"
}

provision_remote() {
  local requested_root="$1"
  local mysql_container
  local mysql_containers
  local target_user

  [[ "$requested_root" == "$deploy_root" ]] ||
    fail 'remote deployment path is invalid'
  cd "$requested_root"

  require_file .env
  require_file docker-compose.yaml
  require_file docker-compose.test.yaml
  require_file docker-compose.registry.yaml
  require_file docker-compose.content-sync.yaml
  validate_staging_database
  export CONTENT_SYNC_STAGING_DATABASE="$staging_database"
  load_image_tag

  compose=(
    docker compose
    -f docker-compose.yaml
    -f docker-compose.test.yaml
    -f docker-compose.registry.yaml
    -f docker-compose.content-sync.yaml
  )
  "${compose[@]}" config --quiet || fail 'Compose validation failed'
  mysql_containers="$("${compose[@]}" ps --quiet mysql)" ||
    fail 'MySQL container discovery failed'
  if [[ -z "$mysql_containers" || "$mysql_containers" == *$'\n'* ]]; then
    fail 'expected one MySQL container'
  fi
  mysql_container="$mysql_containers"

  target_user="$(docker exec "$mysql_container" printenv MYSQL_USER)" ||
    fail 'target user preflight failed'
  [[ "$target_user" == legendhub ]] || fail 'expected target user legendhub'
  if ! docker exec "$mysql_container" sh -eu -c \
      'test -n "${MYSQL_ROOT_PASSWORD:-}"'; then
    fail 'root password preflight failed'
  fi

  docker exec -i "$mysql_container" sh -eu -c '
export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"
unset MYSQL_ROOT_PASSWORD MYSQL_PASSWORD
exec mysql --protocol=socket --user=root
' <<'SQL'
CREATE DATABASE IF NOT EXISTS `legendhub_content_sync`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON `legendhub_content_sync`.*
  TO 'legendhub'@'%';
SQL
}

if [[ "${1:-}" == --remote ]]; then
  [[ "$#" -eq 2 ]] || {
    printf 'Invalid remote provisioning invocation.\n' >&2
    exit 64
  }
  provision_remote "$2"
  exit
fi

[[ "$#" -eq 0 ]] || {
  printf 'Usage: %s\n' "${0##*/}" >&2
  exit 64
}

exec ssh -a dunwichmass bash -s -- \
  --remote "$deploy_root" < "${BASH_SOURCE[0]}"
