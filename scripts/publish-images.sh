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
contexts=("www" "python" "mysql")

sha="$(git rev-parse --short=12 HEAD)"
[[ "$sha" =~ ^[a-f0-9]{12}$ ]] || {
  printf 'Invalid Git SHA: %s\n' "$sha" >&2
  exit 1
}

dirty="$(git status --porcelain=v1 --untracked-files=all -- www python mysql)"
[[ -z "$dirty" ]] || {
  printf 'Refusing to publish dirty image inputs:\n%s\n' "$dirty" >&2
  exit 1
}

docker buildx version >/dev/null
docker buildx inspect --bootstrap >/dev/null

verify_image() {
  local ref="$1"
  docker buildx imagetools inspect --format '{{json .}}' "$ref" \
    | node "$script_dir/verify-image-platform.js"
}

sha_digests=()
for index in "${!repositories[@]}"; do
  repository="${repositories[$index]}"
  context="${contexts[$index]}"
  ref="$repository:$sha"

  if verify_image "$ref" >/dev/null 2>&1; then
    printf 'Reusing verified %s\n' "$ref"
  else
    docker buildx build \
      --platform linux/amd64 \
      --push \
      --tag "$ref" \
      "$context"
  fi

  sha_digests[$index]="$(verify_image "$ref")"
done

for index in "${!repositories[@]}"; do
  repository="${repositories[$index]}"
  sha_ref="$repository:$sha"
  test_ref="$repository:test"

  docker buildx imagetools create \
    --prefer-index=false \
    --tag "$test_ref" \
    "$sha_ref"

  test_digest="$(verify_image "$test_ref")"
  [[ "$test_digest" == "${sha_digests[$index]}" ]] || {
    printf 'Digest mismatch: %s != %s\n' "$test_ref" "$sha_ref" >&2
    exit 1
  }

  printf '%s %s %s\n' "$repository" "$sha" "$test_digest"
done
