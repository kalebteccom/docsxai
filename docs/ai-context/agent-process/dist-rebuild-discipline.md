# dist-rebuild discipline — the stale-CLI trap

`site-docs` runs the compiled `packages/engine/dist/cli.js`. **Source changes are NOT live until `pnpm -r build`.** A stale `dist/` that predates a runtime change can crash the CLI at startup or, worse, silently run old behavior against new tests.

The same trap applies to the Claude Code plugin (`packages/plugin/`), the skill bundle (`packages/skill/`), the backend (`packages/backend/`), and the viewer (`packages/viewer/`) — each is independently compiled.

## The trap

1. Edit source in any package.
2. Believe the change is live because `pnpm test` (which uses Vitest against source) passes.
3. The installed `site-docs` bin (or the plugin daemon, or a long-running viewer process) still holds the _old_ `dist/` import graph in memory.
4. Spend an hour debugging a "bug" that's actually stale compiled code.

## The discipline

- After any source change, `pnpm -r build` regenerates `dist/` across every package.
- A running plugin daemon — the Claude Code plugin host, or a long-running `site-docs` process — does **not** pick up the rebuild. Node's `import()` is one-shot at boot. Any `dist/` rebuild after the daemon started means the running daemon is executing stale code.
- **Restart the daemon and surface the new PID explicitly to the operator** before declaring the change verified. Don't assume "I rebuilt" means "the running session sees it."
- The same applies to a globally-installed `site-docs` bin from a tarball — `pnpm -r build` updates the workspace `dist/`, not the global install. After a global-bin-relevant change, re-link or re-install.

## The wrapper-script consequence

The README's Option A install (`$HOME/.local/bin/site-docs` wrapper) `exec`s `node "${REPO}/packages/engine/dist/cli.js"`. The wrapper reads the path at invocation time, so a `pnpm -r build` is immediately visible to the next `site-docs` invocation — _but_ only because each invocation is a fresh process. Long-running invocations (a `site-docs run --watch` mode that lands later, the plugin daemon) hold the old import graph.

## CI quality gate

Before pushing:

```
pnpm typecheck && pnpm test && pnpm lint && pnpm format:check && pnpm build
```

All exit 0. CI runs the same gate. A CI failure on push is a self-inflicted wound — verify locally first. Never push and hope CI catches it.

The keystone test runs inside `pnpm test` and requires Chromium. If CI has Chromium installed and your local environment doesn't, that's a real gap — install it locally (`pnpm -C packages/engine exec playwright-core install chromium`) and re-run the gate.

## Related

- [`code-quality.md`](code-quality.md) — full quality gate contract.
- [`commit-discipline.md`](commit-discipline.md) — cycle boundaries.
- [`../testing/qa-patterns.md`](../testing/qa-patterns.md) — what the keystone test guards.
