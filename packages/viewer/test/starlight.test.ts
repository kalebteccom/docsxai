// Starlight site emitter suite: golden emit tree for a two-flow fixture, MDX content
// correctness (headings, verbatim prose, image refs, captions numbered to the burned badge
// indexes), config generation from the style artifact's `visual` keys + explicit overrides,
// burned-image preference with clean-screenshot fallback, extends-graph sidebar ordering,
// byte-identical determinism, the no-external-URL self-containment check, and the `site` CLI
// argument paths. The real `astro build` E2E is gated behind SITE_DOCS_STARLIGHT_BUILD=1 so the
// default run stays fast.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ASTRO_VERSION,
  STARLIGHT_VERSION,
  buildStarlightSite,
  deriveFlowOrder,
  emitStarlightSite,
  normalizeAccent,
  resolveAstroBin,
} from "../src/starlight.js";
import { runViewerCli } from "../src/index.js";
import { encodePng } from "./helpers/png.js";

function solidPng(r: number, g: number, b: number): Buffer {
  const w = 8;
  const h = 6;
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = 255;
  }
  return encodePng(rgba, w, h);
}

const CLEAN_PNG = solidPng(40, 80, 200);
const BURNED_PNG = solidPng(200, 60, 40);

interface StepSpec {
  id: string;
  annotations?: Array<{ copy: string; index?: number }>;
  md?: string;
  /** Write `screenshots/<id>.png`. Default true. */
  screenshot?: boolean;
  /** Also write `burned/<id>.png`. Default false. */
  burned?: boolean;
}

interface FlowSpec {
  name: string;
  extendsFlow?: string;
  steps: StepSpec[];
  /** Skip the `flows/<name>.flow.yaml` file (flow exists only under docs/). */
  noFlowFile?: boolean;
}

interface WorkspaceSpec {
  flows: FlowSpec[];
  /** Becomes `docs/style.json`'s `visual` object. */
  visual?: Record<string, unknown>;
  /** Extra files to create (relative path → bytes). */
  extraFiles?: Record<string, Buffer>;
}

const tempDirs: string[] = [];
afterAll(async () => {
  for (const d of tempDirs) await fs.rm(d, { recursive: true, force: true });
});

async function makeWorkspace(spec: WorkspaceSpec): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "site-docs-starlight-test-"));
  tempDirs.push(dir);
  for (const flow of spec.flows) {
    const flowDir = path.join(dir, "docs", flow.name);
    await fs.mkdir(path.join(flowDir, "screenshots"), { recursive: true });
    const annotations = flow.steps.flatMap((step) =>
      (step.annotations ?? []).map((a) => ({
        step: step.id,
        selector: "#target",
        bounding_box: { x: 1, y: 1, width: 3, height: 2 },
        copy: a.copy,
        ...(a.index !== undefined ? { index: a.index } : {}),
      })),
    );
    await fs.writeFile(
      path.join(flowDir, "annotations.json"),
      JSON.stringify({ schema: "site-docs/annotations@1", flow: flow.name, annotations }, null, 2),
      "utf8",
    );
    for (const step of flow.steps) {
      if (step.screenshot !== false) {
        await fs.writeFile(path.join(flowDir, "screenshots", `${step.id}.png`), CLEAN_PNG);
      }
      if (step.burned) {
        await fs.mkdir(path.join(flowDir, "burned"), { recursive: true });
        await fs.writeFile(path.join(flowDir, "burned", `${step.id}.png`), BURNED_PNG);
      }
      if (step.md !== undefined) {
        await fs.writeFile(path.join(flowDir, `${step.id}.md`), step.md, "utf8");
      }
    }
    if (!flow.noFlowFile) {
      await fs.mkdir(path.join(dir, "flows"), { recursive: true });
      const ext = flow.extendsFlow !== undefined ? `extends: ${flow.extendsFlow}\n` : "";
      await fs.writeFile(
        path.join(dir, "flows", `${flow.name}.flow.yaml`),
        `name: ${flow.name}\n${ext}steps: []\n`,
        "utf8",
      );
    }
  }
  if (spec.visual !== undefined) {
    await fs.mkdir(path.join(dir, "docs"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "docs", "style.json"),
      JSON.stringify({ schema: "site-docs/style@1", visual: spec.visual }, null, 2),
      "utf8",
    );
  }
  for (const [rel, bytes] of Object.entries(spec.extraFiles ?? {})) {
    const p = path.join(dir, rel);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, bytes);
  }
  return dir;
}

/** The reference fixture: `checkout` extends `login`, mixed burned/clean/missing images. */
function goldenSpec(): WorkspaceSpec {
  return {
    flows: [
      {
        name: "login",
        steps: [
          {
            id: "step-1",
            annotations: [{ copy: "Enter your email" }],
            burned: true,
          },
          {
            id: "step-2",
            annotations: [
              { copy: "Open the menu", index: 1 },
              { copy: "Pick a workspace", index: 2 },
            ],
            md: "Click **Submit** to continue.\n",
          },
        ],
      },
      {
        name: "checkout",
        extendsFlow: "login",
        steps: [{ id: "pay-1", annotations: [{ copy: "Confirm the total" }], burned: true }],
      },
    ],
    visual: { brand_color: "#2563EB", logo: "assets/logo.png" },
    extraFiles: { "assets/logo.png": CLEAN_PNG },
  };
}

async function outDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "site-docs-starlight-out-"));
  tempDirs.push(dir);
  return dir;
}

const read = (root: string, rel: string) => fs.readFile(path.join(root, rel), "utf8");

describe("normalizeAccent", () => {
  it("passes through lowercase #rrggbb", () => {
    expect(normalizeAccent("#2563eb")).toBe("#2563eb");
  });

  it("adds the missing # and lowercases", () => {
    expect(normalizeAccent("2563EB")).toBe("#2563eb");
  });

  it("expands #rgb shorthand", () => {
    expect(normalizeAccent("#abc")).toBe("#aabbcc");
  });

  it("expands bare rgb shorthand", () => {
    expect(normalizeAccent("F0a")).toBe("#ff00aa");
  });

  it("throws on anything that is not a 3- or 6-digit hex color", () => {
    expect(() => normalizeAccent("#12345")).toThrow(/invalid accent color/);
    expect(() => normalizeAccent("bluish")).toThrow(/invalid accent color/);
    expect(() => normalizeAccent("")).toThrow(/invalid accent color/);
  });
});

describe("deriveFlowOrder", () => {
  it("orders roots alphabetically with extends-children DFS'd under their parent", async () => {
    const ws = await makeWorkspace({
      flows: [
        { name: "signup", steps: [] },
        { name: "checkout", extendsFlow: "signup", steps: [] },
        { name: "admin", steps: [] },
      ],
    });
    const order = await deriveFlowOrder(ws, ["admin", "checkout", "signup"]);
    expect(order).toEqual(["admin", "signup", "checkout"]);
  });

  it("falls back to alphabetical when the workspace has no flows/ directory", async () => {
    const ws = await makeWorkspace({
      flows: [
        { name: "b-flow", steps: [], noFlowFile: true },
        { name: "a-flow", steps: [], noFlowFile: true },
      ],
    });
    const order = await deriveFlowOrder(ws, ["b-flow", "a-flow"]);
    expect(order).toEqual(["a-flow", "b-flow"]);
  });

  it("appends flows absent from flows/ alphabetically after the graph", async () => {
    const ws = await makeWorkspace({
      flows: [
        { name: "zeta", steps: [] },
        { name: "orphan-b", steps: [], noFlowFile: true },
        { name: "orphan-a", steps: [], noFlowFile: true },
      ],
    });
    const order = await deriveFlowOrder(ws, ["orphan-b", "zeta", "orphan-a"]);
    expect(order).toEqual(["zeta", "orphan-a", "orphan-b"]);
  });

  it("never loses flows to an extends cycle — every flow appears exactly once", async () => {
    const ws = await makeWorkspace({
      flows: [
        { name: "ping", extendsFlow: "pong", steps: [] },
        { name: "pong", extendsFlow: "ping", steps: [] },
      ],
    });
    const order = await deriveFlowOrder(ws, ["pong", "ping"]);
    expect([...order].sort()).toEqual(["ping", "pong"]);
    expect(order).toHaveLength(2);
  });
});

describe("emitStarlightSite — file tree golden", () => {
  it("emits exactly the golden file list for the two-flow fixture", async () => {
    const ws = await makeWorkspace(goldenSpec());
    const out = await outDir();
    const r = await emitStarlightSite({ workspaceDir: ws, outDir: out });
    expect(r.files).toEqual([
      ".gitignore",
      "astro.config.mjs",
      "package.json",
      "public/favicon.svg",
      "src/assets/flows/checkout/pay-1.png",
      "src/assets/flows/login/step-1.png",
      "src/assets/flows/login/step-2.png",
      "src/assets/logo.png",
      "src/components/AnnotatedShot.astro",
      "src/content.config.ts",
      "src/content/docs/flows/checkout.mdx",
      "src/content/docs/flows/login.mdx",
      "src/content/docs/index.mdx",
      "src/styles/theme.css",
      "tsconfig.json",
    ]);
  });

  it("writes every listed file to disk", async () => {
    const ws = await makeWorkspace(goldenSpec());
    const out = await outDir();
    const r = await emitStarlightSite({ workspaceDir: ws, outDir: out });
    for (const rel of r.files) await fs.access(path.join(out, rel));
  });

  it("reports flows in sidebar order plus the normalized accent and logo", async () => {
    const ws = await makeWorkspace(goldenSpec());
    const out = await outDir();
    const r = await emitStarlightSite({ workspaceDir: ws, outDir: out });
    expect(r.flows).toEqual(["login", "checkout"]);
    expect(r.title).toBe("Documentation");
    expect(r.accent).toBe("#2563eb");
    expect(r.logo).toBe("src/assets/logo.png");
    expect(r.warnings).toEqual([]);
  });
});

describe("emitStarlightSite — MDX content", () => {
  it("renders an H2 per step in annotation order with the step prose verbatim", async () => {
    const ws = await makeWorkspace(goldenSpec());
    const out = await outDir();
    await emitStarlightSite({ workspaceDir: ws, outDir: out });
    const mdx = await read(out, "src/content/docs/flows/login.mdx");
    const h2s = [...mdx.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(h2s).toEqual(["step-1", "step-2"]);
    expect(mdx).toContain("Click **Submit** to continue.");
  });

  it("imports each step image and passes burned + items into <AnnotatedShot>", async () => {
    const ws = await makeWorkspace(goldenSpec());
    const out = await outDir();
    await emitStarlightSite({ workspaceDir: ws, outDir: out });
    const mdx = await read(out, "src/content/docs/flows/login.mdx");
    expect(mdx).toContain('import AnnotatedShot from "../../../components/AnnotatedShot.astro";');
    expect(mdx).toContain('import shot0 from "../../../assets/flows/login/step-1.png";');
    expect(mdx).toContain('import shot1 from "../../../assets/flows/login/step-2.png";');
    expect(mdx).toContain(
      '<AnnotatedShot src={shot0} alt="step-1" burned={true} items={[{"n":1,"copy":"Enter your email"}]} />',
    );
    expect(mdx).toContain(
      '<AnnotatedShot src={shot1} alt="step-2" burned={false} items={[{"n":1,"copy":"Open the menu"},{"n":2,"copy":"Pick a workspace"}]} />',
    );
  });

  it("numbers caption items by the annotation's burned badge index, not list position", async () => {
    const ws = await makeWorkspace({
      flows: [
        {
          name: "reversed",
          steps: [
            {
              id: "step-1",
              annotations: [
                { copy: "Second badge first in the file", index: 2 },
                { copy: "First badge second in the file", index: 1 },
              ],
            },
          ],
        },
      ],
    });
    const out = await outDir();
    await emitStarlightSite({ workspaceDir: ws, outDir: out });
    const mdx = await read(out, "src/content/docs/flows/reversed.mdx");
    expect(mdx).toContain(
      'items={[{"n":2,"copy":"Second badge first in the file"},{"n":1,"copy":"First badge second in the file"}]}',
    );
  });

  it("emits a placeholder and a warning for a step with no screenshot at all", async () => {
    const ws = await makeWorkspace({
      flows: [
        {
          name: "ghost",
          steps: [{ id: "step-1", annotations: [{ copy: "Look here" }], screenshot: false }],
        },
      ],
    });
    const out = await outDir();
    const r = await emitStarlightSite({ workspaceDir: ws, outDir: out });
    expect(r.warnings).toEqual(['flow "ghost" step "step-1": no screenshot']);
    const mdx = await read(out, "src/content/docs/flows/ghost.mdx");
    expect(mdx).toContain("_(no screenshot for this step)_");
    expect(mdx).not.toContain("AnnotatedShot src=");
  });

  it("builds the landing page from one LinkCard per flow with step/annotation counts", async () => {
    const ws = await makeWorkspace(goldenSpec());
    const out = await outDir();
    await emitStarlightSite({ workspaceDir: ws, outDir: out });
    const index = await read(out, "src/content/docs/index.mdx");
    expect(index).toContain(
      '<LinkCard title="login" href="/flows/login/" description="2 steps, 3 annotations" />',
    );
    expect(index).toContain(
      '<LinkCard title="checkout" href="/flows/checkout/" description="1 step, 1 annotation" />',
    );
    // login before checkout — card order follows the sidebar order.
    expect(index.indexOf('title="login"')).toBeLessThan(index.indexOf('title="checkout"'));
  });

  it("emits an empty-state landing page when the workspace has no flows", async () => {
    const ws = await makeWorkspace({ flows: [] });
    const out = await outDir();
    const r = await emitStarlightSite({ workspaceDir: ws, outDir: out });
    expect(r.flows).toEqual([]);
    const index = await read(out, "src/content/docs/index.mdx");
    expect(index).toContain("no flows yet");
    expect(r.files.filter((f) => f.startsWith("src/content/docs/flows/"))).toEqual([]);
  });
});

describe("emitStarlightSite — config generation", () => {
  it("defaults: title Documentation, no accent CSS, no logo, no remote anything", async () => {
    const ws = await makeWorkspace({
      flows: [{ name: "solo", steps: [{ id: "step-1", annotations: [{ copy: "Here" }] }] }],
    });
    const out = await outDir();
    const r = await emitStarlightSite({ workspaceDir: ws, outDir: out });
    expect(r.accent).toBeNull();
    expect(r.logo).toBeNull();
    const config = await read(out, "astro.config.mjs");
    expect(config).toContain('title: "Documentation",');
    expect(config).not.toContain("customCss");
    expect(config).not.toContain("logo:");
    expect(r.files).not.toContain("src/styles/theme.css");
  });

  it("derives the accent scale from the style artifact's visual.brand_color", async () => {
    const ws = await makeWorkspace(goldenSpec());
    const out = await outDir();
    const r = await emitStarlightSite({ workspaceDir: ws, outDir: out });
    expect(r.accent).toBe("#2563eb");
    const config = await read(out, "astro.config.mjs");
    expect(config).toContain('customCss: ["./src/styles/theme.css"],');
    const css = await read(out, "src/styles/theme.css");
    expect(css).toContain("--sl-color-accent: #2563eb;");
    expect(css).toContain(':root[data-theme="light"]');
  });

  it("prefers visual.brand_color over accent over primary_color", async () => {
    const ws1 = await makeWorkspace({
      flows: [],
      visual: { brand_color: "#333333", accent: "#111111", primary_color: "#222222" },
    });
    const r1 = await emitStarlightSite({ workspaceDir: ws1, outDir: await outDir() });
    expect(r1.accent).toBe("#333333");

    const ws2 = await makeWorkspace({
      flows: [],
      visual: { accent: "#111111", primary_color: "#222222" },
    });
    const r2 = await emitStarlightSite({ workspaceDir: ws2, outDir: await outDir() });
    expect(r2.accent).toBe("#111111");

    const ws3 = await makeWorkspace({ flows: [], visual: { primary_color: "#222222" } });
    const r3 = await emitStarlightSite({ workspaceDir: ws3, outDir: await outDir() });
    expect(r3.accent).toBe("#222222");
  });

  it("lets config.accent override the style artifact", async () => {
    const ws = await makeWorkspace(goldenSpec());
    const out = await outDir();
    const r = await emitStarlightSite({
      workspaceDir: ws,
      outDir: out,
      config: { accent: "C2185B" },
    });
    expect(r.accent).toBe("#c2185b");
    expect(await read(out, "src/styles/theme.css")).toContain("--sl-color-accent: #c2185b;");
  });

  it("warns and skips theme CSS when the style artifact accent is unparsable", async () => {
    const ws = await makeWorkspace({ flows: [], visual: { brand_color: "cornflower" } });
    const out = await outDir();
    const r = await emitStarlightSite({ workspaceDir: ws, outDir: out });
    expect(r.accent).toBeNull();
    expect(r.warnings.some((w) => w.includes("visual accent ignored"))).toBe(true);
    expect(r.files).not.toContain("src/styles/theme.css");
  });

  it("throws on an explicitly configured invalid accent", async () => {
    const ws = await makeWorkspace({ flows: [] });
    await expect(
      emitStarlightSite({ workspaceDir: ws, outDir: await outDir(), config: { accent: "nope" } }),
    ).rejects.toThrow(/invalid accent color/);
  });

  it("copies the logo and wires it into the config; config.logo beats visual.logo", async () => {
    const spec = goldenSpec();
    spec.extraFiles!["assets/alt-logo.svg"] = Buffer.from("<svg/>", "utf8");
    const ws = await makeWorkspace(spec);
    const out = await outDir();
    const r = await emitStarlightSite({
      workspaceDir: ws,
      outDir: out,
      config: { logo: "assets/alt-logo.svg" },
    });
    expect(r.logo).toBe("src/assets/logo.svg");
    expect(await read(out, "astro.config.mjs")).toContain(
      'logo: { src: "./src/assets/logo.svg" },',
    );
    expect(await fs.readFile(path.join(out, "src/assets/logo.svg"), "utf8")).toBe("<svg/>");
  });

  it("warns and emits without a logo when the configured logo file is missing", async () => {
    const ws = await makeWorkspace({ flows: [], visual: { logo: "assets/nope.png" } });
    const out = await outDir();
    const r = await emitStarlightSite({ workspaceDir: ws, outDir: out });
    expect(r.logo).toBeNull();
    expect(r.warnings.some((w) => w.startsWith("logo not found:"))).toBe(true);
    expect(await read(out, "astro.config.mjs")).not.toContain("logo:");
  });

  it("emits the sidebar in extends order with lowercase slugs", async () => {
    const ws = await makeWorkspace(goldenSpec());
    const out = await outDir();
    await emitStarlightSite({ workspaceDir: ws, outDir: out });
    const config = await read(out, "astro.config.mjs");
    const login = config.indexOf('{ label: "login", slug: "flows/login" },');
    const checkout = config.indexOf('{ label: "checkout", slug: "flows/checkout" },');
    expect(login).toBeGreaterThan(-1);
    expect(checkout).toBeGreaterThan(login);
  });

  it("restricts the site to config.flows when given", async () => {
    const ws = await makeWorkspace(goldenSpec());
    const out = await outDir();
    const r = await emitStarlightSite({
      workspaceDir: ws,
      outDir: out,
      config: { flows: ["checkout"] },
    });
    expect(r.flows).toEqual(["checkout"]);
    expect(r.files).not.toContain("src/content/docs/flows/login.mdx");
    expect(await read(out, "astro.config.mjs")).not.toContain('"login"');
  });
});

describe("emitStarlightSite — image selection", () => {
  it("prefers the burned PNG byte-for-byte when burned/<step>.png exists", async () => {
    const ws = await makeWorkspace(goldenSpec());
    const out = await outDir();
    await emitStarlightSite({ workspaceDir: ws, outDir: out });
    const copied = await fs.readFile(path.join(out, "src/assets/flows/login/step-1.png"));
    expect(copied.equals(BURNED_PNG)).toBe(true);
  });

  it("falls back to the clean screenshot byte-for-byte when no burned image exists", async () => {
    const ws = await makeWorkspace(goldenSpec());
    const out = await outDir();
    await emitStarlightSite({ workspaceDir: ws, outDir: out });
    const copied = await fs.readFile(path.join(out, "src/assets/flows/login/step-2.png"));
    expect(copied.equals(CLEAN_PNG)).toBe(true);
  });
});

describe("emitStarlightSite — determinism + self-containment", () => {
  it("two emits of the same workspace are byte-identical across the whole tree", async () => {
    const ws = await makeWorkspace(goldenSpec());
    const outA = await outDir();
    const outB = await outDir();
    const a = await emitStarlightSite({ workspaceDir: ws, outDir: outA });
    const b = await emitStarlightSite({ workspaceDir: ws, outDir: outB });
    expect(a.files).toEqual(b.files);
    for (const rel of a.files) {
      const bytesA = await fs.readFile(path.join(outA, rel));
      const bytesB = await fs.readFile(path.join(outB, rel));
      expect(bytesA.equals(bytesB), `${rel} differs between emits`).toBe(true);
    }
  });

  it("no emitted text file references an external URL", async () => {
    const ws = await makeWorkspace(goldenSpec());
    const out = await outDir();
    const r = await emitStarlightSite({ workspaceDir: ws, outDir: out });
    const textFiles = r.files.filter((f) => !f.endsWith(".png"));
    expect(textFiles.length).toBeGreaterThan(0);
    for (const rel of textFiles) {
      // The SVG xmlns is an XML namespace identifier, never dereferenced — not a fetch.
      const text = (await read(out, rel)).replaceAll('xmlns="http://www.w3.org/2000/svg"', "");
      expect(text, `${rel} must not fetch from the network`).not.toMatch(/https?:\/\//);
    }
  });

  it("pins the exact astro + starlight versions this package was verified against", async () => {
    const ws = await makeWorkspace(goldenSpec());
    const out = await outDir();
    await emitStarlightSite({ workspaceDir: ws, outDir: out });
    const sitePkg = JSON.parse(await read(out, "package.json")) as {
      dependencies: Record<string, string>;
    };
    expect(sitePkg.dependencies).toEqual({
      "@astrojs/starlight": STARLIGHT_VERSION,
      astro: ASTRO_VERSION,
    });
    // The pins must match the devDependencies this repo actually installs + tests with.
    const viewerPkg = JSON.parse(
      await fs.readFile(
        path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json"),
        "utf8",
      ),
    ) as { devDependencies: Record<string, string> };
    expect(viewerPkg.devDependencies["astro"]).toBe(ASTRO_VERSION);
    expect(viewerPkg.devDependencies["@astrojs/starlight"]).toBe(STARLIGHT_VERSION);
  });
});

describe("site CLI subcommand", () => {
  let out: ReturnType<typeof vi.spyOn>;
  let err: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });
  afterEach(() => {
    out.mockRestore();
    err.mockRestore();
  });

  it("site <workspace> --out --title --accent emits the site and exits 0", async () => {
    const ws = await makeWorkspace(goldenSpec());
    const dest = path.join(await outDir(), "site");
    const code = await runViewerCli([
      "site",
      ws,
      "--out",
      dest,
      "--title",
      "Acme Guide",
      "--accent",
      "0a0a0a",
    ]);
    expect(code).toBe(0);
    const config = await read(dest, "astro.config.mjs");
    expect(config).toContain('title: "Acme Guide",');
    expect(await read(dest, "src/styles/theme.css")).toContain("--sl-color-accent: #0a0a0a;");
  });

  it("defaults --out to <workspace>/site", async () => {
    const ws = await makeWorkspace(goldenSpec());
    const code = await runViewerCli(["site", ws]);
    expect(code).toBe(0);
    await fs.access(path.join(ws, "site", "astro.config.mjs"));
  });

  it("--flow restricts the emitted pages", async () => {
    const ws = await makeWorkspace(goldenSpec());
    const dest = path.join(await outDir(), "site");
    const code = await runViewerCli(["site", ws, "--out", dest, "--flow", "login"]);
    expect(code).toBe(0);
    await fs.access(path.join(dest, "src/content/docs/flows/login.mdx"));
    await expect(
      fs.access(path.join(dest, "src/content/docs/flows/checkout.mdx")),
    ).rejects.toThrow();
  });

  it("exits 2 without a workspace argument", async () => {
    expect(await runViewerCli(["site"])).toBe(2);
  });

  it("exits 1 on an invalid --accent", async () => {
    const ws = await makeWorkspace(goldenSpec());
    const code = await runViewerCli(["site", ws, "--out", await outDir(), "--accent", "nope"]);
    expect(code).toBe(1);
  });
});

describe("resolveAstroBin", () => {
  it("resolves the workspace-installed astro bin to an existing script", async () => {
    const bin = resolveAstroBin();
    expect(path.isAbsolute(bin)).toBe(true);
    await fs.access(bin);
  });
});

// Real `astro build` E2E — opt-in only (SITE_DOCS_STARLIGHT_BUILD=1). Builds the golden fixture
// site against the workspace-pinned astro + starlight via the node_modules symlink path. The
// site is emitted under this package (not os.tmpdir): the zero-install build shortcut requires
// a shared filesystem ancestor with the astro install — see buildStarlightSite's contract.
describe.runIf(process.env["SITE_DOCS_STARLIGHT_BUILD"] === "1")(
  "astro build E2E (SITE_DOCS_STARLIGHT_BUILD=1)",
  () => {
    it("builds the emitted site to dist/ with a page per flow", async () => {
      const ws = await makeWorkspace(goldenSpec());
      const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
      const out = await fs.mkdtemp(path.join(pkgRoot, ".tmp-starlight-e2e-"));
      tempDirs.push(out);
      await emitStarlightSite({ workspaceDir: ws, outDir: out });
      const built = await buildStarlightSite({ siteDir: out });
      if (!built.ok) {
        // Surface the astro output — this is the one test where it matters.
        console.error(built.stdout);
        console.error(built.stderr);
      }
      expect(built.ok).toBe(true);
      await fs.access(path.join(built.distDir, "index.html"));
      await fs.access(path.join(built.distDir, "flows", "login", "index.html"));
      await fs.access(path.join(built.distDir, "flows", "checkout", "index.html"));
      console.log(`astro build completed in ${Math.round(built.durationMs)}ms`);
    }, 600_000);
  },
);
