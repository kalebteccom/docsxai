// Pure parts of burn-trackxai.mjs: raw file names, sidecar checks, the screen renames, where a
// burned PNG goes and how the screens pack manifest is merged. No IO.

import { createHash } from "node:crypto";

export const SIDECAR_SCHEMA = "docsxai/raw-capture-sidecar@1";
/** Earlier name of the same schema. Still read; writers use `SIDECAR_SCHEMA`. */
export const SIDECAR_SCHEMA_LEGACY = "trackxai/raw-capture-sidecar@1";
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
 * with a warning. `skipped` lists their positions (1-based). `legacy` is true for the earlier
 * schema name.
 */
export function checkSidecar(doc, file, expect) {
  const fail = (msg) => {
    throw new Error(`${file}: ${msg}`);
  };
  if (!isObj(doc)) fail("not a JSON object");
  if (doc.schema !== SIDECAR_SCHEMA && doc.schema !== SIDECAR_SCHEMA_LEGACY)
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
  return { records, skipped, legacy: doc.schema === SIDECAR_SCHEMA_LEGACY };
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

/** Px² two boxes share; 0 when they only touch. */
export const overlap = (a, b) => {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};

/**
 * Device pixel ratio of a capture: `--dpr` (`flag`), else the sidecar's `device_scale_factor`, else
 * the PNG width over the CSS width of its file name. Throws when the PNG is not that many times
 * wider than its CSS width, or the ratio is outside 1 to 4.
 */
export function captureRatio({ flag, doc, cssWidth, pngWidth, file }) {
  const raw = flag ?? doc?.device_scale_factor ?? pngWidth / cssWidth;
  const dpr = Number(raw);
  if (!Number.isFinite(dpr) || dpr < 1 || dpr > 4) {
    throw new Error(`${file}: device pixel ratio ${raw} is not between 1 and 4`);
  }
  if (Math.abs(pngWidth - cssWidth * dpr) > 0.5) {
    throw new Error(
      `${file}: PNG is ${pngWidth} px wide, not ${cssWidth} CSS px at ratio ${dpr} (${cssWidth * dpr})`,
    );
  }
  return dpr;
}

/**
 * The manifest variant for a burned PNG: `width` and `height` in CSS px, plus `png_width` and
 * `png_height` in device px when the ratio is not 1.
 */
export function variantValue({ src, png, bytes, callouts, dpr }) {
  const css = { width: Math.round(png.width / dpr), height: Math.round(png.height / dpr) };
  return {
    src,
    ...css,
    ...(dpr === 1 ? {} : { png_width: png.width, png_height: png.height }),
    bytes,
    callouts,
  };
}

/**
 * Phone chrome of a capture `size` (device px, `dpr` device px per CSS px, default 1): header and
 * bottom nav bands of 56 CSS px; none from 900 CSS px wide.
 */
export function chromeBands({ width, height, dpr = 1 }) {
  if (width / dpr >= 900) return [];
  const bar = 56 * dpr;
  return [
    { name: "the header", box: { x: 0, y: 0, width, height: bar } },
    { name: "the bottom nav", box: { x: 0, y: height - bar, width, height: bar } },
  ];
}

/**
 * What each drawn caption and badge covers, from the burn report: listed text (a caption's own
 * obstacles, a badge's too), the other annotations' targets, other captions, badges and, on a
 * phone capture of `size`, the header and bottom nav bands. One line per problem, empty when
 * clean. Annotations are named by their index, else their position.
 */
export function coverage(records, report, size = { width: 1280, height: 800, dpr: 1 }) {
  const lines = [];
  const name = (i) => `caption ${records[i].index ?? i + 1}`;
  const bands = chromeBands(size);
  report.forEach((r, i) => {
    const b = r.badge;
    if (b) {
      const text = (records[i].obstacles ?? []).reduce((n, o) => n + overlap(b, o), 0);
      if (text > 0)
        lines.push(
          `badge ${records[i].index ?? i + 1} covers ${Math.round(text)} px² of listed text`,
        );
      for (const band of bands) {
        if (overlap(b, band.box) > 0)
          lines.push(`badge ${records[i].index ?? i + 1} is on ${band.name}`);
      }
    }
    const c = r.callout;
    if (!c) return;
    const text = (records[i].obstacles ?? []).reduce((n, o) => n + overlap(c, o), 0);
    if (text > 0) lines.push(`${name(i)} covers ${Math.round(text)} px² of listed text`);
    for (const band of bands)
      if (overlap(c, band.box) > 0) lines.push(`${name(i)} is on ${band.name}`);
    records.forEach((other, j) => {
      if (j === i) return;
      if (other.bounding_box && overlap(c, other.bounding_box) > 0) {
        lines.push(`${name(i)} covers the target of ${name(j)}`);
      }
      const oc = report[j]?.callout;
      if (oc && j > i && overlap(c, oc) > 0) lines.push(`${name(i)} overlaps ${name(j)}`);
    });
    report.forEach((o, j) => {
      if (o.badge && overlap(c, o.badge) > 0) lines.push(`${name(i)} covers badge of ${name(j)}`);
    });
  });
  return lines;
}

/** Positions (1-based) the burn drew as a badge only, from the report. */
export const badgeOnly = (report) =>
  report.flatMap((r, i) => (r.caption_style === "badge" ? [i + 1] : []));

/**
 * Frames forced to badges only, from `--badge-only` (comma list) and the `badge_only` list of the
 * overrides file. An entry is `<screen>.<width>` (every locale and theme) or
 * `<screen>.<locale>.<theme>.<width>`.
 */
export function badgeOnlyFrames(cli, file) {
  const list = [
    ...(cli ? cli.split(",") : []),
    ...(Array.isArray(file?.badge_only) ? file.badge_only : []),
  ].map((e) => String(e).trim());
  for (const e of list) {
    if (!/^[a-z0-9][a-z0-9-]*\.(?:[A-Za-z-]+\.(?:light|dark)\.)?\d+$/.test(e)) {
      throw new Error(
        `badge-only: "${e}" is not <screen>.<width> or <screen>.<locale>.<theme>.<width>`,
      );
    }
  }
  return new Set(list);
}

/** True when raw `p` (from {@link parseRawName}) is in the badge-only set. */
export const isBadgeOnly = (set, p) =>
  set.has(`${p.screen}.${p.width}`) || set.has(`${p.screen}.${p.locale}.${p.theme}.${p.width}`);

/** A WebP twin must come in under this many bytes to be kept. */
export const WEBP_MAX_BYTES = 100_000;

/** `<name>.png` -> `<name>.webp`, in the same directory. */
export const webpTwinPath = (pngPath) => pngPath.replace(/\.png$/, ".webp");

/** The `cwebp` argv for a lossless twin at the slowest, smallest setting. */
export const cwebpArgs = (input, output) => ["-lossless", "-z", "9", "-quiet", input, "-o", output];

const kb = (bytes) => `${(bytes / 1000).toFixed(1)} kB`;

/**
 * Whether a lossless WebP twin of `name` is worth keeping: under {@link WEBP_MAX_BYTES} and smaller
 * than the PNG. A dropped twin carries a warning that names both sizes.
 */
export function webpVerdict(name, pngBytes, webpBytes) {
  const sizes = `webp ${kb(webpBytes)}, png ${kb(pngBytes)}`;
  if (webpBytes >= WEBP_MAX_BYTES) {
    return {
      keep: false,
      warning: `${name}: webp twin dropped (${sizes}), needs under ${WEBP_MAX_BYTES / 1000} kB`,
    };
  }
  if (webpBytes >= pngBytes) {
    return {
      keep: false,
      warning: `${name}: webp twin dropped (${sizes}), needs to be smaller than the png`,
    };
  }
  return { keep: true };
}
