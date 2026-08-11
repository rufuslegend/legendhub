#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

pass() {
  printf 'PASS: %s\n' "$1"
}

info() {
  printf 'INFO: %s\n' "$1"
}

check_route() {
  local label="$1"
  local base_url="$2"
  local route="$3"
  local http_code

  http_code="$(curl -sS -L -o /dev/null -w '%{http_code}' \
    "${base_url}${route}" || true)"
  [[ "$http_code" == 200 ]] ||
    fail "${label} ${route} returned HTTP ${http_code:-no-response}"
  pass "${label} ${route} HTTP 200"
}

run_remote() {
  local deploy_root="$1"
  local cutover_dump="$2"
  local rollback_root="$3"

  cd "$deploy_root"
  compose=(docker-compose -p legendhub260 -f docker-compose.yaml)

  printf '%s\n' 'LegendHUB production preflight (read-only)'

  [[ -f docker-compose.yaml ]] || fail 'docker-compose.yaml is missing'
  [[ -f .env ]] || fail '.env is missing'
  "${compose[@]}" config --quiet || fail 'Compose validation failed'
  pass 'Compose configuration validates'

  compose_hash="$(sha256sum docker-compose.yaml | awk '{print $1}')"
  info "Compose SHA-256 ${compose_hash}"
  "${compose[@]}" config |
    awk '$1 == "image:" {print "INFO: configured image " $2}'

  containers=(
    legendhub260_mysql_1
    legendhub260_mysql-backup_1
    legendhub260_python_1
    legendhub260_www_1
  )

  for container in "${containers[@]}"; do
    project="$(docker inspect --format \
      '{{index .Config.Labels "com.docker.compose.project"}}' "$container")"
    image="$(docker inspect --format '{{.Config.Image}}' "$container")"
    state="$(docker inspect --format '{{.State.Status}}' "$container")"
    restarts="$(docker inspect --format '{{.RestartCount}}' "$container")"
    container_id="$(docker inspect --format '{{.Id}}' "$container")"
    platform="$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image")"

    [[ "$project" == legendhub260 ]] ||
      fail "$container belongs to project $project"
    [[ "$state" == running ]] || fail "$container is $state"
    [[ "$restarts" == 0 ]] || fail "$container has $restarts restarts"
    [[ "$platform" == linux/amd64 ]] || fail "$image is $platform"

    pass "$container running; image=$image; platform=$platform; restarts=0"
    info "$container id=$container_id"
  done

  mysql_health="$(docker inspect --format '{{.State.Health.Status}}' \
    legendhub260_mysql_1)"
  [[ "$mysql_health" == healthy ]] || fail "MySQL health is $mysql_health"
  pass 'MySQL is healthy'

  docker exec legendhub260_mysql-backup_1 bash -c '
    set -euo pipefail
    private="/backups/private/database_$(date +%m-%d-%Y).sql.gz"
    public="/backups/public/database.sql"
    test -s "$private"
    gzip -t "$private"
    test -s "$public"
    stat -c "INFO: %n — %s bytes — mode %a" "$private" "$public"
  ' || fail 'Manual backup artifacts failed validation'
  pass 'Manual backup artifacts are nonempty and readable'

  [[ -s "$cutover_dump" ]] || fail 'Cutover backup is missing or empty'
  gzip -t "$cutover_dump" || fail 'Cutover backup failed gzip validation'
  stat -c 'INFO: %n — %s bytes — mode %a' "$cutover_dump"
  pass 'Cutover backup is valid'

  [[ -d "$rollback_root" ]] || fail 'Rollback directory is missing'
  rollback_ids="$(docker ps -aq --filter label=com.docker.compose.project=legendhub)"
  [[ -n "$rollback_ids" ]] || fail 'Rollback containers are missing'
  pass 'Rollback directory and containers are present'
  docker ps -a \
    --filter label=com.docker.compose.project=legendhub \
    --format 'INFO: rollback container={{.Names}} image={{.Image}} state={{.Status}}'

  routes=(
    /
    /feedback.html
    /changelog
    /builder/
    /items/
    /mobs/
    /quests/
    /wiki/
    /login.html
  )

  for route in "${routes[@]}"; do
    check_route local 'http://127.0.0.1:7000' "$route"
  done

  for route in "${routes[@]}"; do
    check_route public 'https://www.legendhub.org' "$route"
  done

  printf '%s\n' 'PRODUCTION PREFLIGHT PASSED'
}

if [[ "${1:-}" == --remote ]]; then
  [[ "$#" -eq 4 ]] || fail 'Invalid remote preflight invocation'
  run_remote "$2" "$3" "$4"
  exit
fi

[[ "$#" -eq 0 ]] || fail 'This script does not accept arguments'

ssh -A legend bash -s -- \
  --remote \
  /home/rufus/legendhub \
  /home/rufus/legendhub-cutover-backups/legendhub-pre-2.6.0.sql.gz \
  /legend/LegendHubOriginal < "${BASH_SOURCE[0]}"
