// Pure parts of landing-showcase.mjs: asset names, the panel geometry of the before/after shot,
// the `docsxai run` transcript the terminal shot prints, the <picture> sources the landing page
// reads, and which old files a new run replaces. No IO, so landing-showcase-plan.test.mjs checks
// it with `node --test`.

export { contentHash } from "./burn-trackxai-plan.mjs";

/** The two shots, in page order. */
export const SHOTS = ["pipeline", "terminal"];
export const THEMES = ["dark", "light"];
/** Desktop first: the last <source> without a media query and the <img> fallback use it. */
export const WIDTHS = [1280, 390];
/** Viewports up to this width get the 390 px files. Matches brand.css's phone breakpoint. */
export const PHONE_MEDIA = "(max-width: 34rem)";
/** Pixel density of each width's files: phones get 2x files, shown at the CSS width. */
export const DENSITY = { 1280: 1, 390: 2 };
/** Lossless WebP twins must stay under this, and under their PNG. */
export const MAX_BYTES = 100_000;

const NAME = /^(pipeline|terminal)-(dark|light)-(\d+)(x2)?\.([0-9a-f]{8})\.(png|webp)$/;

/** `<shot>-<theme>-<width>.<hash8>.<ext>`; a 2x file is `<width>x2`, `width` its CSS width. */
export function assetName(shot, theme, width, hash, ext, density = 1) {
  if (!SHOTS.includes(shot)) throw new Error(`unknown shot "${shot}"`);
  if (!THEMES.includes(theme)) throw new Error(`unknown theme "${theme}"`);
  if (!WIDTHS.includes(width)) throw new Error(`unknown width ${width}`);
  if (!/^[0-9a-f]{8}$/.test(hash)) throw new Error(`hash must be 8 hex digits, got "${hash}"`);
  if (ext !== "png" && ext !== "webp") throw new Error(`ext must be png or webp, got "${ext}"`);
  if (density !== 1 && density !== 2) throw new Error(`density must be 1 or 2, got ${density}`);
  return `${shot}-${theme}-${width}${density === 2 ? "x2" : ""}.${hash}.${ext}`;
}

/** An asset name split up; null for any other file. */
export function parseAssetName(name) {
  const m = NAME.exec(name);
  if (!m) return null;
  return {
    shot: m[1],
    theme: m[2],
    width: Number(m[3]),
    density: m[4] ? 2 : 1,
    hash: m[5],
    ext: m[6],
  };
}

/** Files in the output folder that look like ours but are not in `keep`: the previous run's. */
export const staleFiles = (existing, keep) =>
  existing.filter((f) => parseAssetName(f) && !keep.includes(f)).sort();

/**
 * Where the raw and burned panels go. Desktop puts them side by side and crops the app's
 * 248 px sidebar, phone stacks them and keeps the top of the screen, where the annotated
 * progress bar sits. Both panels crop the same rectangle of the same capture.
 */
export function pipelineLayout(width) {
  const label = { height: 26, gap: 8 };
  if (width === 1280) {
    const crop = { x: 248, y: 0, width: 1032, height: 800 };
    const gap = 32;
    const panelWidth = (width - gap) / 2;
    const scale = panelWidth / crop.width;
    const panelHeight = Math.round(crop.height * scale);
    const top = label.height + label.gap;
    return {
      width,
      height: top + panelHeight,
      direction: "row",
      crop,
      scale,
      label,
      panels: [
        { kind: "raw", x: 0, y: top, width: panelWidth, height: panelHeight },
        { kind: "burned", x: panelWidth + gap, y: top, width: panelWidth, height: panelHeight },
      ],
    };
  }
  if (width === 390) {
    const crop = { x: 0, y: 0, width: 390, height: 360 };
    const pad = 12;
    const panelWidth = width - pad * 2;
    const scale = panelWidth / crop.width;
    const panelHeight = Math.round(crop.height * scale);
    const block = label.height + label.gap + panelHeight;
    const between = 20;
    return {
      width,
      height: block * 2 + between,
      direction: "column",
      crop,
      scale,
      label,
      panels: [
        {
          kind: "raw",
          x: pad,
          y: label.height + label.gap,
          width: panelWidth,
          height: panelHeight,
        },
        {
          kind: "burned",
          x: pad,
          y: block + between + label.height + label.gap,
          width: panelWidth,
          height: panelHeight,
        },
      ],
    };
  }
  throw new Error(`no pipeline layout for width ${width}`);
}

/**
 * What `docsxai run <workspace>` prints for a passing run at the default concurrency of 1: the
 * progress lines of packages/engine/src/run-flows.ts and the summary of cli-run-summary.ts.
 * `units`: `{ flow, variant, steps, annotations }` in run order; `variant` null for a flow
 * without a matrix.
 */
export function runTranscript(workspace, units) {
  if (units.length === 0) throw new Error("runTranscript needs at least one unit");
  const lines = [];
  for (const u of units) {
    const name = u.variant ? `${u.flow}/${u.variant}` : u.flow;
    lines.push(`run: ${name}, starting`);
    lines.push(
      `run: ${name}, ${u.steps} step(s) executed, ${u.annotations} annotation(s) written`,
    );
  }
  const noun = units.some((u) => u.variant) ? "flow variants" : "flows";
  const unit = units.length === 1 ? noun.replace(/s$/, "") : noun;
  const docs = `${workspace.replace(/\/+$/, "")}/docs`;
  lines.push(`run: ${units.length} of ${units.length} ${unit} ok, outputs in ${docs}`);
  return lines;
}

/**
 * The same facts as runTranscript on one row per unit, for a phone: no `run:` prefix, no flow
 * name, no starting lines, and a variant id such as `en-US.dark.mobile-390` as `en-US dark 390`.
 */
export function compactTranscript(workspace, units) {
  if (units.length === 0) throw new Error("compactTranscript needs at least one unit");
  const lines = units.map((u) => {
    const name = u.variant ? shortVariant(u.variant) : u.flow;
    return `ok ${name}, ${u.steps} steps, ${u.annotations} annotations`;
  });
  const noun = units.some((u) => u.variant) ? "flow variants" : "flows";
  const unit = units.length === 1 ? noun.replace(/s$/, "") : noun;
  lines.push(`${units.length} of ${units.length} ${unit} ok`);
  lines.push(`outputs in ${workspace.replace(/\/+$/, "")}/docs`);
  return lines;
}

/** `en-US.dark.mobile-390` as `en-US dark 390`; an id of another shape is returned as it is. */
export function shortVariant(id) {
  const m = /^([^.]+)\.([^.]+)\.[^.]*?-?(\d+)$/.exec(id);
  return m ? `${m[1]} ${m[2]} ${m[3]}` : id;
}

/**
 * `line` cut into rows of at most `cols` characters for a monospace font, breaking at spaces
 * where it can; continuation rows start with `indent` spaces. A word longer than a row is cut.
 */
export function wrapMono(line, cols, indent = 2) {
  if (cols <= indent + 1) throw new Error(`wrapMono: cols ${cols} leaves no room after the indent`);
  const rows = [];
  let rest = line;
  let lead = 0;
  while (rest.length > cols) {
    const space = rest.lastIndexOf(" ", cols);
    const atSpace = space > lead;
    const cut = atSpace ? space : cols;
    rows.push(rest.slice(0, cut));
    rest = " ".repeat(indent) + rest.slice(atSpace ? cut + 1 : cut);
    lead = indent;
  }
  rows.push(rest);
  return rows;
}

/**
 * The <picture> of one shot in one theme: a phone WebP and PNG under PHONE_MEDIA, then the
 * desktop WebP, then the desktop PNG as the <img>. Each source carries its own width and height
 * so the browser reserves the right box before the file arrives. `files` maps `<width>.<ext>` to
 * `{ name, width, height, density? }`, `width` and `height` in CSS pixels; a file of density 2 gets
 * a `2x` descriptor. `base` is the public URL folder.
 */
export function pictureFor(files, base) {
  const at = (key) => {
    const f = files[key];
    if (!f) throw new Error(`pictureFor: no ${key} file`);
    const url = `${base}/${f.name}`;
    const srcset = f.density > 1 ? `${url} ${f.density}x` : url;
    return { srcset, width: f.width, height: f.height };
  };
  return {
    sources: [
      { media: PHONE_MEDIA, type: "image/webp", ...at("390.webp") },
      { media: PHONE_MEDIA, type: "image/png", ...at("390.png") },
      { type: "image/webp", ...at("1280.webp") },
    ],
    img: (({ srcset, ...rest }) => ({ src: srcset, ...rest }))(at("1280.png")),
  };
}
