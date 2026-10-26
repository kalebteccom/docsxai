// The pure half of burn-probe-batch.mjs: finding the frames in a raw capture directory (flat or
// rawcap layout), reading either sidecar shape, turning a burn into one row per annotation, and
// writing the markdown report. No file IO and no viewer import here, so
// burn-probe-batch-plan.test.mjs can check it with `node --test`. The strict checks come from
// burn-trackxai-plan.mjs (`checkSidecar`, `coverage`, `chromeBands`, `overlap`).

import {
  checkSidecar,
  chromeBands,
  coverage,
  overlap,
  parseRawName,
} from "./burn-trackxai-plan.mjs";

const LOCALE = "[A-Za-z]{2,3}(?:-[A-Za-z0-9]+)*";
const SEGMENT = "[A-Za-z0-9][A-Za-z0-9_-]*";
// rawcap: <flow>/<step>/<locale>.<theme>.<viewport>.png, <viewport> a width (390) or a name ending in one (mobile-390).
const RAWCAP_PNG = new RegExp(
  `^(${SEGMENT})/(${SEGMENT})/(${LOCALE})\\.(light|dark)\\.(?:[A-Za-z][A-Za-z0-9]*-)?(\\d+)\\.png$`,
);

export const PROJECTS = ["trackxai", "remotxai"];

/** Name of the default tokens file under examples/burn-theme for a project and theme. */
export function defaultTokensName(project, theme) {
  if (!PROJECTS.includes(project)) {
    throw new Error(`--project must be one of ${PROJECTS.join(", ")} (got ${project})`);
  }
  return `${project}-${theme}.tokens.json`;
}

/** A badge farther than this from its target is not next to it. */
export const BADGE_REACH = 6;

/**
 * The frames among `files`, relative paths with `/` separators. A frame is a PNG named
 * `<screen>.<locale>.<theme>.<width>.png` at the top (flat layout) or
 * `<flow>/<step>/<locale>.<theme>.<viewport>.png` two directories down (rawcap layout). Anything
 * else (manifests, READMEs, step metadata, a workspace copy, a `.json` without its PNG) is
 * ignored. Frames come back sorted by label.
 */
export function listFrames(files) {
  const frames = [];
  for (const file of files) {
    const flat = file.includes("/") ? null : parseRawName(file);
    if (flat) {
      frames.push({
        layout: "flat",
        label: file.replace(/\.png$/, ""),
        screen: flat.screen,
        locale: flat.locale,
        theme: flat.theme,
        width: flat.width,
        png: file,
        json: file.replace(/\.png$/, ".json"),
      });
      continue;
    }
    const m = RAWCAP_PNG.exec(file);
    if (!m) continue;
    frames.push({
      layout: "rawcap",
      label: `${m[1]}/${m[2]}/${m[3]}.${m[4]}.${m[5]}`,
      screen: `${m[1]}/${m[2]}`,
      locale: m[3],
      theme: m[4],
      width: Number(m[5]),
      png: file,
      json: file.replace(/\.png$/, ".json"),
    });
  }
  return frames.sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Device pixels per CSS pixel of a frame: the sidecar's `device_scale_factor` (a number from 1 to
 * 4, else an error naming the frame), else 2 to 4 when the PNG is exactly that many times the
 * width in its file name, else 1. A PNG at no whole multiple burns at 1, as the probe always did.
 */
export function probeRatio(doc, frame, pngWidth) {
  const declared = isObj(doc) ? doc.device_scale_factor : undefined;
  if (declared !== undefined) {
    if (
      typeof declared !== "number" ||
      !Number.isFinite(declared) ||
      declared < 1 ||
      declared > 4
    ) {
      throw new Error(
        `${frame.label}: device_scale_factor must be a number from 1 to 4 (got ${JSON.stringify(declared)})`,
      );
    }
    return declared;
  }
  for (const k of [2, 3, 4]) if (pngWidth === frame.width * k) return k;
  return 1;
}

/** `flat`, `rawcap`, `mixed` (both kinds of frame) or `none`. */
export function detectLayout(frames) {
  const kinds = new Set(frames.map((f) => f.layout));
  if (kinds.size === 0) return "none";
  return kinds.size === 2 ? "mixed" : [...kinds][0];
}

/** The frames that match the run's theme, locale and widths. */
export const selectFrames = (frames, { theme, locale, widths }) =>
  frames.filter((f) => f.theme === theme && f.locale === locale && widths.includes(f.width));

/** File name of a frame's burned preview: `/` in a rawcap label becomes `__`. */
export const previewName = (frame) => `${frame.label.replaceAll("/", "__")}.png`;

const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isBox = (b) =>
  isObj(b) &&
  ["x", "y", "width", "height"].every((k) => typeof b[k] === "number" && Number.isFinite(b[k]));
const box = (b) => ({ x: b.x, y: b.y, width: b.width, height: b.height });

/**
 * The burner records of a sidecar in either shape. A flat sidecar (`docsxai/raw-capture-sidecar@1`, or the earlier `trackxai/` name,
 * `bounding_box`) goes through `checkSidecar`. A rawcap sidecar (`{ width, height, annotations:
 * [{ index, copy, bbox, arrow_style?, nudge?, obstacles?, placement? }] }`) is read here; its
 * annotations without a box are kept so the burner skips them. `skipped` lists their 1-based
 * positions. Throws with `file` on anything the burner cannot use.
 */
export function readSidecar(doc, file, frame) {
  const list = isObj(doc) ? doc.annotations : undefined;
  const flat =
    isObj(doc) &&
    (doc.schema !== undefined ||
      (Array.isArray(list) && list.some((a) => isObj(a) && a.bounding_box !== undefined)));
  if (flat) return checkSidecar(doc, file, { width: frame.width });
  const fail = (msg) => {
    throw new Error(`${file}: ${msg}`);
  };
  if (!isObj(doc)) fail("not a JSON object");
  if (!Array.isArray(list)) fail("annotations must be an array");
  if (doc.width !== undefined && doc.width !== frame.width) {
    fail(`width ${doc.width} does not match the file name's ${frame.width}`);
  }
  const skipped = [];
  const records = list.map((a, i) => {
    const at = `annotation ${i + 1}`;
    if (!isObj(a)) fail(`${at} is not an object`);
    if (typeof a.copy !== "string" || a.copy.trim() === "")
      fail(`${at}: copy must be a non-empty string`);
    if (a.bbox === undefined) skipped.push(i + 1);
    else if (!isBox(a.bbox)) fail(`${at}: bbox needs numeric x, y, width and height`);
    if (a.obstacles !== undefined && !(Array.isArray(a.obstacles) && a.obstacles.every(isBox)))
      fail(`${at}: obstacles must be an array of boxes`);
    return {
      step: frame.screen,
      selector: `annotation-${a.index ?? i + 1}`,
      copy: a.copy,
      ...(a.bbox !== undefined ? { bounding_box: box(a.bbox) } : {}),
      ...(Number.isInteger(a.index) ? { index: a.index } : {}),
      ...(a.arrow_style !== undefined ? { arrow_style: a.arrow_style } : {}),
      ...(isObj(a.nudge) ? { nudge: { x: a.nudge.x, y: a.nudge.y } } : {}),
      ...(a.obstacles !== undefined ? { obstacles: a.obstacles.map(box) } : {}),
      ...(a.placement !== undefined ? { placement: a.placement } : {}),
    };
  });
  return { records, skipped };
}

/** Px between two boxes that do not overlap: 0 when they touch. */
export function gap(a, b) {
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width));
  const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height));
  return Math.hypot(dx, dy);
}

const sum = (target, boxes) => Math.round(boxes.reduce((n, o) => n + overlap(target, o), 0));
const own = /(px² of listed text|is on the (?:header|bottom nav))$/;

/**
 * One row per annotation of a burned frame. `report` is the burner's report, one entry per record.
 * `connectors[i]` is `{ length, crossing }` for annotation i: the connector's run in px and the px
 * of it inside listed text (0 and 0 when none was drawn). `size` is the capture's pixel size.
 * `coverage` supplies the problems that involve other annotations (covered targets, overlapping
 * captions, covered badges) and the badge's own, which go in `notes`.
 *
 * Verdict: CHECK when the caption covers listed text or the phone header or bottom nav, the
 * burner marked it unplaceable, a badge is off its target by more than {@link BADGE_REACH} px, on
 * listed text or on phone chrome, `coverage` lists a problem, or (phone captures only, as the
 * burn tests hold them) the connector crosses listed text. Desktop captures keep the crossing
 * column but are not held to it.
 */
export function frameRows(frame, records, report, connectors, size) {
  const bands = chromeBands(size);
  const phone = size.width / (size.dpr ?? 1) < 900;
  const lines = coverage(records, report, size);
  return records.map((record, i) => {
    const r = report[i];
    const n = record.index ?? i + 1;
    const base = { frame: frame.label, n };
    if (r.skipped !== undefined || (r.mode === "none" && r.caption_style !== "badge")) {
      return {
        ...base,
        mode: "skipped",
        side: "-",
        connector: "-",
        text: "-",
        chrome: "-",
        crosses: "-",
        badge: "-",
        verdict: "SKIPPED",
        notes: r.skipped ?? "no callout",
      };
    }
    const caption = r.caption_style === "badge" ? null : r.callout;
    const text = caption ? sum(caption, record.obstacles ?? []) : 0;
    const chrome = caption
      ? sum(
          caption,
          bands.map((b) => b.box),
        )
      : 0;
    const conn = caption
      ? (connectors[i] ?? { length: 0, crossing: 0 })
      : { length: 0, crossing: 0 };
    const crosses = conn.crossing > 0;
    let badge = "-";
    const problems = [];
    if (r.badge && record.bounding_box) {
      const away = gap(r.badge, record.bounding_box);
      const onTarget = overlap(r.badge, record.bounding_box) > 0;
      badge = onTarget || away > BADGE_REACH ? "no" : "yes";
    }
    const notes = lines
      .filter((l) => new RegExp(`^(?:caption|badge) ${n}\\b`).test(l))
      .filter((l) => !(l.startsWith("caption") && own.test(l)));
    if (text > 0) problems.push("caption over text");
    if (chrome > 0) problems.push("caption over header/nav");
    if (r.unplaceable) problems.push("unplaceable");
    if (phone && crosses) problems.push("connector crosses text");
    if (badge === "no") problems.push("badge not adjacent");
    const check = problems.length > 0 || notes.length > 0;
    return {
      ...base,
      mode: caption ? "full" : "badge",
      side: r.mode === "inside" ? "inside" : (r.side ?? "-"),
      connector: caption ? String(conn.length) : "-",
      text: caption ? text : "-",
      chrome: caption ? chrome : "-",
      crosses: caption ? (crosses ? "yes" : "no") : "-",
      badge,
      verdict: check ? "CHECK" : "OK",
      notes: [...problems, ...notes].join("; "),
    };
  });
}

/** Counts for the summary table. `failed` is the frames that could not be read or burned. */
export function summarize(frameCount, rows, failed = 0) {
  const count = (v) => rows.filter((r) => r.verdict === v).length;
  return {
    frames: frameCount,
    annotations: rows.length,
    ok: count("OK"),
    check: count("CHECK"),
    skipped: count("SKIPPED"),
    failed,
  };
}

const cell = (v) => String(v).replaceAll("|", "\\|").replaceAll("\n", " ");
const HEAD = [
  "frame",
  "n",
  "mode",
  "side",
  "connector px",
  "caption over text px²",
  "caption over header/nav px²",
  "connector crosses text",
  "badge adjacent",
  "verdict",
  "notes",
];

function table(rows) {
  const head = `| ${HEAD.join(" | ")} |`;
  const rule = `| ${HEAD.map(() => "---").join(" | ")} |`;
  const body = rows.map(
    (r) =>
      `| ${[r.frame, r.n, r.mode, r.side, r.connector, r.text, r.chrome, r.crosses, r.badge, r.verdict, r.notes].map(cell).join(" | ")} |`,
  );
  return [head, rule, ...body].join("\n");
}

/**
 * The markdown report. `meta` is `{ layout, theme, locale, widths, tokens }`, `errors` the frames
 * that failed as `{ frame, message }`. CHECK rows come first, then every row in frame order.
 */
export function formatReport({ meta, rows, frames, errors = [], legacy = 0 }) {
  const s = summarize(frames, rows, errors.length);
  const check = rows.filter((r) => r.verdict === "CHECK");
  const out = [
    "# Burn probe report",
    "",
    `Layout ${meta.layout}, theme ${meta.theme}, locale ${meta.locale}, widths ${meta.widths.join(", ")}, tokens ${meta.tokens}.`,
    "",
    "## Summary",
    "",
    "| frames | annotations | OK | CHECK | skipped (no bounding_box) | frames failed |",
    "| --- | --- | --- | --- | --- | --- |",
    `| ${s.frames} | ${s.annotations} | ${s.ok} | ${s.check} | ${s.skipped} | ${s.failed} |`,
    "",
    "## CHECK",
    "",
    check.length === 0 ? "None." : table(check),
  ];
  if (errors.length > 0) {
    out.push("", "## Frames that failed", "");
    for (const e of errors) out.push(`- ${cell(e.frame)}: ${cell(e.message)}`);
  }
  if (legacy > 0) {
    out.push(
      "",
      `Note: ${legacy} sidecar(s) use the schema name \`trackxai/raw-capture-sidecar@1\`. Write \`docsxai/raw-capture-sidecar@1\`; the old name still works.`,
    );
  }
  out.push("", "## All annotations", "", rows.length === 0 ? "None." : table(rows), "");
  return out.join("\n");
}
