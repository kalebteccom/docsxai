#!/usr/bin/env bash
# Pack, verify and publish the six npm packages. Called by
# .github/workflows/release.yml; see RELEASING.md.
#
#   release-publish.sh dry-run   pack + verify + `npm publish --dry-run`.
#                                 Needs no credentials and mints no OIDC token.
#   release-publish.sh publish   pack + verify + real publish with provenance.
#                                 Tag pushes only (GITHUB_REF_TYPE=tag).
#
# Everything is packed and verified before the first publish call, so a bad
# tarball or a tag/version mismatch fails the run with nothing on the registry.
# A version already on npm is skipped, so a rerun after a partial publish
# finishes the remaining packages instead of failing with a 403.
set -euo pipefail

mode="${1:-}"
case "$mode" in
  dry-run | publish) ;;
  *)
    echo "usage: release-publish.sh dry-run|publish" >&2
    exit 2
    ;;
esac

# Dependencies before dependents: `docsxai` depends on engine + viewer.
packages=(
  @docsxai/engine
  @docsxai/viewer
  docsxai
  @docsxai/plugin
  @docsxai/skill
  @docsxai/backend
)

expected=""
tag=""
if [ "$mode" = "publish" ]; then
  if [ "${GITHUB_REF_TYPE:-}" != "tag" ]; then
    echo "publish mode runs on a tag ref only (GITHUB_REF_TYPE=${GITHUB_REF_TYPE:-unset})" >&2
    exit 1
  fi
  tag="${GITHUB_REF_NAME:?GITHUB_REF_NAME is required}"
  if ! [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
    echo "tag '$tag' is not vX.Y.Z[-prerelease]" >&2
    exit 1
  fi
  expected="${tag#v}"
fi

out="${RUNNER_TEMP:-$(mktemp -d)}/tarballs"
mkdir -p "$out"

tarballs=()
versions=()
for i in "${!packages[@]}"; do
  pkg="${packages[$i]}"
  dest="$out/$i"
  mkdir -p "$dest"
  echo "::group::pack ${pkg}"
  # `pnpm pack` rewrites workspace:* to the real version inside the tarball.
  pnpm --filter "${pkg}" pack --pack-destination "$dest"
  echo "::endgroup::"
  shopt -s nullglob
  found=("$dest"/*.tgz)
  shopt -u nullglob
  if [ "${#found[@]}" -ne 1 ]; then
    echo "expected exactly one tarball for ${pkg}, found ${#found[@]} in $dest" >&2
    exit 1
  fi
  t="${found[0]}"
  # Name and version come from the manifest inside the tarball, which is what
  # npm publishes. A leftover workspace: spec would break installs.
  meta="$(tar -xOzf "$t" package/package.json | node -e '
    const p = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
    if (JSON.stringify(p).includes("workspace:")) {
      console.error(p.name + ": tarball package.json still contains a workspace: spec");
      process.exit(2);
    }
    console.log(p.name + " " + p.version);
  ')"
  name="${meta% *}"
  version="${meta#* }"
  if [ "$name" != "$pkg" ]; then
    echo "tarball for ${pkg} contains package '${name}'" >&2
    exit 1
  fi
  # Tag push: every version must equal the tag. Dry run: all must agree.
  [ -n "$expected" ] || expected="$version"
  if [ "$version" != "$expected" ]; then
    echo "${pkg} is ${version}, expected ${expected}${tag:+ (tag ${tag})}" >&2
    exit 1
  fi
  tarballs+=("$t")
  versions+=("$version")
done

# A prerelease must not take the `latest` dist-tag (npm 11 refuses without --tag).
dist_tag=latest
case "$expected" in *-*) dist_tag=next ;; esac

# Returns 0 when name@version is on the registry, 1 when it is not. Any other
# registry failure aborts the run.
published() {
  local spec="$1" found rc=0 err
  err="$out/view.err"
  found="$(npm view "$spec" version 2>"$err")" || rc=$?
  if [ "$rc" -eq 0 ]; then
    [ -n "$found" ]
    return
  fi
  if grep -q 'E404' "$err"; then
    return 1
  fi
  cat "$err" >&2
  echo "npm view ${spec} failed; refusing to guess" >&2
  exit 1
}

flags=(--access public --tag "$dist_tag")
if [ "$mode" = "dry-run" ]; then
  flags+=(--dry-run)
else
  flags+=(--provenance)
fi

for i in "${!packages[@]}"; do
  pkg="${packages[$i]}"
  spec="${pkg}@${versions[$i]}"
  echo "::group::${mode} ${spec}"
  if published "$spec"; then
    echo "${spec} already on npm, skipping"
  else
    npm publish "${tarballs[$i]}" "${flags[@]}"
  fi
  echo "::endgroup::"
done
