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
  constructor(message: string, readonly cause?: unknown) {
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
    throw new FlowFileError(`${source}: invalid flow-file:\n${formatZodIssues(result.error)}`, result.error);
  }
  const flow = result.data;
  assertLocatorRefsResolve(flow, source);
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
  if (step.wait_for && typeof step.wait_for === "object" && "selector" in step.wait_for) push(step.wait_for.selector);
  if (step.success) {
    if ("visible" in step.success) push(step.success.visible);
    else if ("hidden" in step.success) push(step.success.hidden);
    else if ("text_contains" in step.success) push(step.success.text_contains.selector);
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
    throw new FlowFileError(`${source}: duplicate step ids: ${[...dupes].map((d) => `"${d}"`).join(", ")}`);
  }
}
