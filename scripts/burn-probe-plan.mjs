// The pure half of burn-probe.mjs: reading the annotation file, applying side overrides, finding
// which obstacles a placed callout touches, and writing the report. No file IO and no viewer
// import here, so burn-probe-plan.test.mjs can check it with `node --test`.

export const SIDES = ["top", "bottom", "left", "right"];

const isRect = (r) =>
  r !== null &&
  typeof r === "object" &&
  ["x", "y", "width", "height"].every((k) => Number.isFinite(r[k]));
const rect = (r) => ({ x: r.x, y: r.y, width: r.width, height: r.height });

/**
 * Burner records from an annotations file. Three shapes are read: a `docsxai/annotations@1` file
 * (`{ annotations: [...] }` with `bounding_box`; `step` picks one screenshot's records), a bare
 * array of such records, and a capture sidecar (`{ width, height, annotations: [{ index, copy,
 * bbox, arrow_style?, nudge?, obstacles? }] }`), whose records are numbered only when there is
 * more than one, as a sidecar-driven burn does.
 */
export function toRecords(raw, { step } = {}) {
  const list = Array.isArray(raw) ? raw : raw?.annotations;
  if (!Array.isArray(list)) {
    throw new Error("annotations: expected an array, or an object with an annotations array");
  }
  const sidecar = list.length > 0 && list.every((a) => a && isRect(a.bbox) && !a.bounding_box);
  if (sidecar) {
    const numbered = list.length > 1;
    return list.map((a, i) => {
      if (typeof a.copy !== "string") throw new Error(`annotations[${i}]: copy must be a string`);
      return {
        step: step ?? "probe",
        selector: `annotation-${a.index ?? i + 1}`,
        copy: a.copy,
        bounding_box: rect(a.bbox),
        ...(numbered ? { index: a.index ?? i + 1 } : {}),
        ...(a.arrow_style !== undefined ? { arrow_style: a.arrow_style } : {}),
        ...(a.nudge !== undefined ? { nudge: { x: a.nudge.x, y: a.nudge.y } } : {}),
        ...(a.obstacles !== undefined ? { obstacles: a.obstacles.map(rect) } : {}),
        ...(a.placement !== undefined ? { placement: a.placement } : {}),
      };
    });
  }
  const records = step === undefined ? list : list.filter((a) => a.step === step);
  if (records.length === 0) {
    throw new Error(
      step === undefined
        ? "annotations: the file holds none"
        : `annotations: none for step "${step}"`,
    );
  }
  return records;
}

/**
 * Parses `--side 2=bottom` style overrides into `{ position, side, strict }`. `position` is
 * 1-based in file order; `strict` sets `placement.side` instead of `arrow_style`.
 */
export function parseSideOverride(text, strict = false) {
  const m = /^(\d+)=(top|bottom|left|right)$/.exec(String(text).trim());
  if (!m) throw new Error(`side override "${text}": write <position>=<top|bottom|left|right>`);
  return { position: Number(m[1]), side: m[2], strict };
}

/** `records` with the overrides applied: a soft hint replaces `arrow_style`, a strict one sets `placement.side`. */
export function applySides(records, overrides) {
  const out = records.map((r) => ({ ...r }));
  for (const o of overrides) {
    const r = out[o.position - 1];
    if (!r) throw new Error(`side override ${o.position}: there are ${out.length} annotations`);
    if (o.strict) r.placement = { ...r.placement, side: o.side };
    else {
      r.arrow_style = o.side;
      if (r.placement?.side !== undefined) {
        r.placement = { ...r.placement };
        delete r.placement.side;
      }
    }
  }
  return out;
}

/** The side a record asks for and how: `placement.side` (strict), `arrow_style` (hint), or none. */
export function askedSide(record) {
  if (record.placement?.side) return { side: record.placement.side, how: "placement.side" };
  const side = (record.arrow_style ?? "").split("-")[0];
  return SIDES.includes(side) ? { side, how: "arrow_style" } : { side: null, how: "none" };
}

function overlap(a, b) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? { w, h } : null;
}

/**
 * Which obstacles the painted parts touch. `parts` maps a part name (`callout`, `arrow`, `stem`,
 * `badge`) to its box or null. A stem reports the px it runs inside the box, the other parts the
 * area they cover. Obstacle numbers are 1-based in the record's order.
 */
export function obstacleHits(parts, obstacles = []) {
  const hits = [];
  obstacles.forEach((o, i) => {
    for (const [part, box] of Object.entries(parts)) {
      if (!box) continue;
      const o2 = overlap(box, o);
      if (!o2) continue;
      const along = part === "stem" ? Math.max(o2.w, o2.h) : null;
      hits.push({
        obstacle: i + 1,
        part,
        ...(along !== null ? { px: round(along) } : { area: round(o2.w * o2.h) }),
      });
    }
  });
  return hits;
}

const round = (n) => Math.round(n * 100) / 100;
const box = (r) => (r ? `${round(r.x)},${round(r.y)} ${round(r.width)}x${round(r.height)}` : "-");

/** The text report: one block per annotation. */
export function formatProbe(probe) {
  const out = [
    `screenshot ${probe.image.width}x${probe.image.height}, theme ${probe.theme}, caption scale ${probe.scale}`,
  ];
  for (const a of probe.annotations) {
    out.push("");
    const asked = a.asked.side ? `${a.asked.side} (${a.asked.how})` : "none";
    const kept =
      a.asked.side === null ? "" : a.side === a.asked.side ? ", hint kept" : ", hint lost";
    out.push(`#${a.position} ${JSON.stringify(a.copy)}`);
    out.push(
      `  asked ${asked} -> ${a.mode === "inside" ? "inside the target" : `side ${a.side}`}${kept}`,
    );
    out.push(
      `  callout ${box(a.callout)}, ${a.lines.length} line(s): ${a.lines.map((l) => JSON.stringify(l)).join(" / ")}`,
    );
    out.push(`  stem ${a.stem} px, connector ${a.connector}, badge ${box(a.badge)}`);
    out.push(
      `  overlap obstacles ${a.obstacleOverlap} px2, others ${a.otherOverlap} px2, ratio ${a.ratio}${a.unplaceable ? " UNPLACEABLE" : ""}`,
    );
    out.push(
      `  obstacle hits: ${
        a.hits.length === 0
          ? "none"
          : a.hits
              .map(
                (h) =>
                  `#${h.obstacle} ${h.part} ${h.px !== undefined ? `${h.px} px` : `${h.area} px2`}`,
              )
              .join(", ")
      }`,
    );
    if (a.verdicts.length > 0) {
      const v = a.verdicts.map(
        (s) =>
          `${s.side}${s.side === a.side ? "*" : ""} ${s.cost === null ? "no room" : `cost ${s.cost} overlap ${s.overlap} stem ${s.stem}`}`,
      );
      out.push(`  sides at base size, lowest cost wins: ${v.join(" | ")}`);
    } else {
      out.push("  sides: not scored (no obstacles and no placement keys)");
    }
  }
  return `${out.join("\n")}\n`;
}
