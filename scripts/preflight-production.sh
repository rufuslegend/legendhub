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

sorted_lines() {
  awk 'NF && !seen[$0]++' | LC_ALL=C sort
}

require_exact_set() {
  local label="$1"
  local actual="$2"
  local expected="$3"

  [[ "$(printf '%s\n' "$actual" | sorted_lines)" == \
    "$(printf '%s\n' "$expected" | sorted_lines)" ]] ||
    fail "$label does not match the expected set"
}

check_route() {
  local label="$1"
  local base_url="$2"
  local route="$3"
  local http_code

  http_code="$(curl -sS --connect-timeout 5 --max-time 15 \
    -o /dev/null -w '%{http_code}' \
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

  expected_services=$'mysql\nmysql-backup\npython\nwww'
  current_services="$("${compose[@]}" config --services)" ||
    fail 'Current Compose services could not be listed'
  require_exact_set 'Current Compose services' \
    "$current_services" "$expected_services"

  expected_containers=$'legendhub260_mysql_1\nlegendhub260_mysql-backup_1\nlegendhub260_python_1\nlegendhub260_www_1'
  current_containers="$(docker ps -a \
    --filter label=com.docker.compose.project=legendhub260 \
    --format '{{.Names}}')" || fail 'Current project containers could not be listed'
  require_exact_set 'Current project containers' \
    "$current_containers" "$expected_containers"
  pass 'Current Compose services and project containers are exact'

  compose_hash="$(sha256sum docker-compose.yaml | awk '{print $1}')"
  info "Compose SHA-256 ${compose_hash}"
  rendered_compose="$("${compose[@]}" config)" ||
    fail 'Compose rendering failed'
  compose_images="$(printf '%s\n' "$rendered_compose" | awk '
    /^services:$/ { in_services = 1; next }
    in_services && /^[^ ]/ { in_services = 0 }
    in_services && /^  [^ ]+:[[:space:]]*$/ {
      service = $1
      sub(/:$/, "", service)
    }
    in_services && /^    image:[[:space:]]/ { print service, $2 }
  ')"
  unset rendered_compose

  expected_entries=(
    'mysql|legendhub260_mysql_1|mysql:5.7.44'
    'mysql-backup|legendhub260_mysql-backup_1|tmckimmey/legendhub-mysql-backup:6ddaeab948a1'
    'python|legendhub260_python_1|tmckimmey/legendhub-python:6ddaeab948a1'
    'www|legendhub260_www_1|tmckimmey/legendhub-www:4bb661fd5dd7'
  )

  for entry in "${expected_entries[@]}"; do
    IFS='|' read -r service container expected_image <<< "$entry"
    compose_image="$(printf '%s\n' "$compose_images" | awk \
      -v wanted="$service" '$1 == wanted {print $2}')"
    [[ "$compose_image" == "$expected_image" ]] ||
      fail "Compose image for $service is ${compose_image:-missing}; expected $expected_image"

    project="$(docker inspect --format \
      '{{index .Config.Labels "com.docker.compose.project"}}' "$container")"
    container_service="$(docker inspect --format \
      '{{index .Config.Labels "com.docker.compose.service"}}' "$container")"
    image="$(docker inspect --format '{{.Config.Image}}' "$container")"
    state="$(docker inspect --format '{{.State.Status}}' "$container")"
    restarts="$(docker inspect --format '{{.RestartCount}}' "$container")"
    container_id="$(docker inspect --format '{{.Id}}' "$container")"
    running_image_id="$(docker inspect --format '{{.Image}}' "$container")"
    expected_image_id="$(docker image inspect --format '{{.Id}}' "$expected_image")"
    platform="$(docker image inspect --format '{{.Os}}/{{.Architecture}}' \
      "$expected_image")"

    [[ "$project" == legendhub260 ]] ||
      fail "$container belongs to project $project"
    [[ "$container_service" == "$service" ]] ||
      fail "$container has service label $container_service; expected $service"
    [[ "$image" == "$expected_image" ]] ||
      fail "container image for $service is $image; expected $expected_image"
    [[ "$running_image_id" == "$expected_image_id" ]] ||
      fail "running image ID for $service does not match $expected_image"
    [[ "$state" == running ]] || fail "$container is $state"
    [[ "$restarts" == 0 ]] || fail "$container has $restarts restarts"
    [[ "$platform" == linux/amd64 ]] || fail "$expected_image is $platform"

    pass "$container running; image=$expected_image; platform=$platform; restarts=0"
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
  dump_metadata="$(stat -c '%s %a %U' "$cutover_dump")" ||
    fail 'Cutover backup metadata could not be read'
  read -r dump_size dump_mode dump_owner <<< "$dump_metadata"
  [[ "$dump_size" =~ ^[0-9]+$ && "$dump_size" -gt 1048576 ]] ||
    fail "Cutover backup is only ${dump_size:-unknown} bytes"
  [[ "$dump_mode" == 600 ]] ||
    fail "Cutover backup mode is ${dump_mode:-unknown}; expected 600"
  current_user="$(id -un)"
  [[ "$dump_owner" == "$current_user" ]] ||
    fail "Cutover backup owner is ${dump_owner:-unknown}; expected $current_user"
  gzip -t "$cutover_dump" || fail 'Cutover backup failed gzip validation'
  info "$cutover_dump — $dump_size bytes — mode $dump_mode — owner $dump_owner"
  pass 'Cutover backup is valid'

  [[ -d "$rollback_root" ]] || fail 'Rollback directory is missing'
  [[ -s "$rollback_root/docker-compose.yaml" ]] ||
    fail 'Rollback docker-compose.yaml is missing'
  [[ -s "$rollback_root/.env" ]] || fail 'Rollback .env is missing'
  (cd "$rollback_root" && docker-compose config --quiet) ||
    fail 'Rollback Compose validation failed'

  rollback_services="$(cd "$rollback_root" && docker-compose config --services)" ||
    fail 'Rollback Compose services could not be listed'
  require_exact_set 'Rollback Compose services' \
    "$rollback_services" $'mysql\nmysql-backup\npython\nwww'

  rollback_project_containers="$(docker ps -a \
    --filter label=com.docker.compose.project=legendhub \
    --format '{{.Names}}')" || fail 'Rollback project containers could not be listed'
  expected_rollback_project_containers=$'legendhub_mysql_1\nlegendhub_python_1\nlegendhub_www_1\nlegendhub_www_2'
  require_exact_set 'Rollback project containers' \
    "$rollback_project_containers" "$expected_rollback_project_containers"

  while IFS= read -r rollback_project_container; do
    rollback_project_state="$(docker inspect --format '{{.State.Status}}' \
      "$rollback_project_container")" ||
      fail "Rollback project container $rollback_project_container is missing"
    case "$rollback_project_state" in
      created|exited) ;;
      *) fail "Rollback project container $rollback_project_container is $rollback_project_state" ;;
    esac
  done <<< "$rollback_project_containers"

  rollback_entries=(
    'mysql|legendhub_mysql_1|legendhub_mysql'
    'python|legendhub_python_1|legendhub_python'
    'www|legendhub_www_1|legendhub_www'
  )
  rollback_volumes=''

  for rollback_entry in "${rollback_entries[@]}"; do
    IFS='|' read -r rollback_service rollback_container \
      expected_rollback_image <<< "$rollback_entry"
    if ! rollback_state="$(docker inspect --format '{{.State.Status}}' \
      "$rollback_container")"; then
      fail "Rollback container $rollback_container is missing"
    fi
    [[ "$rollback_state" == exited ]] ||
      fail "Rollback container $rollback_container is $rollback_state; expected exited"

    rollback_project="$(docker inspect --format \
      '{{index .Config.Labels "com.docker.compose.project"}}' \
      "$rollback_container")"
    rollback_container_service="$(docker inspect --format \
      '{{index .Config.Labels "com.docker.compose.service"}}' \
      "$rollback_container")"
    rollback_image="$(docker inspect --format '{{.Config.Image}}' \
      "$rollback_container")"
    rollback_image_id="$(docker inspect --format '{{.Image}}' \
      "$rollback_container")"
    expected_rollback_image_id="$(docker image inspect --format '{{.Id}}' \
      "$expected_rollback_image")" ||
      fail "Rollback image $expected_rollback_image is missing"
    rollback_platform="$(docker image inspect --format '{{.Os}}/{{.Architecture}}' \
      "$expected_rollback_image")" ||
      fail "Rollback image for $rollback_container is missing"

    [[ "$rollback_project" == legendhub ]] ||
      fail "$rollback_container belongs to project $rollback_project"
    [[ "$rollback_container_service" == "$rollback_service" ]] ||
      fail "$rollback_container has service label $rollback_container_service; expected $rollback_service"
    [[ "$rollback_image" == "$expected_rollback_image" ]] ||
      fail "Rollback container image for $rollback_service is $rollback_image; expected $expected_rollback_image"
    [[ "$rollback_image_id" == "$expected_rollback_image_id" ]] ||
      fail "Rollback running image ID for $rollback_service does not match $expected_rollback_image"
    [[ "$rollback_platform" == linux/amd64 ]] ||
      fail "Rollback image for $rollback_container is $rollback_platform"

    container_volumes="$(docker inspect --format \
      '{{range .Mounts}}{{if eq .Type "volume"}}{{println .Name}}{{end}}{{end}}' \
      "$rollback_container")"
    rollback_volumes="${rollback_volumes}${container_volumes}"$'\n'
    pass "$rollback_container stopped; image=$rollback_image; platform=$rollback_platform"
  done

  rollback_volumes="$(printf '%s\n' "$rollback_volumes" | sorted_lines)"
  expected_rollback_volumes=$'legendhub_database\nlegendhub_database-logs\nlegendhub_python-logs'
  require_exact_set 'Rollback named volumes' \
    "$rollback_volumes" "$expected_rollback_volumes"
  while IFS= read -r rollback_volume; do
    docker volume inspect "$rollback_volume" >/dev/null ||
      fail "Rollback volume $rollback_volume is missing"
    pass "Rollback volume $rollback_volume is present"
  done <<< "$expected_rollback_volumes"

  pass 'Rollback files, containers, images, and volumes are present'

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
