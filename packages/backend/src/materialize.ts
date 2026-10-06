// Lays a stored revision out as a workspace the engine can run: `flows/<name>.flow.yaml`,
// `docs/<flow>[/<variant>]/{annotations.json, screenshots/}`, `docs/{style.yaml,style.json,
// locators.yaml}` and `.docsxai.json`. The artifact payloads are the shapes `docsxai push`
// writes (`docsxai/flows@1` and the rest); the backend does not depend on the engine, so the
// name rules the engine's `FlowName` and pull validator apply are repeated here, and a test in
// `packages/docsxai/test` holds the two copies to the same answers.

import * as fs from "node:fs";
import * as path from "node:path";
import type { RevisionArtifact } from "./api.js";
import { appUrlProblem } from "./app-url.js";
import { sha256Hex, type BackendStore } from "./store.js";

/** The workspace config file the engine reads (`WORKSPACE_CONFIG_FILE` in the engine). */
export const WORKSPACE_CONFIG_FILE = ".docsxai.json";

/** Longest flow name (`MAX_FLOW_NAME_LENGTH` in the engine). */
export const MAX_FLOW_NAME_LENGTH = 64;

const FLOW_FILE_SUFFIX = ".flow.yaml";
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SCREENSHOT_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:png|jpe?g|webp)$/i;
const WINDOWS_DEVICE_STEM = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** A stored payload would not make a workspace the engine can run; nothing past it was written. */
export class MaterializeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MaterializeError";
  }
}

const isWindowsDeviceName = (name: string): boolean =>
  WINDOWS_DEVICE_STEM.test(name.split(".", 1)[0] ?? "");

/** Same answer as the engine's `FlowName` schema. */
export function isFlowName(name: string): boolean {
  return (
    name.length >= 1 &&
    name.length <= MAX_FLOW_NAME_LENGTH &&
    SAFE_SEGMENT.test(name) &&
    !name.includes("..") &&
    !name.endsWith(".") &&
    !isWindowsDeviceName(name)
  );
}

/** Names a variant directory cannot take: they are what the flow directory holds already. */
const RESERVED_SEGMENTS = new Set(["annotations.json", "screenshots"]);

const SHA256_HEX = /^[0-9a-f]{64}$/;

const isSafeSegment = (seg: string): boolean =>
  seg.length <= 128 &&
  !RESERVED_SEGMENTS.has(seg.toLowerCase()) &&
  SAFE_SEGMENT.test(seg) &&
  !seg.includes("..") &&
  !seg.endsWith(".") &&
  !isWindowsDeviceName(seg);

const isScreenshotFile = (file: string): boolean =>
  SCREENSHOT_FILE.test(file) && isSafeSegment(file) && isSafeSegment(file.replace(/\.[^.]+$/, ""));

/** `<flow>[/<variant>]`, every segment safe, the flow segment a valid flow name. */
function isOutputDir(segments: string[]): boolean {
  const [flow, ...variants] = segments;
  return (
    flow !== undefined && isFlowName(flow) && variants.length <= 1 && variants.every(isSafeSegment)
  );
}

/** `<valid flow name>.flow.yaml`. */
export function isFlowFileName(file: string): boolean {
  return file.endsWith(FLOW_FILE_SUFFIX) && isFlowName(file.slice(0, -FLOW_FILE_SUFFIX.length));
}

/** `<flow>[/<variant>]/annotations.json`, relative to `docs/`. */
export function isAnnotationsPath(rel: string): boolean {
  const segments = rel.split("/");
  return segments.pop() === "annotations.json" && isOutputDir(segments);
}

/** `<flow>[/<variant>]/screenshots/<file>`, relative to `docs/`. */
export function isScreenshotPath(rel: string): boolean {
  const segments = rel.split("/");
  const file = segments.pop() ?? "";
  return isScreenshotFile(file) && segments.pop() === "screenshots" && isOutputDir(segments);
}

/** The first two names that differ only by case, or null; exact duplicates are not a clash. */
function caseClash(names: Iterable<string>): [string, string] | null {
  const seen = new Map<string, string>();
  for (const name of names) {
    const earlier = seen.get(name.toLowerCase());
    if (earlier !== undefined && earlier !== name) return [earlier, name];
    if (earlier === undefined) seen.set(name.toLowerCase(), name);
  }
  return null;
}

function describeName(name: string): string {
  return JSON.stringify(name.length > 80 ? `${name.slice(0, 80)}...` : name);
}

/** The `files` map of a payload, or an empty one when the slot is absent. */
function filesOf(payload: unknown, slot: RevisionArtifact): Record<string, unknown> {
  if (typeof payload !== "object" || payload === null) {
    throw new MaterializeError(`${slot} payload is not an object`);
  }
  const files = (payload as { files?: unknown }).files;
  if (typeof files !== "object" || files === null || Array.isArray(files)) {
    throw new MaterializeError(`${slot} payload has no files map`);
  }
  return files as Record<string, unknown>;
}

function checkedNames(
  slot: RevisionArtifact,
  files: Record<string, unknown>,
  ok: (name: string) => boolean,
): string[] {
  const names = Object.keys(files);
  const bad = names.find((n) => !ok(n));
  if (bad !== undefined) {
    throw new MaterializeError(
      `${slot} file name ${describeName(bad)} is not a valid ${slot} path`,
    );
  }
  return names;
}

function assertNoCaseClash(what: string, names: string[]): void {
  const clash = caseClash(names);
  if (clash) {
    throw new MaterializeError(
      `${what} ${describeName(clash[0])} and ${describeName(clash[1])} differ only by case`,
    );
  }
}

function write(root: string, rel: string, data: string | Uint8Array): void {
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(root + path.sep)) {
    throw new MaterializeError(`path escapes the workspace: ${describeName(rel)}`);
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, data);
}

export interface MaterializeSource {
  store: BackendStore;
  workspaceId: string;
  projectId: string;
  revisionId: string;
  artifacts: readonly RevisionArtifact[];
}

export interface MaterializeOptions {
  /** Written to `.docsxai.json` as `app_url`, the default base URL for `docsxai run`. */
  appUrl?: string;
  /** Also refuse a loopback or private-network `appUrl` (see `DENY_PRIVATE_APP_URL_ENV`). */
  denyPrivateAppUrl?: boolean;
}

/** Write the revision's artifacts under `dir` in the layout `docsxai run <dir>` reads. */
export function materializeDocPack(
  dir: string,
  src: MaterializeSource,
  opts: MaterializeOptions = {},
): void {
  const root = path.resolve(dir);
  const { store, workspaceId, projectId, revisionId } = src;
  const payload = (slot: RevisionArtifact): unknown =>
    store.getArtifact(workspaceId, projectId, revisionId, slot);
  const has = (slot: RevisionArtifact): boolean => src.artifacts.includes(slot);

  // `run` lists flows/ and reads docs/ for stale outputs, so both exist even for an empty pack.
  fs.mkdirSync(path.join(root, "flows"), { recursive: true });
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });

  const appUrlIssue =
    opts.appUrl === undefined
      ? null
      : appUrlProblem(opts.appUrl, { denyPrivate: opts.denyPrivateAppUrl === true });
  if (appUrlIssue) throw new MaterializeError(appUrlIssue);
  const config = {
    schema: "docsxai/workspace@1",
    ...(opts.appUrl ? { app_url: opts.appUrl } : {}),
    created_at: new Date().toISOString(),
  };
  write(root, WORKSPACE_CONFIG_FILE, JSON.stringify(config, null, 2) + "\n");

  if (has("flows")) {
    const files = filesOf(payload("flows"), "flows");
    const names = checkedNames("flows", files, isFlowFileName);
    assertNoCaseClash("flows", names);
    for (const name of names) {
      const text = files[name];
      if (typeof text !== "string") {
        throw new MaterializeError(`flows file ${describeName(name)} is not text`);
      }
      write(root, `flows/${name}`, text);
    }
  }

  const annotationFiles = has("annotations") ? filesOf(payload("annotations"), "annotations") : {};
  const screenshotFiles = has("screenshots") ? filesOf(payload("screenshots"), "screenshots") : {};
  const annotationRels = checkedNames("annotations", annotationFiles, isAnnotationsPath);
  const screenshotRels = checkedNames("screenshots", screenshotFiles, isScreenshotPath);
  assertNoCaseClash("annotations", annotationRels);
  assertNoCaseClash("screenshots", screenshotRels);
  // `Tour/` and `tour/` are one directory on a case-insensitive disk, whichever artifact names it.
  assertNoCaseClash("output directories", [
    ...annotationRels.map((n) => n.split("/").slice(0, -1).join("/")),
    ...screenshotRels.map((n) => n.split("/").slice(0, -2).join("/")),
  ]);

  for (const rel of annotationRels) {
    write(root, `docs/${rel}`, JSON.stringify(annotationFiles[rel], null, 2) + "\n");
  }

  for (const rel of screenshotRels) {
    const sha256 = (screenshotFiles[rel] as { sha256?: unknown } | null)?.sha256;
    if (typeof sha256 !== "string") {
      throw new MaterializeError(`screenshots entry ${describeName(rel)} has no sha256`);
    }
    if (!SHA256_HEX.test(sha256)) {
      throw new MaterializeError(`screenshots entry ${describeName(rel)} has a malformed sha256`);
    }
    const bytes = store.getBlob(sha256);
    if (sha256Hex(bytes) !== sha256) {
      throw new MaterializeError(`blob for ${describeName(rel)} failed its sha256 check`);
    }
    write(root, `docs/${rel}`, bytes);
  }

  if (has("style")) {
    const style = payload("style") as { yaml?: unknown; json?: unknown } | null;
    if (typeof style?.yaml === "string") write(root, "docs/style.yaml", style.yaml);
    if (style?.json !== undefined && style.json !== null) {
      write(root, "docs/style.json", JSON.stringify(style.json, null, 2) + "\n");
    }
  }

  if (has("locators")) {
    const locators = payload("locators") as { yaml?: unknown } | null;
    if (typeof locators?.yaml === "string") write(root, "docs/locators.yaml", locators.yaml);
  }
}
