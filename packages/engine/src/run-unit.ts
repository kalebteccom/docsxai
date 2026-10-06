// One unit of `docsxai run`: a flow, or one matrix variant of a flow. Launches a Playwright session
// under the unit's `environment`, runs the flow, and writes its annotations to the unit's doc-pack
// directory (`docs/<flow>/` without a matrix, `docs/<flow>/<variant>/` with one). Every unit gets
// its own session, since `environment` is a browser-context option.

import { promises as fs } from "node:fs";
import type { StorageState } from "./auth.js";
import type { FlowVariant } from "./flow-matrix.js";
import { runFlow } from "./flow-runtime.js";
import { launchPlaywrightSession } from "./playwright-driver.js";
import { resolveWorkspacePath, resolveWorkspacePathReal } from "./workspace.js";

export interface RunUnitContext {
  projectDir: string;
  baseURL: string | undefined;
  headed: boolean;
  ignoreHTTPSErrors: boolean;
  /** Attach to a Chrome at this CDP endpoint instead of launching one. */
  cdpEndpoint: string | undefined;
  storageState: StorageState | undefined;
  stopAfter: string | undefined;
  startFrom: string | undefined;
  /** Keep the browser open after the run until it is closed. */
  pause: boolean;
  /** Record obstacle boxes on each annotation (workspace `annotations.obstacles`). */
  obstacles: boolean;
  /** Log-line prefix for a unit label (carries the label when several units run at once). */
  tag: (label: string) => string;
}

/** `<flow>` for a flow without a matrix, `<flow>/<variant>` for a variant (the name `render` and `burn` use). */
export function unitLabel(unit: FlowVariant): string {
  return unit.id ? `${unit.flow.name}/${unit.id}` : unit.flow.name;
}

/** Run one unit. Returns whether it finished without halting; the reason is written to stderr. */
export async function runUnit(unit: FlowVariant, ctx: RunUnitContext): Promise<boolean> {
  const { flow } = unit;
  const name = unitLabel(unit);
  let session;
  try {
    // When attaching to an existing Chrome via --cdp, the operator owns its auth state — don't
    // load cached `storageState` over it (would replace cookies). When launching fresh, do.
    session = await launchPlaywrightSession({
      baseURL: ctx.baseURL,
      headed: ctx.headed,
      ignoreHTTPSErrors: ctx.ignoreHTTPSErrors,
      ...(ctx.cdpEndpoint
        ? { connectOverCdp: ctx.cdpEndpoint }
        : { storageState: ctx.storageState }),
      ...(flow.environment ? { environment: flow.environment } : {}),
      docPackRoot: ctx.projectDir,
    });
  } catch (e) {
    const msg = (e as Error).message;
    if (/Executable doesn't exist|browserType\.launch|playwright install/i.test(msg)) {
      process.stderr.write(
        `${ctx.tag(name)}no Chromium binary found.  Install one:  npx playwright-core install chromium  (source checkout: pnpm -C packages/engine exec playwright-core install chromium)\n`,
      );
    } else {
      process.stderr.write(`${ctx.tag(name)}failed to launch browser: ${msg}\n`);
    }
    return false;
  }
  try {
    const result = await runFlow(flow, session.driver, {
      resolveLocator: (n) => flow.locators[n],
      ...(unit.info ? { variant: unit.info } : {}),
      ...(ctx.stopAfter ? { stopAfter: ctx.stopAfter } : {}),
      ...(ctx.startFrom ? { startFrom: ctx.startFrom } : {}),
      ...(ctx.obstacles ? { obstacles: true } : {}),
    });
    const docSegments = ["docs", flow.name, ...(unit.id ? [unit.id] : [])];
    await fs.mkdir(resolveWorkspacePath(ctx.projectDir, ...docSegments), { recursive: true });
    // Flow names and variant ids come from the flow-file — resolve the write target symlink-aware.
    const annotationsPath = await resolveWorkspacePathReal(
      ctx.projectDir,
      ...docSegments,
      "annotations.json",
    );
    // With `startFrom`, only the post-startFrom steps emit annotations — merge them into the
    // existing file (if any) by step id so the prior steps' annotations stay in place. Same
    // story for screenshots (they live as separate PNGs and are simply not re-captured).
    let toWrite = result.annotations;
    if (ctx.startFrom) {
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
      `${ctx.tag(name)}${name} — ${result.steps.length} step(s) executed, ${result.annotations.annotations.length} annotation(s) ${ctx.startFrom ? "merged" : "written"}\n`,
    );
    return true;
  } catch (e) {
    process.stderr.write(`${ctx.tag(name)}${(e as Error).message}\n`);
    return false;
  } finally {
    if (ctx.pause) {
      process.stdout.write(
        "run: --pause — browser is open at the last step run; close it to exit.\n",
      );
      await new Promise<void>((resolve) => session.browser.on("disconnected", () => resolve()));
    }
    await session.close();
  }
}
