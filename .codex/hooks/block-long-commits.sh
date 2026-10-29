#!/usr/bin/env bash
# Block generated git commit commands with non-semantic or long-subject messages.
# A body and trailers are allowed; this hook never demands or forbids one.
# Merge commits are exempt. `git commit` counts only as a command word.

set -euo pipefail

max_subject_length=72
conventional_subject_pattern='^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\([a-z0-9][a-z0-9._/-]*\))?!?: .+'
payload="$(cat)"
command="$(
  printf '%s' "$payload" \
    | jq -r '.tool_input.command // .command // empty' 2>/dev/null \
    || true
)"
# Drop quoted text (newlines inside it too), then look for `git commit` at the
# start of a command: start of input, after ; & | ( or a newline, past any
# VAR=value prefixes.
command_without_quoted_text="$(
  printf '%s' "$command" \
    | perl -0777 -pe 's/\x27[^\x27]*\x27|"(?:[^"\\]|\\.)*"//gs'
)"
nl=$'\n'
commit_command_pattern="(^|[;&|(${nl}])[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*git[[:space:]]+commit([[:space:]]|\$)"

if [[ -z "$command" || ! "$command_without_quoted_text" =~ $commit_command_pattern ]]; then
  exit 0
fi

# Concluding a merge: git writes its own message.
merge_head_path="$(git rev-parse --git-path MERGE_HEAD 2>/dev/null || true)"
if [[ -n "$merge_head_path" && -f "$merge_head_path" ]]; then
  exit 0
fi

# Collect every -m / --message= value. Several values are paragraphs: git joins
# them with a blank line, so the first one is the subject.
remaining=" ${command//--message=/ -m }"
message=""
found_message=0
while [[ "$remaining" == *" -m "* ]]; do
  remaining="${remaining#* -m }"
  quote="${remaining:0:1}"
  if [[ "$quote" == "\"" || "$quote" == "'" ]]; then
    value="${remaining:1}"
    value="${value%%"$quote"*}"
    remaining="${remaining:$(( ${#value} + 2 ))}"
  else
    value="${remaining%% *}"
    remaining="${remaining:${#value}}"
  fi
  # Strip heredoc scaffolding: -m "$(cat <<'EOF' ... EOF )"
  value="$(printf '%s\n' "$value" | { grep -v '^\$(cat <<' || true; } | { grep -v '^EOF$' || true; } | { grep -v '^)[[:space:]]*$' || true; })"
  if (( found_message )); then
    message+=$'\n\n'
  fi
  message+="$value"
  found_message=1
done

errors=()
if (( ! found_message )); then
  if [[ "$command" =~ --no-edit ]]; then
    exit 0
  fi
  errors+=("commit message is not visible to the hook; use -m/--message")
fi

subject="$(printf '%s\n' "$message" | sed -n '1p')"
subject_length="${#subject}"

# A subject that starts with "Merge " is a merge commit.
if [[ "$subject" == "Merge "* ]]; then
  exit 0
fi

if (( subject_length > max_subject_length )); then
  errors+=("subject is ${subject_length} characters; max is ${max_subject_length}")
fi
if [[ -n "$subject" && ! "$subject" =~ $conventional_subject_pattern ]]; then
  errors+=("subject must use Conventional Commits, e.g. fix(api): handle token refresh")
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
