// Validator for `docsxai/screens-pack@2`. Pure: takes an untrusted value, returns every problem
// it finds as a path-prefixed line. Unknown keys are errors, so a timestamp cannot slip in.

import {
  HASH8_PATTERN,
  ID_MAX,
  LOCALE_PATTERN,
  SCREENS_PACK_SCHEMA,
  isValidId,
  parseVariantKey,
  type ScreensPack,
} from "./pack-schema.js";

export const MAX_TEXT = 1000;
export const MAX_COPY = 500;
export const MAX_TITLE = 200;
const MAX_FLOWS = 200;
const MAX_STEPS = 500;
const MAX_VARIANTS = 64;
const MAX_CALLOUTS = 50;
const MAX_DIMENSION = 20000;

export interface ValidatePackOptions {
  /** When set, `src` must start with exactly this prefix; otherwise any plain URL path prefix. */
  publicPrefix?: string;
}

export interface PackValidation {
  ok: boolean;
  errors: string[];
}

type Errors = string[];
type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.trim() !== "" && v.length <= max;
const isCount = (v: unknown, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v > 0 && v <= max;
const isCoord = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function noUnknownKeys(value: Obj, allowed: string[], at: string, errors: Errors): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`${at}: unknown key "${key}"`);
  }
}

function checkLocalized(value: unknown, at: string, max: number, errors: Errors): string[] {
  if (!isObj(value)) {
    errors.push(`${at}: expected an object of locale to text`);
    return [];
  }
  const locales = Object.keys(value);
  if (locales.length === 0) errors.push(`${at}: expected at least one locale`);
  for (const locale of locales) {
    if (!LOCALE_PATTERN.test(locale)) errors.push(`${at}: "${locale}" is not a locale tag`);
    if (!isText(value[locale], max)) {
      errors.push(`${at}.${locale}: expected a non-empty string of at most ${max} characters`);
    }
  }
  return locales;
}

function checkBbox(value: unknown, at: string, errors: Errors): void {
  if (!isObj(value)) {
    errors.push(`${at}: expected { x, y, width, height }`);
    return;
  }
  noUnknownKeys(value, ["x", "y", "width", "height"], at, errors);
  for (const key of ["x", "y"]) {
    if (!isCoord(value[key]) || value[key] < 0) errors.push(`${at}.${key}: expected a number >= 0`);
  }
  for (const key of ["width", "height"]) {
    if (!isCoord(value[key]) || value[key] <= 0) errors.push(`${at}.${key}: expected a number > 0`);
  }
}

function checkCallouts(value: unknown, at: string, errors: Errors): void {
  if (!Array.isArray(value)) {
    errors.push(`${at}: expected an array`);
    return;
  }
  if (value.length > MAX_CALLOUTS) errors.push(`${at}: at most ${MAX_CALLOUTS} callouts`);
  const seen = new Set<number>();
  value.forEach((callout: unknown, i) => {
    const where = `${at}[${i}]`;
    if (!isObj(callout)) {
      errors.push(`${where}: expected an object`);
      return;
    }
    noUnknownKeys(callout, ["index", "copy", "bbox"], where, errors);
    if (!isCount(callout.index, MAX_CALLOUTS)) {
      errors.push(`${where}.index: expected an integer from 1 to ${MAX_CALLOUTS}`);
    } else if (seen.has(callout.index)) errors.push(`${where}.index: duplicate ${callout.index}`);
    else seen.add(callout.index);
    if (!isText(callout.copy, MAX_COPY)) {
      errors.push(`${where}.copy: expected a non-empty string of at most ${MAX_COPY} characters`);
    }
    if (callout.bbox !== undefined) checkBbox(callout.bbox, `${where}.bbox`, errors);
  });
}

function srcPattern(flow: string, step: string, prefix: string | undefined): RegExp {
  const lead = prefix === undefined ? "(?:/[A-Za-z0-9_~-][A-Za-z0-9._~-]*)*" : escapeRegExp(prefix);
  return new RegExp(`^${lead}/${escapeRegExp(flow)}/${escapeRegExp(step)}\\.([0-9a-f]{8})\\.png$`);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function checkVariant(
  v: unknown,
  at: string,
  ids: [string, string],
  opts: ValidatePackOptions,
  errors: Errors,
): void {
  if (!isObj(v)) {
    errors.push(`${at}: expected an object`);
    return;
  }
  noUnknownKeys(v, ["src", "width", "height", "bytes", "callouts"], at, errors);
  const match =
    typeof v.src === "string" ? srcPattern(ids[0], ids[1], opts.publicPrefix).exec(v.src) : null;
  if (!match || !HASH8_PATTERN.test(match[1]!)) {
    const lead = opts.publicPrefix ?? "<public-prefix>";
    errors.push(`${at}.src: expected ${lead}/${ids[0]}/${ids[1]}.<8 hex chars>.png`);
  }
  for (const key of ["width", "height"]) {
    if (!isCount(v[key], MAX_DIMENSION))
      errors.push(`${at}.${key}: expected an integer from 1 to ${MAX_DIMENSION}`);
  }
  if (!isCount(v.bytes, Number.MAX_SAFE_INTEGER))
    errors.push(`${at}.bytes: expected a positive integer`);
  checkCallouts(v.callouts, `${at}.callouts`, errors);
}

function checkStep(
  step: unknown,
  at: string,
  ids: [string, string],
  opts: ValidatePackOptions,
  errors: Errors,
): void {
  if (!isObj(step)) {
    errors.push(`${at}: expected an object`);
    return;
  }
  noUnknownKeys(step, ["caption", "alt", "variants"], at, errors);
  const altLocales = checkLocalized(step.alt, `${at}.alt`, MAX_TEXT, errors);
  if (step.caption !== undefined) checkLocalized(step.caption, `${at}.caption`, MAX_TEXT, errors);
  if (!isObj(step.variants)) {
    errors.push(`${at}.variants: expected an object`);
    return;
  }
  const keys = Object.keys(step.variants);
  if (keys.length === 0 || keys.length > MAX_VARIANTS) {
    errors.push(`${at}.variants: expected 1 to ${MAX_VARIANTS} variants`);
  }
  for (const key of keys) {
    const parts = parseVariantKey(key);
    if (!parts) {
      errors.push(`${at}.variants: "${key}" is not <locale>.<theme>.<viewport>`);
      continue;
    }
    if (!altLocales.includes(parts.locale)) {
      errors.push(`${at}.alt: no text for locale "${parts.locale}" used by variant "${key}"`);
    }
    checkVariant(step.variants[key], `${at}.variants["${key}"]`, ids, opts, errors);
  }
}

function checkFlow(
  flow: unknown,
  at: string,
  id: string,
  opts: ValidatePackOptions,
  errors: Errors,
): void {
  if (!isObj(flow)) {
    errors.push(`${at}: expected an object`);
    return;
  }
  noUnknownKeys(flow, ["title", "steps"], at, errors);
  if (flow.title !== undefined) checkLocalized(flow.title, `${at}.title`, MAX_TITLE, errors);
  if (!isObj(flow.steps)) {
    errors.push(`${at}.steps: expected an object`);
    return;
  }
  const stepIds = Object.keys(flow.steps);
  if (stepIds.length === 0 || stepIds.length > MAX_STEPS) {
    errors.push(`${at}.steps: expected 1 to ${MAX_STEPS} steps`);
  }
  for (const stepId of stepIds) {
    const stepAt = `${at}.steps["${stepId}"]`;
    if (!isValidId(stepId))
      errors.push(`${stepAt}: step id must match [a-z0-9] words joined by - or _ (max ${ID_MAX})`);
    else checkStep(flow.steps[stepId], stepAt, [id, stepId], opts, errors);
  }
}

/** Checks an untrusted value against `docsxai/screens-pack@2`. */
export function validatePack(value: unknown, opts: ValidatePackOptions = {}): PackValidation {
  const errors: Errors = [];
  if (!isObj(value)) return { ok: false, errors: ["pack: expected an object"] };
  noUnknownKeys(value, ["schema", "generated_for", "flows"], "pack", errors);
  if (value.schema !== SCREENS_PACK_SCHEMA)
    errors.push(`pack.schema: expected "${SCREENS_PACK_SCHEMA}"`);
  if (value.generated_for !== undefined && !isText(value.generated_for, 128)) {
    errors.push("pack.generated_for: expected a non-empty string of at most 128 characters");
  }
  if (!isObj(value.flows)) {
    errors.push("pack.flows: expected an object");
    return { ok: false, errors };
  }
  const flowIds = Object.keys(value.flows);
  if (flowIds.length === 0 || flowIds.length > MAX_FLOWS)
    errors.push(`pack.flows: expected 1 to ${MAX_FLOWS} flows`);
  for (const id of flowIds) {
    const at = `pack.flows["${id}"]`;
    if (!isValidId(id))
      errors.push(`${at}: flow id must match [a-z0-9] words joined by - or _ (max ${ID_MAX})`);
    else checkFlow(value.flows[id], at, id, opts, errors);
  }
  return { ok: errors.length === 0, errors };
}

/** Throws one error listing every problem. */
export function assertValidPack(
  value: unknown,
  opts: ValidatePackOptions = {},
): asserts value is ScreensPack {
  const { ok, errors } = validatePack(value, opts);
  if (!ok) throw new Error(`screens pack is invalid:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
}
