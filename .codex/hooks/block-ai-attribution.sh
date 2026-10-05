#!/usr/bin/env bash
# Validate the AI attribution trailer on git commit commands.
#
# Policy: an AI-assisted commit carries exactly one trailer,
#   Co-Authored-By: <Claude model name> <noreply@anthropic.com>
# Commits without AI help carry no trailer; this hook never demands one.
# Any other Co-Authored-By line (another email, another AI, a second
# trailer) is denied. "Generated with ..." credit lines are not trailers;
# block-long-commits.sh rejects them as body text.

set -euo pipefail

payload="$(cat)"
command="$(
  printf '%s' "$payload" \
    | jq -r '.tool_input.command // .command // empty' 2>/dev/null \
    || true
)"

if [[ -z "$command" || ! "$command" =~ git[[:space:]]+commit ]]; then
  exit 0
fi

# Each Co-Authored-By occurrence, up to the end of its line or the closing
# quote of a -m argument. Works for heredocs, multi -m and --trailer forms.
trailers="$(printf '%s\n' "$command" | { grep -ioE "co-authored-by:[^\"']*" || true; })"

if [[ -z "$trailers" ]]; then
  exit 0
fi

valid_re='^co-authored-by: Claude( [A-Za-z0-9.()+-]+)* <noreply@anthropic\.com>$'
count=0
bad=0
while IFS= read -r line; do
  line="${line%"${line##*[![:space:]]}"}"
  count=$((count + 1))
  if ! printf '%s\n' "$line" | grep -qiE "$valid_re"; then
    bad=$((bad + 1))
  fi
done <<<"$trailers"

errors=()
if (( bad > 0 )); then
  errors+=("Co-Authored-By trailer must read 'Co-Authored-By: <Claude model name> <noreply@anthropic.com>'")
fi
if (( count > 1 )); then
  errors+=("found ${count} Co-Authored-By trailers; use exactly one")
fi

if (( ${#errors[@]} > 0 )); then
  reason="BLOCKED: $(IFS='; '; echo "${errors[*]}")."
  jq -n --arg reason "$reason" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }'
fi
