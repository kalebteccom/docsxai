// Calibration-aid commands — the static / inspection tools an engineer leans on while hand-authoring
// or fixing a flow-file. None of them mutate the doc pack; they read, check, and report:
//   inspect    — open the app (cached session loaded) and dump [data-testid]s for pinning locators
//   lint       — pure-static flow-file checks (R001…R004 + plugin-contributed rules)
//   flow-tree  — the extends graph, orphans, and resolution issues
//   diagnose   — halt context + recommendations for one step (optional live --cdp probe)
//   style      — init/validate docs/style.yaml; --check scans prose for jargon leaks

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { LocalStorageStateCache, parseAuthStrategyFile } from "./auth.js";
import { type FlowFile } from "./doc-pack.js";
import { FlowFileError, parseFlowFile, resolveFlowExtends } from "./flow-file.js";
import {
  buildDiagnoseReport,
  type DiagnoseReport,
  formatReportText,
  probeLive,
} from "./diagnose.js";
import { formatIssuesText, type LintIssue, type LintRule, lintFlow } from "./flow-lint.js";
import { buildFlowTree, formatTreeText } from "./flow-tree.js";
import {
  formatJargonHitsText,
  initStyleIfAbsent,
  loadStyle,
  scanWorkspaceForJargon,
  StyleError,
  writeStyle,
} from "./style.js";
import { readPluginsLock, readWorkspacePluginsConfig } from "./plugins/lock.js";
import { resolvePlugins } from "./plugins/runtime.js";
import { launchPlaywrightSession } from "./playwright-driver.js";
import { loadWorkspaceConfig, resolveWorkspacePath } from "./workspace.js";
import { listFlowFiles, parseFlags } from "./cli-shared.js";
import { USAGE } from "./cli-usage.js";

export async function cmdInspect(args: string[]): Promise<number> {
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
      "inspect: no URL — pass --url <url>, set app_url in .docsxai.json, or use --cdp <endpoint>\n",
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
        `inspect: no valid cached session for role "${role}" — inspecting unauthenticated (\`docsxai capture-auth\` first if the app needs login)\n`,
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
      process.stderr.write(
        "inspect: no Chromium binary — `npx playwright-core install chromium` (source checkout: `pnpm -C packages/engine exec playwright-core install chromium`)\n",
      );
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

export async function cmdLint(args: string[]): Promise<number> {
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

  // Lint-rule plugins: resolve the workspace's plugin registry and feed registered
  // rules through lintFlow's extraRules. A plugin-resolution failure degrades to
  // core rules with a warning — lint must stay usable while a plugin is broken.
  let extraRules: LintRule[] = [];
  try {
    const cfg = await readWorkspacePluginsConfig(projectDir);
    if (cfg.sources.length > 0) {
      const lock = await readPluginsLock(projectDir);
      const registry = await resolvePlugins({
        workspaceDir: projectDir,
        sources: cfg.sources,
        enabledCapabilities: cfg.capabilities,
        lock,
      });
      extraRules = registry.getLintRules();
    }
  } catch (e) {
    process.stderr.write(`lint: plugin rules skipped — ${(e as Error).message}\n`);
  }

  const issues: LintIssue[] = [];
  for (const flow of targets) {
    const result = await lintFlow(flow, { loadFlow, extraRules });
    issues.push(...result);
  }

  if (format === "json") {
    process.stdout.write(JSON.stringify(issues, null, 2) + "\n");
  } else {
    process.stdout.write(formatIssuesText(issues));
  }

  return issues.some((i) => i.severity === "error" || i.severity === "warning") ? 1 : 0;
}

export async function cmdFlowTree(args: string[]): Promise<number> {
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

export async function cmdDiagnose(args: string[]): Promise<number> {
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

export async function cmdStyle(args: string[]): Promise<number> {
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
