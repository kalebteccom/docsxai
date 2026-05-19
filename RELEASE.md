# Release process — go-public checklist

> **Status: prepared, deferred.** Everything below is *ready*. The actual public release is deferred to **≥ Phase 3** by owner decision (2026-05-19) — the repo stays **private** and unpublished until the full project (through Phase 3) is done. This file is the mechanical checklist for *when* that decision is taken; nothing here is to be executed before then.

The repo is intentionally in a "one-flip-from-public" state: Apache-2.0 in place, READMEs/CONTRIBUTING/CHANGELOG written, npm metadata (`repository`/`homepage`/`bugs`/`keywords`) on every package, git history scrubbed of client identifiers (2026-05-15), versions set to `0.1.0`, and every `package.json` carries `"private": true` so an accidental `npm publish` is impossible until deliberately flipped.

## Why deferred

Owner decision (2026-05-19): hold the public release until the whole project is done (at least Phase 3). Site-docs is Apache-2.0-from-day-one per its spec — there's no licensing gate — but going public commits to a stable public API + semver obligations + external-contributor surface. The owner prefers to land that once, after Phase 3, rather than maintain a public API through Phase-2 churn (GitHub App, engine-side Confluence push, standalone MCP server, additional feature areas).

## The flip (Phase-3, in order)

Each step is mechanical because the prep is done:

1. **Pre-flight.** `pnpm install && pnpm -r typecheck && pnpm -r test && pnpm -r build` — all green. `git log -p | grep -iE "<client>|<product>|<asset>"` — zero (the 2026-05-15 scrub holds; re-audit any docs added since).
2. **Un-private the publishable packages.** Set `"private": false` in `packages/{engine,plugin,backend,viewer,skill}/package.json` (keep root `private: true` — it's the monorepo wrapper, never published). Decide which packages are actually published vs internal-only.
3. **Finalise the CHANGELOG.** Move the `[0.1.0] — UNRELEASED` heading to `[0.1.0] — <date>`; add the compare link.
4. **Tag.** `git tag -a v0.1.0 -m "site-docs 0.1.0"` then `git push origin v0.1.0`.
5. **Publish.** `pnpm -r publish --access public` (or per-package, in dependency order: engine → viewer → backend → skill → plugin). Verify each on npm.
6. **Repo visibility.** Flip the GitHub repo `kalebteccom/automated-site-documentation-bot` to public. Confirm the README renders, the LICENSE is detected, CONTRIBUTING is linked.
7. **Announce / portfolio.** Update the portfolio `roadmap.md` Phase-3 entry + decisions log; flip the portfolio README row.

## Do NOT, before the Phase-3 decision

- Do not `npm publish` (the `private:true` flags block it anyway — leave them).
- Do not flip the GitHub repo to public.
- Do not cut the `v0.1.0` git tag (a tag implies a release; we're prepared, not released).
- Do not remove the `"private": true` flags as "cleanup" — they are the deliberate safety.

Anything that needs to happen *before* the flip (more docs, API stabilisation, security review) gets done here in the private repo first.
