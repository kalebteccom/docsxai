#!/bin/sh
# Secret scan over the commits a push brings in. Run by the secret-scan step of
# .woodpecker/ci.yaml inside the trufflehog image (POSIX sh, git and trufflehog only).
#
# Range: CI_PREV_COMMIT_SHA..CI_COMMIT_SHA. When the previous SHA is empty, all
# zeros (a new branch), not fetchable or not an ancestor (a force push), the range
# is merge-base(origin/main, HEAD)..HEAD. Exits 2 when neither range can be
# computed, so a broken checkout never passes as a clean scan. trufflehog exits
# non-zero (183) on a verified or unknown finding.
set -eu

# The workspace belongs to another uid than this container's; let git read it.
# Set through the environment so it also reaches the git that trufflehog runs.
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.directory GIT_CONFIG_VALUE_0='*'

die() {
  echo "secret-scan: $1" >&2
  exit 2
}

is_commit() { git cat-file -e "$1^{commit}" 2>/dev/null; }

head="${CI_COMMIT_SHA:-}"
[ -n "$head" ] || head="$(git rev-parse HEAD 2>/dev/null)" || die "no HEAD commit"
is_commit "$head" || die "commit $head is not in the checkout"

if [ "$(git rev-parse --is-shallow-repository)" = "true" ]; then
  git fetch --quiet --no-tags --unshallow origin || die "cannot unshallow the clone"
fi

base=""
prev="${CI_PREV_COMMIT_SHA:-}"
if [ -n "$prev" ] && [ -n "$(printf %s "$prev" | tr -d 0)" ]; then
  is_commit "$prev" || git fetch --quiet --no-tags origin -- "$prev" 2>/dev/null || true
  if is_commit "$prev" && git merge-base --is-ancestor "$prev" "$head"; then
    base="$prev"
  fi
fi

if [ -z "$base" ]; then
  git fetch --quiet --no-tags origin "+refs/heads/main:refs/remotes/origin/main" ||
    die "no usable CI_PREV_COMMIT_SHA and cannot fetch origin/main"
  base="$(git merge-base refs/remotes/origin/main "$head")" ||
    die "no merge base between origin/main and $head"
fi

count="$(git rev-list --count "$base..$head")"
echo "secret-scan: scanning $base..$head ($count commits)"
if [ "$count" -eq 0 ]; then
  echo "secret-scan: range is empty (a re-run of an already scanned commit); nothing new to scan"
  exit 0
fi
# trufflehog clones the repository it scans. The CI checkout can be a filtered
# clone with missing trees, which a local clone cannot serve ("bad tree object"),
# so scan a fresh full clone instead. Fails closed when it cannot be made.
url="${CI_REPO_CLONE_URL:-}"
[ -n "$url" ] || die "CI_REPO_CLONE_URL is not set; cannot make a full clone to scan"
scan_dir="$(mktemp -d)"
git clone --quiet --no-tags "$url" "$scan_dir/repo" || die "cannot clone $url for the scan"
cd "$scan_dir/repo"
is_commit "$head" || git fetch --quiet --no-tags origin "$head" || die "commit $head is not on origin"
is_commit "$base" || die "base $base is not in the fresh clone"
exec trufflehog git "file://$scan_dir/repo" \
  --since-commit="$base" \
  --branch="$head" \
  --results=verified,unknown \
  --fail \
  --no-update
