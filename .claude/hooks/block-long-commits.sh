#!/bin/bash
# Block git commits whose subject line is longer than 72 characters.
# A body and trailers (Signed-off-by, Co-Authored-By or any other) are
# allowed; this hook never demands or forbids one. Merge commits are exempt.
#
# `git commit` counts only as a command word: text inside quotes (an echo, a
# commit message that mentions it) is not a commit.

MAX_SUBJECT_LENGTH=72

COMMAND=$(cat | jq -r '.tool_input.command // empty')

if [ -z "$COMMAND" ]; then
  exit 0
fi

# Drop quoted text, then look for `git commit` at the start of a command:
# start of input, after ; & | ( or a newline, past any VAR=value prefixes.
STRIPPED=$(printf '%s' "$COMMAND" | perl -0777 -pe 's/\x27[^\x27]*\x27|"(?:[^"\\]|\\.)*"//gs')
NL=$'\n'
COMMIT_RE="(^|[;&|(${NL}])[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*git[[:space:]]+commit([[:space:]]|\$)"
if ! [[ "$STRIPPED" =~ $COMMIT_RE ]]; then
  exit 0
fi

# Concluding a merge: git writes its own message.
MERGE_HEAD_PATH=$(git rev-parse --git-path MERGE_HEAD 2>/dev/null)
if [ -n "$MERGE_HEAD_PATH" ] && [ -f "$MERGE_HEAD_PATH" ]; then
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
# line), so the first one is the subject.
for SEP in '" -m "' "\" -m '" "' -m \"" "' -m '"; do
  MSG="${MSG//"$SEP"/$'\n\n'}"
done

# Step 3: strip heredoc markers if present (cat <<'EOF' ... EOF)
MSG=$(echo "$MSG" | grep -v '^\$(cat <<' | grep -v '^EOF$' | grep -v '^)[[:space:]]*$')

if [ -z "$MSG" ]; then
  exit 0
fi

SUBJECT=$(echo "$MSG" | head -1)
SUBJECT_LEN=${#SUBJECT}

# A subject that starts with "Merge " is a merge commit.
case "$SUBJECT" in
  "Merge "*) exit 0 ;;
esac

if [ "$SUBJECT_LEN" -gt "$MAX_SUBJECT_LENGTH" ]; then
  REASON="BLOCKED: Subject line is ${SUBJECT_LEN} chars (max ${MAX_SUBJECT_LENGTH}). Shorten the subject; a body after a blank line is allowed."
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
