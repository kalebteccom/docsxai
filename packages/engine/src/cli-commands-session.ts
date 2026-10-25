// Runtime / session commands — the ones that stand up a workspace or drive a live browser:
//   calibrate     — write flows/<name>.flow.yaml from a structured flow-guide
//   run           — execute the workspace's flows against the live app, emitting annotations
//
// These reach into the engine's heavier subsystems (Playwright, auth, the flow runtime); the
// thinner static/aid commands live in cli-commands-authoring.ts and capture-auth lives in cli-commands-auth.ts.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import {
  cachedSessionIsCorrupt,
  parseAuthStrategyFile,
  resolveStateCache,
  storageStateFileName,
  type StorageState,
} from "./auth.js";
import { calibrate, CalibrateError } from "./calibrate.js";
import { type FlowFile } from "./doc-pack.js";
import {
  expandFlowVariants,
  FlowFileError,
  parseFlowFile,
  resolveFlowExtends,
} from "./flow-file.js";
import { type FlowVariant } from "./flow-matrix.js";
import { assertNoCaseCollision } from "./flow-name-rules.js";
import { recordRunHistory } from "./backend-client.js";
import { resolveDeviceScaleFactor } from "./device-scale-factor.js";
import { runFlowsInSessions } from "./run-flows.js";
import { loadWorkspaceConfig, resolveWorkspacePath } from "./workspace.js";
import {
  bareValueFlagExit,
  claimFlowName,
  flagMissingValue,
  isRunnableUrl,
  listFlowFiles,
} from "./cli-shared.js";
import { parseCommandFlags } from "./cli-flags.js";
import { emitVerifyReport, parseVerifyArgs } from "./cli-verify.js";
import { verifyDeterminism } from "./verify-determinism.js";
import { VerifyTreeError } from "./verify-tree.js";
import { describeFsError, shellQuote, usageError, withNext } from "./cli-messages.js";
import { reportRun } from "./cli-run-summary.js";
import { warnStaleMatrixOutputs } from "./cli-run-stale.js";
import { warnUnusableConfig } from "./cli-backend-errors.js";

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
      withNext(
        `auth/strategy.yaml configures role "${role}" but there is no valid cached session at ${path.join(projectDir, ".auth", storageStateFileName(role))} (${(await cachedSessionIsCorrupt(resolveWorkspacePath(projectDir, ".auth"), role)) ? "the file is corrupt" : "missing or expired"})`,
        `docsxai capture-auth ${shellQuote(projectDir)}`,
      ),
    );
  }
  return state;
}

/** The flags of `run` that take a value; one given bare is a usage error, not a flag to ignore. */
const RUN_VALUE_FLAGS = [
  "flow",
  "stop-after",
  "start-from",
  "variant",
  "cdp",
  "base-url",
  "concurrency",
  "device-scale-factor",
];

export async function cmdRun(args: string[]): Promise<number> {
  const parsed = parseCommandFlags("run", args);
  if (typeof parsed === "number") return parsed;
  const { positionals, flags } = parsed;
  if (!positionals[0]) return usageError("run", "missing <workspace-dir>");
  const projectDir: string = positionals[0];
  const bare = flagMissingValue(flags, RUN_VALUE_FLAGS);
  if (bare) return usageError("run", `--${bare} needs a value`);
  // An empty value is falsy downstream, so `--flow ""` would run every flow and `--variant ""` every variant.
  const empty = RUN_VALUE_FLAGS.find((n) => flags.get(n) === "" && n !== "device-scale-factor");
  if (empty) return usageError("run", `--${empty} needs a value (got an empty string)`);
  const concurrencyFlag = flags.get("concurrency");
  if (typeof concurrencyFlag === "string" && !/^[1-9]\d*$/.test(concurrencyFlag)) {
    return usageError(
      "run",
      `--concurrency must be a whole number of 1 or more (got "${concurrencyFlag}")`,
    );
  }
  const dsf = resolveDeviceScaleFactor(
    flags.get("device-scale-factor"),
    process.env,
    typeof flags.get("cdp") === "string",
  );
  if ("error" in dsf) return usageError("run", dsf.error);
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
    return usageError("run", "--start-from requires --flow <name> (single-flow calibration aid)");
  }
  const verify = parseVerifyArgs(flags);
  if (typeof verify === "string") return usageError("run", verify);
  const wsCfg = await loadWorkspaceConfig(projectDir);
  if (!wsCfg) await warnUnusableConfig("run", projectDir);
  const baseUrlFlag =
    typeof flags.get("base-url") === "string" ? (flags.get("base-url") as string) : undefined;
  if (baseUrlFlag !== undefined && !isRunnableUrl(baseUrlFlag)) {
    return usageError("run", "--base-url must be an http://, https:// or file:// URL");
  }
  const baseURL = baseUrlFlag ?? wsCfg?.app_url;
  if (baseUrlFlag === undefined && wsCfg?.app_url !== undefined && !isRunnableUrl(wsCfg.app_url)) {
    const file = resolveWorkspacePath(projectDir, ".docsxai.json");
    const note = withNext(
      `app_url in ${file} is not an http://, https:// or file:// URL`,
      `fix app_url in ${file}, or pass --base-url <url>`,
    );
    process.stderr.write(`run: ${note}\n`);
    return 1;
  }
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
    return parseFlowFile(await fs.readFile(fp, "utf8"), fp);
  };
  // `flows` goes to the run loop, which expands each matrix flow itself; `units` is the same
  // expansion here, for the checks and messages that need the variant ids before anything launches.
  const flows: FlowFile[] = [];
  const units: FlowVariant[] = [];
  const matrixFlows = new Set<string>();
  const knownFlows: string[] = [];
  const flowOwners = new Map<string, string>();
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
        process.stderr.write(
          `run: ${withNext(e.message, `docsxai lint ${shellQuote(projectDir)}`)}\n`,
        );
        return 1;
      }
      throw e;
    }
    knownFlows.push(flow.name);
    if (onlyFlow && flow.name !== onlyFlow) continue;
    const duplicate = claimFlowName(flowOwners, flow.name, fp);
    if (duplicate) {
      process.stderr.write(
        `run: ${withNext(duplicate, `docsxai lint ${shellQuote(projectDir)}`)}\n`,
      );
      return 1;
    }
    flowCount++;
    flows.push(flow);
    if (flow.matrix) matrixFlows.add(flow.name);
    units.push(...variants);
  }
  if (flowCount === 0) {
    process.stderr.write(
      onlyFlow
        ? `run: ${withNext(
            `no flow named "${onlyFlow}" (flows: ${knownFlows.join(", ") || "none"})`,
            knownFlows.length > 0
              ? `docsxai flow-tree ${shellQuote(projectDir)}  (lists the flows), then pass --flow <name>`
              : `docsxai calibrate ${shellQuote(projectDir)} --from <flow.yaml>`,
          )}\n`
        : `run: ${withNext(`no flow-files in ${projectDir}/flows`, `docsxai calibrate ${shellQuote(projectDir)} --from <flow.yaml>`)}\n`,
    );
    return 1;
  }
  try {
    assertNoCaseCollision(
      flows.map((f) => f.name),
      "flow names",
    );
  } catch (e) {
    process.stderr.write(`run: ${(e as Error).message}\n`);
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
  // A step id that no selected flow has would only fail after a browser had launched, as a halt.
  for (const [flag, stepId] of [
    ["start-from", startFrom],
    ["stop-after", stopAfter],
  ] as const) {
    if (!stepId || units.some((u) => u.flow.steps.some((st) => st.id === stepId))) continue;
    const have = [...new Set(units.flatMap((u) => u.flow.steps.map((st) => st.id)))];
    const where = onlyFlow ? `flow "${onlyFlow}"` : "any selected flow";
    return usageError(
      "run",
      `--${flag}: no step "${stepId}" in ${where} (steps: ${have.join(", ")})`,
    );
  }
  await warnStaleMatrixOutputs(projectDir, matrixFlows);

  if (!baseURL && !cdpEndpoint) {
    const relative = units.some((u) =>
      u.flow.steps.some(
        (s) => s.action === "navigate" && s.value && !/^[a-z][a-z0-9+.-]*:/i.test(s.value),
      ),
    );
    if (relative) {
      const note = withNext(
        "warning, a flow navigates to a relative path and there is no app_url",
        `set app_url in ${path.join(projectDir, ".docsxai.json")} or pass --base-url <url>`,
      );
      process.stderr.write(`run: ${note}\n`);
    }
  }

  // An attached browser (--cdp) owns its own login; the cached session is not loaded over it.
  let storageState: StorageState | undefined;
  try {
    storageState = cdpEndpoint ? undefined : await loadAuthStorageState(projectDir);
  } catch (e) {
    process.stderr.write(`run: ${describeFsError(e) ?? (e as Error).message}\n`);
    return 1;
  }

  // Parallel runners: each flow gets its own Playwright session, so flows are isolated and can run together.
  // `--concurrency N` (default 1) caps how many run at once. `--pause` / `--stop-after` force concurrency=1
  // (they're single-flow calibration aids; mixing them with parallelism would be chaos).
  const requestedConcurrency = typeof concurrencyFlag === "string" ? Number(concurrencyFlag) : 1;
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
    ...(dsf.factor !== undefined ? { deviceScaleFactor: dsf.factor } : {}),
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
  reportRun({ projectDir, noun, total: units.length, okCount, failures });

  // Backend-bound workspaces get a run record appended; offline-tolerant (warn, never fail the run).
  const history = await recordRunHistory({
    workspaceDir: projectDir,
    config: wsCfg ?? {},
    ok: !anyFailed,
    durationMs: Date.now() - startedAt,
    summary: `${okCount}/${units.length} ${noun} ok`,
  });
  if (history.warning) process.stderr.write(`run: warning: ${history.warning}\n`);

  return anyFailed ? 1 : 0;
}

export async function cmdCalibrate(args: string[]): Promise<number> {
  const parsed = parseCommandFlags("calibrate", args);
  if (typeof parsed === "number") return parsed;
  const { positionals, flags } = parsed;
  const workspaceDir = positionals[0];
  if (!workspaceDir) return usageError("calibrate", "missing <workspace-dir>");
  const bareCalibrate = bareValueFlagExit("calibrate", flags, ["from", "name"]);
  if (bareCalibrate !== undefined) return bareCalibrate;
  const from = typeof flags.get("from") === "string" ? (flags.get("from") as string) : undefined;
  if (!from) {
    return usageError(
      "calibrate",
      "--from <flow.md|.yaml> is required (the structured flow-guide)",
    );
  }
  const flowName =
    typeof flags.get("name") === "string" ? (flags.get("name") as string) : undefined;
  let text: string;
  try {
    text = await fs.readFile(from, "utf8");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? "unreadable";
    process.stderr.write(`calibrate: cannot read ${from} (${code}); check the path\n`);
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
      `  next: docsxai run ${shellQuote(workspaceDir)}  (then: docsxai render ${shellQuote(workspaceDir)})\n`,
    );
    return 0;
  } catch (e) {
    const rerun = `docsxai calibrate ${shellQuote(workspaceDir)} --from ${shellQuote(from)}`;
    const next =
      e instanceof CalibrateError && e.field === "name-flag"
        ? `${rerun} --name <flow>`
        : `fix ${shellQuote(from)}, then ${rerun}`;
    process.stderr.write(`calibrate: ${withNext((e as Error).message, next)}\n`);
    return 1;
  }
}
