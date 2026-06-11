// Flow-file (`.flow.yaml`) parsing, validation, and serialization.
//
// A flow-file is the source of truth for execution: declarative YAML, hand-editable,
// translated to Playwright at run time (see flow-runtime, to come). This module is the
// parse/validate/serialize boundary — everything downstream works with the validated
// `FlowFile` value, never raw YAML.

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { FlowFile, type Step } from "./doc-pack.js";

export class FlowFileError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "FlowFileError";
  }
}

function formatZodIssues(err: z.ZodError): string {
  return err.issues
    .map((i) => {
      const path = i.path.length ? i.path.join(".") : "(root)";
      return `  • ${path}: ${i.message}`;
    })
    .join("\n");
}

/** Parse + validate a flow-file from YAML text. Throws {@link FlowFileError} with a readable message on failure. */
export function parseFlowFile(yamlText: string, source = "<flow-file>"): FlowFile {
  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (e) {
    throw new FlowFileError(`${source}: not valid YAML — ${(e as Error).message}`, e);
  }
  const result = FlowFile.safeParse(raw);
  if (!result.success) {
    throw new FlowFileError(
      `${source}: invalid flow-file:\n${formatZodIssues(result.error)}`,
      result.error,
    );
  }
  const flow = result.data;
  // A flow with `extends` may reference locators it inherits from the parent — defer the ref check to
  // `resolveFlowExtends`, which runs it on the merged flow.
  if (!flow.extends) assertLocatorRefsResolve(flow, source);
  assertStepIdsUnique(flow, source);
  return flow;
}

/** Serialize a {@link FlowFile} back to canonical YAML. */
export function serializeFlowFile(flow: FlowFile): string {
  // Validate on the way out too, so we never write a malformed file.
  const checked = FlowFile.parse(flow);
  return stringifyYaml(checked, { lineWidth: 100 });
}

const LOCATOR_REF = /^\$([A-Za-z_][A-Za-z0-9_]*)$/;

/** Returns the locator name if `value` is a `$name` reference, else `null` (it's an inline selector). */
export function locatorRefName(value: string): string | null {
  const m = LOCATOR_REF.exec(value);
  return m ? m[1]! : null;
}

function collectLocatorRefs(step: Step): string[] {
  const refs: string[] = [];
  const push = (v?: string) => {
    if (v) {
      const name = locatorRefName(v);
      if (name) refs.push(name);
    }
  };
  push(step.target);
  if (step.wait_for && typeof step.wait_for === "object" && "selector" in step.wait_for)
    push(step.wait_for.selector);
  if (step.success) {
    if ("visible" in step.success) push(step.success.visible);
    else if ("hidden" in step.success) push(step.success.hidden);
    else if ("text_contains" in step.success) push(step.success.text_contains.selector);
  }
  if (step.annotation?.target) push(step.annotation.target);
  if (step.annotations) for (const a of step.annotations) if (a.target) push(a.target);
  if (step.redactions) for (const r of step.redactions) if ("selector" in r) push(r.selector);
  return refs;
}

/** Locator names referenced anywhere in `flow` (steps + flow-level redactions); inline selectors excluded. */
export function referencedLocatorNames(flow: FlowFile): Set<string> {
  const refs = new Set<string>();
  for (const step of flow.steps) for (const ref of collectLocatorRefs(step)) refs.add(ref);
  for (const r of flow.redactions ?? []) {
    if ("selector" in r) {
      const name = locatorRefName(r.selector);
      if (name) refs.add(name);
    }
  }
  return refs;
}

function assertLocatorRefsResolve(flow: FlowFile, source: string): void {
  const known = new Set(Object.keys(flow.locators));
  const missing: string[] = [];
  for (const step of flow.steps) {
    for (const ref of collectLocatorRefs(step)) {
      if (!known.has(ref)) missing.push(`step "${step.id}" → $${ref}`);
    }
  }
  for (const r of flow.redactions ?? []) {
    if ("selector" in r) {
      const name = locatorRefName(r.selector);
      if (name && !known.has(name)) missing.push(`redactions → $${name}`);
    }
  }
  if (missing.length) {
    throw new FlowFileError(
      `${source}: unresolved locator references (not in \`locators\`):\n${missing.map((m) => `  • ${m}`).join("\n")}`,
    );
  }
}

function assertStepIdsUnique(flow: FlowFile, source: string): void {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const step of flow.steps) {
    if (seen.has(step.id)) dupes.add(step.id);
    seen.add(step.id);
  }
  if (dupes.size) {
    throw new FlowFileError(
      `${source}: duplicate step ids: ${[...dupes].map((d) => `"${d}"`).join(", ")}`,
    );
  }
}

/**
 * Resolve a flow's `extends` chain into a single flow: parent's steps first, then this flow's. `locators` and
 * `prerequisites` are merged (this flow wins on locator-name collisions); `environment` merges per-key with
 * this flow's keys winning; `redactions` concatenate (parent's first); step ids must be unique across the
 * merge. Chains are followed recursively; cycles throw. `loadFlowFile(name)` parses `flows/<name>.flow.yaml`
 * (a flow with its own `extends` un-resolved — this function recurses). The result has no `extends`.
 */
export async function resolveFlowExtends(
  flow: FlowFile,
  loadFlowFile: (name: string) => Promise<FlowFile> | FlowFile,
  visited: Set<string> = new Set(),
): Promise<FlowFile> {
  if (!flow.extends) return flow;
  if (visited.has(flow.name)) {
    throw new FlowFileError(
      `flow "${flow.name}": \`extends\` cycle (chain: ${[...visited, flow.name].join(" → ")})`,
    );
  }
  visited.add(flow.name);

  let parentRaw: FlowFile;
  try {
    parentRaw = await loadFlowFile(flow.extends);
  } catch (e) {
    throw e instanceof FlowFileError
      ? e
      : new FlowFileError(
          `flow "${flow.name}": cannot load \`extends\` target "${flow.extends}": ${(e as Error).message}`,
          e,
        );
  }
  const parent = await resolveFlowExtends(parentRaw, loadFlowFile, visited);

  const parentStepIds = new Set(parent.steps.map((s) => s.id));
  for (const s of flow.steps) {
    if (parentStepIds.has(s.id)) {
      throw new FlowFileError(
        `flow "${flow.name}": step id "${s.id}" collides with a step inherited via \`extends\` from "${flow.extends}"`,
      );
    }
  }

  // `environment` merges per-key (this flow wins); `redactions` are additive, parent's first.
  const environment = { ...parent.environment, ...flow.environment };
  const redactions = [...(parent.redactions ?? []), ...(flow.redactions ?? [])];
  const merged: FlowFile = {
    name: flow.name,
    ...(Object.keys(environment).length ? { environment } : {}),
    ...(redactions.length ? { redactions } : {}),
    prerequisites: [...parent.prerequisites, ...flow.prerequisites],
    locators: { ...parent.locators, ...flow.locators },
    steps: [...parent.steps, ...flow.steps],
  };
  assertLocatorRefsResolve(merged, `<resolved flow "${flow.name}">`);
  return merged;
}
