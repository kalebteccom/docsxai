// Renderer plugin suite: the plugin loads through the engine's REAL resolvePlugins path (manifest
// validation, namespacing, register-module import) and `starlight:site` emits a fixture
// workspace's Starlight site end-to-end. Requires the built package — run `pnpm -r build` first.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { type PluginLogger, type RendererContext, resolvePlugins } from "@docsxai/engine";

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const noopLog: PluginLogger = { info: () => {}, warn: () => {}, error: () => {} };

// A tiny valid PNG (1x1) is enough — the emitter copies image bytes, it never decodes them.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const tempDirs: string[] = [];
afterAll(async () => {
  for (const d of tempDirs) await fs.rm(d, { recursive: true, force: true });
});

/** Two flows (`checkout` extends `login`), one annotated step each, login burned. */
async function makeWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-starlight-plugin-test-"));
  tempDirs.push(dir);
  await fs.mkdir(path.join(dir, "flows"), { recursive: true });
  for (const flow of ["login", "checkout"]) {
    const flowDir = path.join(dir, "docs", flow);
    await fs.mkdir(path.join(flowDir, "screenshots"), { recursive: true });
    await fs.writeFile(
      path.join(flowDir, "annotations.json"),
      JSON.stringify({
        schema: "docsxai/annotations@1",
        flow,
        annotations: [{ step: "step-1", selector: "#go", copy: `Start ${flow}` }],
      }),
      "utf8",
    );
    await fs.writeFile(path.join(flowDir, "screenshots", "step-1.png"), PNG);
    await fs.writeFile(path.join(flowDir, "step-1.md"), `Open the **${flow}** page.\n`, "utf8");
    const ext = flow === "checkout" ? "extends: login\n" : "";
    await fs.writeFile(
      path.join(dir, "flows", `${flow}.flow.yaml`),
      `name: ${flow}\n${ext}steps: []\n`,
      "utf8",
    );
  }
  await fs.mkdir(path.join(dir, "docs", "login", "burned"), { recursive: true });
  await fs.writeFile(path.join(dir, "docs", "login", "burned", "step-1.png"), PNG);
  return dir;
}

function makeCtx(workspaceDir: string, outDir: string, flows: string[] = []): RendererContext {
  return { workspaceDir, outDir, flows, config: {}, log: noopLog };
}

describe("starlight renderer plugin — real resolvePlugins path", () => {
  it("loads as starlight:site with a renderer-only artifact set", async () => {
    await fs.access(path.join(PKG_ROOT, "dist", "register.js")); // built package required

    const dir = await makeWorkspace();
    const registry = await resolvePlugins({ workspaceDir: dir, sources: [{ path: PKG_ROOT }] });
    const record = registry.pluginsInfo("starlight");
    expect(record?.status).toBe("loaded");
    expect(record?.trust).toBe("kalebtec");
    expect(record?.artifacts).toEqual([{ kind: "renderer", name: "starlight:site" }]);
  });

  it("renders the fixture workspace into a buildable Starlight project", async () => {
    const dir = await makeWorkspace();
    const registry = await resolvePlugins({ workspaceDir: dir, sources: [{ path: PKG_ROOT }] });
    const renderer = registry.getRenderer("starlight:site");

    const outDir = path.join(dir, "site");
    const result = await renderer.render(makeCtx(dir, outDir));
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.outputs).toContain(path.join(outDir, "astro.config.mjs"));
    expect(result.outputs).toContain(path.join(outDir, "src/content/docs/flows/login.mdx"));
    for (const p of result.outputs) await fs.access(p);

    // Sidebar follows the extends graph (login is checkout's parent) and prose flows through.
    const config = await fs.readFile(path.join(outDir, "astro.config.mjs"), "utf8");
    expect(config.indexOf('"login"')).toBeLessThan(config.indexOf('"checkout"'));
    const mdx = await fs.readFile(path.join(outDir, "src/content/docs/flows/checkout.mdx"), "utf8");
    expect(mdx).toContain("Open the **checkout** page.");
    // login burned, checkout clean — the preference is per step.
    expect(mdx).toContain("burned={false}");
    const loginMdx = await fs.readFile(
      path.join(outDir, "src/content/docs/flows/login.mdx"),
      "utf8",
    );
    expect(loginMdx).toContain("burned={true}");
  });

  it("honors the context flow filter and config title/accent", async () => {
    const dir = await makeWorkspace();
    const registry = await resolvePlugins({ workspaceDir: dir, sources: [{ path: PKG_ROOT }] });
    const renderer = registry.getRenderer("starlight:site");

    const outDir = path.join(dir, "filtered-site");
    const ctx: RendererContext = {
      workspaceDir: dir,
      outDir,
      flows: ["login"],
      config: { title: "Acme Docs", accent: "#c2185b" },
      log: noopLog,
    };
    const result = await renderer.render(ctx);
    expect(result.ok).toBe(true);
    expect(result.outputs.some((p) => p.endsWith("flows/checkout.mdx"))).toBe(false);
    const config = await fs.readFile(path.join(outDir, "astro.config.mjs"), "utf8");
    expect(config).toContain('title: "Acme Docs",');
    const css = await fs.readFile(path.join(outDir, "src/styles/theme.css"), "utf8");
    expect(css).toContain("--sl-color-accent: #c2185b;");
  });

  it("propagates an invalid accent config as a thrown error", async () => {
    const dir = await makeWorkspace();
    const registry = await resolvePlugins({ workspaceDir: dir, sources: [{ path: PKG_ROOT }] });
    const renderer = registry.getRenderer("starlight:site");

    // An invalid accent is a config error — surfaced as a thrown error by the emitter; the
    // renderer contract lets it propagate so the CLI can report it precisely.
    await expect(
      renderer.render({
        workspaceDir: dir,
        outDir: path.join(dir, "bad-site"),
        flows: [],
        config: { accent: "not-a-color" },
        log: noopLog,
      }),
    ).rejects.toThrow(/invalid accent color/);
  });
});
