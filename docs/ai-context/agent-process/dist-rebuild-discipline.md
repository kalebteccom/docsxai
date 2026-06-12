# dist-rebuild discipline — the stale-CLI trap

`docsxai` runs the compiled `packages/engine/dist/cli.js`. **Source changes are NOT live until `pnpm -r build`.** A stale `dist/` that predates a runtime change can crash the CLI at startup or, worse, silently run old behavior against new tests.

The same trap applies to the Claude Code plugin (`packages/plugin/`), the skill bundle (`packages/skill/`), the backend (`packages/backend/`), and the viewer (`packages/viewer/`) — each is independently compiled.

## The trap

1. Edit source in any package.
2. Believe the change is live because `pnpm test` (which uses Vitest against source) passes.
3. The installed `docsxai` bin (or the plugin daemon, or a long-running viewer process) still holds the _old_ `dist/` import graph in memory.
4. Spend an hour debugging a "bug" that's actually stale compiled code.

## The discipline

- After any source change, `pnpm -r build` regenerates `dist/` across every package.
- **Every package build cleans first.** Each package's `build` script runs `node ../../scripts/clean-dist.mjs` before `tsc -b`, removing `dist/` _and_ `tsconfig.build.tsbuildinfo` together. This guarantees `dist/` never carries stale files — compiled outputs of since-deleted sources, or `.map` files from an older config — which would otherwise ship in the published tarball (`"files": ["dist"]`). The two must be removed together: `tsc -b` trusts its `.tsbuildinfo` over the real `dist/` contents, so deleting `dist/` alone makes the next build skip emit. Don't "optimize" the clean step away for incremental speed; `scripts/audit-package-contents.mjs` is the gate that catches the leak class.
- A running plugin daemon — the Claude Code plugin host, or a long-running `docsxai` process — does **not** pick up the rebuild. Node's `import()` is one-shot at boot. Any `dist/` rebuild after the daemon started means the running daemon is executing stale code.
- **Restart the daemon and surface the new PID explicitly to the operator** before declaring the change verified. Don't assume "I rebuilt" means "the running session sees it."
- The same applies to a globally-installed `docsxai` bin from a tarball — `pnpm -r build` updates the workspace `dist/`, not the global install. After a global-bin-relevant change, re-link or re-install.

## The wrapper-script consequence

The README's Option A install (`$HOME/.local/bin/docsxai` wrapper) `exec`s `node "${REPO}/packages/engine/dist/cli.js"`. The wrapper reads the path at invocation time, so a `pnpm -r build` is immediately visible to the next `docsxai` invocation — _but_ only because each invocation is a fresh process. Long-running invocations (a `docsxai run --watch` mode that lands later, the plugin daemon) hold the old import graph.

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
