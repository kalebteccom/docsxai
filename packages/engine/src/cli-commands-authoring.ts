// Calibration-aid commands — the static / inspection tools an engineer leans on while hand-authoring
// or fixing a flow-file. None of them mutate the doc pack; they read, check, and report:
//   inspect    — open the app (cached session loaded) and dump [data-testid]s for pinning locators
//   lint       — pure-static flow-file checks (R001…R004 + plugin-contributed rules)
//   flow-tree  — the extends graph, orphans, and resolution issues
//   diagnose   — halt context + recommendations for one step (optional live --cdp probe)

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { LocalStorageStateCache, parseAuthStrategyFile } from "./auth.js";
import { waitForBrowserClose } from "./browser-wait.js";
import { describeBrowserLaunch } from "./browser-launch-error.js";
import { type FlowFile } from "./doc-pack.js";
import {
  expandFlowVariants,
  FlowFileError,
  parseFlowFile,
  resolveFlowExtends,
} from "./flow-file.js";
import { variantDocDir, type FlowVariant } from "./flow-matrix.js";
import {
  buildDiagnoseReport,
  type DiagnoseReport,
  formatReportText,
  pickDiagnoseVariant,
  probeLive,
} from "./diagnose.js";
import { formatIssuesText, type LintIssue, type LintRule, lintFlow } from "./flow-lint.js";
import { buildFlowTree, formatTreeText } from "./flow-tree.js";
import { readPluginsLock, readWorkspacePluginsConfig } from "./plugins/lock.js";
import { resolvePlugins } from "./plugins/runtime.js";
import { launchPlaywrightSession } from "./playwright-driver.js";
import { loadWorkspaceConfig, resolveWorkspacePath } from "./workspace.js";
import { bareValueFlagExit, claimFlowName, listFlowFiles } from "./cli-shared.js";
import { parseCommandFlags } from "./cli-flags.js";
import { describeFsProblem, shellQuote, usageError, withNext } from "./cli-messages.js";

export async function cmdInspect(args: string[]): Promise<number> {
  const parsed = parseCommandFlags("inspect", args);
  if (typeof parsed === "number") return parsed;
  const { positionals, flags } = parsed;
  const workspaceDir = positionals[0];
  if (!workspaceDir) return usageError("inspect", "missing <workspace-dir>");
  const bare = bareValueFlagExit("inspect", flags, [
    "url",
    "selector",
    "cdp",
    "wait",
    "wait-for",
    "role",
  ]);
  if (bare !== undefined) return bare;
  const waitFlag = flags.get("wait");
  if (typeof waitFlag === "string" && !/^\d+$/.test(waitFlag)) {
    return usageError(
      "inspect",
      `--wait must be a whole number of milliseconds (got "${waitFlag}")`,
    );
  }
  const wsCfg = await loadWorkspaceConfig(workspaceDir);
  const cdp = typeof flags.get("cdp") === "string" ? (flags.get("cdp") as string) : undefined;
  const explicitUrl =
    typeof flags.get("url") === "string" ? (flags.get("url") as string) : undefined;
  const url = explicitUrl ?? wsCfg?.app_url;
  if (!cdp && !url) {
    return usageError(
      "inspect",
      "no URL — pass --url <url>, set app_url in .docsxai.json, or use --cdp <endpoint>",
    );
  }
  const selector =
    typeof flags.get("selector") === "string" ? (flags.get("selector") as string) : undefined;
  const headed = flags.get("headed") === true;
  const ignoreHTTPSErrors =
    flags.get("ignore-https-errors") === true || !!wsCfg?.ignore_https_errors;
  const waitForSel =
    typeof flags.get("wait-for") === "string" ? (flags.get("wait-for") as string) : undefined;
  const waitMs = typeof waitFlag === "string" ? Number(waitFlag) : 800;

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
    try {
      storageState =
        (await new LocalStorageStateCache(resolveWorkspacePath(workspaceDir, ".auth")).load(
          role,
        )) ?? undefined;
    } catch (e) {
      const problem = describeFsProblem(e);
      if (!problem) throw e;
      process.stderr.write(`inspect: ${withNext(problem.reason, problem.next)}\n`);
      return 1;
    }
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
    const problem = describeBrowserLaunch((e as Error).message, cdp);
    process.stderr.write(
      `inspect: ${problem.next ? withNext(problem.reason, problem.next) : problem.reason}\n`,
    );
    return 1;
  }
  try {
    // In CDP-attach mode without an explicit --url, inspect whatever the attached browser already has open.
    if (url && (!cdp || explicitUrl))
      await session.page.goto(url, { waitUntil: "domcontentloaded" }).catch((e: Error) => {
        const why = e.message.split("\n")[0];
        process.stderr.write(
          `inspect: warning — could not load ${url}: ${why}; is the app running?\n`,
        );
      });
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
      await waitForBrowserClose(session.browser);
    }
    return 0;
  } catch (e) {
    process.stderr.write(`inspect: ${(e as Error).message}\n`);
    return 1;
  } finally {
    // A headed launch stays open for the operator; an attach has nothing to keep open.
    if (!headed || cdp) await session.close();
  }
}

export async function cmdLint(args: string[]): Promise<number> {
  const parsed = parseCommandFlags("lint", args);
  if (typeof parsed === "number") return parsed;
  const { positionals, flags } = parsed;
  if (!positionals[0]) return usageError("lint", "missing <workspace-dir>");
  const projectDir = positionals[0];
  const bareLint = bareValueFlagExit("lint", flags, ["flow", "format"]);
  if (bareLint !== undefined) return bareLint;
  const flowFilter =
    typeof flags.get("flow") === "string" ? (flags.get("flow") as string) : undefined;
  const format = typeof flags.get("format") === "string" ? (flags.get("format") as string) : "text";
  if (format !== "text" && format !== "json") {
    return usageError("lint", '--format must be "text" or "json"');
  }

  let flowPaths: string[];
  try {
    flowPaths = await listFlowFiles(projectDir);
  } catch (e) {
    process.stderr.write(`lint: ${(e as Error).message}\n`);
    return 2;
  }

  const flowsByName = new Map<string, FlowFile>();
  const fileNames = new Map<string, string>();
  const owners = new Map<string, string>();
  for (const p of flowPaths) {
    try {
      const text = await fs.readFile(p, "utf8");
      const flow = parseFlowFile(text, path.basename(p));
      const duplicate = claimFlowName(owners, flow.name, p);
      if (duplicate) throw new FlowFileError(duplicate);
      flowsByName.set(flow.name, flow);
      fileNames.set(flow.name, path.basename(p));
    } catch (e) {
      const msg = e instanceof FlowFileError ? e.message : (e as Error).message;
      process.stderr.write(
        `lint: ${withNext(`parse error in ${p}: ${msg}`, `fix the flow-file, then docsxai lint ${shellQuote(projectDir)}`)}\n`,
      );
      return 1;
    }
  }

  const targets = flowFilter
    ? flowsByName.has(flowFilter)
      ? [flowsByName.get(flowFilter)!]
      : []
    : Array.from(flowsByName.values());
  if (flowFilter && targets.length === 0) {
    const known = [...flowsByName.keys()].join(", ") || "none";
    return usageError("lint", `flow not found: ${flowFilter} (flows: ${known})`);
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
    const result = await lintFlow(flow, {
      loadFlow,
      extraRules,
      fileName: fileNames.get(flow.name),
    });
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
  const parsed = parseCommandFlags("flow-tree", args);
  if (typeof parsed === "number") return parsed;
  const { positionals, flags } = parsed;
  if (!positionals[0]) return usageError("flow-tree", "missing <workspace-dir>");
  const projectDir = positionals[0];
  const bareTree = bareValueFlagExit("flow-tree", flags, ["format"]);
  if (bareTree !== undefined) return bareTree;
  const format = typeof flags.get("format") === "string" ? (flags.get("format") as string) : "text";
  if (format !== "text" && format !== "json") {
    return usageError("flow-tree", '--format must be "text" or "json"');
  }

  let flowPaths: string[];
  try {
    flowPaths = await listFlowFiles(projectDir);
  } catch (e) {
    process.stderr.write(`flow-tree: ${(e as Error).message}\n`);
    return 2;
  }

  const flowsByName = new Map<string, FlowFile>();
  const owners = new Map<string, string>();
  for (const p of flowPaths) {
    try {
      const text = await fs.readFile(p, "utf8");
      const flow = parseFlowFile(text, path.basename(p));
      const duplicate = claimFlowName(owners, flow.name, p);
      if (duplicate) throw new FlowFileError(duplicate);
      flowsByName.set(flow.name, flow);
    } catch (e) {
      const msg = e instanceof FlowFileError ? e.message : (e as Error).message;
      process.stderr.write(
        `flow-tree: ${withNext(`parse error in ${p}: ${msg}`, `fix the flow-file, then docsxai flow-tree ${shellQuote(projectDir)}`)}\n`,
      );
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
  const parsed = parseCommandFlags("diagnose", args);
  if (typeof parsed === "number") return parsed;
  const { positionals, flags } = parsed;
  if (!positionals[0]) return usageError("diagnose", "missing <workspace-dir>");
  const projectDir = positionals[0];
  const bareDiagnose = bareValueFlagExit("diagnose", flags, [
    "flow",
    "step",
    "cdp",
    "variant",
    "format",
  ]);
  if (bareDiagnose !== undefined) return bareDiagnose;
  const flowName =
    typeof flags.get("flow") === "string" ? (flags.get("flow") as string) : undefined;
  const stepId = typeof flags.get("step") === "string" ? (flags.get("step") as string) : undefined;
  const cdpEndpoint =
    typeof flags.get("cdp") === "string" ? (flags.get("cdp") as string) : undefined;
  const variantFlag =
    typeof flags.get("variant") === "string" ? (flags.get("variant") as string) : undefined;
  const format = typeof flags.get("format") === "string" ? (flags.get("format") as string) : "text";

  if (!flowName) return usageError("diagnose", "--flow <name> required");
  if (!stepId) return usageError("diagnose", "--step <step-id> required");
  if (format !== "text" && format !== "json") {
    return usageError("diagnose", '--format must be "text" or "json"');
  }

  // Load the flow (resolving `extends` so step lookup works against the merged step list).
  const loadFlowFile = async (name: string) => {
    const fp = resolveWorkspacePath(projectDir, "flows", `${name}.flow.yaml`);
    let text: string;
    try {
      text = await fs.readFile(fp, "utf8");
    } catch {
      throw new FlowFileError(
        withNext(
          `no flow named "${name}" at ${fp}`,
          `docsxai flow-tree ${shellQuote(projectDir)}  (lists the flows)`,
        ),
      );
    }
    return parseFlowFile(text, fp);
  };
  let flow: FlowFile;
  let variants: FlowVariant[];
  try {
    const parsed = await loadFlowFile(flowName);
    flow = parsed.extends ? await resolveFlowExtends(parsed, loadFlowFile) : parsed;
    variants = expandFlowVariants(flow);
  } catch (e) {
    const msg = e instanceof FlowFileError ? e.message : (e as Error).message;
    process.stderr.write(`diagnose: ${msg}\n`);
    return 1;
  }

  // A flow with a `matrix` is diagnosed one variant at a time: its steps and halt shot are the variant's.
  const picked = await pickDiagnoseVariant({
    workspace: projectDir,
    flow: flowName,
    stepId,
    variants,
    requested: variantFlag,
  });
  if ("error" in picked) {
    process.stderr.write(`diagnose: ${picked.error}\n`);
    return 2;
  }
  const variantId = picked.variant.id;
  flow = picked.variant.flow;

  const step = flow.steps.find((s) => s.id === stepId);
  if (!step) {
    process.stderr.write(
      `diagnose: no step "${stepId}" in flow "${flowName}"${variantId ? ` variant "${variantId}"` : ""} (${variantId ? "variant" : "merged"} step list: ${flow.steps.map((s) => s.id).join(", ")})\n`,
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
    variantDocDir(flowName, variantId),
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
      ...(variantId ? { variant: { id: variantId, all: picked.ids } } : {}),
    });
  } catch (e) {
    const hint = cdpEndpoint
      ? withNext(
          "",
          `check Chrome is running with --remote-debugging-port and --cdp ${shellQuote(cdpEndpoint)} points at it, or drop --cdp`,
        )
      : "";
    process.stderr.write(`diagnose: live probe failed: ${(e as Error).message}${hint}\n`);
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
