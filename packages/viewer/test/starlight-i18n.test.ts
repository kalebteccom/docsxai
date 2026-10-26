// The Starlight site in two languages: the lang option (a regional tag maps to its language, an
// unknown tag gives English) sets Starlight's own locale and the text of the CopyId and
// AnnotatedShot components, and English output is the text it always was.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emitStarlightSite } from "../src/starlight.js";
import { runViewerCli } from "../src/index.js";
import { retryWidthCh, UI_TABLES } from "../src/ui-strings.js";

const tempDirs: string[] = [];
afterAll(async () => {
  for (const d of tempDirs) await fs.rm(d, { recursive: true, force: true });
});

async function tmpDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** Two flows with two annotated steps between them; the PNG bytes are never decoded. */
async function makeWorkspace(): Promise<string> {
  const dir = await tmpDir("docsxai-starlight-i18n-");
  for (const [flow, steps] of [
    ["login", ["step-1", "step-2"]],
    ["checkout", ["pay-1"]],
  ] as const) {
    const flowDir = path.join(dir, "docs", flow);
    await fs.mkdir(path.join(flowDir, "screenshots"), { recursive: true });
    const annotations = steps.map((step, i) => ({
      step,
      selector: "#go",
      copy: `Copy ${String(i)}`,
    }));
    await fs.writeFile(
      path.join(flowDir, "annotations.json"),
      JSON.stringify({ schema: "docsxai/annotations@1", flow, annotations }),
    );
    for (const step of steps)
      await fs.writeFile(path.join(flowDir, "screenshots", `${step}.png`), Buffer.from("png"));
  }
  return dir;
}

async function emit(lang?: string): Promise<Record<string, string>> {
  const out = await tmpDir("docsxai-starlight-i18n-out-");
  const r = await emitStarlightSite({
    workspaceDir: await makeWorkspace(),
    outDir: out,
    ...(lang !== undefined ? { config: { lang } } : {}),
  });
  const tree: Record<string, string> = {};
  for (const rel of r.files.filter((f) => !f.endsWith(".png")))
    tree[rel] = await fs.readFile(path.join(out, rel), "utf8");
  return tree;
}

describe("a Spanish site", () => {
  it("sets Starlight's root locale to Spanish and translates the default title and sidebar", async () => {
    const tree = await emit("es");
    const config = tree["astro.config.mjs"]!;
    expect(config).toContain('title: "Documentación",');
    expect(config).toContain('defaultLocale: "root",');
    expect(config).toContain('locales: { root: { label: "Español", lang: "es" } },');
    expect(config).toContain('label: "Flujos",');
  });

  it("keeps an explicit title", async () => {
    const out = await tmpDir("docsxai-starlight-i18n-out-");
    await emitStarlightSite({
      workspaceDir: await makeWorkspace(),
      outDir: out,
      config: { lang: "es", title: "Mi sitio" },
    });
    expect(await fs.readFile(path.join(out, "astro.config.mjs"), "utf8")).toContain(
      'title: "Mi sitio",',
    );
  });

  it("labels CopyId in Spanish, with all three labels in one cell", async () => {
    const copy = (await emit("es"))["src/components/CopyId.astro"]!;
    for (const label of ["Copiar", "Copiado", "Pulsa Ctrl+C"])
      expect(copy).toContain(`>${label}</span>`);
    expect(copy).toContain("aria-label={`Copiar ${kind} ${value}`}");
    expect(copy).toContain('"Copiado al portapapeles: " + kind + " " + value + "."');
    expect(copy).toContain(
      '"El portapapeles no está disponible aquí. Texto seleccionado: " + kind + ". Para copiarlo, pulsa Ctrl+C (Cmd+C en Mac)."',
    );
    expect(copy).toContain("grid-area: 1 / 1;");
    expect(copy).toContain("const COPIED_MS = 1500;");
    expect(copy).not.toContain("Press Ctrl+C");
  });

  it("words AnnotatedShot in Spanish and widens Retry for the longer label", async () => {
    const shot = (await emit("es"))["src/components/AnnotatedShot.astro"]!;
    expect(shot).toContain("alt={`Captura del paso ${alt}`}");
    expect(shot).toContain(
      "No se pudo cargar la captura del paso {alt}. Comprueba tu conexión y pulsa Reintentar.",
    );
    expect(shot).toContain('class="annotated-shot-retry">Reintentar</button>');
    expect(shot).toContain("No hay captura del paso <code>{alt}</code>.");
    expect(shot).toContain('<CopyId value={command} kind="comando" />');
    expect(shot).toContain('ID del paso <CopyId value={alt} kind="ID del paso" />');
    expect(shot).toContain('btn.textContent = "Reintentar";');
    expect(shot).toContain('btn.textContent = "Cargando\\u2026";');
    expect(shot).toContain(
      '"Sigue sin cargar tras " + tries + (tries === 1 ? " intento. " : " intentos. ") + msg.getAttribute("data-base")',
    );
    expect(shot).toContain(`width: ${String(retryWidthCh(UI_TABLES.es))}ch;`);
    expect(retryWidthCh(UI_TABLES.es)).toBe(11);
  });

  it("writes the landing page and the flow pages in Spanish", async () => {
    const tree = await emit("es");
    const index = tree["src/content/docs/index.mdx"]!;
    expect(index).toContain('title: "Documentación"');
    expect(index).toContain('description: "Flujos paso a paso con capturas anotadas."');
    expect(index).toContain('description="2 pasos, 2 anotaciones"');
    expect(index).toContain('description="1 paso, 1 anotación"');
    expect(tree["src/content/docs/flows/login.mdx"]!).toContain(
      '<CopyId value={"login"} kind="ID del flujo" />',
    );
  });

  it("maps es-ES and es_MX to the same output as es", async () => {
    const es = await emit("es");
    expect(await emit("es-ES")).toEqual(es);
    expect(await emit("es_MX")).toEqual(es);
  });
});

describe("English output", () => {
  it("is the same with lang en, an unknown tag or no lang", async () => {
    const base = await emit();
    expect(await emit("en")).toEqual(base);
    expect(await emit("en-GB")).toEqual(base);
    expect(await emit("fr")).toEqual(base);
    expect(await emit("")).toEqual(base);
  });

  it("keeps the English text and adds no locale entry", async () => {
    const tree = await emit();
    const config = tree["astro.config.mjs"]!;
    expect(config).toContain('title: "Documentation",');
    expect(config).toContain('label: "Flows",');
    expect(config).not.toContain("locales");
    expect(config).not.toContain("defaultLocale");
    const copy = tree["src/components/CopyId.astro"]!;
    expect(copy).toContain("aria-label={`Copy ${kind} ${value}`}");
    expect(copy).toContain(
      '? "Copied " + kind + " " + value + " to the clipboard."\n        : "The clipboard is not available here. The " + kind + " is selected, press Ctrl+C (Cmd+C on a Mac) to copy it.",',
    );
    const shot = tree["src/components/AnnotatedShot.astro"]!;
    expect(shot).toContain("No screenshot for step <code>{alt}</code>. The file was not found");
    expect(shot).toContain('<CopyId value={command} kind="command" /> then build the site again.');
    expect(shot).toContain('Step id <CopyId value={alt} kind="step id" />');
    expect(shot).toContain('btn.textContent = "Retrying\\u2026";');
    expect(shot).toContain(
      '"Still not loading after " + tries + (tries === 1 ? " try. " : " tries. ") + msg.getAttribute("data-base")',
    );
    expect(shot).toContain("width: 10ch;");
    const index = tree["src/content/docs/index.mdx"]!;
    expect(index).toContain('description: "Step-by-step flows with annotated screenshots."');
    expect(index).toContain('description="2 steps, 2 annotations"');
    expect(tree["src/content/docs/flows/login.mdx"]!).toContain(
      '<CopyId value={"login"} kind="flow id" />',
    );
  });
});

describe("the site command", () => {
  let out = "";
  let errText = "";
  beforeEach(() => {
    out = "";
    errText = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      out += String(chunk);
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      errText += String(chunk);
      return true;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("takes --lang", async () => {
    const ws = await makeWorkspace();
    const site = path.join(ws, "site");
    expect(await runViewerCli(["site", ws, "--out", site, "--lang", "es-ES"])).toBe(0);
    expect(out).toContain("site: emitted");
    expect(await fs.readFile(path.join(site, "astro.config.mjs"), "utf8")).toContain('lang: "es"');
  });

  it("warns for a --lang with no text table and writes the English site", async () => {
    const ws = await makeWorkspace();
    const site = path.join(ws, "site");
    expect(await runViewerCli(["site", ws, "--out", site, "--lang", "fr"])).toBe(0);
    expect(errText).toContain(
      'site: warning: lang "fr" has no text table (en and es only), so the pages use English',
    );
    expect(await fs.readFile(path.join(site, "astro.config.mjs"), "utf8")).not.toContain("locales");
  });

  it("asks for a value after --lang", async () => {
    const ws = await makeWorkspace();
    expect(await runViewerCli(["site", ws, "--lang"])).toBe(2);
  });

  it("takes --lang on build", async () => {
    const ws = await makeWorkspace();
    const viewer = path.join(ws, "viewer");
    expect(await runViewerCli(["build", path.join(ws, "docs"), viewer, "--lang", "es"])).toBe(0);
    expect(await fs.readFile(path.join(viewer, "login", "index.html"), "utf8")).toContain(
      '<html lang="es">',
    );
  });
});
