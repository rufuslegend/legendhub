#!/usr/bin/env bash
set -euo pipefail

[[ $# -eq 0 ]] || {
  printf 'Usage: %s\n' "$0" >&2
  exit 1
}

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="${LEGENDHUB_REPO_ROOT:-$script_dir/..}"
repo_root="$(cd "$repo_root" && pwd -P)"

cd "$repo_root"
git_root="$(cd "$(git rev-parse --show-toplevel)" && pwd -P)"
[[ "$repo_root" == "$git_root" ]] || {
  printf 'Refusing to tag: repository root %s is not Git top-level %s\n' "$repo_root" "$git_root" >&2
  exit 1
}

version="$(node "$script_dir/verify-release-version.js" "$repo_root")"
tag="v$version"

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
