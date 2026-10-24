#!/usr/bin/env node
// Before and after sample of burned connectors on trackxai-like screens. Draws three synthetic app
// screenshots (header, sidebar, a progress ledger table, cards, an issue detail) in light and dark,
// burns the same annotations on each twice with the trackxai tokens, and writes the PNGs:
//
//   before-<mode>-<n>.png  connector_style "arrow": the triangle and stem themed burns drew before
//   after-<mode>-<n>.png   the theme as written: the thin line connector, now the themed default
//
//   node scripts/burn-trackxai-sample.mjs [--out /tmp/burn-before-after]
//
// It reads the built viewer, so run `pnpm --filter @docsxai/viewer build` first.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VIEWER = join(ROOT, "packages/viewer");
const EXAMPLES = join(ROOT, "examples/burn-theme");
const FONT = join(VIEWER, "assets/fonts/inter-regular.ttf");
const W = 1280;
const H = 800;

const viewer = (file) => import(pathToFileURL(join(VIEWER, "dist", file)).href);
const { Resvg } = createRequire(join(VIEWER, "package.json"))("@resvg/resvg-js");

const PALETTES = {
  light: {
    bg: "#ffffff",
    side: "#f7f7f5",
    panel: "#fbfbfa",
    fg: "#1a1a1a",
    fg2: "#6b6b6b",
    line: "#e7e7e4",
    accent: "#5c00b8",
    accentBg: "#efe6f8",
    ok: "#2f9e6b",
    warn: "#c98a16",
    bad: "#d1453f",
  },
  dark: {
    bg: "#08090a",
    side: "#0b0c0d",
    panel: "#111214",
    fg: "#f2f3f4",
    fg2: "#8a8f98",
    line: "#1f2124",
    accent: "#a64dff",
    accentBg: "#24133a",
    ok: "#42b883",
    warn: "#f2b23e",
    bad: "#e5615b",
  },
};

/** A synthetic screen: SVG markup plus the boxes of everything drawn, for annotations to aim at. */
class Screen {
  constructor(p) {
    this.p = p;
    this.parts = [];
    this.boxes = new Map();
  }
  rect(x, y, w, h, fill, extra = "") {
    this.parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" ${extra}/>`);
  }
  text(x, y, s, { size = 13, fill = this.p.fg, weight = 400, name } = {}) {
    this.parts.push(
      `<text x="${x}" y="${y}" font-family="Inter" font-size="${size}" font-weight="${weight}" fill="${fill}">${s}</text>`,
    );
    const box = {
      x,
      y: y - size,
      width: Math.round(s.length * size * 0.56),
      height: Math.round(size * 1.3),
    };
    if (name) this.boxes.set(name, box);
    return box;
  }
  mark(name, box) {
    this.boxes.set(name, box);
    return box;
  }
  svg() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${this.parts.join("")}</svg>`;
  }
}

function chrome(s, active) {
  const { p } = s;
  s.rect(0, 0, W, H, p.bg);
  s.rect(0, 0, 240, H, p.side);
  s.rect(240, 0, 1, H, p.line);
  s.rect(0, 56, W, 1, p.line);
  s.rect(16, 18, 20, 20, p.accent, 'rx="5"');
  s.text(44, 33, "trackxai", { size: 15, weight: 600 });
  s.rect(264, 14, 320, 28, p.panel, `rx="6" stroke="${p.line}"`);
  s.text(276, 33, "Search issues, ledgers, people", { fill: p.fg2 });
  s.rect(1124, 14, 104, 28, p.accent, 'rx="6"');
  s.mark("new", { x: 1124, y: 14, width: 104, height: 28 });
  s.text(1140, 33, "New issue", { fill: "#ffffff", weight: 600 });
  s.rect(1238, 16, 24, 24, p.fg2, 'rx="12"');
  const nav = ["Inbox", "My issues", "Progress ledger", "Projects", "Cycles", "Views", "Settings"];
  nav.forEach((label, i) => {
    const y = 76 + i * 34;
    if (label === active) s.rect(10, y, 220, 28, p.accentBg, 'rx="6"');
    s.rect(22, y + 8, 12, 12, label === active ? p.accent : p.fg2, 'rx="3"');
    s.text(44, y + 19, label, {
      name: `nav:${label}`,
      fill: label === active ? p.fg : p.fg2,
    });
  });
}

const STATUS = [
  ["Done", "ok"],
  ["In progress", "warn"],
  ["Blocked", "bad"],
  ["In progress", "warn"],
  ["Done", "ok"],
  ["Todo", "fg2"],
];

function ledger(p) {
  const s = new Screen(p);
  chrome(s, "Progress ledger");
  s.text(264, 92, "Progress ledger", { size: 20, weight: 600 });
  s.text(264, 114, "Cycle 14, 38 tasks, 61% complete", { fill: p.fg2 });
  const cols = [
    ["Task", 264],
    ["Owner", 700],
    ["Status", 860],
    ["Progress", 1010],
    ["Due", 1180],
  ];
  s.rect(256, 132, 1008, 36, p.panel);
  cols.forEach(([c, x]) => s.text(x, 155, c, { fill: p.fg2, name: `col:${c}` }));
  const tasks = [
    "Import bank statements",
    "Reconcile March ledger",
    "Approve vendor invoices",
    "Close payroll period",
    "Export tax summary",
    "Archive Q1 receipts",
    "Review open disputes",
    "Sync expense cards",
    "Lock February books",
    "Audit trail check",
    "Forecast cash runway",
    "Board pack figures",
  ];
  tasks.forEach((t, i) => {
    const y = 168 + i * 44;
    s.rect(256, y + 43, 1008, 1, p.line);
    s.text(264, y + 27, t, { name: `task:${i}` });
    s.text(700, y + 27, ["Ana", "Luis", "Marta", "Iker"][i % 4], { fill: p.fg2, name: `own:${i}` });
    const [label, tone] = STATUS[i % STATUS.length];
    const pw = label.length * 7 + 20;
    s.rect(860, y + 12, pw, 22, p[tone], 'rx="11" fill-opacity="0.18"');
    s.text(870, y + 27, label, { size: 12, fill: p[tone] });
    s.mark(`status:${i}`, { x: 860, y: y + 12, width: pw, height: 22 });
    const pct = [100, 55, 25, 70, 100, 0, 40, 85, 100, 15, 60, 30][i];
    s.rect(1010, y + 19, 120, 6, p.line, 'rx="3"');
    s.rect(1010, y + 19, (120 * pct) / 100, 6, p.accent, 'rx="3"');
    s.mark(`progress:${i}`, { x: 1010, y: y + 15, width: 150, height: 14 });
    s.text(1138, y + 27, `${pct}%`, { size: 12, fill: p.fg2, name: `pct:${i}` });
    s.text(1180, y + 27, `Apr ${3 + i}`, { fill: p.fg2, name: `due:${i}` });
  });
  return {
    s,
    targets: [
      ["status:2", "Blocked tasks stay red until an owner unblocks them", "right"],
      ["progress:6", "Progress fills as subtasks close; the ledger updates live", "top"],
      ["new", "Add a task to the ledger from anywhere", "bottom"],
    ],
  };
}

function cards(p) {
  const s = new Screen(p);
  chrome(s, "Projects");
  s.text(264, 92, "Projects", { size: 20, weight: 600 });
  ["All", "Active", "At risk", "Shipped"].forEach((c, i) => {
    const x = 264 + i * 92;
    s.rect(x, 108, 82, 26, i === 2 ? p.accentBg : p.panel, `rx="13" stroke="${p.line}"`);
    s.text(x + 14, 126, c, { size: 12, fill: i === 2 ? p.fg : p.fg2 });
    s.mark(`chip:${c}`, { x, y: 108, width: 82, height: 26 });
  });
  const kpis = [
    ["Open issues", "214"],
    ["Velocity", "38 pts"],
    ["Cycle time", "2.4 d"],
    ["On track", "86%"],
  ];
  kpis.forEach(([k, v], i) => {
    const x = 264 + i * 248;
    s.rect(x, 152, 232, 112, p.panel, `rx="10" stroke="${p.line}"`);
    s.text(x + 16, 180, k, { fill: p.fg2, name: `kpi-label:${i}` });
    s.text(x + 16, 228, v, { size: 30, weight: 600, name: `kpi:${i}` });
  });
  s.rect(264, 284, 984, 300, p.panel, `rx="10" stroke="${p.line}"`);
  s.text(284, 314, "Burn-up, last 6 cycles", { weight: 600, name: "chart-title" });
  for (let i = 0; i < 24; i++) {
    const h = 40 + ((i * 37) % 170);
    s.rect(300 + i * 38, 560 - h, 22, h, i % 4 === 3 ? p.accent : p.line, 'rx="3"');
    s.mark(`bar:${i}`, { x: 300 + i * 38, y: 560 - h, width: 22, height: h });
  }
  s.rect(264, 604, 984, 172, p.panel, `rx="10" stroke="${p.line}"`);
  ["Ledger v2 migration", "Mobile capture", "Billing exports"].forEach((t, i) => {
    s.text(284, 640 + i * 44, t, { name: `proj:${i}` });
    s.text(1100, 640 + i * 44, ["On track", "At risk", "Shipped"][i], { fill: p.fg2 });
  });
  return {
    s,
    targets: [
      ["kpi:1", "Velocity averages the last three cycles", "bottom"],
      ["chip:At risk", "Filter to projects that slipped this cycle", "right"],
      ["bar:19", "Highlighted bars are cycles that hit their goal", "top"],
    ],
  };
}

function detail(p) {
  const s = new Screen(p);
  chrome(s, "Cycles");
  s.rect(256, 72, 360, 712, p.panel, `rx="10" stroke="${p.line}"`);
  for (let i = 0; i < 12; i++) {
    const y = 88 + i * 56;
    if (i === 3) s.rect(264, y - 4, 344, 52, p.accentBg, 'rx="6"');
    s.text(280, y + 16, `TRX-${120 + i}`, { size: 12, fill: p.fg2, name: `id:${i}` });
    s.text(280, y + 36, ["Fix ledger rounding", "Capture flow v3", "Invoice OCR"][i % 3], {
      name: `issue:${i}`,
    });
  }
  s.text(648, 104, "Fix ledger rounding", { size: 22, weight: 600, name: "title" });
  s.text(648, 132, "TRX-123 opened by Ana, 2 days ago", { fill: p.fg2, name: "meta" });
  const props = [
    ["Status", "In progress"],
    ["Assignee", "Marta Ruiz"],
    ["Labels", "ledger, bug"],
    ["Cycle", "Cycle 14"],
  ];
  props.forEach(([k, v], i) => {
    const y = 168 + i * 40;
    s.text(648, y + 20, k, { fill: p.fg2, name: `prop:${k}` });
    s.rect(780, y, 200, 30, p.panel, `rx="6" stroke="${p.line}"`);
    s.text(792, y + 20, v, { name: `val:${k}` });
    s.mark(`field:${k}`, { x: 780, y, width: 200, height: 30 });
  });
  for (let i = 0; i < 5; i++) {
    s.text(648, 360 + i * 24, "Totals drift by a cent when a ledger mixes currencies.", {
      fill: p.fg2,
      name: `body:${i}`,
    });
  }
  s.rect(648, 640, 600, 96, p.panel, `rx="8" stroke="${p.line}"`);
  s.text(664, 668, "Leave a comment", { fill: p.fg2 });
  s.rect(1148, 696, 88, 28, p.accent, 'rx="6"');
  s.text(1162, 715, "Comment", { fill: "#ffffff", weight: 600 });
  s.mark("comment", { x: 1148, y: 696, width: 88, height: 28 });
  return {
    s,
    targets: [
      ["nav:Cycles", "Cycles group the work you plan to finish together", "right"],
      ["field:Assignee", "Reassign without leaving the issue", "right"],
      ["comment", "Comments notify everyone watching the issue", "top"],
    ],
  };
}

/** Annotations for a screen: each target's neighbours (every other drawn box) are its obstacles. */
function annotationsOf({ s, targets }) {
  const all = [...s.boxes.entries()];
  return targets.map(([name, copy, side], i) => {
    const box = s.boxes.get(name);
    if (!box) throw new Error(`no box named ${name}`);
    const obstacles = all.filter(([n]) => n !== name).map(([, b]) => b);
    return {
      step: "shot",
      selector: name,
      index: i + 1,
      copy,
      arrow_style: side,
      bounding_box: box,
      obstacles,
    };
  });
}

async function themeFor(mode) {
  const { parseThemeConfig, resolveBurnTheme } = await viewer("burn-theme-config.js");
  const { flattenTokens } = await viewer("burn-theme-tokens.js");
  const from = `trackxai-${mode}.tokens.json`;
  const tokens = flattenTokens(JSON.parse(await readFile(join(EXAMPLES, from), "utf8")));
  const config = parseThemeConfig({ from }, from);
  return resolveBurnTheme(config, { workspace: EXAMPLES, tokens }, from);
}

async function main() {
  const { values } = parseArgs({ options: { out: { type: "string" } } });
  const out = resolve(values.out ?? "/tmp/burn-before-after");
  await mkdir(out, { recursive: true });
  const { burnAnnotations } = await viewer("burn.js");
  const written = [];
  for (const mode of ["light", "dark"]) {
    const theme = await themeFor(mode);
    const builds = [ledger, cards, detail];
    for (const [i, build] of builds.entries()) {
      const screen = build(PALETTES[mode]);
      const png = new Resvg(screen.s.svg(), {
        font: { fontFiles: [FONT], loadSystemFonts: false, defaultFontFamily: "Inter" },
      })
        .render()
        .asPng();
      const annotations = annotationsOf(screen);
      for (const [label, t] of [
        ["before", { ...theme, connectorStyle: "arrow" }],
        ["after", theme],
      ]) {
        const burned = await burnAnnotations({
          screenshotBuffer: png,
          annotations,
          options: { theme: t, warn: () => {} },
        });
        const file = join(out, `${label}-${mode}-${i + 1}.png`);
        await writeFile(file, burned);
        written.push(file);
      }
    }
  }
  for (const f of written) console.log(f);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
