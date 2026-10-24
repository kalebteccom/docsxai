// Pure parts of burn-trackxai.mjs: raw file names, sidecar checks, the screen renames, where a
// burned PNG goes and how the screens pack manifest is merged. No IO.

import { createHash } from "node:crypto";

export const SIDECAR_SCHEMA = "trackxai/raw-capture-sidecar@1";
export const PACK_SCHEMA = "docsxai/screens-pack@1";

const RAW_NAME =
  /^([a-z0-9][a-z0-9-]*)\.([A-Za-z]{2,3}(?:-[A-Za-z0-9]+)*)\.(light|dark)\.(\d+)\.png$/;

/** `<screen>.<locale>.<theme>.<width>.png` split up; null for any other name. */
export function parseRawName(name) {
  const m = RAW_NAME.exec(name);
  if (!m) return null;
  return { screen: m[1], locale: m[2], theme: m[3], width: Number(m[4]) };
}

/** `tokens=agent-tokens,ticket-panel=ticket` as a Map from raw name to landing name. */
export function parseRename(text) {
  const map = new Map();
  if (!text) return map;
  for (const pair of text.split(",")) {
    const [from, to, extra] = pair.split("=").map((s) => s.trim());
    if (!from || !to || extra !== undefined || !/^[a-z0-9][a-z0-9-]*$/.test(to)) {
      throw new Error(`--rename: "${pair}" is not <raw>=<name> (lowercase letters, digits, -)`);
    }
    map.set(from, to);
  }
  return map;
}

/** Pack directory for a capture width: `desktop-<w>` from 900 px up, `mobile-<w>` under. */
export const variantDir = (width) => (width >= 900 ? `desktop-${width}` : `mobile-${width}`);

/** First 8 hex digits of the SHA-256 of `bytes`. */
export const contentHash = (bytes) => createHash("sha256").update(bytes).digest("hex").slice(0, 8);

const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isBox = (b) =>
  isObj(b) &&
  ["x", "y", "width", "height"].every((k) => typeof b[k] === "number" && Number.isFinite(b[k]));

/**
 * The burner records of a sidecar, checked. Throws with `file` and the annotation's position on
 * anything the burner cannot use. Annotations without a `bounding_box` pass: the burner skips them
 * with a warning. `skipped` lists their positions (1-based).
 */
export function checkSidecar(doc, file, expect) {
  const fail = (msg) => {
    throw new Error(`${file}: ${msg}`);
  };
  if (!isObj(doc)) fail("not a JSON object");
  if (doc.schema !== SIDECAR_SCHEMA)
    fail(`schema must be "${SIDECAR_SCHEMA}", got ${JSON.stringify(doc.schema)}`);
  if (!Array.isArray(doc.annotations)) fail("annotations must be an array");
  const vp = doc.viewport;
  if (expect && isObj(vp) && vp.width !== expect.width) {
    fail(`viewport.width ${vp.width} does not match the file name's ${expect.width}`);
  }
  const skipped = [];
  const records = doc.annotations.map((a, i) => {
    const at = `annotation ${i + 1}`;
    if (!isObj(a)) fail(`${at} is not an object`);
    if (typeof a.copy !== "string" || a.copy.trim() === "")
      fail(`${at}: copy must be a non-empty string`);
    if (typeof a.selector !== "string") fail(`${at}: selector must be a string`);
    if (a.bounding_box === undefined) skipped.push(i + 1);
    else if (!isBox(a.bounding_box))
      fail(`${at}: bounding_box needs numeric x, y, width and height`);
    if (a.obstacles !== undefined) {
      if (!Array.isArray(a.obstacles)) fail(`${at}: obstacles must be an array`);
      a.obstacles.forEach((o, j) => {
        if (!isBox(o)) fail(`${at}: obstacle ${j + 1} needs numeric x, y, width and height`);
      });
    }
    if (a.index !== undefined && !(Number.isInteger(a.index) && a.index > 0)) {
      fail(`${at}: index must be a positive integer`);
    }
    return { ...a, step: typeof a.step === "string" ? a.step : String(doc.step ?? "") };
  });
  return { records, skipped };
}

/** Callout texts the manifest lists: the copy of each drawn annotation, numbered ones by index. */
export function calloutTexts(records) {
  return records
    .filter((r) => r.bounding_box)
    .map((r, i) => ({ n: r.index ?? 1000 + i, copy: r.copy }))
    .sort((a, b) => a.n - b.n)
    .map((r) => r.copy);
}

/**
 * `manifest` with `entries` added or replacing the variants they name. Other screens, other
 * variants and every `alt` stay, in their order; new screens and variants go last. Returns the new manifest and the `src` paths it no longer names.
 * Each entry: `{ screen, variant, value }`, `value` the variant object.
 */
export function mergeManifest(manifest, entries) {
  const base = manifest ?? { schema: PACK_SCHEMA, screens: {} };
  if (base.schema !== PACK_SCHEMA) {
    throw new Error(
      `manifest: schema must be "${PACK_SCHEMA}", got ${JSON.stringify(base.schema)}`,
    );
  }
  const screens = structuredClone(base.screens ?? {});
  const superseded = [];
  for (const { screen, variant, value } of entries) {
    const entry = screens[screen] ?? { variants: {} };
    const old = entry.variants?.[variant];
    if (old && old.src !== value.src) superseded.push(old.src);
    entry.variants = { ...entry.variants, [variant]: value };
    screens[screen] = entry;
  }
  return { manifest: { ...base, screens }, superseded };
}
