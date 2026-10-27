#!/usr/bin/env bash
# Exercises the commit-message hooks with sample messages and prints a matrix.
#
#   .claude/hooks/block-long-commits.sh   (Claude Code PreToolUse)
#   .codex/hooks/block-long-commits.sh    (Codex PreToolUse)
#   .githooks/commit-msg                  (git commit-msg)
#
# Each case is run through every hook in three command shapes (one quoted -m,
# a heredoc, one -m per paragraph) plus the commit-msg file. The hooks never
# demand or forbid a trailer or an attribution line; a subject over 72
# characters (or, for Codex and commit-msg, a non-conventional one) is refused.
# Hooks run from a scratch repo so a merge in progress here cannot skew the
# result. Exit 1 on any mismatch. Run: bash scripts/test-commit-hooks.sh

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
command -v jq >/dev/null || { echo "jq is required" >&2; exit 2; }
command -v perl >/dev/null || { echo "perl is required" >&2; exit 2; }

# Scratch repos: CLEAN has no merge in progress, MERGING has MERGE_HEAD.
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
CLEAN="$WORK/clean"
MERGING="$WORK/merging"
for r in "$CLEAN" "$MERGING"; do
  git init -q "$r" || { echo "git init failed" >&2; exit 2; }
done
printf '0000000000000000000000000000000000000000\n' >"$MERGING/.git/MERGE_HEAD"

AI='Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>'
SIGN='Signed-off-by: Jane Dev <jane@example.com>'
SUBJ='feat(engine): add thing'
LONG_SUBJ="feat(engine): $(printf 'x%.0s' $(seq 1 70))"
MAX_SUBJ="feat(engine): $(printf 'x%.0s' $(seq 1 58))"
MERGE_SUBJ="Merge branch 'feature/$(printf 'x%.0s' $(seq 1 80))' into main"

pass=0
fail=0
rows=()

# verdict_* <command> [repo]: prints "deny" or "allow".
verdict_claude() {
  local json out
  json="$(jq -n --arg c "$1" '{tool_input:{command:$c}}')"
  out="$(cd "${2:-$CLEAN}" && printf '%s' "$json" | "$ROOT/.claude/hooks/block-long-commits.sh")"
  [[ "$out" == *'"deny"'* ]] && echo deny || echo allow
}
verdict_codex() {
  local json out
  json="$(jq -n --arg c "$1" '{tool_input:{command:$c}}')"
  out="$(cd "${2:-$CLEAN}" && printf '%s' "$json" | "$ROOT/.codex/hooks/block-long-commits.sh")"
  [[ "$out" == *'"deny"'* ]] && echo deny || echo allow
}
verdict_githook() {
  local f rc
  f="$(mktemp)"
  printf '%s\n' "$1" >"$f"
  (cd "${2:-$CLEAN}" && "$ROOT/.githooks/commit-msg" "$f" >/dev/null 2>&1) && rc=allow || rc=deny
  rm -f "$f"
  echo "$rc"
}

check() { # <label> <expect> <got>
  if [[ "$2" == "$3" ]]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    echo "MISMATCH  $1: expected $2, got $3" >&2
  fi
}

# all_hooks <label> <expect> <repo> <command>...: every command-line hook must
# return <expect> for every command.
all_hooks() {
  local label="$1" expect="$2" repo="$3" got="$2" cmd
  shift 3
  for cmd in "$@"; do
    if [[ "$(verdict_claude "$cmd" "$repo")" != "$expect" || "$(verdict_codex "$cmd" "$repo")" != "$expect" ]]; then
      echo "MISMATCH  $label: ${cmd:0:60}" >&2
      got=wrong
    fi
  done
  check "$label" "$expect" "$got"
  rows+=("$(printf '%-34s %-7s all hooks=%s' "$label" "$expect" "$got")")
}

# run_case <name> <expect> <paragraph>...  (paragraphs are joined by a blank line)
run_case() {
  local name="$1" expect="$2"
  shift 2
  local msg="" multi="" p
  for p in "$@"; do
    msg+="${msg:+$'\n\n'}$p"
    multi+=" -m \"$p\""
  done
  local quoted="git commit -m \"$msg\""
  local heredoc="git commit -m \"\$(cat <<'EOF'"$'\n'"$msg"$'\n'"EOF"$'\n'")\""
  raw_case "$name" "$expect" "$msg" "$quoted" "$heredoc" "git commit$multi"
}

# raw_case <name> <expect> <message> <command>...
raw_case() {
  local name="$1" expect="$2" msg="$3"
  shift 3
  local cmd c x g
  local cl=allow cx=allow
  for cmd in "$@"; do
    c="$(verdict_claude "$cmd")"
    x="$(verdict_codex "$cmd")"
    check "$name [claude] ${cmd:0:40}" "$expect" "$c"
    check "$name [codex] ${cmd:0:40}" "$expect" "$x"
    [[ "$c" == deny ]] && cl=deny
    [[ "$x" == deny ]] && cx=deny
  done
  g="$(verdict_githook "$msg")"
  check "$name [commit-msg]" "$expect" "$g"
  rows+=("$(printf '%-34s %-7s claude=%-5s codex=%-5s commit-msg=%-5s' "$name" "$expect" "$cl" "$cx" "$g")")
}

run_case 'AI trailer'                     allow "$SUBJ" "$AI"
run_case 'no trailer'                     allow "$SUBJ"
run_case 'trailer + Signed-off-by'        allow "$SUBJ" "$AI"$'\n'"$SIGN"
run_case 'Signed-off-by only'             allow "$SUBJ" "$SIGN"
run_case 'trailer, lowercase key'         allow "$SUBJ" 'Co-authored-by: Claude Opus 4.1 <noreply@anthropic.com>'
run_case 'human co-author trailer'        allow "$SUBJ" 'Co-Authored-By: Jane Dev <jane@example.com>'
run_case 'non-Claude AI trailer'          allow "$SUBJ" 'Co-Authored-By: GPT-5 <noreply@openai.com>'
run_case 'two AI trailers'                allow "$SUBJ" "$AI"$'\n'"$AI"
run_case 'Generated with line'            allow "$SUBJ" 'Generated with [Claude Code](https://claude.com/claude-code)'
run_case 'prose body'                     allow "$SUBJ" 'This explains why I did it.'
run_case 'prose body + trailer'           allow "$SUBJ" 'This explains why.'$'\n'"$AI"
run_case 'bullet body'                    allow "$SUBJ" '- one'$'\n''- two'
run_case 'long subject'                   deny  "$LONG_SUBJ"
run_case 'long subject + body'            deny  "$LONG_SUBJ" 'Some body text.'
run_case 'long subject + trailer'         deny  "$LONG_SUBJ" "$AI"
run_case 'subject of exactly 72'          allow "$MAX_SUBJ"
run_case 'subject of 73'                  deny  "${MAX_SUBJ}x"
raw_case 'body, no blank line'            allow "$SUBJ"$'\n'"Some body." \
  "git commit -m \"$SUBJ"$'\n'"Some body.\"" \
  "git commit -m \"\$(cat <<'EOF'"$'\n'"$SUBJ"$'\n'"Some body."$'\n'"EOF"$'\n'")\""

# `git commit` counts only as a command word. Quoted text that mentions it is
# not a commit, so even an over-long "subject" inside it passes.
all_hooks 'quoted git commit not matched' allow "$CLEAN" \
  "echo \"git commit -m $LONG_SUBJ\"" \
  "echo 'git commit -m \"$LONG_SUBJ\"'" \
  'echo "git commit -m x"' \
  "printf '%s' \"first line"$'\n'"; git commit -m $LONG_SUBJ\""

# Real commits are still seen after ; && and a newline, and after VAR=value.
all_hooks 'chained git commit matched' deny "$CLEAN" \
  "git add . && git commit -m \"$LONG_SUBJ\"" \
  "git add .; git commit -m \"$LONG_SUBJ\"" \
  "git add ."$'\n'"git commit -m \"$LONG_SUBJ\"" \
  "GIT_AUTHOR_NAME=x git commit -m \"$LONG_SUBJ\""

# Merge commits: MERGE_HEAD present, or a subject starting "Merge ".
all_hooks 'merge in progress (MERGE_HEAD)' allow "$MERGING" \
  "git commit -m \"$SUBJ\"" \
  "git commit -m \"$LONG_SUBJ\"" \
  'git commit --no-edit' \
  'git commit'
check 'MERGE_HEAD [commit-msg]' allow "$(verdict_githook "$LONG_SUBJ" "$MERGING")"

all_hooks 'subject starting "Merge "' allow "$CLEAN" \
  "git commit -m \"Merge branch 'a' into main\"" \
  "git commit -m \"$MERGE_SUBJ\""
check 'Merge subject [commit-msg]' allow "$(verdict_githook "$MERGE_SUBJ")"

# Non-commit commands and PR bodies stay allowed.
all_hooks 'non-commit / PR body line' allow "$CLEAN" \
  'git status' \
  'gh pr create --title "x" --body "Generated with [Claude Code](https://claude.com/claude-code)"'

printf '%s\n' "${rows[@]}"
echo "passed=$pass failed=$fail"
[[ "$fail" -eq 0 ]]
