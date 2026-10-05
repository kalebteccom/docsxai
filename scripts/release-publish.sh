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
cd "$(dirname "${BASH_SOURCE[0]}")/.."

mode="${1:-}"
case "$mode" in
  dry-run | publish) ;;
  *)
    echo "usage: release-publish.sh dry-run|publish" >&2
    exit 2
    ;;
esac

# Dependencies before dependents: `docsxai` depends on engine + viewer.
# plugin, skill and backend do not depend on the engine at install time, so
# their position after those three is arbitrary.
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
  # npm_config_ignore_scripts keeps prepack/prepare from running with the OIDC
  # token in scope (pnpm 9 rejects a `pack --ignore-scripts` flag but honours
  # the env var). The tarballs ship the dist/ built by the preceding build step.
  # Packed from the package directory: pnpm 9 rejects `--filter ... pack`
  # ("Unknown option: 'recursive'").
  (cd "packages/${pkg#@docsxai/}" && npm_config_ignore_scripts=true pnpm pack --pack-destination "$dest")
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

# Returns 0 when name@version is on the registry, 1 when it is not. Anything
# else (network failure, auth error, unparseable output) aborts the run.
published() {
  local spec="$1" version="$2" body rc=0 verdict
  body="$(npm view "$spec" version --json 2>"$out/view.err")" || rc=$?
  verdict="$(printf '%s' "$body" | node -e '
    const [rc, version] = process.argv.slice(1);
    const raw = require("node:fs").readFileSync(0, "utf8").trim();
    let out;
    try {
      out = JSON.parse(raw);
    } catch {
      out = undefined;
    }
    if (out && typeof out === "object" && !Array.isArray(out) && out.error) {
      console.log(out.error.code === "E404" ? "absent" : "error");
    } else if (rc === "0" && out === version) {
      console.log("present");
    } else {
      console.log("error");
    }
  ' "$rc" "$version")"
  case "$verdict" in
    present) return 0 ;;
    absent) return 1 ;;
  esac
  cat "$out/view.err" >&2
  printf '%s\n' "$body" >&2
  echo "npm view ${spec} gave an unexpected answer; refusing to guess" >&2
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
  if published "$spec" "${versions[$i]}"; then
    echo "${spec} already on npm, skipping"
  else
    npm publish "${tarballs[$i]}" "${flags[@]}"
  fi
  echo "::endgroup::"
done
