#!/usr/bin/env bash
set -euo pipefail

umask 077

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
state_dir="${LEGENDHUB_LOCAL_STATE_DIR:-${repo_root}/data/local-stack}"
backup_dir="${state_dir}/backups"
tls_dir="${state_dir}/tls"
snapshot_target="${backup_dir}/dunwich-latest.sql.gz"
environment_file="${state_dir}/local.env"
certificate_file="${tls_dir}/localhost.pem"
key_file="${tls_dir}/localhost-key.pem"

if [[ "$#" -gt 1 ]]; then
  printf 'Usage: %s [dunwich-snapshot.sql.gz]\n' "$0" >&2
  exit 64
fi

for command in gzip mkcert openssl; do
  if ! command -v "$command" >/dev/null 2>&1; then
    printf 'prepare-local-stack: required command is missing: %s\n' \
      "$command" >&2
    exit 1
  fi
done

mkdir -p "$backup_dir" "$tls_dir"
chmod 700 "$state_dir" "$backup_dir" "$tls_dir"

if [[ "$#" -eq 1 ]]; then
  snapshot_source="$1"
  if [[ ! -f "$snapshot_source" || ! -s "$snapshot_source" ]]; then
    printf 'prepare-local-stack: snapshot is missing or empty\n' >&2
    exit 1
  fi
  if ! gzip -t "$snapshot_source"; then
    printf 'prepare-local-stack: snapshot is not a valid gzip file\n' >&2
    exit 1
  fi

  source_directory="$(cd "$(dirname "$snapshot_source")" && pwd -P)"
  source_path="${source_directory}/$(basename "$snapshot_source")"
  target_directory="$(cd "$backup_dir" && pwd -P)"
  target_path="${target_directory}/$(basename "$snapshot_target")"
  if [[ "$source_path" != "$target_path" ]]; then
    snapshot_temporary="$(mktemp "${backup_dir}/.dunwich-latest.sql.gz.XXXXXX")"
    cp "$snapshot_source" "$snapshot_temporary"
    chmod 600 "$snapshot_temporary"
    mv -f "$snapshot_temporary" "$snapshot_target"
  fi
fi

if [[ ! -f "$snapshot_target" || ! -s "$snapshot_target" ]]; then
  printf 'prepare-local-stack: provide a Dunwich snapshot on first setup\n' >&2
  exit 1
fi
gzip -t "$snapshot_target"
chmod 600 "$snapshot_target"

if [[ ! -f "$environment_file" ]]; then
  root_password="$(openssl rand -hex 24)"
  app_password="$(openssl rand -hex 24)"
  environment_temporary="$(mktemp "${state_dir}/.local.env.XXXXXX")"
  {
    printf 'COMPOSE_PROJECT_NAME=legendhub-local\n'
    printf 'NODE_ENV=production\n'
    printf 'PORT=80\n'
    printf 'EXTERNAL_PORT=127.0.0.1:7002\n'
    printf 'MYSQL_PORT=3306\n'
    printf 'MYSQL_ROOT_PASSWORD=%s\n' "$root_password"
    printf 'MYSQL_USER=legendhub\n'
    printf 'MYSQL_PASSWORD=%s\n' "$app_password"
    printf 'MYSQL_DATABASE=legendhub\n'
    printf 'LEGENDHUB_LOCAL_STATE_DIR=%s\n' "$state_dir"
    printf 'GITHUB_TOKEN=\n'
    printf 'GITHUB_REPOSITORY=rufuslegend/legendhub\n'
    printf 'RECAPTCHA_SITEKEY=\n'
    printf 'RECAPTCHA_SECRET=\n'
  } > "$environment_temporary"
  chmod 600 "$environment_temporary"
  mv "$environment_temporary" "$environment_file"
fi
chmod 600 "$environment_file"

if [[ ! -f "$certificate_file" || ! -f "$key_file" ]]; then
  certificate_temporary="$(mktemp "${tls_dir}/.localhost.pem.XXXXXX")"
  key_temporary="$(mktemp "${tls_dir}/.localhost-key.pem.XXXXXX")"
  rm -f "$certificate_temporary" "$key_temporary"
  cleanup_tls() {
    rm -f "$certificate_temporary" "$key_temporary"
  }
  trap cleanup_tls EXIT
  mkcert -cert-file "$certificate_temporary" -key-file "$key_temporary" \
    localhost 127.0.0.1 ::1 >/dev/null
  chmod 600 "$certificate_temporary" "$key_temporary"
  mv -f "$certificate_temporary" "$certificate_file"
  mv -f "$key_temporary" "$key_file"
  trap - EXIT
fi
chmod 600 "$certificate_file" "$key_file"

printf 'Local Compose state prepared at %s\n' "$state_dir"
