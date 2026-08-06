#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="${LEGENDHUB_REPO_ROOT:-$(cd "$script_dir/.." && pwd -P)}"
version="$(node "$script_dir/verify-release-version.js" "$repo_root")"
tag="v$version"

cd "$repo_root"
dirty="$(git status --porcelain=v1 --untracked-files=all)"
[[ -z "$dirty" ]] || {
  printf 'Refusing to tag dirty release inputs:\n%s\n' "$dirty" >&2
  exit 1
}

if git show-ref --verify --quiet "refs/tags/$tag"; then
  printf 'Release tag already exists: %s\n' "$tag" >&2
  exit 1
fi

git tag -a "$tag" -m "LegendHUB $version"
printf '%s %s\n' "$tag" "$(git rev-parse HEAD)"
