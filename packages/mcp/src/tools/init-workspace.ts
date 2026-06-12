// init_workspace — scaffold a new site-docs workspace (wraps the engine's initWorkspace).

import { initWorkspace } from "@kalebtec/docsxai-engine";
import { z } from "zod";
import { defineTool, fail, ok } from "../shared.js";

export const initWorkspaceTool = defineTool({
  name: "init_workspace",
  title: "Initialize a site-docs workspace",
  description:
    "Scaffold a new site-docs workspace directory (flows/, docs/, auth/strategy.yaml, .site-docs.json). " +
    "Put it OUTSIDE the documented app's source repo.",
  inputSchema: {
    dir: z.string().min(1).describe("Directory to create the workspace in"),
    appUrl: z.string().optional().describe("Base URL of the running app this workspace documents"),
    auth: z
      .enum(["manual-capture", "none"])
      .optional()
      .describe("Auth scaffold: manual-capture (default) writes auth/strategy.yaml; none skips it"),
    role: z.string().optional().describe("Default auth role name"),
    ttl: z.string().optional().describe("Cached-session TTL fallback (e.g. 1h, 30m, session)"),
    captureTrigger: z.enum(["console", "button"]).optional(),
    authCookie: z.string().optional().describe("Name of the app's auth/session cookie"),
    ignoreHttpsErrors: z.boolean().optional(),
    force: z.boolean().optional().describe("Allow scaffolding into a non-empty directory"),
  },
  async handler(args) {
    try {
      const r = await initWorkspace({
        dir: args.dir,
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
      return fail(
        (e as Error).message,
        "pass force: true to scaffold into a non-empty directory, or pick a fresh dir",
      );
    }
  },
});
