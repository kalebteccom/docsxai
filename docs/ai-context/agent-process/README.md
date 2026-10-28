# Agent-process discipline

Cross-cutting working rules for every diff in this repo.

- [`code-quality.md`](code-quality.md): the quality gate, SOLID applied to docsxai's TypeScript, comments discipline, no-tracker-IDs rule.
- [`commit-discipline.md`](commit-discipline.md): single-line conventional subjects ≤72 chars, trailers-only body (AI `Co-Authored-By`, DCO `Signed-off-by`); cycle-per-commit cadence.
- [`dist-rebuild-discipline.md`](dist-rebuild-discipline.md): the `dist/cli.js` trap and the plugin-daemon restart discipline; the local verify gate before push.
- [`validation-agent-repo-write-policy.md`](validation-agent-repo-write-policy.md): agents validating docsxai as consumers never write into the tool repos; findings go to the consumer workspace as written requests.

## Local pre-checks

Two contributor scripts keep cheap CI failures off the gate. Neither builds anything or runs a full suite.

- `scripts/new-wt.sh <branch> [--from <ref>]` fetches, then creates `../docsxai-wt-<slug>` from `refs/remotes/origin/main` (or `--from`) and runs `pnpm install --offline --frozen-lockfile --ignore-scripts` in it. It refuses a clone whose `origin` is not `kalebteccom/docsxai`, and an existing path or branch. It never symlinks `node_modules`. If the offline install fails, the worktree stays, the path is printed and the exit code is 3.
- `node scripts/pre-gate.mjs [--base refs/remotes/origin/main]` checks the files changed since the base, plus uncommitted and untracked files. One line per check, then `PASS` or `FAIL`, exit 1 on any failure:
  - `prettier --check` on supported files.
  - `eslint --no-warn-ignored` on changed `.ts`, `.mjs` and `.js` files.
  - `tsc --noEmit -p` per touched `packages/*` directory, only when its `node_modules` exists and its workspace dependencies have a `dist`. Otherwise it prints the `pnpm install` hint or names the unbuilt dependency and skips.
  - Single-file tests: changed `packages/*/test` files through `vitest run`, changed `scripts/*.test.mjs` and, when anything under `website/` changed, every `website/scripts/check-*.test.mjs` through `node --test`.
  - The dash guard, `scripts/no-dash-repo.test.mjs`, which owns the allowlist. It reads tracked files, so stage a new file to have it checked.

Known gap: while `packages/*/dist` is missing, `no-unnecessary-type-assertion`, `no-redundant-type-constituents` and `restrict-template-expressions` give false positives. Hits on those three are listed as unverified locally and do not fail. CI decides. The website typecheck needs generated Astro types and is left to CI.

The repo-root [`AGENTS.md`](../../../AGENTS.md) is the rule base. These files unpack the _why_ behind the rules and give worked examples.
