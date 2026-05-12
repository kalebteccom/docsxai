#!/usr/bin/env node
// `site-docs` — the deterministic CLI (the agent-invoked surface; the plugin's `run`/`render`/… wrap this).
//
// Phase-0 scope: `run` (execute a project's flow-files headlessly, re-emit annotations + screenshots) and
// `render` (build the viewer — stubbed until the viewer package exists). Calibration subcommands run in an
// agent context and are exposed by the plugin, not here.

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { LocalStorageStateCache, makeStrategy, parseAuthStrategyFile, resolveCredsEnv, type StorageState } from "./auth.js";
import { calibrate } from "./calibrate.js";
import { parseFlowFile } from "./flow-file.js";
import { runFlow } from "./flow-runtime.js";
import { launchPlaywrightSession } from "./playwright-driver.js";
import { PlaywrightInstrumentedBrowser } from "./playwright-instrumented-browser.js";
import { initWorkspace, loadWorkspaceConfig } from "./workspace.js";

const USAGE = `site-docs — deterministic execution CLI

Usage:
  site-docs init <workspace-dir> [--app-url <url>] [--auth manual-capture|none] [--role <name>] [--ttl <dur>]
                                 [--capture-trigger console|button] [--auth-cookie <name>] [--ignore-https-errors]
                                 [--persist tmp] [--force]
  site-docs calibrate <workspace-dir> --from <flow.md|.yaml> [--name <flow>]
  site-docs inspect <workspace-dir> [--url <url>] [--selector <css>] [--headed] [--role <role>]
  site-docs run <workspace-dir> [--flow <name>] [--base-url <url>] [--headed] [--ignore-https-errors] [--stop-after <step-id>] [--pause]
  site-docs render <workspace-dir>
  site-docs capture-auth <workspace-dir> [--base-url <url>] [--role <role>] [--auth-cookie <name>] [--cdp <endpoint>] [--fresh] [--headless] [--ignore-https-errors]
  site-docs --help

Notes:
  • A *workspace* (created by \`init\`) holds flows/<flow>.flow.yaml, docs/, auth/strategy.yaml, .auth/, .viewer/,
    and a .site-docs.json config. Put it OUTSIDE the app's source repo — site-docs documents a running app from
    outside and never writes into the app repo.
  • run / capture-auth read app_url + ignore_https_errors from .site-docs.json if you don't pass the flags.
  • run launches Chromium; if no browser binary is present, install one:  npx playwright install chromium
  • --ignore-https-errors accepts self-signed/invalid TLS (e.g. an app's local HTTPS dev cert)
  • run --stop-after <step-id> runs only a prefix of the flow (up to & incl. that step); --pause keeps the
    (headed) browser open at the last step run — so you can inspect the live state mid-flow when calibrating
    (pair with --flow <name>). For waiting on a slow backend op, give a step a wait_for of the form
    { selector: $x, timeout_ms: 180000 } — a per-step override of the default ~30s selector-wait timeout.
  • capture-auth runs the role's auth strategy (MVP: manual-capture — a headed, instrumented browser the
    engineer logs into; window.__siteDocs.capture() or an injected button snapshots the session) and caches
    it to <workspace-dir>/.auth/<role>.json for subsequent \`run\`s. It prints the captured cookie jar so you
    can identify the app's real auth/session cookie.
  • capture-auth keeps a persistent Chrome profile at <workspace>/.auth/chrome-profile/ (gitignored) — re-running
    it reuses the login (just trigger capture again). Use --fresh for a clean profile (forces a fresh login).
  • --cdp <endpoint> makes capture-auth *attach to an already-running Chrome* (start it with
    --remote-debugging-port=N --disable-web-security --user-data-dir=<dir>) instead of launching a fresh one —
    use this to capture from the same Chrome the engineer is already logged into (and that Claude in Chrome is
    driving for discovery), so they don't log in twice. site-docs won't close that Chrome. (--cdp ignores --fresh.)
  • auth_cookie (set via \`init --auth-cookie\`, \`capture-auth --auth-cookie\`, or hand-edited into
    auth/strategy.yaml) names that cookie; when set, the cached session's expiry tracks *that* cookie's
    expiry rather than the \`ttl\` guess (an interactive SSO login leaves ephemeral IdP scratch cookies, so
    \`min(cookie.expires)\` ≈ now — don't rely on it). If unset/unfound, \`ttl\` (or a 1h default) is used.
  • inspect opens the app in a headless (or --headed) browser *with the cached session loaded* and prints the
    page's [data-testid] elements (or, with --selector, matching elements' HTML) — for pinning locators when
    hand-authoring a flow-file (the captured session can't be replayed in a browser the agent's MCP controls
    because the auth cookie is usually httpOnly; inspect does the storageState→Playwright bridge for you).
  • calibrate takes a *structured flow-guide* (a flow-file in YAML, or a .md with a yaml fenced block) and
    writes flows/<name>.flow.yaml + a default docs/style.yaml. Loose-prose descriptions / live element-picking
    need the host agent — that's the /site-docs:calibrate *skill* (see the plugin), which then refines/produces
    the flow-file; this CLI command covers only the deterministic structured-input case.`;

function parseFlags(args: string[]): { positionals: string[]; flags: Map<string, string | true> } {
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags.set(key, next);
        i++;
      } else {
        flags.set(key, true);
      }
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags };
}

async function listFlowFiles(projectDir: string): Promise<string[]> {
  const dir = path.join(projectDir, "flows");
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    throw new Error(`no flows directory at ${dir}`);
  }
  return entries.filter((e) => e.endsWith(".flow.yaml")).sort().map((e) => path.join(dir, e));
}

async function loadAuthStorageState(projectDir: string): Promise<StorageState | undefined> {
  const descriptorPath = path.join(projectDir, "auth", "strategy.yaml");
  let text: string;
  try {
    text = await fs.readFile(descriptorPath, "utf8");
  } catch {
    return undefined; // no auth configured — run with a fresh context
  }
  const descriptor = parseAuthStrategyFile(text, descriptorPath);
  const role = descriptor.default_role;
  const cache = new LocalStorageStateCache(path.join(projectDir, ".auth"));
  const state = await cache.load(role);
  if (!state) {
    throw new Error(
      `auth/strategy.yaml configures role "${role}" but no valid cached session was found at ${path.join(projectDir, ".auth", role + ".json")}.\n` +
        `Capture one first (calibration's auth step, e.g. the manual-capture flow).`,
    );
  }
  return state;
}

async function cmdRun(args: string[]): Promise<number> {
  const { positionals, flags } = parseFlags(args);
  const projectDir = positionals[0];
  if (!projectDir) {
    process.stderr.write("run: missing <project-dir>\n\n" + USAGE + "\n");
    return 2;
  }
  const onlyFlow = typeof flags.get("flow") === "string" ? (flags.get("flow") as string) : undefined;
  const stopAfter = typeof flags.get("stop-after") === "string" ? (flags.get("stop-after") as string) : undefined;
  const pause = flags.get("pause") === true;
  const headed = flags.get("headed") === true || pause; // --pause implies --headed
  const wsCfg = await loadWorkspaceConfig(projectDir);
  const baseURL = (typeof flags.get("base-url") === "string" ? (flags.get("base-url") as string) : undefined) ?? wsCfg?.app_url;
  const ignoreHTTPSErrors = flags.get("ignore-https-errors") === true || !!wsCfg?.ignore_https_errors;

  let flowPaths: string[];
  try {
    flowPaths = await listFlowFiles(projectDir);
  } catch (e) {
    process.stderr.write(`run: ${(e as Error).message}\n`);
    return 1;
  }
  const flows = [];
  for (const fp of flowPaths) {
    const flow = parseFlowFile(await fs.readFile(fp, "utf8"), fp);
    if (!onlyFlow || flow.name === onlyFlow) flows.push(flow);
  }
  if (flows.length === 0) {
    process.stderr.write(onlyFlow ? `run: no flow named "${onlyFlow}"\n` : `run: no flow-files in ${projectDir}/flows\n`);
    return 1;
  }

  let storageState: StorageState | undefined;
  try {
    storageState = await loadAuthStorageState(projectDir);
  } catch (e) {
    process.stderr.write(`run: ${(e as Error).message}\n`);
    return 1;
  }

  let session;
  try {
    session = await launchPlaywrightSession({ baseURL, headed, ignoreHTTPSErrors, storageState, docPackRoot: projectDir });
  } catch (e) {
    const msg = (e as Error).message;
    if (/Executable doesn't exist|browserType\.launch|playwright install/i.test(msg)) {
      process.stderr.write(`run: no Chromium binary found.\n  Install one:  npx playwright install chromium\n`);
      return 1;
    }
    process.stderr.write(`run: failed to launch browser: ${msg}\n`);
    return 1;
  }

  try {
    for (const flow of flows) {
      const result = await runFlow(flow, session.driver, { resolveLocator: (n) => flow.locators[n], ...(stopAfter ? { stopAfter } : {}) });
      const docsDir = path.join(projectDir, "docs", flow.name);
      await fs.mkdir(docsDir, { recursive: true });
      await fs.writeFile(
        path.join(docsDir, "annotations.json"),
        JSON.stringify(result.annotations, null, 2) + "\n",
        "utf8",
      );
      process.stdout.write(`run: ${flow.name} — ${result.steps.length} steps, ${result.annotations.annotations.length} annotation(s)\n`);
    }
    return 0;
  } catch (e) {
    process.stderr.write(`run: ${(e as Error).message}\n`);
    return 1;
  } finally {
    if (pause) {
      process.stdout.write("run: --pause — browser is open at the last step run; close it to exit.\n");
      await new Promise<void>((resolve) => session.browser.on("disconnected", () => resolve()));
    }
    await session.close();
  }
}

async function cmdRender(args: string[]): Promise<number> {
  const { positionals } = parseFlags(args);
  const projectDir = positionals[0];
  if (!projectDir) {
    process.stderr.write("render: missing <project-dir>\n\n" + USAGE + "\n");
    return 2;
  }
  const docsDir = path.join(projectDir, "docs");
  const outDir = path.join(projectDir, ".viewer");
  // The viewer is its own package/bin; shell out to it so the engine doesn't depend on it at build time.
  return new Promise<number>((resolve) => {
    const child = spawn("site-docs-viewer", ["build", docsDir, outDir], { stdio: "inherit" });
    child.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") {
        process.stderr.write(
          "render: `site-docs-viewer` not found on PATH.\n" +
            `  Run it directly:  site-docs-viewer build ${docsDir} ${outDir}\n` +
            "  (it's the @kalebtec/site-docs-viewer bin; in this workspace: pnpm exec site-docs-viewer …)\n",
        );
      } else {
        process.stderr.write(`render: ${e.message}\n`);
      }
      resolve(1);
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function cmdCaptureAuth(args: string[]): Promise<number> {
  const { positionals, flags } = parseFlags(args);
  const projectDir = positionals[0];
  if (!projectDir) {
    process.stderr.write("capture-auth: missing <project-dir>\n\n" + USAGE + "\n");
    return 2;
  }
  const wsCfg = await loadWorkspaceConfig(projectDir);
  const baseURL = (typeof flags.get("base-url") === "string" ? (flags.get("base-url") as string) : undefined) ?? wsCfg?.app_url;
  if (!baseURL) {
    process.stderr.write("capture-auth: --base-url <url> is required (or set app_url in the workspace's .site-docs.json)\n");
    return 2;
  }
  const headless = flags.get("headless") === true;
  const ignoreHTTPSErrors = flags.get("ignore-https-errors") === true || !!wsCfg?.ignore_https_errors;
  const authCookie = typeof flags.get("auth-cookie") === "string" ? (flags.get("auth-cookie") as string) : undefined;
  const cdp = typeof flags.get("cdp") === "string" ? (flags.get("cdp") as string) : undefined;
  const fresh = flags.get("fresh") === true;
  // Persistent Chrome profile under the workspace — re-running capture-auth reuses the login. (Not when attaching, or with --fresh.)
  const profileDir = fresh || cdp ? undefined : path.join(projectDir, ".auth", "chrome-profile");

  const descriptorPath = path.join(projectDir, "auth", "strategy.yaml");
  let descriptorText: string;
  try {
    descriptorText = await fs.readFile(descriptorPath, "utf8");
  } catch {
    process.stderr.write(`capture-auth: no auth descriptor at ${descriptorPath}\n`);
    return 1;
  }
  let role: string;
  let roleAuth;
  try {
    const descriptor = parseAuthStrategyFile(descriptorText, descriptorPath);
    role = typeof flags.get("role") === "string" ? (flags.get("role") as string) : descriptor.default_role;
    const ra = descriptor.roles[role];
    if (!ra) {
      process.stderr.write(`capture-auth: role "${role}" not in ${descriptorPath}\n`);
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
    process.stdout.write(`capture-auth: captured ${cookies.length} cookie(s)${cookies.length ? " (newest expiry first):" : ""}\n`);
    for (const c of [...cookies].sort((a, b) => (b.expires || 0) - (a.expires || 0))) {
      const exp = c.expires && c.expires > 0 ? new Date(c.expires * 1000).toISOString() : "(session)";
      process.stdout.write(`    ${c.name}  @${c.domain}  expires ${exp}\n`);
    }

    const { expiresAt, source } = await new LocalStorageStateCache(path.join(projectDir, ".auth")).save(
      role,
      result,
      roleAuth,
      Date.now(),
      authCookie ? { authCookie } : {},
    );
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

async function cmdInit(args: string[]): Promise<number> {
  const { positionals, flags } = parseFlags(args);
  const persistTmp = flags.get("persist") === "tmp";
  const dir = positionals[0];
  if (!persistTmp && !dir) {
    process.stderr.write("init: missing <workspace-dir> (or use --persist tmp)\n\n" + USAGE + "\n");
    return 2;
  }
  const str = (k: string): string | undefined => (typeof flags.get(k) === "string" ? (flags.get(k) as string) : undefined);
  const auth = str("auth");
  if (auth !== undefined && auth !== "manual-capture" && auth !== "none") {
    process.stderr.write("init: --auth must be 'manual-capture' or 'none'\n");
    return 2;
  }
  const trigger = str("capture-trigger");
  if (trigger !== undefined && trigger !== "console" && trigger !== "button") {
    process.stderr.write("init: --capture-trigger must be 'console' or 'button'\n");
    return 2;
  }
  const appUrl = str("app-url");
  const role = str("role");
  const ttl = str("ttl");
  const authCookie = str("auth-cookie");
  try {
    const r = await initWorkspace({
      ...(dir ? { dir } : {}),
      persistTmp,
      ...(appUrl ? { appUrl } : {}),
      ...(auth ? { auth } : {}),
      ...(role ? { role } : {}),
      ...(ttl ? { ttl } : {}),
      ...(trigger ? { captureTrigger: trigger } : {}),
      ...(authCookie ? { authCookie } : {}),
      ignoreHttpsErrors: flags.get("ignore-https-errors") === true,
      force: flags.get("force") === true,
    });
    process.stdout.write(`init: workspace ${r.ephemeral ? "(ephemeral) " : ""}at ${r.dir}\n  created: ${r.created.join(", ")}\n`);
    process.stdout.write(
      `  next: ${appUrl ? "" : "(set app_url in .site-docs.json, then) "}site-docs capture-auth ${r.dir}  →  …calibrate…  →  site-docs run ${r.dir}  →  site-docs render ${r.dir}\n`,
    );
    return 0;
  } catch (e) {
    process.stderr.write(`init: ${(e as Error).message}\n`);
    return 1;
  }
}

async function cmdCalibrate(args: string[]): Promise<number> {
  const { positionals, flags } = parseFlags(args);
  const workspaceDir = positionals[0];
  if (!workspaceDir) {
    process.stderr.write("calibrate: missing <workspace-dir>\n\n" + USAGE + "\n");
    return 2;
  }
  const from = typeof flags.get("from") === "string" ? (flags.get("from") as string) : undefined;
  if (!from) {
    process.stderr.write("calibrate: --from <flow.md|.yaml> is required (the structured flow-guide)\n");
    return 2;
  }
  const flowName = typeof flags.get("name") === "string" ? (flags.get("name") as string) : undefined;
  let text: string;
  try {
    text = await fs.readFile(from, "utf8");
  } catch {
    process.stderr.write(`calibrate: cannot read ${from}\n`);
    return 1;
  }
  try {
    const r = await calibrate({ workspaceDir, fromText: text, fromSource: from, ...(flowName ? { flowName } : {}) });
    process.stdout.write(`calibrate: wrote ${r.flowFilePath}  (${r.flow.steps.length} steps)\n`);
    if (r.wroteStyle) process.stdout.write(`calibrate: wrote default ${r.stylePath}\n`);
    process.stdout.write(`  next: site-docs run ${workspaceDir}  (then: site-docs render ${workspaceDir})\n`);
    return 0;
  } catch (e) {
    process.stderr.write(`calibrate: ${(e as Error).message}\n`);
    return 1;
  }
}

async function cmdInspect(args: string[]): Promise<number> {
  const { positionals, flags } = parseFlags(args);
  const workspaceDir = positionals[0];
  if (!workspaceDir) {
    process.stderr.write("inspect: missing <workspace-dir>\n\n" + USAGE + "\n");
    return 2;
  }
  const wsCfg = await loadWorkspaceConfig(workspaceDir);
  const url = (typeof flags.get("url") === "string" ? (flags.get("url") as string) : undefined) ?? wsCfg?.app_url;
  if (!url) {
    process.stderr.write("inspect: no URL — pass --url <url> or set app_url in the workspace's .site-docs.json\n");
    return 2;
  }
  const selector = typeof flags.get("selector") === "string" ? (flags.get("selector") as string) : undefined;
  const headed = flags.get("headed") === true;
  const ignoreHTTPSErrors = flags.get("ignore-https-errors") === true || !!wsCfg?.ignore_https_errors;

  let role = typeof flags.get("role") === "string" ? (flags.get("role") as string) : undefined;
  if (!role) {
    try {
      role = parseAuthStrategyFile(await fs.readFile(path.join(workspaceDir, "auth", "strategy.yaml"), "utf8")).default_role;
    } catch {
      role = "editor";
    }
  }
  const storageState = (await new LocalStorageStateCache(path.join(workspaceDir, ".auth")).load(role)) ?? undefined;
  if (!storageState) {
    process.stderr.write(`inspect: no valid cached session for role "${role}" — inspecting unauthenticated (\`site-docs capture-auth\` first if the app needs login)\n`);
  }

  let session;
  try {
    session = await launchPlaywrightSession({ baseURL: url, headed, ignoreHTTPSErrors, ...(storageState ? { storageState } : {}), docPackRoot: workspaceDir });
  } catch (e) {
    const msg = (e as Error).message;
    if (/Executable doesn't exist|playwright install/i.test(msg)) {
      process.stderr.write("inspect: no Chromium binary — `npx playwright install chromium`\n");
      return 1;
    }
    process.stderr.write(`inspect: failed to launch browser: ${msg}\n`);
    return 1;
  }
  try {
    await session.page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => undefined);
    await session.page.waitForTimeout(300);
    process.stdout.write(`inspect: ${session.page.url()}\n  title: ${await session.page.title().catch(() => "(?)")}\n`);
    if (selector) {
      const els = await session.page.locator(selector).all();
      process.stdout.write(`  ${els.length} element(s) matching ${selector} (first 20):\n`);
      for (const el of els.slice(0, 20)) {
        const html = (await el.evaluate((e) => e.outerHTML).catch(() => "")).replace(/\s+/g, " ").slice(0, 400);
        process.stdout.write(`    ${html}\n`);
      }
    } else {
      const items = await session.page
        .$$eval("[data-testid]", (els) =>
          els.map((e) => ({
            testid: e.getAttribute("data-testid") ?? "",
            tag: e.tagName.toLowerCase(),
            text: (e.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60),
            visible:
              typeof (e as unknown as { checkVisibility?: () => boolean }).checkVisibility === "function"
                ? (e as unknown as { checkVisibility: () => boolean }).checkVisibility()
                : (e as unknown as { offsetParent?: unknown }).offsetParent != null,
          })),
        )
        .catch(() => [] as Array<{ testid: string; tag: string; text: string; visible: boolean }>);
      process.stdout.write(`  ${items.length} [data-testid] element(s) (✓ = visible) — pin these as locators:\n`);
      for (const it of items) {
        process.stdout.write(`    ${it.visible ? "✓" : " "} [data-testid="${it.testid}"]  <${it.tag}>  ${it.text ? `"${it.text}"` : ""}\n`);
      }
      process.stdout.write(`  (--selector '<css>' dumps matching elements' HTML; --headed opens the browser; --url <url> for a sub-page)\n`);
    }
    if (headed) {
      process.stdout.write("inspect: browser is open — close it to exit.\n");
      await new Promise<void>((resolve) => session!.browser.on("disconnected", () => resolve()));
    }
    return 0;
  } catch (e) {
    process.stderr.write(`inspect: ${(e as Error).message}\n`);
    return 1;
  } finally {
    if (!headed) await session.close();
  }
}

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case undefined:
    case "--help":
    case "-h":
    case "help":
      process.stdout.write(USAGE + "\n");
      return 0;
    case "init":
      return cmdInit(rest);
    case "calibrate":
      return cmdCalibrate(rest);
    case "inspect":
      return cmdInspect(rest);
    case "run":
      return cmdRun(rest);
    case "render":
      return cmdRender(rest);
    case "capture-auth":
      return cmdCaptureAuth(rest);
    default:
      process.stderr.write(`unknown command: ${cmd}\n\n${USAGE}\n`);
      return 2;
  }
}

// Run as the bin entry, but not when imported (e.g. in tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
