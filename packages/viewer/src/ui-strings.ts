// Text docsxai itself emits into viewer pages and the Starlight site (button labels, announcements,
// empty and error states), in English and Spanish. One table per language, selected by the page
// language: a tag such as `es`, `es-ES` or `es_MX` selects Spanish, any other tag selects English.
// No DOM access, so the markup builders, the Starlight component sources and the browser runtime
// (overlay-runtime.ts, which bundles this file) share one source.
//
// A string may hold `{name}` placeholders, filled by `fmt`. Table text is trusted markup-safe text:
// it holds no `<`, `>`, `&`, `"`, `{` or `}` outside placeholders, so builders place it without
// escaping. Values passed to `fmt` are escaped (or are deliberate markup) by the caller. The Spanish
// copy uses infinitives and nouns ("Copiar", "Pulsar Ctrl+C"), never a second-person form.

export type UiLang = "en" | "es";

/** The kinds of value that get a copy button; the English phrase is the key in every language. */
export type CopyKind = "flow id" | "step id" | "viewer build" | "command";

export interface UiStrings {
  lang: UiLang;
  /** The language's own name, for the Starlight locale entry. */
  langLabel: string;
  siteTitle: string;
  skipToContent: string;
  /** `{stamp}` is the viewer build. */
  renderedBy: string;
  copy: {
    idle: string;
    done: string;
    fallback: string;
    /** Accessible name of a copy button: `{kind}`, `{value}`. */
    aria: string;
    announceDone: string;
    /** Viewer wording: `{kind}`, `{value}`. */
    announceFallback: string;
    /** Starlight wording: `{kind}`. */
    announceFallbackSite: string;
  };
  kinds: Record<CopyKind, string>;
  nav: { label: string; all: string; prev: string; next: string };
  shortcuts: {
    summary: string;
    /** `{what}` is `whatSteps` or `whatFlows`. */
    intro: string;
    whatSteps: string;
    whatFlows: string;
    /** Joins the keys of one shortcut, with its spaces. */
    or: string;
    opened: string;
    /** Description text by its English form (the key in `SHORTCUTS`). */
    descriptions: Readonly<Record<string, string>>;
    /** Key caps that differ from the English label. */
    keys: Readonly<Record<string, string>>;
  };
  step: {
    writeUp: string;
    /** `{id}` */
    shotAlt: string;
    /** Name used in the load announcement when the image has no alt text. */
    shotName: string;
    /** `{name}` */
    shotLoaded: string;
    /** `{n}`, `{total}`, `{title}` */
    position: string;
  };
  shot: {
    /** `{id}`, `{file}` */
    errorMsg: string;
    retry: string;
    retrying: string;
    /** "<prefix><n><one or many>" after a second failure. */
    stillPrefix: string;
    stillOne: string;
    stillMany: string;
    /** `{file}` */
    missingWhy: string;
    /** `{command}`, `{render}` */
    missingHow: string;
    /** `{run}`, `{render}` */
    unsafe: string;
    thumbFailed: string;
    thumbMissing: string;
  };
  index: {
    /** `{run}`, `{render}` */
    noFlows: string;
    /** `{run}`, `{render}` */
    noSteps: string;
    cardNoSteps: string;
    /** `{n}` */
    stepOne: string;
    stepMany: string;
    annOne: string;
    annMany: string;
  };
  notices: {
    /** `{tail}` is `noCallouts`. */
    unparsable: string;
    noList: string;
    noCallouts: string;
    /** `{n}` */
    skippedOne: string;
    skippedMany: string;
  };
  site: {
    description: string;
    noFlows: string;
    flowsLabel: string;
    /** `{id}` */
    missingWhy: string;
    /** `{command}` */
    missingHow: string;
    /** `{id}` */
    errorMsg: string;
    /** `{copy}` */
    stepId: string;
  };
}

const EN: UiStrings = {
  lang: "en",
  langLabel: "English",
  siteTitle: "Documentation",
  skipToContent: "Skip to content",
  renderedBy: "Rendered by {stamp}. Hard-reload if this page looks stale.",
  copy: {
    idle: "Copy",
    done: "Copied",
    fallback: "Press Ctrl+C",
    aria: "Copy {kind} {value}",
    announceDone: "Copied {kind} {value} to the clipboard.",
    announceFallback:
      "The clipboard is not available here. {kind} {value} is selected, press Ctrl+C (Cmd+C on a Mac) to copy it.",
    announceFallbackSite:
      "The clipboard is not available here. The {kind} is selected, press Ctrl+C (Cmd+C on a Mac) to copy it.",
  },
  kinds: {
    "flow id": "flow id",
    "step id": "step id",
    "viewer build": "viewer build",
    command: "command",
  },
  nav: {
    label: "Flows",
    all: "All flows",
    prev: "Previous flow: {name}",
    next: "Next flow: {name}",
  },
  shortcuts: {
    summary: "Keyboard shortcuts",
    intro:
      "Arrow keys and Home/End move between {what}. Keys are ignored while you type in a field or hold Ctrl, Alt or Cmd.",
    whatSteps: "steps",
    whatFlows: "flows",
    or: " or ",
    opened: "Keyboard shortcuts opened.",
    descriptions: {
      "Next step": "Next step",
      "Previous step": "Previous step",
      "First step": "First step",
      "Last step": "Last step",
      "Next flow": "Next flow",
      "Previous flow": "Previous flow",
      "Hide the open call-out": "Hide the open call-out",
      "Open this list": "Open this list",
    },
    keys: {},
  },
  step: {
    writeUp: "Step write-up",
    shotAlt: "Screenshot of step {id}",
    shotName: "Screenshot",
    shotLoaded: "{name} loaded.",
    position: "Step {n} of {total}: {title}",
  },
  shot: {
    errorMsg:
      "The screenshot for step {id} could not be loaded. Check that {file} is still next to this page, then press Retry.",
    retry: "Retry",
    retrying: "Retrying\u2026",
    stillPrefix: "Still not loading after ",
    stillOne: " try. ",
    stillMany: " tries. ",
    missingWhy: "No screenshot for this step. {file} was not found when this page was built.",
    missingHow: "Capture it again with {command} then run {render}.",
    unsafe:
      "This step's name cannot be used as a file name, so its screenshot and write-up were left out. Rename the step in the flow file, then run {run} and {render} again.",
    thumbFailed: "This thumbnail could not be loaded. Open the flow to retry.",
    thumbMissing: "No screenshot yet. Open the flow to see how to capture it.",
  },
  index: {
    noFlows: "No flows yet. Run {run}, then {render}.",
    noSteps: "This flow has no steps yet. Capture it with {run}, then run {render} again.",
    cardNoSteps: "No steps yet",
    stepOne: "{n} step",
    stepMany: "{n} steps",
    annOne: "{n} annotation",
    annMany: "{n} annotations",
  },
  notices: {
    unparsable: "annotations.json could not be parsed, {tail}",
    noList: "annotations.json has no annotations list, {tail}",
    noCallouts:
      "so this page shows the screenshots without call-outs. Fix the file, then run docsxai render again.",
    skippedOne:
      "{n} annotation record was skipped: each needs a step name and copy text. Fix them in annotations.json, then run docsxai render again.",
    skippedMany:
      "{n} annotation records were skipped: each needs a step name and copy text. Fix them in annotations.json, then run docsxai render again.",
  },
  site: {
    description: "Step-by-step flows with annotated screenshots.",
    noFlows: "_(no flows yet \u2014 run `docsxai run`, then re-emit the site)_",
    flowsLabel: "Flows",
    missingWhy: "No screenshot for step {id}. The file was not found when this site was built.",
    missingHow: "Capture it with {command} then build the site again.",
    errorMsg:
      "The screenshot for step {id} could not be loaded. Check your connection, then press Retry.",
    stepId: "Step id {copy}",
  },
};

const ES: UiStrings = {
  lang: "es",
  langLabel: "Español",
  siteTitle: "Documentación",
  skipToContent: "Saltar al contenido",
  renderedBy: "Generado con {stamp}. Forzar la recarga si esta página parece desactualizada.",
  copy: {
    idle: "Copiar",
    done: "Copiado",
    fallback: "Pulsar Ctrl+C",
    aria: "Copiar {kind} {value}",
    announceDone: "Copiado al portapapeles: {kind} {value}.",
    announceFallback:
      "El portapapeles no está disponible aquí. Texto seleccionado: {kind} {value}. Para copiar, pulsar Ctrl+C (Cmd+C en Mac).",
    announceFallbackSite:
      "El portapapeles no está disponible aquí. Texto seleccionado: {kind}. Para copiar, pulsar Ctrl+C (Cmd+C en Mac).",
  },
  kinds: {
    "flow id": "id del flujo",
    "step id": "id del paso",
    "viewer build": "versión del visor",
    command: "comando",
  },
  nav: {
    label: "Flujos",
    all: "Todos los flujos",
    prev: "Flujo anterior: {name}",
    next: "Flujo siguiente: {name}",
  },
  shortcuts: {
    summary: "Atajos de teclado",
    intro:
      "Las flechas y Inicio/Fin permiten moverse entre {what}. Las teclas se ignoran al escribir en un campo o con Ctrl, Alt o Cmd pulsadas.",
    whatSteps: "pasos",
    whatFlows: "flujos",
    or: " o ",
    opened: "Lista de atajos abierta.",
    descriptions: {
      "Next step": "Paso siguiente",
      "Previous step": "Paso anterior",
      "First step": "Primer paso",
      "Last step": "Último paso",
      "Next flow": "Flujo siguiente",
      "Previous flow": "Flujo anterior",
      "Hide the open call-out": "Ocultar la anotación abierta",
      "Open this list": "Abrir esta lista",
    },
    keys: { Home: "Inicio", End: "Fin" },
  },
  step: {
    writeUp: "Descripción del paso",
    shotAlt: "Captura del paso {id}",
    shotName: "Captura",
    shotLoaded: "{name} cargada.",
    position: "Paso {n} de {total}: {title}",
  },
  shot: {
    errorMsg:
      "No se pudo cargar la captura del paso {id}. Comprobar que {file} sigue junto a esta página y pulsar Reintentar.",
    retry: "Reintentar",
    retrying: "Cargando\u2026",
    stillPrefix: "Sigue sin cargar tras ",
    stillOne: " intento. ",
    stillMany: " intentos. ",
    missingWhy: "Falta la captura de este paso. No se encontró {file} al generar esta página.",
    missingHow: "Para capturarla de nuevo, ejecutar {command} y después {render}.",
    unsafe:
      "El nombre de este paso no sirve como nombre de archivo, así que se omitieron su captura y su descripción. Renombrar el paso en el archivo del flujo y volver a ejecutar {run} y {render}.",
    thumbFailed: "No se pudo cargar esta miniatura. Abrir el flujo para reintentar.",
    thumbMissing: "Aún no hay captura. Abrir el flujo para ver cómo capturarla.",
  },
  index: {
    noFlows: "Aún no hay flujos. Ejecutar {run} y después {render}.",
    noSteps: "Este flujo aún no tiene pasos. Capturarlo con {run} y volver a ejecutar {render}.",
    cardNoSteps: "Sin pasos todavía",
    stepOne: "{n} paso",
    stepMany: "{n} pasos",
    annOne: "{n} anotación",
    annMany: "{n} anotaciones",
  },
  notices: {
    unparsable: "No se pudo analizar annotations.json, {tail}",
    noList: "annotations.json no tiene lista de anotaciones, {tail}",
    noCallouts:
      "por lo que esta página muestra las capturas sin anotaciones. Corregir el archivo y volver a ejecutar docsxai render.",
    skippedOne:
      "Se omitió {n} registro de anotación: cada uno necesita el nombre de un paso y un texto. Corregirlo en annotations.json y volver a ejecutar docsxai render.",
    skippedMany:
      "Se omitieron {n} registros de anotación: cada uno necesita el nombre de un paso y un texto. Corregirlos en annotations.json y volver a ejecutar docsxai render.",
  },
  site: {
    description: "Flujos paso a paso con capturas anotadas.",
    noFlows: "_(aún no hay flujos: ejecutar `docsxai run` y volver a generar el sitio)_",
    flowsLabel: "Flujos",
    missingWhy: "No hay captura del paso {id}. No se encontró el archivo al generar este sitio.",
    missingHow: "Para capturarla, usar {command} y volver a generar el sitio.",
    errorMsg:
      "No se pudo cargar la captura del paso {id}. Comprobar la conexión y pulsar Reintentar.",
    stepId: "Id del paso {copy}",
  },
};

/** Every language the tables cover. */
export const UI_TABLES: Readonly<Record<UiLang, UiStrings>> = { en: EN, es: ES };

/**
 * The table language for a locale tag: `es`, `es-ES`, `es_MX` and `ES` select Spanish; an empty,
 * missing or unknown tag selects English.
 */
export function uiLang(tag: string | null | undefined): UiLang {
  if (typeof tag !== "string") return "en";
  const primary = tag.trim().toLowerCase().split(/[-_]/, 1)[0];
  return primary === "es" ? "es" : "en";
}

/**
 * What to tell the operator when a `--lang` tag is set but has no table, so the pages come out in
 * English. Nothing for a missing or blank tag, or one that selects `en` or `es`.
 */
export function langFallbackWarning(tag: string | null | undefined): string | undefined {
  if (typeof tag !== "string" || tag.trim() === "") return undefined;
  const primary = tag.trim().toLowerCase().split(/[-_]/, 1)[0];
  if (primary === "en" || primary === "es") return undefined;
  return `lang ${JSON.stringify(tag.trim())} has no text table (en and es only), so the pages use English`;
}

/** The strings for a locale tag (see `uiLang`). */
export function uiStrings(tag?: string | null): UiStrings {
  return UI_TABLES[uiLang(tag)];
}

/** Fills `{name}` placeholders. A name with no value stays as written; values are not re-scanned. */
export function fmt(template: string, vars: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : m,
  );
}

const VARIANT_LOCALE = /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8}){0,2}$/;

/**
 * The locale a matrix variant flow name carries. A variant flow is `<flow>/<variant id>` and the
 * id is `<locale>.<color scheme>.<viewport>` with the axes the matrix does not name left out, so
 * the first dotted part is the locale when it looks like a tag. A plain flow has none.
 */
export function variantLocale(flow: string): string | undefined {
  const slash = flow.indexOf("/");
  if (slash < 0) return undefined;
  const first = flow.slice(slash + 1).split(".", 1)[0] ?? "";
  return VARIANT_LOCALE.test(first) ? first : undefined;
}

/** Page language for a flow: its variant locale when it has one, else `fallback`. */
export function flowUiLang(flow: string, fallback?: string | null): UiLang {
  return uiLang(variantLocale(flow) ?? fallback);
}

/**
 * Width in `ch` for the Retry button: the longer of its two labels plus one, so "Retry" and its
 * working label never change the button's width.
 */
export function retryWidthCh(ui: UiStrings): number {
  return Math.max(ui.shot.retry.length, ui.shot.retrying.length) + 1;
}

/** `s` as a double-quoted JavaScript string literal with the ellipsis written as an escape. */
export function jsString(s: string): string {
  return JSON.stringify(s).replace(/\u2026/g, "\\u2026");
}

/**
 * A template as a JavaScript concatenation, each `{name}` becoming the identifier of that name:
 * `"Copied {kind} {value}."` gives `"Copied " + kind + " " + value + "."`.
 */
export function jsConcat(template: string): string {
  const parts = template.split(/\{(\w+)\}/);
  return parts
    .map((p, i) => (i % 2 === 1 ? p : p === "" ? "" : jsString(p)))
    .filter((p) => p !== "")
    .join(" + ");
}
