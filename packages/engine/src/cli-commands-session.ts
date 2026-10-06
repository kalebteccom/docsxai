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
import {
  expandFlowVariants,
  FlowFileError,
  parseFlowFile,
  resolveFlowExtends,
} from "./flow-file.js";
import { type FlowVariant } from "./flow-matrix.js";
import { recordRunHistory } from "./backend-client.js";
import { runFlowsInSessions } from "./run-flows.js";
import { PlaywrightInstrumentedBrowser } from "./playwright-instrumented-browser.js";
import { initWorkspace, loadWorkspaceConfig, resolveWorkspacePath } from "./workspace.js";
import { listFlowFiles, parseFlags } from "./cli-shared.js";
import { emitVerifyReport, parseVerifyArgs } from "./cli-verify.js";
import { verifyDeterminism } from "./verify-determinism.js";
import { VerifyTreeError } from "./verify-tree.js";
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
  const onlyVariant =
    typeof flags.get("variant") === "string" ? (flags.get("variant") as string) : undefined;
  const pause = flags.get("pause") === true;
  const headed = flags.get("headed") === true || pause; // --pause implies --headed
  if (startFrom && !onlyFlow) {
    process.stderr.write(
      `run: --start-from requires --flow <name> (single-flow calibration aid)\n`,
    );
    return 2;
  }
  const verify = parseVerifyArgs(flags);
  if (typeof verify === "string") {
    process.stderr.write(`run: ${verify}\n\n${USAGE}\n`);
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
  // `flows` goes to the run loop, which expands each matrix flow itself; `units` is the same
  // expansion here, for the checks and messages that need the variant ids before anything launches.
  const flows: FlowFile[] = [];
  const units: FlowVariant[] = [];
  const matrixFlows = new Set<string>();
  let flowCount = 0;
  for (const fp of flowPaths) {
    let flow: FlowFile;
    let variants: FlowVariant[];
    try {
      const parsed = parseFlowFile(await fs.readFile(fp, "utf8"), fp);
      flow = parsed.extends ? await resolveFlowExtends(parsed, loadFlowFile) : parsed;
      variants = expandFlowVariants(flow, fp);
    } catch (e) {
      if (e instanceof FlowFileError) {
        process.stderr.write(`run: ${e.message}\n`);
        return 1;
      }
      throw e;
    }
    if (onlyFlow && flow.name !== onlyFlow) continue;
    flowCount++;
    flows.push(flow);
    if (flow.matrix) matrixFlows.add(flow.name);
    units.push(...variants);
  }
  if (flowCount === 0) {
    process.stderr.write(
      onlyFlow
        ? `run: no flow named "${onlyFlow}"\n`
        : `run: no flow-files in ${projectDir}/flows\n`,
    );
    return 1;
  }
  if (cdpEndpoint && matrixFlows.size > 0) {
    process.stderr.write(
      `run: --cdp attaches to a browser that owns its viewport, color scheme and locale, so it cannot run the matrix of ${[...matrixFlows].join(", ")}\n`,
    );
    return 1;
  }
  if (onlyVariant) {
    const wanted = units.filter((u) => u.id === onlyVariant);
    if (wanted.length === 0) {
      process.stderr.write(
        `run: no variant "${onlyVariant}" (variants: ${
          units
            .map((u) => u.id)
            .filter(Boolean)
            .join(", ") || "none, no flow has a matrix"
        })\n`,
      );
      return 1;
    }
    units.splice(0, units.length, ...wanted);
  }
  for (const name of matrixFlows) {
    const stale = resolveWorkspacePath(projectDir, "docs", name, "annotations.json");
    if (
      await fs.access(stale).then(
        () => true,
        () => false,
      )
    ) {
      process.stderr.write(
        `run: warning — docs/${name}/annotations.json is from before ${name} had a matrix; its variants write to docs/${name}/<variant>/, so remove the old docs/${name}/ outputs\n`,
      );
    }
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
  const noun = matrixFlows.size > 0 ? "flow variants" : "flows";
  const runOptions = {
    projectDir,
    flows,
    variant: onlyVariant,
    storageState,
    baseURL,
    headed,
    ignoreHTTPSErrors,
    cdpEndpoint,
    stopAfter,
    startFrom,
    obstacles: wsCfg?.annotations?.obstacles === true,
    concurrency,
  };

  // Verification runs the same loop N times into isolated roots and prints the report on stdout, so
  // its progress lines go to stderr.
  if (verify) {
    try {
      const report = await verifyDeterminism({
        ...runOptions,
        runs: verify.runs,
        progress: (line) => process.stderr.write(line),
      });
      return emitVerifyReport(report, verify.format);
    } catch (e) {
      if (e instanceof VerifyTreeError) {
        process.stderr.write(`run: --verify-determinism: ${e.message}\n`);
        return 1;
      }
      throw e;
    }
  }

  const startedAt = Date.now();
  const { okCount, failures } = await runFlowsInSessions({
    ...runOptions,
    outputRoot: projectDir,
    pause,
    progress: (line) => process.stdout.write(line),
  });
  const anyFailed = failures.length > 0;

  // Backend-bound workspaces get a run record appended; offline-tolerant (warn, never fail the run).
  const history = await recordRunHistory({
    workspaceDir: projectDir,
    config: wsCfg ?? {},
    ok: !anyFailed,
    durationMs: Date.now() - startedAt,
    summary: `${okCount}/${units.length} ${noun} ok`,
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
