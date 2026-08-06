#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd "$script_dir/.." && pwd -P)"
cd "$repo_root"

repositories=(
  "tmckimmey/legendhub-www"
  "tmckimmey/legendhub-python"
  "tmckimmey/legendhub-mysql-backup"
)
contexts=("." "python" "mysql")
dockerfiles=("www/Dockerfile" "" "")

sha="$(git rev-parse --short=12 HEAD)"
[[ "$sha" =~ ^[a-f0-9]{12}$ ]] || {
  printf 'Invalid Git SHA: %s\n' "$sha" >&2
  exit 1
}

dirty="$(git status --porcelain=v1 --untracked-files=all -- .dockerignore CHANGELOG.md www python mysql)"
[[ -z "$dirty" ]] || {
  printf 'Refusing to publish dirty image inputs:\n%s\n' "$dirty" >&2
  exit 1
}

docker buildx version >/dev/null
docker buildx inspect --bootstrap >/dev/null

inspect_image() {
  local ref="$1"
  local output

  if output="$(docker buildx imagetools inspect --format '{{json .}}' "$ref" 2>&1)"; then
    printf '%s\n' "$output"
    return 0
  fi

  if [[ "$output" == "ERROR: $ref: not found" \
    || "$output" == "ERROR: docker.io/$ref: not found" ]]; then
    return 2
  fi

  printf 'Unable to inspect image %s:\n%s\n' "$ref" "$output" >&2
  return 1
}

verify_image() {
  node "$script_dir/verify-image-platform.js"
}

sha_digests=()
for index in "${!repositories[@]}"; do
  repository="${repositories[$index]}"
  context="${contexts[$index]}"
  ref="$repository:$sha"

  if inspection="$(inspect_image "$ref")"; then
    printf 'Reusing inspected %s\n' "$ref"
  else
    inspect_status=$?
    if [[ "$inspect_status" -eq 2 ]]; then
      dockerfile_args=()
      if [[ -n "${dockerfiles[$index]}" ]]; then
        dockerfile_args=(--file "${dockerfiles[$index]}")
      fi
      docker buildx build \
        --platform linux/amd64 \
        --push \
        --tag "$ref" \
        ${dockerfile_args[@]+"${dockerfile_args[@]}"} \
        "$context"
      inspection="$(inspect_image "$ref")"
    else
      exit "$inspect_status"
    fi
  fi

  sha_digests[$index]="$(printf '%s\n' "$inspection" | verify_image)"
done

for index in "${!repositories[@]}"; do
  repository="${repositories[$index]}"
  sha_ref="$repository:$sha"
  test_ref="$repository:test"

  docker buildx imagetools create \
    --prefer-index=false \
    --tag "$test_ref" \
    "$sha_ref"

  test_inspection="$(inspect_image "$test_ref")"
  test_digest="$(printf '%s\n' "$test_inspection" | verify_image)"
  [[ "$test_digest" == "${sha_digests[$index]}" ]] || {
    printf 'Digest mismatch: %s != %s\n' "$test_ref" "$sha_ref" >&2
    exit 1
  }

  printf '%s %s %s\n' "$repository" "$sha" "$test_digest"
done
