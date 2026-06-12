# MCP tool registry — adding a tool to `@kalebtec/docsxai-mcp`

The registry pattern is deliberate: **one tool = one file** under `packages/mcp/src/tools/`, and
the registry is **composed only in `packages/mcp/src/server.ts`**. Nothing else registers tools;
no tool imports another tool. This keeps every tool independently testable and the server's
surface auditable in one screen.

Before adding anything, check the boundary: docsxai-mcp is **calibration meta-orchestration +
read-only doc-pack introspection only**. Browser primitives (click/fill/inspect on a live page)
belong to browxai, not here. If the tool you want drives a live page, stop — it's out of scope
for this server.

## The add-a-tool checklist

1. **Zod schema first.** Define the input shape as a `z.ZodRawShape` (plain object of zod types,
   not a `z.object(…)`) — the SDK derives the JSON schema from it. Every workspace-scoped tool
   takes `workspace: z.string().optional()` so the bin's `--workspace` default applies. Add
   `.describe(…)` to every field; that text is what the host agent sees.
2. **One-file handler.** Create `packages/mcp/src/tools/<kebab-name>.ts` exporting a single
   `defineTool({ name, title, description, inputSchema, handler })`. The tool name is
   `snake_case`; the file is `kebab-case`. Wrap engine functions — never re-implement engine
   behaviour, and never import a tool from another tool. Results follow the convention:
   `ok({ … })` on success, `fail(error, hint?)` on failure. Domain errors return `fail(…)`;
   only programmer errors throw (the server wrapper still converts them to `{ok:false}`).
3. **Compose in `src/server.ts` only.** Import the definition and append it to
   `TOOL_DEFINITIONS`. That array is the single source of truth for the surface; the server
   asserts name uniqueness at startup.
4. **Unit test the arg validation + error paths.** Add a `describe` block to
   `packages/mcp/test/tools-unit.test.ts`: schema rejections (missing/invalid args) and every
   `fail(…)` branch, asserting the `{ok:false, error, hint}` shape. The uniform
   no-workspace test picks the new tool up automatically — give it any required args there if it
   has them.
5. **Scripted-client row.** Add the tool's name to `EXPECTED_TOOLS` in
   `packages/mcp/test/scripted-client.test.ts` and add at least one happy-path call over the
   linked client/server pair. If the tool touches a real page, gate it on `chromiumAvailable`
   and run it against the toy-site fixture over loopback `node:http` (keystone pattern — see
   `docs/ai-context/testing/unit-vs-keystone.md`).
6. **README row.** Add the tool to the table in `packages/mcp/README.md` (name, kind:
   orchestration vs. introspection, one-line description; new env vars go in the env-var table).
7. **CHANGELOG note.** Add a line under Unreleased in the root `CHANGELOG.md`.

## Gate

`pnpm typecheck && pnpm -r build && pnpm test && pnpm lint && pnpm format:check` — all exit 0
before pushing, same as every other package.
