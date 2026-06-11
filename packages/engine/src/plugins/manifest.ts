// Plugin manifest: the `docsxai` field on a plugin package's package.json. Zod-validated; the
// rejections here are load-errors, not warnings — a plugin with a lying or malformed manifest
// never reaches `register()`.

import { z } from "zod";

/** The plugin-runtime contract version this engine build advertises. */
export const RUNTIME_API_VERSION = "1.0.0";

/** Namespaces plugins can never claim — the engine's own surfaces live here. */
export const RESERVED_NAMESPACES: ReadonlyArray<string> = [
  "site-docs",
  "docsxai",
  "core",
  "plugins",
];

export const PLUGIN_KINDS = ["publisher", "renderer", "lint-rules", "auth-strategy"] as const;
export type PluginKind = (typeof PLUGIN_KINDS)[number];

export type PluginTrust = "kalebtec" | "community" | "local";

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const NAMESPACE = /^[a-z][a-z0-9-]*$/;
// The only capability family today is target-host egress. Unknown prefixes are rejected so a
// manifest can't smuggle an undisclosed capability past review.
const CAPABILITY = /^egress:[a-zA-Z0-9*]([a-zA-Z0-9*.-]*[a-zA-Z0-9*])?$/;

const manifestSchema = z
  .object({
    apiVersion: z.string().regex(SEMVER, "apiVersion must be exact semver (x.y.z)"),
    namespace: z
      .string()
      .regex(NAMESPACE, "namespace must match /^[a-z][a-z0-9-]*$/ (kebab-case)")
      .refine((ns) => !RESERVED_NAMESPACES.includes(ns), {
        message: `namespace is reserved (${RESERVED_NAMESPACES.join(", ")})`,
      }),
    register: z.string().min(1, "register must be a relative path to the register module"),
    kinds: z.array(z.enum(PLUGIN_KINDS)).min(1, "kinds must declare at least one extension point"),
    capabilities: z
      .array(
        z
          .string()
          .regex(CAPABILITY, 'capability must match "egress:<host-glob>" (the only family today)'),
      )
      .default([]),
    dependsOn: z
      .array(z.object({ plugin: z.string().min(1), version: z.string().min(1) }).strict())
      .default([]),
    trust: z.enum(["kalebtec", "community", "local"]).default("local"),
  })
  .strict();

export type PluginManifest = z.infer<typeof manifestSchema>;

export class PluginManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginManifestError";
  }
}

/** Validate the `docsxai` field of a plugin's package.json. Throws {@link PluginManifestError}. */
export function parsePluginManifest(raw: unknown, source: string): PluginManifest {
  if (raw === undefined || raw === null) {
    throw new PluginManifestError(`${source}: package.json has no "docsxai" field — not a plugin`);
  }
  const result = manifestSchema.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.length ? i.path.join(".") + ": " : ""}${i.message}`)
      .join("; ");
    throw new PluginManifestError(`${source}: invalid "docsxai" manifest — ${detail}`);
  }
  return result.data;
}

function parseSemver(v: string): [number, number, number] | null {
  const m = SEMVER.exec(v);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * A plugin's `apiVersion` is compatible when it shares the runtime's major and its minor is ≤
 * the runtime's. A plugin built for `1.0.0` runs under runtime `1.5.0`; a plugin built for
 * `1.6.0` or `2.0.0` does not run under runtime `1.5.0`.
 */
export function isApiVersionCompatible(
  pluginApiVersion: string,
  runtimeApiVersion = RUNTIME_API_VERSION,
): boolean {
  const plugin = parseSemver(pluginApiVersion);
  const runtime = parseSemver(runtimeApiVersion);
  if (!plugin || !runtime) return false;
  return plugin[0] === runtime[0] && plugin[1] <= runtime[1];
}

function compareSemver(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! < b[i]! ? -1 : 1;
  }
  return 0;
}

/**
 * Minimal semver-range check for `dependsOn`: supports `^x.y.z`, `~x.y.z`, and exact `x.y.z`
 * (npm semantics, including the 0.x caret caveats). Anything else returns false.
 */
export function satisfiesRange(version: string, range: string): boolean {
  const v = parseSemver(version);
  if (!v) return false;
  const op = range.startsWith("^") || range.startsWith("~") ? range[0] : "";
  const base = parseSemver(op ? range.slice(1) : range);
  if (!base) return false;
  if (compareSemver(v, base) < 0) return false;
  if (op === "") return compareSemver(v, base) === 0;
  if (op === "~") return v[0] === base[0] && v[1] === base[1];
  // Caret: nothing left of the leftmost non-zero digit may change.
  if (base[0] > 0) return v[0] === base[0];
  if (base[1] > 0) return v[0] === 0 && v[1] === base[1];
  return v[0] === 0 && v[1] === 0 && v[2] === base[2];
}
