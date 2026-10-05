#!/bin/bash
# Validate the AI attribution trailer on git commit commands.
#
# Policy: an AI-assisted commit carries exactly one trailer,
#   Co-Authored-By: <Claude model name> <noreply@anthropic.com>
# Commits without AI help carry no trailer; this hook never demands one.
# Any other Co-Authored-By line (another email, another AI, a second
# trailer) is denied. "Generated with ..." credit lines are not trailers;
# block-long-commits.sh rejects them as body text.

COMMAND=$(cat | jq -r '.tool_input.command // empty')

if [ -z "$COMMAND" ]; then
  exit 0
fi

# Only inspect git commit commands
if ! echo "$COMMAND" | grep -qi 'git commit'; then
  exit 0
fi

# Each Co-Authored-By occurrence, up to the end of its line or the closing
# quote of a -m argument. Works for heredocs, multi -m and --trailer forms.
TRAILERS=$(printf '%s\n' "$COMMAND" | grep -ioE "co-authored-by:[^\"']*")

if [ -z "$TRAILERS" ]; then
  exit 0
fi

VALID_RE='^co-authored-by: Claude( [A-Za-z0-9.()+-]+)* <noreply@anthropic\.com>$'
COUNT=0
BAD=0
while IFS= read -r line; do
  line="${line%"${line##*[![:space:]]}"}"
  COUNT=$((COUNT + 1))
  if ! printf '%s\n' "$line" | grep -qiE "$VALID_RE"; then
    BAD=$((BAD + 1))
  fi
done <<EOT
$TRAILERS
EOT

ERRORS=""
if [ "$BAD" -gt 0 ]; then
  ERRORS="Co-Authored-By trailer must read 'Co-Authored-By: <Claude model name> <noreply@anthropic.com>'."
fi
if [ "$COUNT" -gt 1 ]; then
  ERRORS="${ERRORS:+$ERRORS }Found ${COUNT} Co-Authored-By trailers; use exactly one."
fi

if [ -n "$ERRORS" ]; then
  jq -n --arg reason "BLOCKED: ${ERRORS}" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }'
else
  exit 0
fi
