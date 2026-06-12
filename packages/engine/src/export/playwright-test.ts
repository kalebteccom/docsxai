// Flow-file → Playwright test export — pure, deterministic, zero HTTP.
//
// Each flow becomes one self-contained `.spec.ts`: locator const declarations from the flow's
// `locators` map, steps translated to Playwright actions, `wait_for` to waits, `success` to
// `expect(...)` assertions, the `environment` block to `test.use({...})` (+ `page.clock` for a
// frozen clock), and `optional: true` steps wrapped in try/catch (conditionally-present UI — a
// miss is tolerated, mirroring the runtime). The flow-file stays the source of truth: generated
// specs carry a "regenerate, don't hand-edit" header and are meant to live in the consumer's
// Playwright suite as a drift tripwire between docs and reality.

import { promises as fs } from "node:fs";
import {
  type EnvironmentSpec,
  type FlowFile,
  type Step,
  type SuccessSpec,
  VIEWPORT_PRESETS,
  type WaitSpec,
} from "../doc-pack.js";
import { locatorRefName, parseFlowFile, resolveFlowExtends } from "../flow-file.js";
import { resolveWorkspacePath } from "../workspace.js";

export interface PlaywrightExportOptions {
  /** Flow-file base name for the header comment (default: the flow's `name`). */
  flowFileName?: string;
}

const RESERVED = new Set([
  // ES reserved words + the identifiers the generated scaffold itself uses.
  ...`await break case catch class const continue debugger default delete do else enum export
  extends false finally for function if import in instanceof let new null return static super
  switch this throw true try typeof var void while with yield`.split(/\s+/),
  "page",
  "test",
  "expect",
]);

/** Deterministic flow-locator-name → JS identifier mapping (sanitized, collision-free). */
function locatorIdentifiers(flow: FlowFile): Map<string, string> {
  const taken = new Set<string>(RESERVED);
  const ids = new Map<string, string>();
  for (const name of Object.keys(flow.locators)) {
    let id = name.replace(/[^A-Za-z0-9_$]/g, "_");
    if (!/^[A-Za-z_$]/.test(id)) id = `_${id}`;
    while (taken.has(id)) id = `${id}_`;
    taken.add(id);
    ids.set(name, id);
  }
  return ids;
}

/** Render a step `target` / locator-ref-or-inline-selector as a Playwright locator expression. */
function locatorExpr(value: string, ids: Map<string, string>): string {
  const ref = locatorRefName(value);
  if (ref !== null) {
    const id = ids.get(ref);
    if (id) return id;
  }
  return `page.locator(${JSON.stringify(value)})`;
}

function environmentUse(env: EnvironmentSpec): string[] {
  const entries: string[] = [];
  if (env.viewport !== undefined) {
    const v = typeof env.viewport === "string" ? VIEWPORT_PRESETS[env.viewport] : env.viewport;
    entries.push(`viewport: { width: ${v.width}, height: ${v.height} }`);
  }
  if (env.locale !== undefined) entries.push(`locale: ${JSON.stringify(env.locale)}`);
  if (env.timezone !== undefined) entries.push(`timezoneId: ${JSON.stringify(env.timezone)}`);
  if (env.color_scheme !== undefined)
    entries.push(`colorScheme: ${JSON.stringify(env.color_scheme)}`);
  if (env.reduced_motion) entries.push(`reducedMotion: "reduce"`);
  if (entries.length === 0) return [];
  return ["test.use({", ...entries.map((e) => `  ${e},`), "});", ""];
}

function actionLines(step: Step, ids: Map<string, string>): string[] {
  const target = step.target !== undefined ? locatorExpr(step.target, ids) : null;
  const value = step.value;
  const missing = (what: string): string[] => [
    `// step "${step.id}": ${step.action} without ${what} — nothing to emit`,
  ];
  switch (step.action) {
    case "navigate":
      return value === undefined
        ? missing("a value")
        : [`await page.goto(${JSON.stringify(value)});`];
    case "click":
      return target === null ? missing("a target") : [`await ${target}.click();`];
    case "fill":
      return target === null
        ? missing("a target")
        : [`await ${target}.fill(${JSON.stringify(value ?? "")});`];
    case "select":
      return target === null || value === undefined
        ? missing("a target/value")
        : [`await ${target}.selectOption(${JSON.stringify(value)});`];
    case "check":
      return target === null ? missing("a target") : [`await ${target}.check();`];
    case "uncheck":
      return target === null ? missing("a target") : [`await ${target}.uncheck();`];
    case "hover":
      return target === null ? missing("a target") : [`await ${target}.hover();`];
    case "press":
      if (value === undefined) return missing("a key value");
      return target === null
        ? [`await page.keyboard.press(${JSON.stringify(value)});`]
        : [`await ${target}.press(${JSON.stringify(value)});`];
    case "upload":
      return target === null || value === undefined
        ? missing("a target/value")
        : [`await ${target}.setInputFiles(${JSON.stringify(value)});`];
    case "wait":
      return []; // the step's wait_for carries the semantics
  }
}

function waitLines(wait: WaitSpec, step: Step, ids: Map<string, string>): string[] {
  if (wait === "network_idle") return [`await page.waitForLoadState("networkidle");`];
  if (wait === "load") return [`await page.waitForLoadState("load");`];
  if (wait === "element_stable") {
    // Playwright actions auto-wait for element stability; approximate the standalone wait with a
    // visibility wait on the step target when there is one.
    return step.target !== undefined
      ? [`await ${locatorExpr(step.target, ids)}.waitFor({ state: "visible" }); // element_stable`]
      : [`// wait_for: element_stable — Playwright auto-waits on the next action`];
  }
  if ("selector" in wait) {
    const opts =
      wait.timeout_ms !== undefined
        ? `{ state: "visible", timeout: ${wait.timeout_ms} }`
        : `{ state: "visible" }`;
    return [`await ${locatorExpr(wait.selector, ids)}.waitFor(${opts});`];
  }
  return [`await page.waitForTimeout(${wait.timeout_ms});`];
}

function successLines(success: SuccessSpec, ids: Map<string, string>): string[] {
  if ("visible" in success)
    return [`await expect(${locatorExpr(success.visible, ids)}).toBeVisible();`];
  if ("hidden" in success)
    return [`await expect(${locatorExpr(success.hidden, ids)}).toBeHidden();`];
  if ("url_matches" in success)
    return [`await expect(page).toHaveURL(new RegExp(${JSON.stringify(success.url_matches)}));`];
  return [
    `await expect(${locatorExpr(success.text_contains.selector, ids)})` +
      `.toContainText(${JSON.stringify(success.text_contains.text)});`,
  ];
}

function stepLines(step: Step, ids: Map<string, string>): string[] {
  const body = [
    ...actionLines(step, ids),
    ...(step.wait_for !== undefined ? waitLines(step.wait_for, step, ids) : []),
    ...(step.success !== undefined ? successLines(step.success, ids) : []),
  ];
  const header = `// step: ${step.id} (${step.action}${step.optional ? ", optional" : ""})`;
  if (!step.optional) return [header, ...body];
  return [
    header,
    "try {",
    ...body.map((l) => `  ${l}`),
    "} catch {",
    "  // optional step — conditionally-present UI; a miss is tolerated",
    "}",
  ];
}

/**
 * Render a flow as a self-contained Playwright `.spec.ts`. The flow must have its `extends`
 * chain resolved first (see `resolveFlowExtends`) so the emitted spec carries the merged steps.
 * Pure string transform — deterministic for a given flow.
 */
export function exportFlowAsPlaywrightTest(
  flow: FlowFile,
  options: PlaywrightExportOptions = {},
): string {
  if (flow.extends) {
    throw new Error(
      `flow "${flow.name}": resolve \`extends\` before exporting (resolveFlowExtends)`,
    );
  }
  const fileName = options.flowFileName ?? flow.name;
  const ids = locatorIdentifiers(flow);

  const lines: string[] = [
    `// generated from ${fileName}.flow.yaml — regenerate, don't hand-edit`,
    `import { expect, test } from "@playwright/test";`,
    "",
  ];
  if (flow.environment) lines.push(...environmentUse(flow.environment));

  lines.push(`test(${JSON.stringify(flow.name)}, async ({ page }) => {`);
  const body: string[] = [];
  if (flow.environment?.clock !== undefined) {
    body.push(
      `await page.clock.setFixedTime(new Date(${JSON.stringify(flow.environment.clock)}));`,
      "",
    );
  }
  const locatorDecls = [...ids.entries()].map(
    ([name, id]) => `const ${id} = page.locator(${JSON.stringify(flow.locators[name]!)});`,
  );
  if (locatorDecls.length > 0) body.push(...locatorDecls, "");
  flow.steps.forEach((step, i) => {
    body.push(...stepLines(step, ids));
    if (i < flow.steps.length - 1) body.push("");
  });
  lines.push(...body.map((l) => (l === "" ? "" : `  ${l}`)), "});", "");
  return lines.join("\n");
}

export interface ExportedSpec {
  flowName: string;
  /** `<flow>.spec.ts` */
  fileName: string;
  content: string;
}

/**
 * Export a workspace's flows (default: all of `flows/*.flow.yaml`, sorted) as Playwright specs.
 * `extends` chains are resolved before generation. Reads only; the caller writes the files.
 */
export async function exportWorkspaceFlowsAsPlaywrightTests(opts: {
  workspaceDir: string;
  /** Restrict to these flow names. Unknown names throw. */
  flows?: string[];
}): Promise<ExportedSpec[]> {
  const flowsDir = resolveWorkspacePath(opts.workspaceDir, "flows");
  const entries = await fs.readdir(flowsDir).catch(() => [] as string[]);
  const names = entries
    .filter((e) => e.endsWith(".flow.yaml"))
    .map((e) => e.slice(0, -".flow.yaml".length))
    .sort();
  const wanted = opts.flows && opts.flows.length > 0 ? opts.flows : names;
  for (const w of wanted) {
    if (!names.includes(w))
      throw new Error(`export playwright: no flow named "${w}" in ${flowsDir}`);
  }

  const load = async (name: string): Promise<FlowFile> => {
    const p = resolveWorkspacePath(opts.workspaceDir, "flows", `${name}.flow.yaml`);
    return parseFlowFile(await fs.readFile(p, "utf8"), p);
  };

  const out: ExportedSpec[] = [];
  for (const name of wanted) {
    const flow = await resolveFlowExtends(await load(name), load);
    out.push({
      flowName: name,
      fileName: `${name}.spec.ts`,
      content: exportFlowAsPlaywrightTest(flow, { flowFileName: name }),
    });
  }
  return out;
}
