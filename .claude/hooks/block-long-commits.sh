#!/bin/bash
# Block git commits with subject lines that are too long or messages that
# carry a body. The only body allowed is a trailer block: Co-Authored-By
# (content validated by block-ai-attribution.sh) and Signed-off-by (DCO),
# separated from the subject by one blank line. Keeps commit messages short
# and single-purpose.

MAX_SUBJECT_LENGTH=72

COMMAND=$(cat | jq -r '.tool_input.command // empty')

if [ -z "$COMMAND" ]; then
  exit 0
fi

# Only inspect git commit commands
if ! echo "$COMMAND" | grep -qi 'git commit'; then
  exit 0
fi

# Extract the commit message using bash parameter expansion (multiline-safe).
# Step 1: strip everything up to -m "
AFTER_M="${COMMAND#*-m \"}"
if [ "$AFTER_M" = "$COMMAND" ]; then
  AFTER_M="${COMMAND#*-m \'}"
fi
# Step 2: strip trailing quote and anything after it
MSG="${AFTER_M%\"*}"
if [ "$MSG" = "$AFTER_M" ]; then
  MSG="${AFTER_M%\'*}"
fi

# Step 2b: several -m arguments are paragraphs (git joins them with a blank
# line), so `-m "subject" -m "Co-Authored-By: ..."` reads as subject + trailer.
for SEP in '" -m "' "\" -m '" "' -m \"" "' -m '"; do
  MSG="${MSG//"$SEP"/$'\n\n'}"
done

# Step 3: strip heredoc markers if present (cat <<'EOF' ... EOF)
MSG=$(echo "$MSG" | grep -v '^\$(cat <<' | grep -v '^EOF$' | grep -v '^)[[:space:]]*$')

if [ -z "$MSG" ]; then
  exit 0
fi

# Subject is the first line; everything after it is the body.
SUBJECT=$(echo "$MSG" | head -1)
SUBJECT_LEN=${#SUBJECT}
BODY=$(echo "$MSG" | tail -n +2)
SECOND_LINE=$(echo "$MSG" | sed -n 2p)
TRAILER_RE='^(Co-Authored-By|Signed-off-by): .+ <[^<>]+>[[:space:]]*$'
# Non-blank body lines that are not a Co-Authored-By / Signed-off-by trailer.
NON_TRAILER_COUNT=$(echo "$BODY" | grep -v '^[[:space:]]*$' | grep -vciE "$TRAILER_RE")

ERRORS=""

if [ "$SUBJECT_LEN" -gt "$MAX_SUBJECT_LENGTH" ]; then
  ERRORS="Subject line is ${SUBJECT_LEN} chars (max ${MAX_SUBJECT_LENGTH})."
fi

if [ "$NON_TRAILER_COUNT" -gt 0 ]; then
  if [ -n "$ERRORS" ]; then
    ERRORS="${ERRORS} "
  fi
  ERRORS="${ERRORS}Message body has ${NON_TRAILER_COUNT} line(s) that are not a Co-Authored-By or Signed-off-by trailer."
elif [ -n "${BODY//[[:space:]]/}" ] && [ -n "${SECOND_LINE//[[:space:]]/}" ]; then
  if [ -n "$ERRORS" ]; then
    ERRORS="${ERRORS} "
  fi
  ERRORS="${ERRORS}Separate the trailer from the subject with a blank line."
fi

if [ -n "$ERRORS" ]; then
  REASON="BLOCKED: ${ERRORS} Write a single-line subject (max ${MAX_SUBJECT_LENGTH} chars), optionally followed by a blank line and a Co-Authored-By / Signed-off-by trailer. No prose body, no bullet points."
  jq -n --arg reason "$REASON" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }'
else
  exit 0
fi
