#!/usr/bin/env node
// `site-docs` — the deterministic CLI. The plugin's commands wrap this; calibration runs in an agent
// context and is exposed by the plugin, not here.

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import {
  LocalStorageStateCache,
  makeStrategy,
  parseAuthStrategyFile,
  resolveCredsEnv,
  type StorageState,
} from "./auth.js";
import { calibrate } from "./calibrate.js";
import { type FlowFile } from "./doc-pack.js";
import { FlowFileError, parseFlowFile, resolveFlowExtends } from "./flow-file.js";
import { BackendClient, BackendClientError } from "./backend-client.js";
import {
  buildDiagnoseReport,
  type DiagnoseReport,
  formatReportText,
  probeLive,
} from "./diagnose.js";
import { type DocPackPayloads, readDocPack, writeDocPack } from "./doc-pack-io.js";
import { formatIssuesText, type LintIssue, lintFlow } from "./flow-lint.js";
import { runFlow } from "./flow-runtime.js";
import { buildFlowTree, formatTreeText } from "./flow-tree.js";
import {
  formatJargonHitsText,
  initStyleIfAbsent,
  loadStyle,
  scanWorkspaceForJargon,
  StyleError,
  writeStyle,
} from "./style.js";
import { pluginsCli } from "./plugins-cli.js";
import { ZipError, zipDocPack } from "./zip.js";
import { launchPlaywrightSession } from "./playwright-driver.js";
import { PlaywrightInstrumentedBrowser } from "./playwright-instrumented-browser.js";
import {
  initWorkspace,
  loadWorkspaceConfig,
  resolveWorkspacePath,
  resolveWorkspacePathReal,
} from "./workspace.js";

const USAGE = `site-docs — deterministic execution CLI

Usage:
  site-docs init <workspace-dir> [--app-url <url>] [--auth manual-capture|none] [--role <name>] [--ttl <dur>]
                                 [--capture-trigger console|button] [--auth-cookie <name>] [--ignore-https-errors]
                                 [--persist tmp] [--force]
  site-docs calibrate <workspace-dir> --from <flow.md|.yaml> [--name <flow>]
  site-docs inspect <workspace-dir> [--url <url>] [--selector <css>] [--cdp <endpoint>] [--wait <ms>] [--wait-for <css>] [--headed] [--role <role>]
  site-docs run <workspace-dir> [--flow <name>] [--base-url <url>] [--headed] [--ignore-https-errors] [--stop-after <step-id>] [--start-from <step-id>] [--cdp <endpoint>] [--pause] [--concurrency <N>]
  site-docs lint <workspace-dir> [--flow <name>] [--format text|json]
  site-docs flow-tree <workspace-dir> [--format text|json]
  site-docs diagnose <workspace-dir> --flow <name> --step <step-id> [--cdp <endpoint>] [--format text|json]
  site-docs style <workspace-dir> [--check] [--format text|json]
  site-docs zip <workspace-dir> [--out <output.zip>] [--include-viewer]
  site-docs plugins <list|info|sync> <workspace-dir> [<namespace>] [--format text|json]
  site-docs login --backend-url <url>
  site-docs push <workspace-dir> [--kind calibrate|run|edit] [--author <name>]
  site-docs pull <workspace-dir> [--rev <id>]
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
  • run --concurrency <N> runs up to N flows in parallel (each its own Chromium session, isolated; default 1).
    Useful when several flows share a long preamble — total wall time = max(per-flow), not sum. Force-clamped
    to 1 when --pause / --stop-after / --start-from / --cdp is set. The target app must tolerate multiple sessions from one user.
  • run --start-from <step-id> --flow <name> SKIPS every step before <step-id> and starts execution there —
    the inverse of --stop-after. Pair with --cdp to attach to a Chrome that's already in the post-prior-steps
    state (e.g. left over from a paused previous run) and iterate on the new tail step in seconds rather
    than re-walking the whole extends chain. New annotations MERGE into the existing annotations.json by
    step id; the prior steps' annotations and screenshots are preserved.
  • run --cdp <endpoint> attaches to a running Chrome (start it with --remote-debugging-port=N) instead of
    launching one. site-docs won't close that Chrome. When --cdp is set, the cached storageState is NOT
    loaded into the context — the operator's Chrome owns its auth state. Useful with --start-from for the
    sub-3-sec iteration loop on long-async flows.
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
    because the auth cookie is usually httpOnly; inspect does the storageState→Playwright bridge for you). On a
    slow SPA, settle before the snapshot with --wait <ms> (default 800) or --wait-for '<css>'. --cdp <endpoint>
    attaches to an already-running Chrome (e.g. the one from capture-auth --cdp) instead of launching one.
  • calibrate takes a *structured flow-guide* (a flow-file in YAML, or a .md with a yaml fenced block) and
    writes flows/<name>.flow.yaml + a default docs/style.yaml. Loose-prose descriptions / live element-picking
    need the host agent — that's the /site-docs:calibrate *skill* (see the plugin), which then refines/produces
    the flow-file; this CLI command covers only the deterministic structured-input case.
  • lint runs pure-static checks across the workspace's flow-files — no Playwright, no live page. Rules:
    R001 (deep extends chain), R002 (annotation anchored to a likely-unmounting click/navigate target —
    suggest annotation.target override), R003 (wait_for with no timeout_ms on a long-async-looking step),
    R004 (bare [data-*=…] selector — may have hidden duplicates; suggest :visible / :has-text qualifier).
    Exit 1 if any warning/error; 0 otherwise. --format json emits machine-readable output for tooling.
  • flow-tree prints the workspace's extends graph (root flows + their descendants), plus any orphans
    (flows whose extends parent isn't in the workspace) and resolution issues (cycles / step-id collisions
    across the merge). Pure-static, ~no I/O beyond reading the flow files. Exit 1 if any issues.
  • diagnose gathers halt context for a specific step (the step's selector/wait_for/success, the halt
    screenshot if one exists, and — with --cdp — a live actionable() probe of the target on the running
    page) and prints recommendations (selector / wait_for / success / annotation_target / split_step /
    investigate). The engine never patches the flow-file itself — that's the agent's explicit opt-in
    action. --format json emits machine-readable output for an agent to act on. Pair with
    --start-from <step-id> --cdp on a follow-up run to validate the fix in seconds.
  • style initialises docs/style.yaml + derived docs/style.json if absent (otherwise validates the
    existing YAML against the schema and rederives the JSON). --check additionally scans every
    docs/<flow>/<step>.md user-facing write-up for jargon leaks against the style's pruning_rules
    (e.g. VERIFY / WAIT / data-testid leaking into user-facing prose). The engine never re-shapes
    prose itself (LLM-agnostic) — the agent does that at calibration time; this command is the
    enforcement layer for the semantic-reshape exit criterion. --format json emits machine-readable
    output for tooling.
  • zip packages the workspace's doc pack into a single archive for hand-off. Includes flows/, docs/,
    .site-docs.json, auth/strategy.yaml (env-var names only, no creds), README.md. Excludes .auth/
    (operator-local session state), **/halts/ (debug screenshots), .viewer/ by default (re-renderable
    from the doc pack; pass --include-viewer to bundle it). Defaults output to <workspace-name>.zip
    in the current dir; override with -o <path>. Requires the system 'zip' binary (preinstalled on
    macOS / Linux / WSL).
  • login validates a bearer token against a backend URL — hits /v1/health, /v1/workspaces. Reads
    the token from SITE_DOCS_TOKEN env var. Prints what the backend sees if the call succeeds,
    or a clear error if not. Stateless: doesn't store anything; configure the env var in your shell.
  • push serialises the workspace's doc pack (flows + annotations + screenshots + style + locators)
    and POSTs it as a new revision against the backend named in .site-docs.json (backend_url +
    optionally backend_workspace_id / backend_project_id; created on first push if absent and
    persisted to the config). --kind defaults to "calibrate"; --author defaults to the OS user.
  • pull fetches a revision's artifacts back into the workspace files (default: HEAD). Useful for
    syncing with a different operator's edits or rolling back to a named revision.`;

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
  const dir = resolveWorkspacePath(projectDir, "flows");
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    throw new Error(`no flows directory at ${dir}`);
  }
  return entries
    .filter((e) => e.endsWith(".flow.yaml"))
    .sort()
    .map((e) => resolveWorkspacePath(projectDir, "flows", e));
}

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
  const cache = new LocalStorageStateCache(resolveWorkspacePath(projectDir, ".auth"));
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
        docPackRoot: projectDir,
      });
    } catch (e) {
      const msg = (e as Error).message;
      if (/Executable doesn't exist|browserType\.launch|playwright install/i.test(msg)) {
        process.stderr.write(
          `${tag(name)}no Chromium binary found.  Install one:  npx playwright install chromium\n`,
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
  async function worker(): Promise<void> {
    while (idx < flows.length) {
      const flow = flows[idx++]!;
      if (!(await runOne(flow))) anyFailed = true;
    }
  }
  const workers = Math.min(concurrency, flows.length);
  if (workers > 1)
    process.stdout.write(
      `run: running ${flows.length} flows with ${workers} parallel worker(s)…\n`,
    );
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return anyFailed ? 1 : 0;
}

async function cmdRender(args: string[]): Promise<number> {
  const { positionals } = parseFlags(args);
  const projectDir = positionals[0];
  if (!projectDir) {
    process.stderr.write("render: missing <project-dir>\n\n" + USAGE + "\n");
    return 2;
  }
  const docsDir = resolveWorkspacePath(projectDir, "docs");
  const outDir = resolveWorkspacePath(projectDir, ".viewer");
  // The viewer is its own package/bin; shell out to it so the engine doesn't depend on it at build time.
  return new Promise<number>((resolve) => {
    const child = spawn("docsxai-viewer", ["build", docsDir, outDir], { stdio: "inherit" });
    child.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") {
        process.stderr.write(
          "render: `docsxai-viewer` not found on PATH.\n" +
            `  Run it directly:  docsxai-viewer build ${docsDir} ${outDir}\n` +
            "  (it's the @kalebtec/docsxai-viewer bin; in this workspace: pnpm exec docsxai-viewer …)\n",
        );
      } else {
        process.stderr.write(`render: ${e.message}\n`);
      }
      resolve(1);
    });
    child.on("exit", (code) => {
      if ((code ?? 1) === 0) {
        process.stdout.write(
          `render: open ${path.join(outDir, "index.html")}  (the index links the flows; each flow page shows the screenshots — hover a pulsing halo to read its callout)\n`,
        );
      }
      resolve(code ?? 1);
    });
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
  const baseURL =
    (typeof flags.get("base-url") === "string" ? (flags.get("base-url") as string) : undefined) ??
    wsCfg?.app_url;
  if (!baseURL) {
    process.stderr.write(
      "capture-auth: --base-url <url> is required (or set app_url in the workspace's .site-docs.json)\n",
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

async function cmdInit(args: string[]): Promise<number> {
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
      `  next: site-docs run ${workspaceDir}  (then: site-docs render ${workspaceDir})\n`,
    );
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
  const cdp = typeof flags.get("cdp") === "string" ? (flags.get("cdp") as string) : undefined;
  const explicitUrl =
    typeof flags.get("url") === "string" ? (flags.get("url") as string) : undefined;
  const url = explicitUrl ?? wsCfg?.app_url;
  if (!cdp && !url) {
    process.stderr.write(
      "inspect: no URL — pass --url <url>, set app_url in .site-docs.json, or use --cdp <endpoint>\n",
    );
    return 2;
  }
  const selector =
    typeof flags.get("selector") === "string" ? (flags.get("selector") as string) : undefined;
  const headed = flags.get("headed") === true;
  const ignoreHTTPSErrors =
    flags.get("ignore-https-errors") === true || !!wsCfg?.ignore_https_errors;
  const waitForSel =
    typeof flags.get("wait-for") === "string" ? (flags.get("wait-for") as string) : undefined;
  const waitMs =
    typeof flags.get("wait") === "string" ? Math.max(0, Number(flags.get("wait")) || 0) : 800;

  let storageState: import("./auth.js").StorageState | undefined;
  if (!cdp) {
    let role = typeof flags.get("role") === "string" ? (flags.get("role") as string) : undefined;
    if (!role) {
      try {
        role = parseAuthStrategyFile(
          await fs.readFile(resolveWorkspacePath(workspaceDir, "auth", "strategy.yaml"), "utf8"),
        ).default_role;
      } catch {
        role = "editor";
      }
    }
    storageState =
      (await new LocalStorageStateCache(resolveWorkspacePath(workspaceDir, ".auth")).load(role)) ??
      undefined;
    if (!storageState) {
      process.stderr.write(
        `inspect: no valid cached session for role "${role}" — inspecting unauthenticated (\`site-docs capture-auth\` first if the app needs login)\n`,
      );
    }
  }

  let session;
  try {
    session = await launchPlaywrightSession({
      ...(cdp
        ? { connectOverCdp: cdp }
        : {
            ...(url ? { baseURL: url } : {}),
            headed,
            ignoreHTTPSErrors,
            ...(storageState ? { storageState } : {}),
          }),
      docPackRoot: workspaceDir,
    });
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
    // In CDP-attach mode without an explicit --url, inspect whatever the attached browser already has open.
    if (url && (!cdp || explicitUrl))
      await session.page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => undefined);
    if (waitForSel)
      await session.page.waitForSelector(waitForSel, { timeout: 30_000 }).catch(() => undefined);
    else if (waitMs > 0) await session.page.waitForTimeout(waitMs);
    process.stdout.write(
      `inspect: ${session.page.url()}\n  title: ${await session.page.title().catch(() => "(?)")}\n`,
    );
    if (selector) {
      const els = await session.page.locator(selector).all();
      process.stdout.write(`  ${els.length} element(s) matching ${selector} (first 20):\n`);
      for (const el of els.slice(0, 20)) {
        const html = (await el.evaluate((e) => e.outerHTML).catch(() => ""))
          .replace(/\s+/g, " ")
          .slice(0, 400);
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
              typeof (e as unknown as { checkVisibility?: () => boolean }).checkVisibility ===
              "function"
                ? (e as unknown as { checkVisibility: () => boolean }).checkVisibility()
                : (e as unknown as { offsetParent?: unknown }).offsetParent != null,
          })),
        )
        .catch(() => [] as Array<{ testid: string; tag: string; text: string; visible: boolean }>);
      process.stdout.write(
        `  ${items.length} [data-testid] element(s) (✓ = visible) — pin these as locators:\n`,
      );
      for (const it of items) {
        process.stdout.write(
          `    ${it.visible ? "✓" : " "} [data-testid="${it.testid}"]  <${it.tag}>  ${it.text ? `"${it.text}"` : ""}\n`,
        );
      }
      process.stdout.write(
        `  (--selector '<css>' dumps matching elements' HTML; --url <url> for a sub-page; --wait <ms> / --wait-for '<css>' to settle a slow SPA before snapshot; --cdp <endpoint> to attach to a running Chrome instead of launching; --headed to open it)\n`,
      );
    }
    if (headed && !cdp) {
      process.stdout.write("inspect: browser is open — close it to exit.\n");
      await new Promise<void>((resolve) => session.browser.on("disconnected", () => resolve()));
    }
    return 0;
  } catch (e) {
    process.stderr.write(`inspect: ${(e as Error).message}\n`);
    return 1;
  } finally {
    if (!headed) await session.close();
  }
}

async function cmdLint(args: string[]): Promise<number> {
  const { positionals, flags } = parseFlags(args);
  if (!positionals[0]) {
    process.stderr.write(`lint: missing <workspace-dir>\n`);
    return 2;
  }
  const projectDir = positionals[0];
  const flowFilter =
    typeof flags.get("flow") === "string" ? (flags.get("flow") as string) : undefined;
  const format = typeof flags.get("format") === "string" ? (flags.get("format") as string) : "text";
  if (format !== "text" && format !== "json") {
    process.stderr.write(`lint: --format must be "text" or "json"\n`);
    return 2;
  }

  let flowPaths: string[];
  try {
    flowPaths = await listFlowFiles(projectDir);
  } catch (e) {
    process.stderr.write(`lint: ${(e as Error).message}\n`);
    return 2;
  }

  const flowsByName = new Map<string, FlowFile>();
  for (const p of flowPaths) {
    try {
      const text = await fs.readFile(p, "utf8");
      const flow = parseFlowFile(text, path.basename(p));
      flowsByName.set(flow.name, flow);
    } catch (e) {
      const msg = e instanceof FlowFileError ? e.message : (e as Error).message;
      process.stderr.write(`lint: parse error in ${p}: ${msg}\n`);
      return 1;
    }
  }

  const targets = flowFilter
    ? flowsByName.has(flowFilter)
      ? [flowsByName.get(flowFilter)!]
      : []
    : Array.from(flowsByName.values());
  if (flowFilter && targets.length === 0) {
    process.stderr.write(`lint: flow not found: ${flowFilter}\n`);
    return 2;
  }

  const loadFlow = (name: string) => {
    const f = flowsByName.get(name);
    if (!f) throw new Error(`extends target not found: ${name}`);
    return f;
  };

  const issues: LintIssue[] = [];
  for (const flow of targets) {
    const result = await lintFlow(flow, { loadFlow });
    issues.push(...result);
  }

  if (format === "json") {
    process.stdout.write(JSON.stringify(issues, null, 2) + "\n");
  } else {
    process.stdout.write(formatIssuesText(issues));
  }

  return issues.some((i) => i.severity === "error" || i.severity === "warning") ? 1 : 0;
}

async function cmdFlowTree(args: string[]): Promise<number> {
  const { positionals, flags } = parseFlags(args);
  if (!positionals[0]) {
    process.stderr.write(`flow-tree: missing <workspace-dir>\n`);
    return 2;
  }
  const projectDir = positionals[0];
  const format = typeof flags.get("format") === "string" ? (flags.get("format") as string) : "text";
  if (format !== "text" && format !== "json") {
    process.stderr.write(`flow-tree: --format must be "text" or "json"\n`);
    return 2;
  }

  let flowPaths: string[];
  try {
    flowPaths = await listFlowFiles(projectDir);
  } catch (e) {
    process.stderr.write(`flow-tree: ${(e as Error).message}\n`);
    return 2;
  }

  const flowsByName = new Map<string, FlowFile>();
  for (const p of flowPaths) {
    try {
      const text = await fs.readFile(p, "utf8");
      const flow = parseFlowFile(text, path.basename(p));
      flowsByName.set(flow.name, flow);
    } catch (e) {
      const msg = e instanceof FlowFileError ? e.message : (e as Error).message;
      process.stderr.write(`flow-tree: parse error in ${p}: ${msg}\n`);
      return 1;
    }
  }

  const tree = await buildFlowTree(flowsByName);

  if (format === "json") {
    process.stdout.write(JSON.stringify(tree, null, 2) + "\n");
  } else {
    process.stdout.write(formatTreeText(tree));
  }

  return tree.issues.length > 0 || tree.orphans.length > 0 ? 1 : 0;
}

async function cmdDiagnose(args: string[]): Promise<number> {
  const { positionals, flags } = parseFlags(args);
  if (!positionals[0]) {
    process.stderr.write(`diagnose: missing <workspace-dir>\n`);
    return 2;
  }
  const projectDir = positionals[0];
  const flowName =
    typeof flags.get("flow") === "string" ? (flags.get("flow") as string) : undefined;
  const stepId = typeof flags.get("step") === "string" ? (flags.get("step") as string) : undefined;
  const cdpEndpoint =
    typeof flags.get("cdp") === "string" ? (flags.get("cdp") as string) : undefined;
  const format = typeof flags.get("format") === "string" ? (flags.get("format") as string) : "text";

  if (!flowName) {
    process.stderr.write(`diagnose: --flow <name> required\n`);
    return 2;
  }
  if (!stepId) {
    process.stderr.write(`diagnose: --step <step-id> required\n`);
    return 2;
  }
  if (format !== "text" && format !== "json") {
    process.stderr.write(`diagnose: --format must be "text" or "json"\n`);
    return 2;
  }

  // Load the flow (resolving `extends` so step lookup works against the merged step list).
  const loadFlowFile = async (name: string) => {
    const fp = resolveWorkspacePath(projectDir, "flows", `${name}.flow.yaml`);
    let text: string;
    try {
      text = await fs.readFile(fp, "utf8");
    } catch {
      throw new FlowFileError(`no flow named "${name}" at ${fp}`);
    }
    return parseFlowFile(text, fp);
  };
  let flow: FlowFile;
  try {
    const parsed = await loadFlowFile(flowName);
    flow = parsed.extends ? await resolveFlowExtends(parsed, loadFlowFile) : parsed;
  } catch (e) {
    const msg = e instanceof FlowFileError ? e.message : (e as Error).message;
    process.stderr.write(`diagnose: ${msg}\n`);
    return 1;
  }

  const step = flow.steps.find((s) => s.id === stepId);
  if (!step) {
    process.stderr.write(
      `diagnose: no step "${stepId}" in flow "${flowName}" (merged step list: ${flow.steps.map((s) => s.id).join(", ")})\n`,
    );
    return 1;
  }

  const resolvedSelector = step.target
    ? step.target.startsWith("$")
      ? (flow.locators[step.target.slice(1)] ?? step.target)
      : step.target
    : undefined;

  const haltScreenshotAbsPath = resolveWorkspacePath(
    projectDir,
    "docs",
    flowName,
    "halts",
    `${stepId}.png`,
  );

  // Optional live probe via --cdp.
  let liveProbe: (() => ReturnType<typeof probeLive>) | undefined;
  let liveSession: Awaited<ReturnType<typeof launchPlaywrightSession>> | undefined;
  if (cdpEndpoint && resolvedSelector) {
    liveProbe = async () => {
      liveSession = await launchPlaywrightSession({
        connectOverCdp: cdpEndpoint,
        docPackRoot: projectDir,
      });
      return probeLive(liveSession.driver, resolvedSelector, cdpEndpoint);
    };
  }

  let report: DiagnoseReport;
  try {
    report = await buildDiagnoseReport({
      workspace: projectDir,
      flow,
      step,
      ...(resolvedSelector ? { resolvedSelector } : {}),
      haltScreenshotAbsPath,
      ...(liveProbe ? { liveProbe } : {}),
    });
  } catch (e) {
    process.stderr.write(`diagnose: live probe failed: ${(e as Error).message}\n`);
    return 1;
  } finally {
    if (liveSession) await liveSession.close();
  }

  if (format === "json") {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    process.stdout.write(formatReportText(report));
  }
  return 0;
}

async function cmdStyle(args: string[]): Promise<number> {
  const { positionals, flags } = parseFlags(args);
  if (!positionals[0]) {
    process.stderr.write(`style: missing <workspace-dir>\n`);
    return 2;
  }
  const projectDir = positionals[0];
  const check = flags.get("check") === true;
  const format = typeof flags.get("format") === "string" ? (flags.get("format") as string) : "text";
  if (format !== "text" && format !== "json") {
    process.stderr.write(`style: --format must be "text" or "json"\n`);
    return 2;
  }

  // init-if-absent (idempotent); then load + validate; then rederive JSON; then optional jargon check.
  const { created } = await initStyleIfAbsent(projectDir);
  let style;
  try {
    style = await loadStyle(projectDir);
  } catch (e) {
    if (e instanceof StyleError) {
      process.stderr.write(`style: ${e.message}\n`);
      return 1;
    }
    throw e;
  }
  if (!style) {
    // Shouldn't happen after initStyleIfAbsent, but defensive.
    process.stderr.write(`style: failed to initialise style.yaml in ${projectDir}\n`);
    return 1;
  }
  // Always rewrite to ensure derived JSON stays in sync with YAML (idempotent).
  const paths = await writeStyle(projectDir, style);

  let hits: Awaited<ReturnType<typeof scanWorkspaceForJargon>> = [];
  if (check) {
    hits = await scanWorkspaceForJargon(projectDir, style);
  }

  if (format === "json") {
    process.stdout.write(
      JSON.stringify({ style, paths, created, jargonLeaks: check ? hits : undefined }, null, 2) +
        "\n",
    );
  } else {
    process.stdout.write(
      `style: ${created ? "created" : "validated"} ${path.relative(projectDir, paths.yamlPath)}; rederived ${path.relative(projectDir, paths.jsonPath)}\n`,
    );
    if (check) {
      process.stdout.write("\n");
      process.stdout.write(formatJargonHitsText(hits));
    }
  }

  return check && hits.length > 0 ? 1 : 0;
}

async function cmdZip(args: string[]): Promise<number> {
  const { positionals, flags } = parseFlags(args);
  if (!positionals[0]) {
    process.stderr.write(`zip: missing <workspace-dir>\n`);
    return 2;
  }
  const projectDir = positionals[0];
  const output =
    typeof flags.get("out") === "string"
      ? (flags.get("out") as string)
      : path.join(process.cwd(), `${path.basename(path.resolve(projectDir))}.zip`);
  const includeViewer = flags.get("include-viewer") === true;

  try {
    const r = await zipDocPack({ workspace: projectDir, output, includeViewer });
    const kb = (r.bytes / 1024).toFixed(1);
    process.stdout.write(`zip: wrote ${r.output} (${kb} KB)\n`);
    return 0;
  } catch (e) {
    if (e instanceof ZipError) {
      process.stderr.write(`zip: ${e.message}\n`);
      return 1;
    }
    throw e;
  }
}

async function cmdLogin(args: string[]): Promise<number> {
  const { flags } = parseFlags(args);
  const backendUrl =
    typeof flags.get("backend-url") === "string" ? (flags.get("backend-url") as string) : undefined;
  if (!backendUrl) {
    process.stderr.write(`login: --backend-url <url> required\n`);
    return 2;
  }
  if (!process.env.SITE_DOCS_TOKEN) {
    process.stderr.write(
      `login: SITE_DOCS_TOKEN env var not set. Export it before running: SITE_DOCS_TOKEN=<token> site-docs login --backend-url ${backendUrl}\n`,
    );
    return 2;
  }
  let client: BackendClient;
  try {
    client = new BackendClient({ baseUrl: backendUrl });
  } catch (e) {
    process.stderr.write(`login: ${(e as Error).message}\n`);
    return 1;
  }
  try {
    const h = await client.health();
    if (!h.ok) {
      process.stderr.write(`login: backend health-check returned ok=false\n`);
      return 1;
    }
    const wss = await client.listWorkspaces();
    process.stdout.write(
      `login: ok. ${wss.length} workspace${wss.length !== 1 ? "s" : ""} visible at ${backendUrl}\n`,
    );
    return 0;
  } catch (e) {
    if (e instanceof BackendClientError) {
      process.stderr.write(`login: ${e.message}\n`);
      return 1;
    }
    throw e;
  }
}

/** Ensure the workspace has a backend workspace + project to push to; create them on first push. */
async function ensureBackendBinding(
  client: BackendClient,
  projectDir: string,
  cfg: { backend_workspace_id?: string; backend_project_id?: string },
  workspaceName: string,
): Promise<{ wsId: string; projectId: string; createdAny: boolean }> {
  let wsId = cfg.backend_workspace_id;
  let projectId = cfg.backend_project_id;
  let createdAny = false;
  if (!wsId) {
    const ws = await client.createWorkspace(workspaceName);
    wsId = ws.id;
    createdAny = true;
  }
  if (!projectId) {
    const proj = await client.createProject(wsId, workspaceName);
    projectId = proj.id;
    createdAny = true;
  }
  return { wsId, projectId, createdAny };
}

async function cmdPush(args: string[]): Promise<number> {
  const { positionals, flags } = parseFlags(args);
  if (!positionals[0]) {
    process.stderr.write(`push: missing <workspace-dir>\n`);
    return 2;
  }
  const projectDir = positionals[0];
  const wsCfg = await loadWorkspaceConfig(projectDir);
  if (!wsCfg?.backend_url) {
    process.stderr.write(
      `push: no backend_url in ${path.join(projectDir, ".site-docs.json")}. Set it before pushing.\n`,
    );
    return 2;
  }
  const kindArg =
    typeof flags.get("kind") === "string" ? (flags.get("kind") as string) : "calibrate";
  if (kindArg !== "calibrate" && kindArg !== "run" && kindArg !== "edit") {
    process.stderr.write(`push: --kind must be calibrate | run | edit (got "${kindArg}")\n`);
    return 2;
  }
  const author =
    (typeof flags.get("author") === "string" ? (flags.get("author") as string) : null) ??
    process.env.USER ??
    "unknown";

  let client: BackendClient;
  try {
    client = new BackendClient({ baseUrl: wsCfg.backend_url });
  } catch (e) {
    process.stderr.write(`push: ${(e as Error).message}\n`);
    return 1;
  }

  try {
    const binding = await ensureBackendBinding(
      client,
      projectDir,
      wsCfg,
      path.basename(path.resolve(projectDir)),
    );
    if (binding.createdAny) {
      // Persist the new IDs back to .site-docs.json so subsequent push/pull don't re-create.
      const updated = {
        ...wsCfg,
        backend_workspace_id: binding.wsId,
        backend_project_id: binding.projectId,
      };
      await fs.writeFile(
        resolveWorkspacePath(projectDir, ".site-docs.json"),
        JSON.stringify(updated, null, 2) + "\n",
        "utf8",
      );
    }

    const rev = await client.createRevision(binding.wsId, binding.projectId, {
      kind: kindArg,
      author,
    });
    const payloads = await readDocPack(projectDir);
    let pushed = 0;
    for (const [key, p] of Object.entries(payloads) as Array<
      [keyof DocPackPayloads, DocPackPayloads[keyof DocPackPayloads]]
    >) {
      if (p === null) continue;
      await client.putArtifact(binding.wsId, binding.projectId, rev.id, key, p);
      pushed++;
    }
    process.stdout.write(
      `push: revision ${rev.id} (${kindArg}, ${author}) — ${pushed} artifact slot${pushed !== 1 ? "s" : ""} uploaded\n`,
    );
    return 0;
  } catch (e) {
    if (e instanceof BackendClientError) {
      process.stderr.write(`push: ${e.message}\n`);
      return 1;
    }
    throw e;
  }
}

async function cmdPull(args: string[]): Promise<number> {
  const { positionals, flags } = parseFlags(args);
  if (!positionals[0]) {
    process.stderr.write(`pull: missing <workspace-dir>\n`);
    return 2;
  }
  const projectDir = positionals[0];
  const wsCfg = await loadWorkspaceConfig(projectDir);
  if (!wsCfg?.backend_url || !wsCfg.backend_workspace_id || !wsCfg.backend_project_id) {
    process.stderr.write(
      `pull: workspace isn't bound to a backend yet. Run \`push\` first (or hand-edit .site-docs.json's backend_workspace_id / backend_project_id).\n`,
    );
    return 2;
  }
  const revArg = typeof flags.get("rev") === "string" ? (flags.get("rev") as string) : "head";

  let client: BackendClient;
  try {
    client = new BackendClient({ baseUrl: wsCfg.backend_url });
  } catch (e) {
    process.stderr.write(`pull: ${(e as Error).message}\n`);
    return 1;
  }

  try {
    const rev = await client.getRevision(
      wsCfg.backend_workspace_id,
      wsCfg.backend_project_id,
      revArg,
    );
    const payloads: Partial<DocPackPayloads> = {};
    for (const artifact of rev.artifacts) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (payloads as any)[artifact] = await client.getArtifact(
        wsCfg.backend_workspace_id,
        wsCfg.backend_project_id,
        rev.id,
        artifact,
      );
    }
    const r = await writeDocPack(projectDir, payloads);
    process.stdout.write(
      `pull: revision ${rev.id} (${rev.kind}, ${rev.author}) — wrote ${r.filesWritten} file(s)\n`,
    );
    return 0;
  } catch (e) {
    if (e instanceof BackendClientError) {
      process.stderr.write(`pull: ${e.message}\n`);
      return 1;
    }
    throw e;
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
    case "lint":
      return cmdLint(rest);
    case "flow-tree":
      return cmdFlowTree(rest);
    case "diagnose":
      return cmdDiagnose(rest);
    case "style":
      return cmdStyle(rest);
    case "zip":
      return cmdZip(rest);
    case "plugins":
      return pluginsCli(rest);
    case "login":
      return cmdLogin(rest);
    case "push":
      return cmdPush(rest);
    case "pull":
      return cmdPull(rest);
    default:
      process.stderr.write(`unknown command: ${cmd}\n\n${USAGE}\n`);
      return 2;
  }
}

// Run as the bin entry, but not when imported (e.g. in tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main(process.argv.slice(2)).then((code) => process.exit(code));
}
