// Flow matrix expansion: one flow-file becomes one flow per variant (locale x color scheme x
// viewport). Pure and deterministic: the output depends only on the parsed flow, in declared
// order, so two parses of one file expand identically. See
// docs/ai-context/architecture/flow-matrix-decision.md for the design.
//
// A flow without a `matrix` expands to itself (`id: null`), with the one addition that
// `copy_by_locale` resolves against `environment.locale`. That path adds nothing to the output
// of a flow that uses none of the matrix keys: the returned flow is the input object.

import type { FlowFile, Step, StepAnnotation } from "./doc-pack.js";
import type { ColorScheme } from "./environment-spec.js";
import {
  resolveMatrixViewport,
  type MatrixSpec,
  type ResolvedMatrixViewport,
  type VariantInfo,
  type VariantSelector,
} from "./matrix-spec.js";

/** Thrown when a flow's `matrix`, `only`/`skip` or `copy_by_locale` cannot expand. */
export class FlowMatrixError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FlowMatrixError";
  }
}

/** One cell of the matrix: the value on each axis the matrix names. */
export interface VariantCombo {
  locale?: string;
  color_scheme?: ColorScheme;
  viewport?: ResolvedMatrixViewport;
}

/** A flow resolved for one variant. `id` and `info` are null for a flow without a `matrix`. */
export interface FlowVariant {
  id: string | null;
  info: VariantInfo | null;
  /** The flow to run: no `matrix`, no `only`/`skip`, `copy` resolved, `environment` overridden. */
  flow: FlowFile;
}

/** The cells of a matrix: locales outermost, then color schemes, then viewports, each in declared order. */
export function matrixCombos(matrix: MatrixSpec): VariantCombo[] {
  const combos: VariantCombo[] = [];
  const viewports = matrix.viewports?.map(resolveMatrixViewport);
  for (const locale of matrix.locales ?? [undefined]) {
    for (const color_scheme of matrix.color_schemes ?? [undefined]) {
      for (const viewport of viewports ?? [undefined]) {
        combos.push({
          ...(locale !== undefined ? { locale } : {}),
          ...(color_scheme !== undefined ? { color_scheme } : {}),
          ...(viewport !== undefined ? { viewport } : {}),
        });
      }
    }
  }
  return combos;
}

/** `<locale>.<color_scheme>.<viewport name>`, leaving out the axes the matrix does not name. */
export function variantId(combo: VariantCombo): string {
  return [combo.locale, combo.color_scheme, combo.viewport?.name]
    .filter((s): s is string => s !== undefined)
    .join(".");
}

/** The ids a matrix expands to, in expansion order. */
export function matrixVariantIds(matrix: MatrixSpec): string[] {
  return matrixCombos(matrix).map(variantId);
}

function variantInfo(combo: VariantCombo): VariantInfo {
  return {
    id: variantId(combo),
    ...(combo.locale !== undefined ? { locale: combo.locale } : {}),
    ...(combo.color_scheme !== undefined ? { color_scheme: combo.color_scheme } : {}),
    ...(combo.viewport !== undefined ? { viewport: combo.viewport } : {}),
  };
}

/** Doc-pack directory (relative to the workspace) holding a flow's outputs for a variant. */
export function variantDocDir(flow: string, variant: string | null | undefined): string {
  return variant ? `docs/${flow}/${variant}` : `docs/${flow}`;
}

/** True when `want` is `have` or its language (`es` matches `es-ES`), ignoring case. */
export function localeMatches(want: string, have: string): boolean {
  const w = want.toLowerCase();
  const h = have.toLowerCase();
  return h === w || h.startsWith(`${w}-`);
}

function axisMatches(
  sel: VariantSelector,
  axis: keyof VariantSelector,
  combo: VariantCombo,
): boolean {
  const wanted = sel[axis];
  if (wanted === undefined) return true;
  if (axis === "locale") {
    const have = combo.locale;
    return have !== undefined && wanted.some((w) => localeMatches(w, have));
  }
  const have = axis === "viewport" ? combo.viewport?.name : combo.color_scheme;
  return have !== undefined && (wanted as string[]).includes(have);
}

function selectorMatches(sel: VariantSelector, combo: VariantCombo): boolean {
  return (["viewport", "color_scheme", "locale"] as const).every((a) => axisMatches(sel, a, combo));
}

/** Kept when `only` (if any) matches and `skip` (if any) does not. */
function applies(
  item: { only?: VariantSelector | undefined; skip?: VariantSelector | undefined },
  combo: VariantCombo,
): boolean {
  if (item.only && !selectorMatches(item.only, combo)) return false;
  return !(item.skip && selectorMatches(item.skip, combo));
}

/** Call-out text for a locale: the exact tag, then its language, else `copy`. */
export function pickCopy(ann: StepAnnotation, locale: string | undefined): string {
  const byLocale = ann.copy_by_locale;
  if (!byLocale || locale === undefined) return ann.copy;
  const find = (tag: string): string | undefined => {
    const key = Object.keys(byLocale).find((k) => k.toLowerCase() === tag.toLowerCase());
    return key === undefined ? undefined : byLocale[key];
  };
  return find(locale) ?? find(locale.split("-")[0]!) ?? ann.copy;
}

function resolveAnnotation(
  ann: StepAnnotation,
  combo: VariantCombo,
  locale: string | undefined,
): StepAnnotation | undefined {
  if (!applies(ann, combo)) return undefined;
  if (!ann.only && !ann.skip && !ann.copy_by_locale) return ann;
  const { only: _only, skip: _skip, copy_by_locale: _copy, ...rest } = ann;
  return { ...rest, copy: pickCopy(ann, locale) };
}

function touchesVariants(step: Step): boolean {
  const hasKeys = (a: StepAnnotation): boolean => !!(a.only || a.skip || a.copy_by_locale);
  return !!(
    step.only ||
    step.skip ||
    (step.annotation && hasKeys(step.annotation)) ||
    step.annotations?.some(hasKeys)
  );
}

function resolveStep(
  step: Step,
  combo: VariantCombo,
  locale: string | undefined,
): Step | undefined {
  if (!applies(step, combo)) return undefined;
  if (!touchesVariants(step)) return step;
  const { only: _only, skip: _skip, annotation, annotations, ...rest } = step;
  const out: Step = { ...rest };
  if (annotation) {
    const a = resolveAnnotation(annotation, combo, locale);
    if (a) out.annotation = a;
  }
  if (annotations) {
    const list = annotations
      .map((a) => resolveAnnotation(a, combo, locale))
      .filter((a): a is StepAnnotation => a !== undefined);
    if (list.length > 0) out.annotations = list;
  }
  return out;
}

/** Every `only`/`skip` selector in the flow, with where it sits. */
function selectorsOf(flow: FlowFile): Array<{ where: string; sel: VariantSelector }> {
  const found: Array<{ where: string; sel: VariantSelector }> = [];
  const add = (where: string, kind: "only" | "skip", item: { only?: unknown; skip?: unknown }) => {
    const sel = item[kind] as VariantSelector | undefined;
    if (sel) found.push({ where: `${where} \`${kind}\``, sel });
  };
  for (const step of flow.steps) {
    const at = `step "${step.id}"`;
    for (const kind of ["only", "skip"] as const) {
      add(at, kind, step);
      if (step.annotation) add(`${at} annotation`, kind, step.annotation);
      step.annotations?.forEach((a, i) => add(`${at} annotations[${i}]`, kind, a));
    }
  }
  return found;
}

/** Throws unless every value a selector names can match some entry of the matrix. */
function assertSelectorsResolve(flow: FlowFile, matrix: MatrixSpec): void {
  const names = matrix.viewports?.map((v) => resolveMatrixViewport(v).name);
  const known: Record<keyof VariantSelector, string[] | undefined> = {
    viewport: names,
    color_scheme: matrix.color_schemes,
    locale: matrix.locales,
  };
  const problems: string[] = [];
  for (const { where, sel } of selectorsOf(flow)) {
    for (const axis of ["viewport", "color_scheme", "locale"] as const) {
      const wanted = sel[axis];
      if (wanted === undefined) continue;
      const axisValues = known[axis];
      if (axisValues === undefined) {
        const key = axis === "color_scheme" ? "color_schemes" : `${axis}s`;
        problems.push(`${where}: names \`${axis}\` but the matrix has no \`${key}\``);
        continue;
      }
      for (const w of wanted) {
        const ok =
          axis === "locale" ? axisValues.some((l) => localeMatches(w, l)) : axisValues.includes(w);
        if (!ok)
          problems.push(`${where}: ${axis} "${w}" is not in the matrix (${axisValues.join(", ")})`);
      }
    }
  }
  if (problems.length > 0) {
    throw new FlowMatrixError(
      `flow "${flow.name}": \`only\`/\`skip\` do not match the matrix:\n${problems.map((p) => `  • ${p}`).join("\n")}`,
    );
  }
}

function withEnvironment(flow: FlowFile, combo: VariantCombo): FlowFile["environment"] {
  const env = {
    ...flow.environment,
    ...(combo.locale !== undefined ? { locale: combo.locale } : {}),
    ...(combo.color_scheme !== undefined ? { color_scheme: combo.color_scheme } : {}),
    ...(combo.viewport !== undefined
      ? { viewport: { width: combo.viewport.width, height: combo.viewport.height } }
      : {}),
  };
  return Object.keys(env).length > 0 ? env : undefined;
}

/**
 * Expand a flow into its variants. A flow without a `matrix` returns itself, `id: null`, unless it
 * uses `only`/`skip` (an error: they need a matrix) or `copy_by_locale` (resolved against
 * `environment.locale`). Throws {@link FlowMatrixError} on a selector no matrix entry can match, or
 * on a variant left with no steps.
 */
export function expandFlow(flow: FlowFile): FlowVariant[] {
  const { matrix, ...rest } = flow;
  if (!matrix) {
    const bad = selectorsOf(flow);
    if (bad.length > 0) {
      throw new FlowMatrixError(
        `flow "${flow.name}": ${bad[0]!.where} needs a \`matrix\`${bad.length > 1 ? ` (so do ${bad.length - 1} more uses of \`only\`/\`skip\`)` : ""}; a flow without one has a single variant`,
      );
    }
    const locale = flow.environment?.locale;
    const steps = flow.steps.map((s) => resolveStep(s, {}, locale)!);
    const same = steps.every((s, i) => s === flow.steps[i]);
    return [{ id: null, info: null, flow: same ? flow : { ...flow, steps } }];
  }
  assertSelectorsResolve(flow, matrix);
  return matrixCombos(matrix).map((combo) => {
    const locale = combo.locale ?? flow.environment?.locale;
    const steps = flow.steps
      .map((s) => resolveStep(s, combo, locale))
      .filter((s): s is Step => s !== undefined);
    const id = variantId(combo);
    if (steps.length === 0) {
      throw new FlowMatrixError(
        `flow "${flow.name}": variant "${id}" has no steps left after \`only\`/\`skip\``,
      );
    }
    const environment = withEnvironment(flow, combo);
    const { environment: _env, ...withoutEnv } = rest;
    return {
      id,
      info: variantInfo(combo),
      flow: { ...withoutEnv, ...(environment ? { environment } : {}), steps },
    };
  });
}
