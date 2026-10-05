#!/usr/bin/env bash
# Block generated git commit commands with non-semantic, long, or prose-body messages.
# The only body allowed is a trailer block: Co-Authored-By (content validated by
# block-ai-attribution.sh) and Signed-off-by (DCO), after one blank line.

set -euo pipefail

max_subject_length=72
conventional_subject_pattern='^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\([a-z0-9][a-z0-9._/-]*\))?!?: .+'
trailer_pattern='^(Co-Authored-By|Signed-off-by): .+ <[^<>]+>[[:space:]]*$'
payload="$(cat)"
command="$(
  printf '%s' "$payload" \
    | jq -r '.tool_input.command // .command // empty' 2>/dev/null \
    || true
)"
command_without_quoted_text="$(
  printf '%s' "$command" \
    | sed -E "s/'[^']*'//g; s/\"([^\"\\]|\\.)*\"//g"
)"

if [[ -z "$command" || ! "$command_without_quoted_text" =~ (^[[:space:]]*|[;&|][[:space:]]*)git[[:space:]]+commit([[:space:]]|$) ]]; then
  exit 0
fi

# Collect every -m / --message= value. Several values are paragraphs: git joins
# them with a blank line, so `-m "subject" -m "Co-Authored-By: ..."` is valid.
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
body="$(printf '%s\n' "$message" | tail -n +2)"
second_line="$(printf '%s\n' "$message" | sed -n '2p')"
subject_length="${#subject}"
non_trailer_count="$(
  printf '%s\n' "$body" \
    | { grep -v '^[[:space:]]*$' || true; } \
    | { grep -vciE "$trailer_pattern" || true; }
)"

if (( subject_length > max_subject_length )); then
  errors+=("subject is ${subject_length} characters; max is ${max_subject_length}")
fi
if [[ -n "$subject" && ! "$subject" =~ $conventional_subject_pattern ]]; then
  errors+=("subject must use Conventional Commits, e.g. fix(api): handle token refresh")
fi
if (( non_trailer_count > 0 )); then
  errors+=("message body has ${non_trailer_count} line(s) that are not a Co-Authored-By or Signed-off-by trailer")
elif [[ -n "${body//[[:space:]]/}" && -n "${second_line//[[:space:]]/}" ]]; then
  errors+=("separate the trailer from the subject with a blank line")
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
