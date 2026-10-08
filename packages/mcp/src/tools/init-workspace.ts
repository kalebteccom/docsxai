// init_workspace — scaffold a new docsxai workspace (wraps the engine's initWorkspace).

import { initWorkspace } from "@docsxai/engine";
import { z } from "zod";
import { defineTool, fail, ok, resolveToolPath } from "../shared.js";

export const initWorkspaceTool = defineTool({
  name: "init_workspace",
  title: "Initialize a docsxai workspace",
  description:
    "Create a new docsxai workspace (flows/, docs/, auth/strategy.yaml, .docsxai.json). Use it " +
    "once, first: every other tool needs an existing workspace. Put the workspace outside the " +
    "documented app's source repo. Returns { dir, created, ephemeral }: the absolute directory " +
    "and the files written. Fails when `dir` is not empty unless `force` is true; pick a fresh " +
    "directory first.",
  inputSchema: {
    dir: z
      .string()
      .min(1)
      .describe("Directory to create the workspace in. Pass it as `workspace` to the other tools."),
    appUrl: z.string().optional().describe("Base URL of the running app this workspace documents"),
    auth: z
      .enum(["manual-capture", "none"])
      .optional()
      .describe("Auth scaffold: manual-capture (default) writes auth/strategy.yaml; none skips it"),
    role: z.string().optional().describe("Default auth role name"),
    ttl: z.string().optional().describe("Cached-session TTL fallback (e.g. 1h, 30m, session)"),
    captureTrigger: z
      .enum(["console", "button"])
      .optional()
      .describe("How a person triggers the manual session capture: console (default) or button"),
    authCookie: z.string().optional().describe("Name of the app's auth/session cookie"),
    ignoreHttpsErrors: z
      .boolean()
      .optional()
      .describe(
        "Accept self-signed or invalid TLS certificates on the app (saved in .docsxai.json)",
      ),
    force: z
      .boolean()
      .optional()
      .describe(
        "Scaffold into a non-empty directory. Overwrites .docsxai.json, auth/strategy.yaml, README.md and .gitignore there.",
      ),
  },
  async handler(args, ctx) {
    const dir = ctx.workspaceRoot ? await resolveToolPath(args.dir, ctx) : args.dir;
    try {
      const r = await initWorkspace({
        dir,
        ...(args.appUrl ? { appUrl: args.appUrl } : {}),
        ...(args.auth ? { auth: args.auth } : {}),
        ...(args.role ? { role: args.role } : {}),
        ...(args.ttl ? { ttl: args.ttl } : {}),
        ...(args.captureTrigger ? { captureTrigger: args.captureTrigger } : {}),
        ...(args.authCookie ? { authCookie: args.authCookie } : {}),
        ...(args.ignoreHttpsErrors !== undefined
          ? { ignoreHttpsErrors: args.ignoreHttpsErrors }
          : {}),
        ...(args.force !== undefined ? { force: args.force } : {}),
      });
      return ok({ dir: r.dir, created: r.created, ephemeral: r.ephemeral });
    } catch (e) {
      const message = (e as Error).message;
      return fail(
        message,
        /is not empty/.test(message)
          ? "pick a fresh dir, or pass force: true to scaffold into this one (it overwrites .docsxai.json, auth/strategy.yaml, README.md and .gitignore)"
          : "check the arguments and that the directory can be created, then retry",
      );
    }
  },
});
