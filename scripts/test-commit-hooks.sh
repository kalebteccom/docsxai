#!/usr/bin/env bash
# Exercises the commit-message hooks with sample messages and prints a matrix.
#
#   .claude/hooks/block-ai-attribution.sh + block-long-commits.sh   (Claude Code PreToolUse)
#   .codex/hooks/block-ai-attribution.sh  + block-long-commits.sh   (Codex PreToolUse)
#   .githooks/commit-msg                                            (git commit-msg)
#
# Each case is run through every hook in three command shapes (one quoted -m,
# a heredoc, one -m per paragraph) plus the commit-msg file. Exit 1 on any
# mismatch. Run: bash scripts/test-commit-hooks.sh

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
command -v jq >/dev/null || { echo "jq is required" >&2; exit 2; }

AI='Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>'
SIGN='Signed-off-by: Jane Dev <jane@example.com>'
SUBJ='feat(engine): add thing'
LONG_SUBJ="feat(engine): $(printf 'x%.0s' $(seq 1 70))"

pass=0
fail=0
rows=()

# deny <harness> <command>: prints "deny" or "allow".
verdict_claude() {
  local json out
  json="$(jq -n --arg c "$1" '{tool_input:{command:$c}}')"
  out="$(printf '%s' "$json" | "$ROOT/.claude/hooks/block-ai-attribution.sh"; printf '%s' "$json" | "$ROOT/.claude/hooks/block-long-commits.sh")"
  [[ "$out" == *'"deny"'* ]] && echo deny || echo allow
}
verdict_codex() {
  local json out
  json="$(jq -n --arg c "$1" '{tool_input:{command:$c}}')"
  out="$(printf '%s' "$json" | "$ROOT/.codex/hooks/block-ai-attribution.sh"; printf '%s' "$json" | "$ROOT/.codex/hooks/block-long-commits.sh")"
  [[ "$out" == *'"deny"'* ]] && echo deny || echo allow
}
verdict_githook() {
  local f rc
  f="$(mktemp)"
  printf '%s\n' "$1" >"$f"
  "$ROOT/.githooks/commit-msg" "$f" >/dev/null 2>&1 && rc=allow || rc=deny
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

run_case 'valid trailer'                  allow "$SUBJ" "$AI"
run_case 'no trailer (human commit)'      allow "$SUBJ"
run_case 'trailer + Signed-off-by'        allow "$SUBJ" "$AI"$'\n'"$SIGN"
run_case 'Signed-off-by only'             allow "$SUBJ" "$SIGN"
run_case 'Signed-off-by + trailer'        allow "$SUBJ" "$SIGN"$'\n'"$AI"
run_case 'trailer, lowercase key'         allow "$SUBJ" 'Co-authored-by: Claude Opus 4.1 <noreply@anthropic.com>'
run_case 'prose body'                     deny  "$SUBJ" 'This explains why I did it.'
run_case 'prose body + trailer'           deny  "$SUBJ" 'This explains why.'$'\n'"$AI"
run_case 'bullet body'                    deny  "$SUBJ" '- one'$'\n''- two'
run_case 'long subject'                   deny  "$LONG_SUBJ"
run_case 'long subject + trailer'         deny  "$LONG_SUBJ" "$AI"
run_case 'wrong email'                    deny  "$SUBJ" 'Co-Authored-By: Claude Sonnet 5.5 <claude@example.com>'
run_case 'non-Claude AI trailer'          deny  "$SUBJ" 'Co-Authored-By: GPT-5 <noreply@openai.com>'
run_case 'human co-author'                deny  "$SUBJ" 'Co-Authored-By: Jane Dev <jane@example.com>'
run_case 'two AI trailers'                deny  "$SUBJ" "$AI"$'\n'"$AI"
run_case 'Generated with line in commit'  deny  "$SUBJ" 'Generated with [Claude Code](https://claude.com/claude-code)'
run_case 'trailer + Generated with'       deny  "$SUBJ" "$AI"$'\n''Generated with [Claude Code](https://claude.com/claude-code)'
raw_case 'no blank line before trailer'   deny  "$SUBJ"$'\n'"$AI" \
  "git commit -m \"$SUBJ"$'\n'"$AI\"" \
  "git commit -m \"\$(cat <<'EOF'"$'\n'"$SUBJ"$'\n'"$AI"$'\n'"EOF"$'\n'")\""

# Commands that are not commits, or that carry the PR line, stay allowed.
other_ok=allow
for cmd in 'git status' 'gh pr create --title "x" --body "Generated with [Claude Code](https://claude.com/claude-code)"'; do
  [[ "$(verdict_claude "$cmd")" == allow && "$(verdict_codex "$cmd")" == allow ]] || other_ok=deny
done
check 'non-commit commands' allow "$other_ok"
rows+=("$(printf '%-34s %-7s all hooks=%s' 'non-commit / PR body line' allow "$other_ok")")

printf '%s\n' "${rows[@]}"
echo "passed=$pass failed=$fail"
[[ "$fail" -eq 0 ]]
