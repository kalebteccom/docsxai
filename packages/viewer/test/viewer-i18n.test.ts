// The viewer in two languages: the page language comes from the lang option, a regional tag maps to
// its language, an unknown tag gives English, and English output is the text it always was. The
// Spanish labels reach the markup, the shortcut list, the notices and the inlined script.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildViewer, parseAnnotations } from "../src/render.js";
import { retryWidthCh, UI_TABLES } from "../src/ui-strings.js";
import { copyAnnouncement, copyButton } from "../src/viewer-copy.js";
import { stepAnnouncement } from "../src/viewer-keys.js";
import { VIEWER_STYLE } from "../src/viewer-style.js";
import {
  flowPageHtml,
  indexHtml,
  shortcutsHtml,
  stepHtml,
  type ViewerStep,
} from "../src/viewer-markup.js";

const AT = "@docsxai/viewer 1.2.3";

const step = (over: Partial<ViewerStep> = {}): ViewerStep => ({
  id: "open-sidebar",
  screenshot: "screenshots/open-sidebar.png",
  anns: [{ step: "open-sidebar", selector: "#play", copy: "Click Play" }],
  md: "Body.",
  ...over,
});

const page = (lang?: string) =>
  flowPageHtml(
    "checkout/es.light.1280",
    [step(), step({ id: "gone", screenshot: null, md: null })],
    AT,
    "/*js*/",
    { neighbours: { prev: "a", next: "b" }, ...(lang !== undefined ? { lang } : {}) },
  );

describe("a Spanish page", () => {
  const html = page("es");

  it("sets lang to es and a Spanish title", () => {
    expect(html).toContain('<html lang="es">');
    expect(html).toContain("<title>checkout/es.light.1280 · Documentación</title>");
  });

  it("labels the skip link, the flow navigation and the shortcut list in Spanish", () => {
    expect(html).toContain('<a class="skip-link" href="#main">Saltar al contenido</a>');
    expect(html).toContain('<nav aria-label="Flujos">');
    expect(html).toContain("Todos los flujos</a>");
    expect(html).toContain('rel="prev" href="../../a/index.html">Flujo anterior: a</a>');
    expect(html).toContain('rel="next" href="../../b/index.html">Flujo siguiente: b</a>');
    expect(html).toContain("<summary>Atajos de teclado</summary>");
    expect(html).toContain("<dd>Paso siguiente</dd>");
    expect(html).toContain("<kbd>Inicio</kbd>");
    expect(html).toContain("<kbd>Fin</kbd>");
    expect(html).toContain("<dt><kbd>→</kbd> o <kbd>j</kbd></dt>");
  });

  it("labels the copy buttons, the screenshot and the write-up in Spanish", () => {
    expect(html).toContain('aria-hidden="true">Copiar</span>');
    expect(html).toContain('aria-hidden="true">Copiado</span>');
    expect(html).toContain('aria-hidden="true">Pulsar Ctrl+C</span>');
    expect(html).toContain('data-kind="id del paso"');
    expect(html).toContain('aria-label="Copiar id del paso open-sidebar"');
    expect(html).toContain('aria-label="Copiar id del flujo checkout/es.light.1280"');
    expect(html).toContain('alt="Captura del paso open-sidebar"');
    expect(html).toContain("<summary>Descripción del paso</summary>");
  });

  it("words the image error, the missing-screenshot block and the footer in Spanish", () => {
    expect(html).toContain(
      '<span class="shot-error-msg">No se pudo cargar la captura del paso open-sidebar. Comprobar que <code>screenshots/open-sidebar.png</code> sigue junto a esta página y pulsar Reintentar.</span> <button type="button" class="shot-retry">Reintentar</button>',
    );
    expect(html).toContain(
      "<p>Falta la captura de este paso. No se encontró <code>screenshots/gone.png</code> al generar esta página.</p>",
    );
    expect(html).toContain("Para capturarla de nuevo, ejecutar ");
    expect(html).toContain('data-kind="comando"');
    expect(html).toContain("y después <code>docsxai render &lt;workspace&gt;</code>.</p>");
    expect(html).toContain(
      'Generado con <span class="sd-id">@docsxai/viewer 1.2.3</span>. Forzar la recarga si esta página parece desactualizada.',
    );
    expect(html).toContain('data-kind="versión del visor"');
  });

  it("names the empty states in Spanish", () => {
    const none = flowPageHtml("a/es", [], AT, "", { lang: "es" });
    expect(none).toContain(
      '<p class="empty">Este flujo aún no tiene pasos. Capturarlo con <code>docsxai run</code> y volver a ejecutar <code>docsxai render</code>.</p>',
    );
    expect(indexHtml([], AT, "", "es")).toContain(
      '<p class="empty">Aún no hay flujos. Ejecutar <code>docsxai run</code> y después <code>docsxai render</code>.</p>',
    );
    const unsafe = stepHtml(step({ id: "../x", screenshot: null, unsafe: true }), 1, "a", "es");
    expect(unsafe).toContain("El nombre de este paso no sirve como nombre de archivo");
  });

  it("counts steps and annotations with Spanish plurals on the index", () => {
    const cards = [
      { flow: "a", steps: 0, annotations: 0, thumb: null },
      { flow: "b", steps: 1, annotations: 1, thumb: "b/screenshots/s.png" },
      { flow: "c", steps: 3, annotations: 2, thumb: null },
    ];
    const html = indexHtml(cards, AT, "/*js*/", "es");
    expect(html).toContain("<span>Sin pasos todavía</span>");
    expect(html).toContain("<span>1 paso, 1 anotación</span>");
    expect(html).toContain("<span>3 pasos, 2 anotaciones</span>");
    expect(html).toContain(
      '<div class="thumb-missing">Aún no hay captura. Abrir el flujo para ver cómo capturarla.</div>',
    );
    expect(html).toContain('<html lang="es">');
    expect(html).toContain("<h1>Documentación</h1>");
  });

  it("announces a copy and a step change in Spanish", () => {
    const es = UI_TABLES.es;
    expect(copyAnnouncement("done", "id del paso", "pay", es)).toBe(
      "Copiado al portapapeles: id del paso pay.",
    );
    expect(copyAnnouncement("fallback", "id del paso", "pay", es)).toContain("pulsar Ctrl+C");
    expect(copyAnnouncement("idle", "id del paso", "pay", es)).toBe("");
    expect(stepAnnouncement(1, 5, "open-sidebar", es)).toBe("Paso 2 de 5: open-sidebar");
  });
});

describe("the page language", () => {
  it("maps es-ES and es_MX to es", () => {
    for (const tag of ["es-ES", "es_MX", "ES", "es-419"]) {
      const html = page(tag);
      expect(html, tag).toContain('<html lang="es">');
      expect(html, tag).toContain("Saltar al contenido");
    }
    expect(stepHtml(step(), 1, "a", "es-ES")).toContain('alt="Captura del paso open-sidebar"');
    expect(shortcutsHtml(true, "es_MX")).toContain("Atajos de teclado");
    expect(indexHtml([], AT, "", "es-ES")).toContain('<html lang="es">');
  });

  it("falls back to English for an unknown or empty tag", () => {
    for (const tag of ["fr", "pt-BR", "xx", "", "klingon"]) {
      expect(page(tag), tag).toBe(page("en"));
      expect(page(tag), tag).toContain('<html lang="en">');
    }
  });

  it("is English when no language is given", () => {
    expect(page()).toBe(page("en"));
    expect(indexHtml([], AT)).toBe(indexHtml([], AT, "", "en"));
    expect(stepHtml(step(), 1)).toBe(stepHtml(step(), 1, undefined, "en"));
    expect(shortcutsHtml(false)).toBe(shortcutsHtml(false, "en"));
    expect(copyButton("x", "step id")).toBe(copyButton("x", "step id", UI_TABLES.en));
  });
});

describe("English output", () => {
  const html = page();

  it("keeps the text it always had", () => {
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<a class="skip-link" href="#main">Skip to content</a>');
    expect(html).toContain('<nav aria-label="Flows">');
    expect(html).toContain('rel="prev" href="../../a/index.html">Previous flow: a</a>');
    expect(html).toContain('rel="next" href="../../b/index.html">Next flow: b</a>');
    expect(html).toContain(
      "<summary>Keyboard shortcuts</summary><p>Arrow keys and Home/End move between steps. Keys are ignored while you type in a field or hold Ctrl, Alt or Cmd.</p>",
    );
    expect(html).toContain("<summary>Step write-up</summary>");
    expect(html).toContain(
      '<footer class="meta site-footer">Rendered by <span class="sd-id">@docsxai/viewer 1.2.3</span>. Hard-reload if this page looks stale. <button',
    );
    expect(html).toContain(
      '<div class="shot-missing" role="status"><p>No screenshot for this step. <code>screenshots/gone.png</code> was not found when this page was built.</p><p>Capture it again with <span class="sd-copyable"><code class="sd-id">docsxai run &lt;workspace&gt; --flow checkout --start-from gone</code> ',
    );
    expect(html).toContain(" then run <code>docsxai render &lt;workspace&gt;</code>.</p></div>");
  });

  it("adds no width rule, since the base style already reserves the Retry width", () => {
    expect(html).not.toContain("button.shot-retry { width:");
    expect(VIEWER_STYLE).toContain(`width: ${retryWidthCh(UI_TABLES.en)}ch;`);
  });

  it("counts steps the way it always did", () => {
    const html = indexHtml(
      [
        { flow: "a", steps: 0, annotations: 0, thumb: null },
        { flow: "b", steps: 1, annotations: 1, thumb: null },
        { flow: "c", steps: 3, annotations: 2, thumb: null },
      ],
      AT,
    );
    expect(html).toContain("<span>No steps yet</span>");
    expect(html).toContain("<span>1 step, 1 annotation</span>");
    expect(html).toContain("<span>3 steps, 2 annotations</span>");
  });
});

describe("button width reservation", () => {
  it("adds a Retry width rule for Spanish, sized from the longer label, after the base style", () => {
    const html = page("es");
    const rule = `button.shot-retry { width: ${retryWidthCh(UI_TABLES.es)}ch; }`;
    expect(retryWidthCh(UI_TABLES.es)).toBe(
      Math.max(UI_TABLES.es.shot.retry.length, UI_TABLES.es.shot.retrying.length) + 1,
    );
    expect(html).toContain(rule);
    expect(html.indexOf(rule)).toBeGreaterThan(html.indexOf("button.shot-retry {"));
    expect(html.indexOf(rule)).toBeLessThan(html.indexOf("</style>"));
  });

  it("keeps all three copy labels in one cell in every language", () => {
    for (const ui of [UI_TABLES.en, UI_TABLES.es]) {
      const one = copyButton("x", "step id", ui);
      for (const state of ["idle", "done", "fallback"] as const)
        expect(one).toContain(
          `<span class="sd-copy-label sd-copy-${state}" aria-hidden="true">${ui.copy[state]}</span>`,
        );
    }
  });

  it("stacks the Spanish labels so the widest, Pulsar Ctrl+C, sets the width", () => {
    const labels = [UI_TABLES.es.copy.idle, UI_TABLES.es.copy.done, UI_TABLES.es.copy.fallback];
    expect(labels.reduce((a, b) => (b.length > a.length ? b : a))).toBe("Pulsar Ctrl+C");
    expect(VIEWER_STYLE).toContain(".sd-copy-label { grid-area: 1 / 1; visibility: hidden;");
  });
});

describe("notices", () => {
  it("are English by default and Spanish on request", () => {
    expect(parseAnnotations("{").notices[0]).toMatch(
      /^annotations\.json could not be parsed, so this page/,
    );
    expect(parseAnnotations("{", "es").notices[0]).toBe(
      "No se pudo analizar annotations.json, por lo que esta página muestra las capturas sin anotaciones. Corregir el archivo y volver a ejecutar docsxai render.",
    );
    expect(parseAnnotations("null", "es-ES").notices[0]).toMatch(
      /^annotations\.json no tiene lista de anotaciones, por lo que/,
    );
    const rec = { step: "a", copy: "c" };
    const one = parseAnnotations(JSON.stringify({ annotations: [rec, {}] }), "es");
    expect(one.notices[0]).toMatch(/^Se omitió 1 registro de anotación:/);
    const two = parseAnnotations(JSON.stringify({ annotations: [rec, {}, 1] }), "es_MX");
    expect(two.notices[0]).toMatch(/^Se omitieron 2 registros de anotación:/);
    const en = parseAnnotations(JSON.stringify({ annotations: [{}, {}] }), "fr");
    expect(en.notices[0]).toMatch(/^2 annotation records were skipped: each needs a step name/);
  });
});

describe("buildViewer", () => {
  let tmp = "";

  async function flow(name: string): Promise<void> {
    const dir = path.join(tmp, "docs", name);
    await fs.mkdir(path.join(dir, "screenshots"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "annotations.json"),
      JSON.stringify({
        annotations: [
          {
            step: "one",
            selector: "#a",
            bounding_box: { x: 1, y: 1, width: 2, height: 2 },
            copy: "Hi",
          },
        ],
      }),
    );
    await fs.writeFile(
      path.join(dir, "screenshots", "one.png"),
      Buffer.from("\x89PNG\r\n\x1a\n-x-"),
    );
  }
  const read = (...p: string[]) => fs.readFile(path.join(tmp, "out", ...p), "utf8");

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-viewer-i18n-"));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("takes each variant flow's page language from its locale", async () => {
    await flow("tour/en-US.light.1280");
    await flow("tour/es-ES.light.1280");
    await flow("plain");
    await buildViewer({ docsDir: path.join(tmp, "docs"), outDir: path.join(tmp, "out") });
    expect(await read("tour/en-US.light.1280/index.html")).toContain('<html lang="en">');
    expect(await read("tour/es-ES.light.1280/index.html")).toContain('<html lang="es">');
    expect(await read("tour/es-ES.light.1280/index.html")).toContain("Saltar al contenido");
    expect(await read("plain/index.html")).toContain('<html lang="en">');
    expect(await read("index.html")).toContain('<html lang="en">');
  });

  it("uses the lang option for flows without a locale, and for an index of mixed flows", async () => {
    await flow("tour/es.light.1280");
    await flow("plain");
    await buildViewer({
      docsDir: path.join(tmp, "docs"),
      outDir: path.join(tmp, "out"),
      lang: "es-MX",
    });
    expect(await read("plain/index.html")).toContain('<html lang="es">');
    expect(await read("index.html")).toContain('<html lang="es">');
    expect(await read("index.html")).toContain("<h1>Documentación</h1>");
  });

  it("gives the index the shared language of the flows, and English when they differ", async () => {
    await flow("tour/es.light.1280");
    await buildViewer({ docsDir: path.join(tmp, "docs"), outDir: path.join(tmp, "out") });
    expect(await read("index.html")).toContain('<html lang="es">');
    await flow("tour/en.light.1280");
    await buildViewer({ docsDir: path.join(tmp, "docs"), outDir: path.join(tmp, "out2") });
    expect(await fs.readFile(path.join(tmp, "out2", "index.html"), "utf8")).toContain(
      '<html lang="en">',
    );
  });

  it("writes Spanish notices into a Spanish flow page", async () => {
    await flow("tour/es.light.1280");
    await fs.writeFile(path.join(tmp, "docs", "tour/es.light.1280", "annotations.json"), "{");
    await buildViewer({
      docsDir: path.join(tmp, "docs"),
      outDir: path.join(tmp, "out"),
      flows: ["tour/es.light.1280"],
    });
    expect(await read("tour/es.light.1280/index.html")).toContain(
      '<p class="notice">No se pudo analizar annotations.json',
    );
  });

  it("inlines a script that carries both languages and picks one from the page lang", async () => {
    await flow("tour/es.light.1280");
    await buildViewer({ docsDir: path.join(tmp, "docs"), outDir: path.join(tmp, "out") });
    const html = await read("tour/es.light.1280/index.html");
    expect(html).toContain("document.documentElement.lang");
    for (const text of [
      "Reintentar",
      "Sigue sin cargar tras ",
      "Retry",
      "Still not loading after ",
    ])
      expect(html).toContain(text);
  });
});
