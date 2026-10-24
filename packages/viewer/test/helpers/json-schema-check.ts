// A small JSON Schema (draft 2020-12) checker for the two schema files under `schemas/`. It
// implements exactly the keywords those files use and throws on any other, so a keyword added to a
// schema later cannot be silently ignored by the test. No dependency: ajv is not one of ours.

import { readFileSync } from "node:fs";

type Schema = Record<string, unknown>;

/** Reads `packages/viewer/schemas/<file>`. */
export function readSchema(file: string): Schema {
  const url = new URL(`../../schemas/${file}`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as Schema;
}

/**
 * A deep copy of `base` with the value at `path` replaced, or the key removed when `value` is
 * `undefined`. Assigns with `defineProperty`, so a `__proto__` key stays an own property.
 */
export function edited<T>(base: T, path: (string | number)[], value: unknown): T {
  const copy = structuredClone(base);
  let node = copy as unknown as Record<string | number, unknown>;
  for (const key of path.slice(0, -1)) node = node[key] as Record<string | number, unknown>;
  const last = path[path.length - 1]!;
  if (value === undefined) delete node[last];
  else
    Object.defineProperty(node, last, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  return copy;
}

/** Keywords that carry no constraint. */
const ANNOTATIONS = new Set(["$schema", "$id", "$defs", "title", "description"]);

const KEYWORDS = new Set([
  "$ref",
  "type",
  "const",
  "enum",
  "not",
  "anyOf",
  "allOf",
  "if",
  "then",
  "else",
  "required",
  "properties",
  "additionalProperties",
  "propertyNames",
  "minProperties",
  "maxProperties",
  "items",
  "maxItems",
  "minLength",
  "maxLength",
  "pattern",
  "minimum",
  "maximum",
  "exclusiveMinimum",
]);

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function typeMatches(type: unknown, value: unknown): boolean {
  switch (type) {
    case "object":
      return isObject(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    default:
      throw new Error(`json-schema-check: unsupported type ${JSON.stringify(type)}`);
  }
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Problems of `value` against `schema`, each prefixed with a JSON pointer; empty when valid. */
export function checkSchema(root: Schema, value: unknown): string[] {
  const errors: string[] = [];

  function resolve(ref: string): Schema {
    const match = /^#\/\$defs\/([A-Za-z0-9]+)$/.exec(ref);
    const target = match ? (root.$defs as Schema | undefined)?.[match[1]!] : undefined;
    if (!isObject(target)) throw new Error(`json-schema-check: cannot resolve ${ref}`);
    return target;
  }

  /** Whether `value` passes `schema`, collecting nothing. */
  const passes = (schema: Schema, v: unknown): boolean => {
    const before = errors.length;
    visit(schema, v, "");
    return errors.splice(before).length === 0;
  };

  function visit(schema: Schema, v: unknown, at: string): void {
    const fail = (why: string): number => errors.push(`${at || "/"}: ${why}`);
    for (const key of Object.keys(schema)) {
      if (!KEYWORDS.has(key) && !ANNOTATIONS.has(key)) {
        throw new Error(`json-schema-check: unsupported keyword "${key}"`);
      }
    }
    if (typeof schema.$ref === "string") visit(resolve(schema.$ref), v, at);
    if ("type" in schema && !typeMatches(schema.type, v)) {
      fail(`expected ${String(schema.type)}`);
      return;
    }
    if ("const" in schema && !same(schema.const, v))
      fail(`expected ${JSON.stringify(schema.const)}`);
    if (Array.isArray(schema.enum) && !schema.enum.some((e) => same(e, v))) fail("not in enum");
    if (isObject(schema.not) && passes(schema.not, v)) fail("matches a forbidden schema");
    if (Array.isArray(schema.allOf)) {
      for (const sub of schema.allOf as Schema[]) visit(sub, v, at);
    }
    if (Array.isArray(schema.anyOf) && !(schema.anyOf as Schema[]).some((s) => passes(s, v))) {
      fail("matches none of anyOf");
    }
    if (isObject(schema.if)) {
      const branch = passes(schema.if, v) ? schema.then : schema.else;
      if (isObject(branch)) visit(branch, v, at);
    }
    if (typeof v === "string") visitString(schema, v, fail);
    if (typeof v === "number") visitNumber(schema, v, fail);
    if (Array.isArray(v)) visitArray(schema, v, at, fail);
    if (isObject(v)) visitObject(schema, v, at, fail);
  }

  function visitString(schema: Schema, v: string, fail: (why: string) => number): void {
    // JSON Schema counts code points, not UTF-16 units.
    const length = [...v].length;
    if (typeof schema.minLength === "number" && length < schema.minLength) fail("too short");
    if (typeof schema.maxLength === "number" && length > schema.maxLength) fail("too long");
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(v)) {
      fail(`does not match ${schema.pattern}`);
    }
  }

  function visitNumber(schema: Schema, v: number, fail: (why: string) => number): void {
    if (typeof schema.minimum === "number" && v < schema.minimum) fail("below minimum");
    if (typeof schema.maximum === "number" && v > schema.maximum) fail("above maximum");
    if (typeof schema.exclusiveMinimum === "number" && v <= schema.exclusiveMinimum) {
      fail("not above exclusiveMinimum");
    }
  }

  function visitArray(
    schema: Schema,
    v: unknown[],
    at: string,
    fail: (why: string) => number,
  ): void {
    if (typeof schema.maxItems === "number" && v.length > schema.maxItems) fail("too many items");
    if (isObject(schema.items))
      v.forEach((item, i) => visit(schema.items as Schema, item, `${at}/${i}`));
  }

  function visitObject(
    schema: Schema,
    v: Record<string, unknown>,
    at: string,
    fail: (why: string) => number,
  ): void {
    const keys = Object.keys(v);
    if (typeof schema.minProperties === "number" && keys.length < schema.minProperties) {
      fail("too few properties");
    }
    if (typeof schema.maxProperties === "number" && keys.length > schema.maxProperties) {
      fail("too many properties");
    }
    for (const name of (schema.required as string[] | undefined) ?? []) {
      if (!Object.hasOwn(v, name)) fail(`missing "${name}"`);
    }
    const properties = (schema.properties as Record<string, Schema> | undefined) ?? {};
    for (const key of keys) {
      const where = `${at}/${key}`;
      if (isObject(schema.propertyNames)) {
        if (!passes(schema.propertyNames, key)) fail(`property name "${key}" is not allowed`);
      }
      if (Object.hasOwn(properties, key)) visit(properties[key]!, v[key], where);
      else if (schema.additionalProperties === false) fail(`unknown key "${key}"`);
      else if (isObject(schema.additionalProperties))
        visit(schema.additionalProperties, v[key], where);
    }
  }

  visit(root, value, "");
  return errors;
}
