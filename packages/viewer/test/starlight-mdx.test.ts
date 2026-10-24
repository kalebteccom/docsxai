// Starlight emitter: flow names and step ids that need care in MDX, in a content slug and in an
// import path. The opt-in build test runs the real `astro build` over the same names.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildStarlightSite, emitStarlightSite } from "../src/starlight.js";
import { encodePng } from "./helpers/png.js";

const PNG = encodePng(new Uint8Array(8 * 6 * 4).fill(200), 8, 6);
let base = "";
const ws = () => path.join(base, "ws");
const site = () => path.join(base, "site");

async function flow(name: string, steps: string[]) {
  const dir = path.join(ws(), "docs", name);
  await fs.mkdir(path.join(dir, "screenshots"), { recursive: true });
  await fs.writeFile(
    path.join(dir, "annotations.json"),
    JSON.stringify({ annotations: steps.map((step) => ({ step, copy: "copy" })) }),
  );
  for (const step of steps) await fs.writeFile(path.join(dir, "screenshots", `${step}.png`), PNG);
}
const emit = () => emitStarlightSite({ workspaceDir: ws(), outDir: site() });
const read = (rel: string) => fs.readFile(path.join(site(), rel), "utf8");

beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-site-mdx-"));
});
afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true });
});

describe("step ids in MDX", () => {
  it("passes a step id with a quote or an ampersand as a JavaScript string, not a JSX string", async () => {
    await flow("f", ['i"j&k']);
    await emit();
    const page = await read("src/content/docs/flows/f.mdx");
    expect(page).toContain('alt={"i\\"j&k"}');
    expect(page).not.toMatch(/alt="i"/);
  });

  it("keeps a plain step id as a plain JSX string", async () => {
    await flow("f", ["step-1"]);
    await emit();
    expect(await read("src/content/docs/flows/f.mdx")).toContain('alt="step-1"');
  });

  it("escapes markdown emphasis, links and entities in the step heading", async () => {
    await flow("f", ["a*b_c[d]&amp;"]);
    await emit();
    expect(await read("src/content/docs/flows/f.mdx")).toContain("## a\\*b\\_c\\[d\\]\\&amp;");
  });
});

describe("image files in the site", () => {
  it("names an image with #, ? or % by a slug, since an import path reads them as URL syntax", async () => {
    await flow("f", ["a#b", "c?d", "e%20f", "a b"]);
    const r = await emit();
    const assets = r.files.filter((f) => f.startsWith("src/assets/flows/f/"));
    expect(assets).toEqual([
      "src/assets/flows/f/a-b-2.png",
      "src/assets/flows/f/a-b.png",
      "src/assets/flows/f/c-d.png",
      "src/assets/flows/f/e-20f.png",
    ]);
    const page = await read("src/content/docs/flows/f.mdx");
    expect(page).toContain('import shot0 from "../../../assets/flows/f/a-b.png";');
    expect(page).toContain("## a#b");
  });
});

describe("flow names in the site", () => {
  it("gives a name with a space, a quote or an ampersand a slug of letters, digits and hyphens", async () => {
    await flow("My Flow", ["s"]);
    await flow('q"&r', ["s"]);
    await emit();
    const index = await read("src/content/docs/index.mdx");
    expect(index).toContain('<LinkCard title="My Flow" href="/flows/my-flow/"');
    expect(index).toContain('<LinkCard title={"q\\"&r"} href="/flows/q-r/"');
    const config = await read("astro.config.mjs");
    expect(config).toContain('slug: "flows/my-flow"');
    expect(config).toContain('label: "My Flow"');
    expect(await read("src/content/docs/flows/my-flow.mdx")).toContain('title: "My Flow"');
    await expect(
      fs.access(path.join(site(), "src/assets/flows/my-flow/s.png")),
    ).resolves.toBeUndefined();
  });

  it("keeps letters outside ASCII and right-to-left names in the slug", async () => {
    await flow("ñandú", ["s"]);
    await flow("שלום", ["s"]);
    const r = await emit();
    expect(r.files).toContain("src/content/docs/flows/ñandú.mdx");
    expect(r.files).toContain("src/content/docs/flows/שלום.mdx");
  });

  it("tells two names with the same slug apart and warns", async () => {
    await flow("A b", ["s"]);
    await flow("a-b", ["s"]);
    const r = await emit();
    const pages = r.files.filter((f) => f.startsWith("src/content/docs/flows/"));
    expect(pages).toEqual(["src/content/docs/flows/a-b-2.mdx", "src/content/docs/flows/a-b.mdx"]);
    expect(r.warnings.some((w) => w.includes('"a-b"') && w.includes('"a-b-2"'))).toBe(true);
  });
});

describe.runIf(process.env["DOCSX_STARLIGHT_BUILD"] === "1")(
  "astro build with unusual names",
  () => {
    it("builds a site whose flows and steps hold spaces, quotes, #, ? and %", async () => {
      await flow("My Flow", ["a#b", "c d", "e%20f", "g?h", 'i"j', "k&l"]);
      await flow("ñandú", ["s"]);
      const pkgRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
      const out = await fs.mkdtemp(path.join(pkgRoot, ".tmp-starlight-names-"));
      try {
        await emitStarlightSite({ workspaceDir: ws(), outDir: out });
        const built = await buildStarlightSite({ siteDir: out });
        if (!built.ok) console.error(built.stderr.slice(-2000));
        expect(built.ok).toBe(true);
        await fs.access(path.join(built.distDir, "flows", "my-flow", "index.html"));
      } finally {
        await fs.rm(out, { recursive: true, force: true });
      }
    }, 600_000);
  },
);
