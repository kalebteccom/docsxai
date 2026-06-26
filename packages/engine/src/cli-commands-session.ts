// Runtime / session commands — the ones that stand up a workspace or drive a live browser:
//   init          — scaffold a workspace
//   capture-auth  — run a role's auth strategy and cache the session
//   calibrate     — write flows/<name>.flow.yaml from a structured flow-guide
//   run           — execute the workspace's flows against the live app, emitting annotations
//
// These reach into the engine's heavier subsystems (Playwright, auth, the flow runtime); the
// thinner static/aid commands live in cli-commands-authoring.ts.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import {
  LocalStorageStateCache,
  makeStrategy,
  parseAuthStrategyFile,
  resolveCredsEnv,
  resolveStateCache,
  type StorageState,
} from "./auth.js";
import { calibrate } from "./calibrate.js";
import { type FlowFile } from "./doc-pack.js";
import { FlowFileError, parseFlowFile, resolveFlowExtends } from "./flow-file.js";
import { recordRunHistory } from "./backend-client.js";
import { runFlow } from "./flow-runtime.js";
import { launchPlaywrightSession } from "./playwright-driver.js";
import { PlaywrightInstrumentedBrowser } from "./playwright-instrumented-browser.js";
import {
  initWorkspace,
  loadWorkspaceConfig,
  resolveWorkspacePath,
  resolveWorkspacePathReal,
} from "./workspace.js";
import { listFlowFiles, parseFlags } from "./cli-shared.js";
import { USAGE } from "./cli-usage.js";

async function loadAuthStorageState(projectDir: string): Promise<StorageState | undefined> {
  const descriptorPath = resolveWorkspacePath(projectDir, "auth", "strategy.yaml");
  let text: string;
  try {
    text = await fs.readFile(descriptorPath, "utf8");
  } catch {
    return undefined; // no auth configured — run with a fresh context
  }
  const descriptor = parseAuthStrategyFile(text, descriptorPath);
  const role = descriptor.default_role;
  const cache = await resolveStateCache(descriptor.roles[role]!, projectDir);
  const state = await cache.load(role);
  if (!state) {
    throw new Error(
      `auth/strategy.yaml configures role "${role}" but no valid cached session was found at ${path.join(projectDir, ".auth", role + ".json")}.\n` +
        `Capture one first (calibration's auth step, e.g. the manual-capture flow).`,
    );
  }
  return state;
}

export async function cmdRun(args: string[]): Promise<number> {
  const { positionals, flags } = parseFlags(args);
  if (!positionals[0]) {
    process.stderr.write("run: missing <project-dir>\n\n" + USAGE + "\n");
    return 2;
  }
  const projectDir: string = positionals[0];
  const onlyFlow =
    typeof flags.get("flow") === "string" ? (flags.get("flow") as string) : undefined;
  const stopAfter =
    typeof flags.get("stop-after") === "string" ? (flags.get("stop-after") as string) : undefined;
  const startFrom =
    typeof flags.get("start-from") === "string" ? (flags.get("start-from") as string) : undefined;
  const cdpEndpoint =
    typeof flags.get("cdp") === "string" ? (flags.get("cdp") as string) : undefined;
  const pause = flags.get("pause") === true;
  const headed = flags.get("headed") === true || pause; // --pause implies --headed
  if (startFrom && !onlyFlow) {
    process.stderr.write(
      `run: --start-from requires --flow <name> (single-flow calibration aid)\n`,
    );
    return 2;
  }
  const wsCfg = await loadWorkspaceConfig(projectDir);
  const baseURL =
    (typeof flags.get("base-url") === "string" ? (flags.get("base-url") as string) : undefined) ??
    wsCfg?.app_url;
  const ignoreHTTPSErrors =
    flags.get("ignore-https-errors") === true || !!wsCfg?.ignore_https_errors;

  let flowPaths: string[];
  try {
    flowPaths = await listFlowFiles(projectDir);
  } catch (e) {
    process.stderr.write(`run: ${(e as Error).message}\n`);
    return 1;
  }
  const loadFlowFile = async (name: string) => {
    const fp = resolveWorkspacePath(projectDir, "flows", `${name}.flow.yaml`);
    let text: string;
    try {
      text = await fs.readFile(fp, "utf8");
    } catch {
      throw new FlowFileError(`\`extends\`: no flow named "${name}" at ${fp}`);
    }
    return parseFlowFile(text, fp);
  };
  const flows: FlowFile[] = [];
  for (const fp of flowPaths) {
    let flow: FlowFile;
    try {
      const parsed = parseFlowFile(await fs.readFile(fp, "utf8"), fp);
      flow = parsed.extends ? await resolveFlowExtends(parsed, loadFlowFile) : parsed;
    } catch (e) {
      if (e instanceof FlowFileError) {
        process.stderr.write(`run: ${e.message}\n`);
        return 1;
      }
      throw e;
    }
    if (!onlyFlow || flow.name === onlyFlow) flows.push(flow);
  }
  if (flows.length === 0) {
    process.stderr.write(
      onlyFlow
        ? `run: no flow named "${onlyFlow}"\n`
        : `run: no flow-files in ${projectDir}/flows\n`,
    );
    return 1;
  }

  let storageState: StorageState | undefined;
  try {
    storageState = await loadAuthStorageState(projectDir);
  } catch (e) {
    process.stderr.write(`run: ${(e as Error).message}\n`);
    return 1;
  }

  // Parallel runners: each flow gets its own Playwright session, so flows are isolated and can run together.
  // `--concurrency N` (default 1) caps how many run at once. `--pause` / `--stop-after` force concurrency=1
  // (they're single-flow calibration aids; mixing them with parallelism would be chaos).
  const concurrencyRaw =
    typeof flags.get("concurrency") === "string" ? Number(flags.get("concurrency")) : 1;
  const requestedConcurrency = Math.max(1, Math.floor(concurrencyRaw || 1));
  const forceSingle = pause || stopAfter || startFrom || cdpEndpoint;
  const concurrency = forceSingle ? 1 : requestedConcurrency;
  if (forceSingle && requestedConcurrency > 1) {
    process.stderr.write(
      `run: --pause / --stop-after / --start-from / --cdp force --concurrency 1 (ignoring --concurrency ${requestedConcurrency})\n`,
    );
  }
  const tag = concurrency > 1 ? (name: string) => `run [${name}]: ` : () => "run: ";

  async function runOne(flow: FlowFile): Promise<boolean> {
    const name = flow.name;
    let session;
    try {
      // When attaching to an existing Chrome via --cdp, the operator owns its auth state — don't
      // load cached `storageState` over it (would replace cookies). When launching fresh, do.
      session = await launchPlaywrightSession({
        baseURL,
        headed,
        ignoreHTTPSErrors,
        ...(cdpEndpoint ? { connectOverCdp: cdpEndpoint } : { storageState }),
        ...(flow.environment ? { environment: flow.environment } : {}),
        docPackRoot: projectDir,
      });
    } catch (e) {
      const msg = (e as Error).message;
      if (/Executable doesn't exist|browserType\.launch|playwright install/i.test(msg)) {
        process.stderr.write(
          `${tag(name)}no Chromium binary found.  Install one:  npx playwright-core install chromium  (source checkout: pnpm -C packages/engine exec playwright-core install chromium)\n`,
        );
      } else {
        process.stderr.write(`${tag(name)}failed to launch browser: ${msg}\n`);
      }
      return false;
    }
    try {
      const result = await runFlow(flow, session.driver, {
        resolveLocator: (n) => flow.locators[n],
        ...(stopAfter ? { stopAfter } : {}),
        ...(startFrom ? { startFrom } : {}),
      });
      await fs.mkdir(resolveWorkspacePath(projectDir, "docs", flow.name), { recursive: true });
      // Flow names come from the flow-files — resolve the write target symlink-aware.
      const annotationsPath = await resolveWorkspacePathReal(
        projectDir,
        "docs",
        flow.name,
        "annotations.json",
      );
      // With `startFrom`, only the post-startFrom steps emit annotations — merge them into the
      // existing file (if any) by step id so the prior steps' annotations stay in place. Same
      // story for screenshots (they live as separate PNGs and are simply not re-captured).
      let toWrite = result.annotations;
      if (startFrom) {
        try {
          const existingText = await fs.readFile(annotationsPath, "utf8");
          const existing = JSON.parse(existingText) as typeof result.annotations;
          const newStepIds = new Set(result.annotations.annotations.map((a) => a.step));
          const merged = [
            ...existing.annotations.filter((a) => !newStepIds.has(a.step)),
            ...result.annotations.annotations,
          ];
          toWrite = { ...result.annotations, annotations: merged };
        } catch {
          // No existing file (or unreadable) — just write what we have.
        }
      }
      await fs.writeFile(annotationsPath, JSON.stringify(toWrite, null, 2) + "\n", "utf8");
      process.stdout.write(
        `${tag(name)}${name} — ${result.steps.length} step(s) executed, ${result.annotations.annotations.length} annotation(s) ${startFrom ? "merged" : "written"}\n`,
      );
      return true;
    } catch (e) {
      process.stderr.write(`${tag(name)}${(e as Error).message}\n`);
      return false;
    } finally {
      if (pause) {
        process.stdout.write(
          "run: --pause — browser is open at the last step run; close it to exit.\n",
        );
        await new Promise<void>((resolve) => session.browser.on("disconnected", () => resolve()));
      }
      await session.close();
    }
  }

  let idx = 0;
  let anyFailed = false;
  let okCount = 0;
  const startedAt = Date.now();
  async function worker(): Promise<void> {
    while (idx < flows.length) {
      const flow = flows[idx++]!;
      if (await runOne(flow)) okCount++;
      else anyFailed = true;
    }
  }
  const workers = Math.min(concurrency, flows.length);
  if (workers > 1)
    process.stdout.write(
      `run: running ${flows.length} flows with ${workers} parallel worker(s)…\n`,
    );
  await Promise.all(Array.from({ length: workers }, () => worker()));

  // Backend-bound workspaces get a run record appended; offline-tolerant (warn, never fail the run).
  const history = await recordRunHistory({
    workspaceDir: projectDir,
    config: wsCfg ?? {},
    ok: !anyFailed,
    durationMs: Date.now() - startedAt,
    summary: `${okCount}/${flows.length} flows ok`,
  });
  if (history.warning) process.stderr.write(`run: warning — ${history.warning}\n`);

  return anyFailed ? 1 : 0;
}

export async function cmdCaptureAuth(args: string[]): Promise<number> {
  const { positionals, flags } = parseFlags(args);
  const projectDir = positionals[0];
  if (!projectDir) {
    process.stderr.write("capture-auth: missing <project-dir>\n\n" + USAGE + "\n");
    return 2;
  }
  const wsCfg = await loadWorkspaceConfig(projectDir);
  const baseURL =
    (typeof flags.get("base-url") === "string" ? (flags.get("base-url") as string) : undefined) ??
    wsCfg?.app_url;
  if (!baseURL) {
    process.stderr.write(
      "capture-auth: --base-url <url> is required (or set app_url in the workspace's .docsxai.json)\n",
    );
    return 2;
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
    process.stderr.write(`capture-auth: no auth descriptor at ${descriptorPath}\n`);
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

export async function cmdInit(args: string[]): Promise<number> {
  const { positionals, flags } = parseFlags(args);
  const persistTmp = flags.get("persist") === "tmp";
  const dir = positionals[0];
  if (!persistTmp && !dir) {
    process.stderr.write("init: missing <workspace-dir> (or use --persist tmp)\n\n" + USAGE + "\n");
    return 2;
  }
  const str = (k: string): string | undefined =>
    typeof flags.get(k) === "string" ? (flags.get(k) as string) : undefined;
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
    process.stdout.write(
      `init: workspace ${r.ephemeral ? "(ephemeral) " : ""}at ${r.dir}\n  created: ${r.created.join(", ")}\n`,
    );
    process.stdout.write(
      `  next: ${appUrl ? "" : "(set app_url in .docsxai.json, then) "}docsxai capture-auth ${r.dir}  →  …calibrate…  →  docsxai run ${r.dir}  →  docsxai render ${r.dir}\n`,
    );
    return 0;
  } catch (e) {
    process.stderr.write(`init: ${(e as Error).message}\n`);
    return 1;
  }
}

export async function cmdCalibrate(args: string[]): Promise<number> {
  const { positionals, flags } = parseFlags(args);
  const workspaceDir = positionals[0];
  if (!workspaceDir) {
    process.stderr.write("calibrate: missing <workspace-dir>\n\n" + USAGE + "\n");
    return 2;
  }
  const from = typeof flags.get("from") === "string" ? (flags.get("from") as string) : undefined;
  if (!from) {
    process.stderr.write(
      "calibrate: --from <flow.md|.yaml> is required (the structured flow-guide)\n",
    );
    return 2;
  }
  const flowName =
    typeof flags.get("name") === "string" ? (flags.get("name") as string) : undefined;
  let text: string;
  try {
    text = await fs.readFile(from, "utf8");
  } catch {
    process.stderr.write(`calibrate: cannot read ${from}\n`);
    return 1;
  }
  try {
    const r = await calibrate({
      workspaceDir,
      fromText: text,
      fromSource: from,
      ...(flowName ? { flowName } : {}),
    });
    process.stdout.write(`calibrate: wrote ${r.flowFilePath}  (${r.flow.steps.length} steps)\n`);
    if (r.wroteStyle) process.stdout.write(`calibrate: wrote default ${r.stylePath}\n`);
    process.stdout.write(
      `  next: docsxai run ${workspaceDir}  (then: docsxai render ${workspaceDir})\n`,
    );
    return 0;
  } catch (e) {
    process.stderr.write(`calibrate: ${(e as Error).message}\n`);
    return 1;
  }
}
