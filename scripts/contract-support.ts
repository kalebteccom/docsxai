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
// program), and `describeZod` reads Zod's `_def` tree.

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
// Reads Zod 3's `_def` tree and returns plain JSON:
//   string / number          -> "string[min:1]", "number[int,max:30000,min:100]" (checks sorted;
//                               an exclusive bound renders as `min>0`)
//   boolean, unknown, null   -> the type name
//   literal / enum           -> "literal:<value>", "enum:a|b|c" (declaration order)
//   union                    -> { oneOf: [...] } (declaration order, which is parse order)
//   array / record           -> { array: <item>, min?, max? } / { record: <value> }
//   object                   -> { strict: boolean, fields: { "key": <type>, "key?": <type> } }
//   optional field           -> key suffixed with `?`
//   field with a default     -> key suffixed with `?`, value { default, of }
//   nullable                 -> { nullable: <type> }
// Refinements (`.refine`) are invisible to this dump; test them with behavioural assertions.

interface ZodCheck {
  kind: string;
  value?: unknown;
  inclusive?: boolean;
  regex?: RegExp;
}

type Def = Record<string, unknown>;

function defOf(schema: unknown): Def {
  const def = (schema as { _def?: Def })._def;
  if (!def) throw new Error("describeZod: value is not a Zod schema");
  return def;
}

function stringCheck(c: ZodCheck): string {
  if (c.kind === "min" || c.kind === "max" || c.kind === "length") {
    return `${c.kind}:${String(c.value)}`;
  }
  if (c.kind === "regex") return `regex:${(c.regex as RegExp).source}`;
  return c.kind;
}

function numberCheck(c: ZodCheck): string {
  if (c.kind === "min" || c.kind === "max") {
    const sep = c.inclusive ? ":" : c.kind === "min" ? ">" : "<";
    return `${c.kind}${sep}${String(c.value)}`;
  }
  return c.kind;
}

function withChecks(base: string, checks: string[]): string {
  return checks.length > 0 ? `${base}[${[...checks].sort().join(",")}]` : base;
}

function describeField(schema: unknown): { optional: boolean; value: unknown } {
  const def = defOf(schema);
  if (def.typeName === "ZodOptional") {
    return { optional: true, value: describeZod(def.innerType) };
  }
  if (def.typeName === "ZodDefault") {
    const make = def.defaultValue as () => unknown;
    return { optional: true, value: { default: make(), of: describeZod(def.innerType) } };
  }
  return { optional: false, value: describeZod(schema) };
}

export function describeZod(schema: unknown): unknown {
  const def = defOf(schema);
  switch (def.typeName) {
    case "ZodString":
      return withChecks("string", (def.checks as ZodCheck[]).map(stringCheck));
    case "ZodNumber":
      return withChecks("number", (def.checks as ZodCheck[]).map(numberCheck));
    case "ZodBoolean":
      return "boolean";
    case "ZodUnknown":
      return "unknown";
    case "ZodNull":
      return "null";
    case "ZodLiteral":
      return `literal:${String(def.value)}`;
    case "ZodEnum":
      return `enum:${(def.values as string[]).join("|")}`;
    case "ZodUnion":
      return { oneOf: (def.options as unknown[]).map(describeZod) };
    case "ZodArray": {
      const min = def.minLength as { value: number } | null;
      const max = def.maxLength as { value: number } | null;
      return {
        array: describeZod(def.type),
        ...(min ? { min: min.value } : {}),
        ...(max ? { max: max.value } : {}),
      };
    }
    case "ZodRecord":
      return { record: describeZod(def.valueType) };
    case "ZodObject": {
      const shape = (def.shape as () => Record<string, unknown>)();
      const fields: Record<string, unknown> = {};
      for (const [key, field] of Object.entries(shape)) {
        const d = describeField(field);
        fields[d.optional ? `${key}?` : key] = d.value;
      }
      return { strict: def.unknownKeys === "strict", fields };
    }
    case "ZodOptional":
      return { optional: describeZod(def.innerType) };
    case "ZodNullable":
      return { nullable: describeZod(def.innerType) };
    case "ZodDefault": {
      const make = def.defaultValue as () => unknown;
      return { default: make(), of: describeZod(def.innerType) };
    }
    case "ZodEffects":
      return describeZod(def.schema);
    default:
      throw new Error(`describeZod: unhandled Zod type ${String(def.typeName)}`);
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
