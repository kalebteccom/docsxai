#!/bin/sh
# lint -> run (page by page) -> burn -> pack.
# Needs the demo target up on 127.0.0.1:3100 and DOCSXAI=<docsxai checkout>.
# DOCSXAI_VIEWER=<path to viewer dist/index.js> burns with another viewer build.
# Usage: scripts/pipeline.sh [out-dir]   (default out-dir: .screens)
set -e
W=$(cd "$(dirname "$0")/.." && pwd)
D=${DOCSXAI:?set DOCSXAI to the docsxai checkout}
DOCSXAI_CLI="node $D/packages/engine/dist/cli.js"
LOG=$(mktemp)
SEGMENTS=$(mktemp)
trap 'rm -f "$LOG" "$SEGMENTS"' EXIT
RETRIES=0

$DOCSXAI_CLI lint "$W"
$DOCSXAI_CLI capture-auth "$W" --headless >/dev/null

# The dev server's error badge shows on about one load in ten and the no-dev-overlay guard halts
# the run. The obstacle scan gives up after 2 s on a slow load and leaves the annotation without
# obstacles, which would break byte-identical output. A halted run writes nothing, so each page is
# its own run (--start-from/--stop-after, merged by step id) and a retry repeats one page.
run_segment() { # flow first-step last-step
  attempt=1
  while :; do
    ok=0
    $DOCSXAI_CLI run "$W" --flow "$1" --start-from "$2" --stop-after "$3" >"$LOG" 2>&1 && ok=1
    if [ "$ok" = 1 ] && ! grep -q "obstacle scan skipped" "$LOG"; then
      return 0
    fi
    grep -v "^run: .* annotation(s)" "$LOG" | head -3 >&2
    [ "$attempt" -ge 8 ] && { echo "pipeline: $1 $2 failed after $attempt attempts" >&2; exit 1; }
    echo "pipeline: retry $1 $2 (attempt $attempt failed)" >&2
    RETRIES=$((RETRIES + 1))
    attempt=$((attempt + 1))
  done
}

for flowfile in "$W"/flows/*.flow.yaml; do
  flow=$(basename "$flowfile" .flow.yaml)
  rm -rf "$W/docs/$flow/halts" "$W/docs/$flow/screenshots" "$W/docs/$flow/burned"
  rm -f "$W/docs/$flow/annotations.json"
  node "$W/scripts/flow-segments.mjs" "$flow" >"$SEGMENTS"
  while read -r first last; do
    run_segment "$flow" "$first" "$last"
  done <"$SEGMENTS"
  rm -rf "$W/docs/$flow/halts"
  echo "run: $flow done"
done

node "${DOCSXAI_VIEWER:-$D/packages/viewer/dist/index.js}" burn "$W"
node "$W/scripts/build-screens.mjs" "${1:-$W/.screens}"
echo "pipeline: $RETRIES retried attempt(s)"
