#!/usr/bin/env bash
# Create a sibling worktree for a branch and install its dependencies.
#
#   scripts/new-wt.sh <branch> [--from <ref>]
#
# Path: ../docsxai-wt-<slug>, where slug is the branch with "/" turned into "-".
# Start point: --from, else refs/remotes/origin/main (fetched first).
# Never symlinks node_modules: pnpm refuses it, so the worktree gets its own offline install.
set -euo pipefail

REPO="kalebteccom/docsxai"
DEFAULT_FROM="refs/remotes/origin/main"

die() {
  echo "new-wt: $*" >&2
  exit 1
}

usage() {
  echo "usage: scripts/new-wt.sh <branch> [--from <ref>]" >&2
  exit 2
}

branch=""
from="$DEFAULT_FROM"
while [ $# -gt 0 ]; do
  case "$1" in
    --from)
      [ $# -ge 2 ] || usage
      from="$2"
      shift 2
      ;;
    -h | --help) usage ;;
    -*) usage ;;
    *)
      [ -z "$branch" ] || usage
      branch="$1"
      shift
      ;;
  esac
done
[ -n "$branch" ] || usage

git rev-parse --show-toplevel >/dev/null 2>&1 || die "not inside a git repository"
top="$(git rev-parse --show-toplevel)"

remote_url="$(git -C "$top" remote get-url origin 2>/dev/null || true)"
case "$remote_url" in
  *github.com[:/]"$REPO" | *github.com[:/]"$REPO".git) ;;
  *) die "origin is '${remote_url:-unset}', expected $REPO; refusing to run in another repository" ;;
esac

git check-ref-format --branch "$branch" >/dev/null 2>&1 || die "'$branch' is not a valid branch name"

slug="$(printf '%s' "$branch" | tr '/' '-' | tr -c 'A-Za-z0-9._\n-' '-')"
path="$(dirname "$top")/docsxai-wt-$slug"

[ ! -e "$path" ] || die "path already exists: $path"
if git -C "$top" show-ref --verify --quiet "refs/heads/$branch"; then
  die "branch already exists: $branch"
fi

git -C "$top" fetch --quiet origin
git -C "$top" rev-parse --verify --quiet "$from^{commit}" >/dev/null || die "unknown start point: $from"

git -C "$top" worktree add -b "$branch" "$path" "$from"

if ! (cd "$path" && pnpm install --offline --frozen-lockfile --ignore-scripts); then
  echo "new-wt: worktree created, but the offline install failed (pnpm store or metadata cache incomplete)." >&2
  echo "$path"
  exit 3
fi

echo "$path"
