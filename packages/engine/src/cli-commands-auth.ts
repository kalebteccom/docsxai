// capture-auth: run a role's auth strategy against a live browser and cache the session.
// Split from cli-commands-session.ts to keep both files under the max-lines ceiling.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import {
  LocalStorageStateCache,
  makeStrategy,
  parseAuthStrategyFile,
  resolveCredsEnv,
} from "./auth.js";
import { PlaywrightInstrumentedBrowser } from "./playwright-instrumented-browser.js";
import { loadWorkspaceConfig, resolveWorkspacePath } from "./workspace.js";
import { bareValueFlagExit, parseFlags } from "./cli-shared.js";
import { usageError, withNext } from "./cli-messages.js";
import { warnUnusableConfig } from "./cli-backend-errors.js";

export async function cmdCaptureAuth(args: string[]): Promise<number> {
  const { positionals, flags } = parseFlags(args);
  const projectDir = positionals[0];
  if (!projectDir) return usageError("capture-auth", "missing <workspace-dir>");
  const bare = bareValueFlagExit("capture-auth", flags, ["base-url", "role", "auth-cookie", "cdp"]);
  if (bare !== undefined) return bare;
  const wsCfg = await loadWorkspaceConfig(projectDir);
  if (!wsCfg) await warnUnusableConfig("capture-auth", projectDir);
  const baseURL =
    (typeof flags.get("base-url") === "string" ? (flags.get("base-url") as string) : undefined) ??
    wsCfg?.app_url;
  if (!baseURL) {
    return usageError(
      "capture-auth",
      "--base-url <url> is required (or set app_url in the workspace's .docsxai.json)",
    );
  }
  const headless = flags.get("headless") === true;
  const ignoreHTTPSErrors =
    flags.get("ignore-https-errors") === true || !!wsCfg?.ignore_https_errors;
  const authCookie =
    typeof flags.get("auth-cookie") === "string" ? (flags.get("auth-cookie") as string) : undefined;
  const cdp = typeof flags.get("cdp") === "string" ? (flags.get("cdp") as string) : undefined;
  const fresh = flags.get("fresh") === true;
  // Persistent Chrome profile under the workspace — re-running capture-auth reuses the login. (Not when attaching, or with --fresh.)
  const profileDir =
    fresh || cdp ? undefined : resolveWorkspacePath(projectDir, ".auth", "chrome-profile");

  const descriptorPath = resolveWorkspacePath(projectDir, "auth", "strategy.yaml");
  let descriptorText: string;
  try {
    descriptorText = await fs.readFile(descriptorPath, "utf8");
  } catch {
    process.stderr.write(
      `capture-auth: ${withNext(`no auth descriptor at ${descriptorPath} (a workspace made with --auth none has none; if the app needs no login, skip capture-auth)`, "write auth/strategy.yaml (`docsxai init <new-dir>` scaffolds an example to copy)")}\n`,
    );
    return 1;
  }
  let role: string;
  let roleAuth;
  try {
    const descriptor = parseAuthStrategyFile(descriptorText, descriptorPath);
    role =
      typeof flags.get("role") === "string"
        ? (flags.get("role") as string)
        : descriptor.default_role;
    const ra = descriptor.roles[role];
    if (!ra) {
      const roles = Object.keys(descriptor.roles).join(", ");
      process.stderr.write(
        `capture-auth: role "${role}" not in ${descriptorPath} (roles: ${roles}); pass --role <role>\n`,
      );
      return 1;
    }
    roleAuth = ra;
  } catch (e) {
    process.stderr.write(`capture-auth: ${(e as Error).message}\n`);
    return 1;
  }

  let creds: Record<string, string>;
  try {
    creds = resolveCredsEnv(roleAuth);
  } catch (e) {
    process.stderr.write(`capture-auth: ${(e as Error).message}\n`);
    return 1;
  }

  let strategy;
  try {
    strategy = makeStrategy(roleAuth, {
      instrumentedBrowser: () =>
        new PlaywrightInstrumentedBrowser({
          headless,
          ignoreHTTPSErrors,
          ...(cdp ? { connectOverCdp: cdp } : {}),
          ...(profileDir ? { profileDir } : {}),
        }),
    });
  } catch (e) {
    process.stderr.write(`capture-auth: ${(e as Error).message}\n`);
    return 1;
  }

  try {
    process.stdout.write(
      `capture-auth: launching browser for role "${role}" (${roleAuth.strategy})${cdp ? ` — attaching to ${cdp}` : profileDir ? " — reusing saved profile if present" : " — fresh profile"}; log in if prompted, then trigger capture…\n`,
    );
    const result = await strategy.authenticate({ creds, options: roleAuth.options, baseURL, role });

    const cookies = result.storageState.cookies ?? [];
    process.stdout.write(
      `capture-auth: captured ${cookies.length} cookie(s)${cookies.length ? " (newest expiry first):" : ""}\n`,
    );
    for (const c of [...cookies].sort((a, b) => (b.expires || 0) - (a.expires || 0))) {
      const exp =
        c.expires && c.expires > 0 ? new Date(c.expires * 1000).toISOString() : "(session)";
      process.stdout.write(`    ${c.name}  @${c.domain}  expires ${exp}\n`);
    }

    const { expiresAt, source } = await new LocalStorageStateCache(
      resolveWorkspacePath(projectDir, ".auth"),
    ).save(role, result, roleAuth, Date.now(), authCookie ? { authCookie } : {});
    process.stdout.write(
      `capture-auth: cached ${role} → ${path.join(projectDir, ".auth", role + ".json")}\n` +
        `  expires ${new Date(expiresAt).toISOString()}  (from ${source}; re-run when it lapses)\n`,
    );
    if (!/^auth-cookie/.test(source)) {
      process.stdout.write(
        `  tip: pick the app's auth/session cookie from the list above and set 'cache.auth_cookie: <name>' in\n` +
          `       ${path.join(projectDir, "auth", "strategy.yaml")} (or pass --auth-cookie <name>) so the cache tracks its real expiry.\n`,
      );
    }
    return 0;
  } catch (e) {
    process.stderr.write(`capture-auth: ${(e as Error).message}\n`);
    return 1;
  }
}
