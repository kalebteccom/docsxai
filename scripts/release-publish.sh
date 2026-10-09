#!/usr/bin/env bash
# Pack, verify and publish the six npm packages. Called by
# .woodpecker/release.yaml and .github/workflows/release.yml; see RELEASING.md.
#
#   release-publish.sh dry-run   pack + verify + `npm publish --dry-run`.
#                                 Needs no credentials.
#   release-publish.sh publish   pack + verify + publish. Needs a release tag.
#
# Environment:
#   RELEASE_TAG            the vX.Y.Z[-pre] tag to release. Falls back to
#                          GITHUB_REF_NAME on a GitHub tag push.
#   RELEASE_REQUIRE_TAG=1  dry-run fails without a tag too (Woodpecker).
#   RELEASE_PUBLISH_MODE   direct (default on every runner): `npm publish`,
#                          with --provenance on GitHub Actions only.
#                          stage: `npm stage publish`, a maintainer approves
#                          each stage with 2FA. Inactive: no pipeline sets it.
#   NODE_AUTH_TOKEN        the npm token, off GitHub Actions only. Never printed.
#
# With a tag, the checked-out commit must be the tag's commit and every package
# version must equal the tag. Everything is packed and verified before the
# first publish call, so a bad tarball or a mismatch fails the run with nothing
# on the registry. A version already on npm is skipped, so a rerun after a
# partial publish finishes the remaining packages instead of failing with a 403.
# An auth, token or permission error from npm stops the run at once.
set -euo pipefail
set +x
cd "$(dirname "${BASH_SOURCE[0]}")/.."

fail() {
  echo "release-publish: $1" >&2
  exit 1
}

mode="${1:-}"
case "$mode" in
  dry-run | publish) ;;
  *)
    echo "usage: release-publish.sh dry-run|publish" >&2
    exit 2
    ;;
esac

on_github=false
[ "${GITHUB_ACTIONS:-}" = "true" ] && on_github=true

publish_mode="${RELEASE_PUBLISH_MODE:-direct}"
case "$publish_mode" in
  stage | direct) ;;
  *) fail "RELEASE_PUBLISH_MODE must be stage or direct, got '${publish_mode}'" ;;
esac

# 0 when version $1 >= $2, comparing X.Y.Z and ignoring any prerelease suffix.
version_at_least() {
  node -e '
    const [have, want] = process.argv.slice(1).map((v) =>
      v.trim().replace(/^v/, "").split("-")[0].split(".").map(Number),
    );
    for (let i = 0; i < 3; i++) {
      if (have[i] !== want[i]) process.exit(have[i] > want[i] ? 0 : 1);
    }
  ' "$1" "$2"
}

# `npm stage` needs npm >= 11.15.0 on Node >= 22.14.0.
if [ "$publish_mode" = "stage" ]; then
  npm_version="$(npm --version)"
  node_version="$(node --version)"
  version_at_least "$npm_version" 11.15.0 ||
    fail "stage mode needs npm >= 11.15.0 for \`npm stage publish\`, found npm ${npm_version}"
  version_at_least "$node_version" 22.14.0 ||
    fail "stage mode needs Node >= 22.14.0, found ${node_version}"
fi

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

# The publish set is exactly these six. This check catches drift between the
# list above and this literal; the backstop against a seventh package is code
# review of a change to both.
allowed="@docsxai/backend @docsxai/engine @docsxai/plugin @docsxai/skill @docsxai/viewer docsxai"
actual="$(printf '%s\n' "${packages[@]}" | LC_ALL=C sort | tr '\n' ' ')"
[ "${actual% }" = "$allowed" ] ||
  fail "package list is '${actual% }', expected exactly '${allowed}'"

expected=""
tag="${RELEASE_TAG:-}"
if [ -z "$tag" ] && [ "$mode" = "publish" ] && [ "${GITHUB_REF_TYPE:-}" = "tag" ]; then
  tag="${GITHUB_REF_NAME:-}"
fi
if [ -z "$tag" ] && { [ "$mode" = "publish" ] || [ "${RELEASE_REQUIRE_TAG:-}" = "1" ]; }; then
  fail "${mode} needs RELEASE_TAG or a GitHub tag push (GITHUB_REF_TYPE=${GITHUB_REF_TYPE:-unset})"
fi
if [ -n "$tag" ]; then
  if ! [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
    fail "tag '${tag}' is not vX.Y.Z[-prerelease]"
  fi
  # The tag on the remote is the authority; a stale or missing local tag is replaced.
  git fetch --quiet --no-tags origin "+refs/tags/${tag}:refs/tags/${tag}" ||
    fail "could not fetch tag ${tag} from origin"
  tag_commit="$(git rev-parse --verify --quiet "refs/tags/${tag}^{commit}")" ||
    fail "tag ${tag} does not point at a commit"
  head_commit="$(git rev-parse --verify HEAD)"
  if [ "$tag_commit" != "$head_commit" ]; then
    fail "HEAD is ${head_commit} but ${tag} is ${tag_commit}; run the release on the tagged commit"
  fi
  echo "release tag ${tag} is HEAD (${head_commit})"
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
  # npm_config_ignore_scripts keeps prepack/prepare from running with a
  # credential in scope (pnpm 9 rejects a `pack --ignore-scripts` flag but honours
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
  # With a tag every version must equal it; without one, all must agree.
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

# npm error codes and text that mean the token or its permissions are wrong.
auth_error_re='E401|E403|ENEEDAUTH|EOTP|two-factor'

auth_stop() {
  fail "npm reported an auth error ($1): token or permission problem: stop and tell the owner. Nothing further was published."
}

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
  if grep -Eiq "$auth_error_re" "$out/view.err" ||
    printf '%s' "$body" | grep -Eiq "$auth_error_re"; then
    auth_stop "npm view ${spec}"
  fi
  echo "npm view ${spec} gave an unexpected answer; refusing to guess" >&2
  exit 1
}

flags=(--access public --tag "$dist_tag")
publish_cmd=(npm publish)
if [ "$mode" = "dry-run" ]; then
  flags+=(--dry-run)
elif [ "$publish_mode" = "stage" ]; then
  publish_cmd=(npm stage publish)
elif $on_github; then
  # Provenance needs a GitHub or GitLab OIDC identity; no other runner has one.
  flags+=(--provenance)
fi

# Off GitHub Actions the token comes from NODE_AUTH_TOKEN. The user config
# written here holds the variable name, which npm expands when it reads the
# file, so the token is never written to disk. It lives outside the workspace
# and is removed on exit.
if [ "$mode" = "publish" ] && ! $on_github; then
  [ -n "${NODE_AUTH_TOKEN:-}" ] ||
    fail "NODE_AUTH_TOKEN is empty; the npm_publish_token secret did not reach this step"
  npmrc_dir="$(mktemp -d)"
  trap 'rm -rf "$npmrc_dir"' EXIT
  # shellcheck disable=SC2016 # literal ${NODE_AUTH_TOKEN}, expanded by npm
  printf '%s\n' '//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}' >"$npmrc_dir/npmrc"
  chmod 600 "$npmrc_dir/npmrc"
  export NPM_CONFIG_USERCONFIG="$npmrc_dir/npmrc"
  # npm writes a debug log on failure; keep it at notice level and inside the
  # directory removed on exit, so no verbose request header can reach a
  # persistent path.
  export NPM_CONFIG_LOGLEVEL=notice
  export NPM_CONFIG_LOGS_DIR="$npmrc_dir/npm-logs"
  mkdir -p "$NPM_CONFIG_LOGS_DIR"
fi

staged=()
for i in "${!packages[@]}"; do
  pkg="${packages[$i]}"
  spec="${pkg}@${versions[$i]}"
  echo "::group::${mode} ${spec}"
  if published "$spec" "${versions[$i]}"; then
    echo "${spec} already on npm, skipping"
  else
    # Output goes to the log and to a file that is checked for auth errors.
    # npm never prints the token.
    rc=0
    publish_log="$out/publish.$i.log"
    (umask 077 && : >"$publish_log")
    "${publish_cmd[@]}" "${tarballs[$i]}" "${flags[@]}" 2>&1 | tee "$publish_log" || rc=$?
    if [ "$rc" -ne 0 ]; then
      if grep -Eiq "$auth_error_re" "$publish_log"; then
        auth_stop "${publish_cmd[*]} ${spec}"
      fi
      fail "${publish_cmd[*]} ${spec} failed (exit ${rc}); nothing after it was published"
    fi
    if [ "$mode" = "publish" ] && [ "$publish_mode" = "stage" ]; then
      staged+=("$pkg")
      echo "staged ${spec} (dist-tag ${dist_tag})"
    elif [ "$mode" = "publish" ]; then
      echo "published ${spec} (dist-tag ${dist_tag})"
    fi
  fi
  echo "::endgroup::"
done

if [ "${#staged[@]}" -gt 0 ]; then
  echo
  echo "Staged, not live. The stage ids are in the npm output above and in npm stage list."
  for pkg in "${staged[@]}"; do
    npm stage list "$pkg" || echo "npm stage list ${pkg} failed; list it from a maintainer machine"
  done
  echo "Approve each from a machine with your 2FA: npm stage approve <stage-id> --otp <code>"
  echo "Or drop it: npm stage reject <stage-id>"
fi
