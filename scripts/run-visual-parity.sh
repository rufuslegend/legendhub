#!/usr/bin/env bash
set -euo pipefail

readonly required_reference_sha="0cab3ac95826a53de19b3146d277e7056495210f"
readonly reference_project="legendhub-parity-reference"
readonly candidate_project="legendhub-parity-candidate"
readonly reference_port="7443"
readonly candidate_port="7444"

usage() {
  printf 'Usage: %s [--mode smoke|full] [--keep] [--fail-on-diff]\n' "$0" >&2
}

mode="smoke"
keep=0
fail_on_diff=0

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --mode)
      if [[ "$#" -lt 2 ]]; then
        usage
        exit 64
      fi
      mode="$2"
      shift 2
      ;;
    --mode=*)
      mode="${1#--mode=}"
      shift
      ;;
    --keep)
      keep=1
      shift
      ;;
    --fail-on-diff)
      fail_on_diff=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage
      exit 64
      ;;
  esac
done

case "$mode" in
  smoke|full) ;;
  *)
    usage
    exit 64
    ;;
esac

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
candidate_root="$(cd "${script_dir}/.." && pwd -P)"
state_directory_input="${LEGENDHUB_LOCAL_STATE_DIR:-${candidate_root}/data/local-stack}"

if [[ ! -d "$state_directory_input" ]]; then
  printf 'visual-parity: required local state is missing; run prepare-local-stack.sh first\n' >&2
  exit 1
fi
state_directory="$(cd "$state_directory_input" && pwd -P)"
environment_file="${state_directory}/local.env"
snapshot_file="${state_directory}/backups/dunwich-latest.sql.gz"
certificate_file="${state_directory}/tls/localhost.pem"
certificate_key_file="${state_directory}/tls/localhost-key.pem"
fixture_file="${candidate_root}/scripts/fixtures/visual-parity.sql"
nginx_config_file="${candidate_root}/nginx/parity.conf"
parity_overlay="${candidate_root}/docker-compose.parity.yaml"
darwin_parity_overlay="${candidate_root}/docker-compose.parity-darwin.yaml"
parity_platform="$(uname -s)" || {
  printf 'visual-parity: could not determine the local platform\n' >&2
  exit 1
}
parity_compose_arguments=(-f "$parity_overlay")
if [[ "$parity_platform" == "Darwin" ]]; then
  parity_compose_arguments+=(-f "$darwin_parity_overlay")
fi

required_files=(
  "$environment_file" \
  "$snapshot_file" \
  "$certificate_file" \
  "$certificate_key_file" \
  "$fixture_file" \
  "$nginx_config_file" \
  "$parity_overlay" \
  "${candidate_root}/docker-compose.yaml"
)
if [[ "$parity_platform" == "Darwin" ]]; then
  required_files+=("$darwin_parity_overlay")
fi

for required_file in "${required_files[@]}"; do
  if [[ ! -f "$required_file" || ! -s "$required_file" ]]; then
    printf 'visual-parity: required local state is missing; run prepare-local-stack.sh first\n' >&2
    exit 1
  fi
done

common_git_directory="$(
  git -C "$candidate_root" rev-parse --path-format=absolute --git-common-dir
)"
reference_sha="$(
  git -C "$candidate_root" rev-parse --verify 'v2.9.0^{commit}'
)"
candidate_sha="$(git -C "$candidate_root" rev-parse HEAD)"

if [[ ! "$reference_sha" =~ ^[0-9a-f]{40}$ ||
      "$reference_sha" != "$required_reference_sha" ]]; then
  printf 'visual-parity: v2.9.0 did not resolve to the required commit\n' >&2
  exit 1
fi
if [[ ! "$candidate_sha" =~ ^[0-9a-f]{40}$ ]]; then
  printf 'visual-parity: candidate HEAD did not resolve to a full Git commit\n' >&2
  exit 1
fi

repository_root="$(dirname "$common_git_directory")"
reference_root="${repository_root}/.worktrees/parity-v2.9.0"

if [[ ! -e "$reference_root" ]]; then
  mkdir -p "$(dirname "$reference_root")"
  git -C "$candidate_root" worktree add --detach \
    "$reference_root" "$reference_sha"
fi

reference_head="$(git -C "$reference_root" rev-parse HEAD)"
if [[ "$reference_head" != "$required_reference_sha" ]]; then
  printf 'visual-parity: cached reference worktree is not at the required commit\n' >&2
  exit 1
fi
reference_status="$(git -C "$reference_root" status --porcelain)" || {
  reference_status_code="$?"
  printf 'visual-parity: could not inspect cached reference worktree status\n' >&2
  exit "$reference_status_code"
}
if [[ -n "$reference_status" ]]; then
  printf 'visual-parity: cached reference worktree is modified; inspect it without resetting or removing it\n' >&2
  exit 1
fi
if git -C "$reference_root" symbolic-ref -q HEAD >/dev/null 2>&1; then
  symbolic_ref_status=0
else
  symbolic_ref_status="$?"
fi
case "$symbolic_ref_status" in
  0)
    printf 'visual-parity: cached reference worktree is not detached; inspect it without resetting or removing it\n' >&2
    exit 1
    ;;
  1) ;;
  *)
    printf 'visual-parity: could not inspect whether cached reference is detached\n' >&2
    exit "$symbolic_ref_status"
    ;;
esac
if [[ ! -s "${reference_root}/docker-compose.yaml" ]]; then
  printf 'visual-parity: cached reference worktree is incomplete\n' >&2
  exit 1
fi

for port in "$reference_port" "$candidate_port"; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    printf 'visual-parity: port %s is already in use\n' "$port" >&2
    exit 1
  else
    lsof_status="$?"
    if [[ "$lsof_status" -ne 1 ]]; then
      printf 'visual-parity: could not inspect port %s safely\n' "$port" >&2
      exit 1
    fi
  fi
done

export LEGENDHUB_PARITY_STATE_DIR="$state_directory"
export LEGENDHUB_PARITY_FIXTURE="$fixture_file"
export LEGENDHUB_PARITY_NGINX_CONFIG="$nginx_config_file"
export LEGENDHUB_PARITY_SNAPSHOT="$snapshot_file"
export LEGENDHUB_PARITY_CERTIFICATE="$certificate_file"
export LEGENDHUB_PARITY_CERTIFICATE_KEY="$certificate_key_file"

validate_destructive_project() {
  local project_name="$1"

  case "$project_name" in
    legendhub-parity-reference|legendhub-parity-candidate) ;;
    *)
      printf 'visual-parity: refusing unsafe project name\n' >&2
      exit 1
      ;;
  esac
}

compose_for() {
  local project_name="$1"
  local checkout_root="$2"
  local https_port="$3"
  shift 3

  LEGENDHUB_PARITY_HTTPS_PORT="$https_port" docker compose \
    --project-directory "$checkout_root" \
    --project-name "$project_name" \
    --env-file "$environment_file" \
    -f "${checkout_root}/docker-compose.yaml" \
    "${parity_compose_arguments[@]}" \
    "$@"
}

print_shell_word() {
  printf '%q' "$1"
}

print_compose_command() {
  local project_name="$1"
  local checkout_root="$2"
  local https_port="$3"
  shift 3
  local word
  local -a command=(
    "LEGENDHUB_PARITY_HTTPS_PORT=${https_port}"
    "LEGENDHUB_PARITY_STATE_DIR=${state_directory}"
    "LEGENDHUB_PARITY_FIXTURE=${fixture_file}"
    "LEGENDHUB_PARITY_NGINX_CONFIG=${nginx_config_file}"
    docker compose
    --project-directory "$checkout_root"
    --project-name "$project_name"
    --env-file "$environment_file"
    -f "${checkout_root}/docker-compose.yaml"
    "${parity_compose_arguments[@]}"
    "$@"
  )

  print_shell_word "${command[0]}"
  for word in "${command[@]:1}"; do
    printf ' '
    print_shell_word "$word"
  done
  printf '\n'
}

print_cleanup_command() {
  local project_name="$1"
  local checkout_root="$2"
  local https_port="$3"

  validate_destructive_project "$project_name"
  print_compose_command "$project_name" "$checkout_root" "$https_port" \
    down --volumes --remove-orphans
}

has_stale_resources() {
  local project_name="$1"
  local containers
  local inspection_status
  local networks
  local volumes

  containers="$(docker ps --all --quiet --no-trunc \
    --filter "label=com.docker.compose.project=${project_name}")" || {
      inspection_status="$?"
      printf 'visual-parity: could not inspect containers for %s (status %s)\n' \
        "$project_name" "$inspection_status" >&2
      return 2
    }
  networks="$(docker network ls --quiet \
    --filter "label=com.docker.compose.project=${project_name}")" || {
      inspection_status="$?"
      printf 'visual-parity: could not inspect networks for %s (status %s)\n' \
        "$project_name" "$inspection_status" >&2
      return 2
    }
  volumes="$(docker volume ls --quiet \
    --filter "label=com.docker.compose.project=${project_name}")" || {
      inspection_status="$?"
      printf 'visual-parity: could not inspect volumes for %s (status %s)\n' \
        "$project_name" "$inspection_status" >&2
      return 2
    }
  [[ -n "$containers" || -n "$networks" || -n "$volumes" ]]
}

for project_spec in \
  "${reference_project}|${reference_root}|${reference_port}" \
  "${candidate_project}|${candidate_root}|${candidate_port}"; do
  project_name="${project_spec%%|*}"
  project_remainder="${project_spec#*|}"
  checkout_root="${project_remainder%%|*}"
  https_port="${project_remainder##*|}"
  if has_stale_resources "$project_name"; then
    stale_resource_status=0
  else
    stale_resource_status="$?"
  fi
  case "$stale_resource_status" in
    0)
      printf 'visual-parity: retained or stale Docker resources belong to %s\n' \
        "$project_name" >&2
      printf 'visual-parity: inspect them, then run exactly:\n' >&2
      print_cleanup_command "$project_name" "$checkout_root" "$https_port" >&2
      exit 1
      ;;
    1) ;;
    *) exit "$stale_resource_status" ;;
  esac
done

safe_down() {
  local project_name="$1"
  local checkout_root="$2"
  local https_port="$3"

  validate_destructive_project "$project_name"
  LEGENDHUB_PARITY_HTTPS_PORT="$https_port" docker compose \
    --project-directory "$checkout_root" \
    --project-name "$project_name" \
    --env-file "$environment_file" \
    -f "${checkout_root}/docker-compose.yaml" \
    "${parity_compose_arguments[@]}" \
    down --volumes --remove-orphans
}

cleanup_active=0

finish() {
  local status="$1"
  trap - EXIT INT TERM

  if [[ "$cleanup_active" -eq 1 ]]; then
    if [[ "$keep" -eq 1 ]]; then
      printf 'visual-parity: retained disposable stacks for inspection. Logs:\n' >&2
      print_compose_command "$reference_project" "$reference_root" \
        "$reference_port" logs --tail 100 mysql www nginx >&2
      print_compose_command "$candidate_project" "$candidate_root" \
        "$candidate_port" logs --tail 100 mysql www nginx >&2
      printf 'visual-parity: remove them with exactly:\n' >&2
      print_cleanup_command "$reference_project" "$reference_root" \
        "$reference_port" >&2
      print_cleanup_command "$candidate_project" "$candidate_root" \
        "$candidate_port" >&2
    else
      if ! safe_down "$reference_project" "$reference_root" "$reference_port"; then
        printf 'visual-parity: reference cleanup failed; run exactly:\n' >&2
        print_cleanup_command "$reference_project" "$reference_root" \
          "$reference_port" >&2
      fi
      if ! safe_down "$candidate_project" "$candidate_root" "$candidate_port"; then
        printf 'visual-parity: candidate cleanup failed; run exactly:\n' >&2
        print_cleanup_command "$candidate_project" "$candidate_root" \
          "$candidate_port" >&2
      fi
    fi
  fi

  exit "$status"
}

trap 'finish "$?"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

wait_until_ready() {
  local stack_name="$1"
  local project_name="$2"
  local checkout_root="$3"
  local https_port="$4"
  local url="$5"
  local attempt
  local -a curl_arguments=(--fail --silent --show-error --max-time 5)

  if [[ "$parity_platform" == "Darwin" ]]; then
    curl_arguments+=(--resolve "localhost:${https_port}:[::1]")
  fi

  for attempt in {1..30}; do
    if curl "${curl_arguments[@]}" "${url}/" \
      >/dev/null 2>&1; then
      if [[ "$parity_platform" == "Darwin" ]]; then
        printf 'visual-parity: verified trusted ::1 HTTPS readiness for %s\n' \
          "$stack_name"
      fi
      return 0
    fi
    sleep 1
  done

  printf 'visual-parity: %s readiness timed out for %s\n' \
    "$stack_name" "$project_name" >&2
  compose_for "$project_name" "$checkout_root" "$https_port" \
    ps mysql www nginx >&2 || true
  compose_for "$project_name" "$checkout_root" "$https_port" \
    logs --tail 100 mysql www nginx >&2 || true
  return 1
}

render_stack() {
  local stack_name="$1"
  local project_name="$2"
  local checkout_root="$3"
  local https_port="$4"
  local status

  compose_for "$project_name" "$checkout_root" "$https_port" \
    config --quiet || {
      status="$?"
      printf 'visual-parity: %s Compose render failed for %s\n' \
        "$stack_name" "$project_name" >&2
      return "$status"
    }
}

start_stack() {
  local stack_name="$1"
  local project_name="$2"
  local checkout_root="$3"
  local https_port="$4"
  local status

  compose_for "$project_name" "$checkout_root" "$https_port" \
    up --build -d mysql www nginx || {
      status="$?"
      printf 'visual-parity: %s startup failed for %s services mysql www nginx\n' \
        "$stack_name" "$project_name" >&2
      compose_for "$project_name" "$checkout_root" "$https_port" \
        ps mysql www nginx >&2 || true
      compose_for "$project_name" "$checkout_root" "$https_port" \
        logs --tail 100 mysql www nginx >&2 || true
      return "$status"
    }
}

cleanup_active=1

render_stack reference "$reference_project" "$reference_root" "$reference_port"
start_stack reference "$reference_project" "$reference_root" "$reference_port"
wait_until_ready reference "$reference_project" "$reference_root" \
  "$reference_port" "https://localhost:${reference_port}"

render_stack candidate "$candidate_project" "$candidate_root" "$candidate_port"
start_stack candidate "$candidate_project" "$candidate_root" "$candidate_port"
wait_until_ready candidate "$candidate_project" "$candidate_root" \
  "$candidate_port" "https://localhost:${candidate_port}"

candidate_short_sha="${candidate_sha:0:12}"
run_timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
report_directory="${candidate_root}/data/parity-report/${run_timestamp}-${candidate_short_sha}"
mkdir -p "$report_directory"

capture_arguments=(
  "--reference-base-url=https://localhost:${reference_port}"
  "--candidate-base-url=https://localhost:${candidate_port}"
  "--reference-sha=${reference_sha}"
  "--candidate-sha=${candidate_sha}"
  "--mode=${mode}"
  "--output-dir=${report_directory}"
)
if [[ "$fail_on_diff" -eq 1 ]]; then
  capture_arguments+=(--fail-on-diff)
fi

printf 'visual-parity: writing report to %s\n' "$report_directory"
npm --prefix "${candidate_root}/www" run parity:visual -- \
  "${capture_arguments[@]}"
