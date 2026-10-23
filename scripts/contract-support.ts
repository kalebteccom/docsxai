// Shared support for the public-surface contract tests (packages/*/test/contract/).
//
// A contract test dumps one slice of the public surface (CLI usage lines, a Zod schema, an
// interface's members, a route table) into plain JSON and compares it with a checked-in
// snapshot. The snapshots are written by hand or by an explicit opt-in rewrite, and they are
// never created or refreshed by a normal run: a missing snapshot, or one that differs, fails
// the test with the update procedure in the message.
//
// Everything here is deterministic and cheap: no browser, no network, no child processes. The
// interface helpers parse TypeScript source text with `ts.createSourceFile` (syntax only, no
// program), and `describeZod` reads Zod's `_zod.def` tree.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import ts from "typescript";

/** Set to `1` to rewrite a snapshot. The test still fails in that run, so a rewrite is never silent. */
export const UPDATE_ENV = "UPDATE_CONTRACT_SNAPSHOTS";

const PROCEDURE =
  "This is a public-surface contract test. If the change is intentional: " +
  `(1) run this test file once with ${UPDATE_ENV}=1 to rewrite the snapshot (that run fails on purpose), ` +
  "(2) review the snapshot diff with git, " +
  "(3) update docs/public-surface.md and add a CHANGELOG entry (a removal or a rename is a breaking change), " +
  `(4) run the file again without ${UPDATE_ENV}. CI never sets it.`;

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
}

/** Pretty JSON with object keys sorted at every depth and a trailing newline. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2) + "\n";
}

/** Lines that differ between two texts, as `-` (only in the snapshot) and `+` (only in the live surface). */
function lineDiff(expected: string, actual: string): string {
  const counts = new Map<string, number>();
  for (const l of expected.split("\n")) counts.set(l, (counts.get(l) ?? 0) + 1);
  const added: string[] = [];
  for (const l of actual.split("\n")) {
    const n = counts.get(l) ?? 0;
    if (n > 0) counts.set(l, n - 1);
    else added.push(`+ ${l}`);
  }
  const removed: string[] = [];
  for (const [l, n] of counts) for (let i = 0; i < n; i++) removed.push(`- ${l}`);
  return [...removed, ...added].slice(0, 80).join("\n");
}

/**
 * Compare `actual` (any JSON-able value) with the JSON snapshot at `file`. Object key order is
 * ignored, array order is not. Throws with a line diff and the update procedure on any mismatch.
 */
export function expectJsonSnapshot(file: string, actual: unknown): void {
  const text = stableStringify(actual);
  if (process.env[UPDATE_ENV] === "1") {
    writeFileSync(file, text, "utf8");
    throw new Error(
      `${file} was rewritten because ${UPDATE_ENV}=1. Review it with git, update docs/public-surface.md ` +
        `and the CHANGELOG, then run again without ${UPDATE_ENV}.`,
    );
  }
  if (!existsSync(file)) {
    throw new Error(`Contract snapshot missing: ${file}\n${PROCEDURE}`);
  }
  const expected: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!isDeepStrictEqual(expected, JSON.parse(text))) {
    throw new Error(
      `Public surface changed: ${file}\n${lineDiff(stableStringify(expected), text)}\n${PROCEDURE}`,
    );
  }
}

/** Read a source file as text (for the few surfaces that only exist as source, such as `case` labels). */
export function readSource(file: string): string {
  return readFileSync(file, "utf8");
}

// ---------------------------------------------------------------------------
// Zod schema dump
// ---------------------------------------------------------------------------
//
// Reads Zod 4's `_zod.def` tree and returns plain JSON:
//   string / number          -> "string[min:1]", "number[int,max:30000,min:100]" (checks sorted;
//                               an exclusive bound renders as `min>0`; numbers are finite by default, so
//                               there is no `finite` entry)
//   boolean, unknown, null   -> the type name
//   literal / enum           -> "literal:<value>", "enum:a|b|c" (declaration order)
//   union                    -> { oneOf: [...] } (declaration order, which is parse order)
//   array / record           -> { array: <item>, min?, max? } / { record: <value> }
//   object                   -> { strict: boolean, fields: { "key": <type>, "key?": <type> } }
//   optional field           -> key suffixed with `?`
//   field with a default     -> key suffixed with `?`, value { default, of }
//   nullable                 -> { nullable: <type> }
// Refinements (`.refine`) are invisible to this dump; test them with behavioural assertions.

/** The fields of a Zod 4 check's definition that the dump reads. */
interface ZodCheckDef {
  check: string;
  minimum?: unknown;
  maximum?: unknown;
  length?: unknown;
  value?: unknown;
  inclusive?: boolean;
  format?: string;
  pattern?: RegExp;
}

type Def = Record<string, unknown>;

function defOf(schema: unknown): Def {
  const def = (schema as { _zod?: { def?: Def } })._zod?.def;
  if (!def) throw new Error("describeZod: value is not a Zod schema");
  return def;
}

/** Definitions of a schema's attached checks (`.min()`, `.regex()`, `.refine()`, ...). */
function checkDefs(def: Def): ZodCheckDef[] {
  const checks = (def.checks ?? []) as Array<{ _zod: { def: ZodCheckDef } }>;
  return checks.map((c) => c._zod.def);
}

/** String entry for one check; `null` for checks the dump ignores (refinements). */
function stringCheck(c: ZodCheckDef): string | null {
  switch (c.check) {
    case "min_length":
      return `min:${String(c.minimum)}`;
    case "max_length":
      return `max:${String(c.maximum)}`;
    case "length_equals":
      return `length:${String(c.length)}`;
    case "string_format":
      return c.format === "regex" ? `regex:${(c.pattern as RegExp).source}` : String(c.format);
    default:
      return null;
  }
}

function numberCheck(c: ZodCheckDef): string | null {
  switch (c.check) {
    case "greater_than":
      return `min${c.inclusive ? ":" : ">"}${String(c.value)}`;
    case "less_than":
      return `max${c.inclusive ? ":" : "<"}${String(c.value)}`;
    case "number_format":
      return c.format === "safeint" ? "int" : String(c.format);
    default:
      return null;
  }
}

function withChecks(base: string, checks: Array<string | null>): string {
  const kept = checks.filter((c): c is string => c !== null);
  return kept.length > 0 ? `${base}[${[...kept].sort().join(",")}]` : base;
}

/** A default is stored as a value in Zod 4 (a getter); tolerate a thunk too. */
function defaultOf(def: Def): unknown {
  const v = def.defaultValue;
  return typeof v === "function" ? (v as () => unknown)() : v;
}

function describeField(schema: unknown): { optional: boolean; value: unknown } {
  const def = defOf(schema);
  if (def.type === "optional") {
    return { optional: true, value: describeZod(def.innerType) };
  }
  if (def.type === "default") {
    return { optional: true, value: { default: defaultOf(def), of: describeZod(def.innerType) } };
  }
  return { optional: false, value: describeZod(schema) };
}

export function describeZod(schema: unknown): unknown {
  const def = defOf(schema);
  switch (def.type) {
    case "string":
      return withChecks("string", checkDefs(def).map(stringCheck));
    case "number":
      return withChecks("number", checkDefs(def).map(numberCheck));
    case "boolean":
      return "boolean";
    case "unknown":
      return "unknown";
    case "null":
      return "null";
    case "literal":
      return `literal:${String((def.values as unknown[])[0])}`;
    case "enum":
      return `enum:${Object.values(def.entries as Record<string, string>).join("|")}`;
    case "union":
      return { oneOf: (def.options as unknown[]).map(describeZod) };
    case "array": {
      const checks = checkDefs(def);
      const min = checks.find((c) => c.check === "min_length");
      const max = checks.find((c) => c.check === "max_length");
      return {
        array: describeZod(def.element),
        ...(min ? { min: min.minimum } : {}),
        ...(max ? { max: max.maximum } : {}),
      };
    }
    case "record":
      return { record: describeZod(def.valueType) };
    case "object": {
      const shape = def.shape as Record<string, unknown>;
      const fields: Record<string, unknown> = {};
      for (const [key, field] of Object.entries(shape)) {
        const d = describeField(field);
        fields[d.optional ? `${key}?` : key] = d.value;
      }
      const catchall = def.catchall as { _zod?: { def?: Def } } | undefined;
      return { strict: catchall?._zod?.def?.type === "never", fields };
    }
    case "optional":
      return { optional: describeZod(def.innerType) };
    case "nullable":
      return { nullable: describeZod(def.innerType) };
    case "default":
      return { default: defaultOf(def), of: describeZod(def.innerType) };
    default:
      throw new Error(`describeZod: unhandled Zod type ${String(def.type)}`);
  }
}

// ---------------------------------------------------------------------------
// TypeScript source dumps (syntax only)
// ---------------------------------------------------------------------------

function parseSource(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
}

/** One-line form of a member's source text: comments removed, whitespace collapsed, trailing separator and trailing comma dropped. */
function normalize(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/[^\n]*/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\(\s/g, "(")
    .replace(/,?\s\)/g, ")")
    .replace(/[;,]$/, "");
}

function membersOf(sf: ts.SourceFile, name: string): readonly ts.TypeElement[] {
  for (const stmt of sf.statements) {
    if (ts.isInterfaceDeclaration(stmt) && stmt.name.text === name) return stmt.members;
    if (
      ts.isTypeAliasDeclaration(stmt) &&
      stmt.name.text === name &&
      ts.isTypeLiteralNode(stmt.type)
    ) {
      return stmt.type.members;
    }
  }
  throw new Error(`${name} is not an interface or object type alias in ${sf.fileName}`);
}

export interface TypeMembers {
  /** Member name -> its normalized declaration text (the `?` and `readonly` markers included). */
  members: Record<string, string>;
  /** Names of the members declared optional. */
  optional: string[];
}

/** Members of `interface <name>` or `type <name> = { ... }` in `file`, from the source text. */
export function typeMembers(file: string, name: string): TypeMembers {
  const sf = parseSource(file);
  const members: Record<string, string> = {};
  const optional: string[] = [];
  for (const m of membersOf(sf, name)) {
    if (!m.name) continue;
    const key = m.name.getText(sf);
    members[key] = normalize(m.getText(sf));
    if (m.questionToken) optional.push(key);
  }
  return { members, optional: optional.sort() };
}

/** String literals of `type <name> = "a" | "b" | ...` in `file`, in declaration order. */
export function stringUnion(file: string, name: string): string[] {
  const sf = parseSource(file);
  for (const stmt of sf.statements) {
    if (ts.isTypeAliasDeclaration(stmt) && stmt.name.text === name) {
      if (!ts.isUnionTypeNode(stmt.type)) break;
      return stmt.type.types.map((t) => {
        if (ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal)) return t.literal.text;
        throw new Error(`${name} in ${file} has a member that is not a string literal`);
      });
    }
  }
  throw new Error(`${name} is not a string-literal union in ${file}`);
}
