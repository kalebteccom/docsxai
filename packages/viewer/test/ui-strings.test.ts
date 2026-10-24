// The en/es UI string table: language selection, placeholder parity between the two languages,
// the character rules that let builders place table text without escaping, the Spanish register,
// and the widths reserved for the buttons whose label changes.

import { describe, expect, it } from "vitest";
import {
  UI_TABLES,
  fmt,
  flowUiLang,
  jsConcat,
  jsString,
  retryWidthCh,
  uiLang,
  uiStrings,
  variantLocale,
  type UiStrings,
} from "../src/ui-strings.js";
import { SHORTCUTS } from "../src/viewer-keys.js";

/** Every string in a table with its dotted path. */
function leaves(value: unknown, at = ""): Array<[string, string]> {
  if (typeof value === "string") return [[at, value]];
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([k, v]) => leaves(v, at ? `${at}.${k}` : k));
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();

describe("uiLang", () => {
  it("selects Spanish for es and its regional forms", () => {
    for (const tag of ["es", "ES", "es-ES", "es_MX", "es-419", " es-AR ", "es-Latn-MX"])
      expect(uiLang(tag)).toBe("es");
  });

  it("selects English for en, regional English and everything unknown", () => {
    for (const tag of ["en", "en-GB", "en_US", "fr", "pt-BR", "esp", "e", "", "zz-ES"])
      expect(uiLang(tag)).toBe("en");
  });

  it("selects English when there is no tag", () => {
    expect(uiLang(undefined)).toBe("en");
    expect(uiLang(null)).toBe("en");
  });

  it("returns the table of the selected language", () => {
    expect(uiStrings("es-ES")).toBe(UI_TABLES.es);
    expect(uiStrings("klingon")).toBe(UI_TABLES.en);
    expect(uiStrings()).toBe(UI_TABLES.en);
  });
});

describe("variantLocale and flowUiLang", () => {
  it("reads the locale from a matrix variant flow name", () => {
    expect(variantLocale("checkout/es.light.1280")).toBe("es");
    expect(variantLocale("checkout/es-ES.dark.mobile-390")).toBe("es-ES");
    expect(variantLocale("checkout/pt_BR.light")).toBe("pt_BR");
    expect(variantLocale("checkout/es")).toBe("es");
  });

  it("finds none in a plain flow or a variant with no locale axis", () => {
    expect(variantLocale("checkout")).toBeUndefined();
    expect(variantLocale("checkout/light.1280")).toBeUndefined();
    expect(variantLocale("checkout/desktop-1280")).toBeUndefined();
  });

  it("takes the variant locale over the fallback, and the fallback for a plain flow", () => {
    expect(flowUiLang("checkout/es-MX.light.1280", "en")).toBe("es");
    expect(flowUiLang("checkout/en.light.1280", "es")).toBe("en");
    expect(flowUiLang("checkout/fr.light.1280", "es")).toBe("en");
    expect(flowUiLang("checkout", "es_ES")).toBe("es");
    expect(flowUiLang("checkout")).toBe("en");
  });
});

describe("fmt, jsString and jsConcat", () => {
  it("fills placeholders once and keeps unknown ones", () => {
    expect(fmt("{a} and {b} and {c}", { a: 1, b: "{a}" })).toBe("1 and {a} and {c}");
  });

  it("does not treat Object.prototype names as values", () => {
    expect(fmt("{constructor}", {})).toBe("{constructor}");
  });

  it("writes an ellipsis as an escape", () => {
    expect(jsString("Retrying…")).toBe('"Retrying\\u2026"');
    expect(jsString('say "hi"')).toBe('"say \\"hi\\""');
  });

  it("turns a template into a concatenation of literals and identifiers", () => {
    expect(jsConcat("Copied {kind} {value} to the clipboard.")).toBe(
      '"Copied " + kind + " " + value + " to the clipboard."',
    );
    expect(jsConcat("{a}{b}")).toBe("a + b");
  });
});

describe("the two tables", () => {
  const en = leaves(UI_TABLES.en);
  const es = leaves(UI_TABLES.es);

  it("have the same keys, except the key caps that only one language relabels", () => {
    const shape = (rows: Array<[string, string]>) =>
      rows.map(([k]) => k).filter((k) => !k.startsWith("shortcuts.keys."));
    expect(shape(es)).toEqual(shape(en));
  });

  it("use the same placeholders in every string", () => {
    const byPath = new Map(es);
    for (const [at, text] of en) {
      if (at === "lang") continue;
      expect(placeholders(byPath.get(at) ?? ""), at).toEqual(placeholders(text));
    }
  });

  it("have no empty string", () => {
    for (const [at, text] of [...en, ...es]) expect(text.length, at).toBeGreaterThan(0);
  });

  it("hold no markup, entity, quote or brace outside a placeholder", () => {
    for (const [at, text] of [...en, ...es]) {
      const bare = text.replace(/\{\w+\}/g, "");
      expect(bare, at).not.toMatch(/[<>&"{}]/);
    }
  });

  it("describe every shortcut in both languages", () => {
    for (const s of SHORTCUTS) {
      expect(UI_TABLES.en.shortcuts.descriptions[s.description]).toBe(s.description);
      expect(UI_TABLES.es.shortcuts.descriptions[s.description]).toBeTruthy();
    }
  });

  it("name the same languages they select", () => {
    expect(UI_TABLES.en.lang).toBe("en");
    expect(UI_TABLES.es.lang).toBe("es");
  });
});

describe("the Spanish copy", () => {
  const es = leaves(UI_TABLES.es);

  it("uses the infinitive or a noun for actions", () => {
    const { copy, shot } = UI_TABLES.es;
    expect([copy.idle, copy.done, copy.fallback]).toEqual(["Copiar", "Copiado", "Pulsar Ctrl+C"]);
    expect([shot.retry, shot.retrying]).toEqual(["Reintentar", "Cargando…"]);
  });

  it("has no imperative or formal command form", () => {
    const forms =
      /\b(pulsa|pulse|copia|copie|usa|use|haz|haga|abre|abra|ejecuta|ejecute|comprueba|compruebe|corrige|corrija|renombra|renombre|vuelve|vuelva|recargue)\b/i;
    for (const [at, text] of es) expect(text, at).not.toMatch(forms);
  });
});

describe("reserved widths", () => {
  it("sizes the Retry button for the longer of its two labels, plus one", () => {
    expect(retryWidthCh(UI_TABLES.en)).toBe(10); // "Retrying…" is 9 characters
    expect(retryWidthCh(UI_TABLES.es)).toBe(11); // "Reintentar" is 10, "Cargando…" 9
  });

  it("follows the table when a label grows", () => {
    const longer: UiStrings = {
      ...UI_TABLES.en,
      shot: { ...UI_TABLES.en.shot, retrying: "Retrying again…" },
    };
    expect(retryWidthCh(longer)).toBe("Retrying again…".length + 1);
    const shorter: UiStrings = {
      ...UI_TABLES.en,
      shot: { ...UI_TABLES.en.shot, retry: "Try again now", retrying: "Wait" },
    };
    expect(retryWidthCh(shorter)).toBe("Try again now".length + 1);
  });
});
