import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";
import { breakWord, wrapBalanced, wrapUnits } from "../src/caption-wrap.js";
import { measureCallout, DEFAULT_CALLOUT_STYLE } from "../src/burn-callout.js";
import { measureText, parseFontMetrics, wrapText } from "../src/font-metrics.js";

const FONT = await fs.readFile(new URL("../assets/fonts/inter-regular.ttf", import.meta.url));
const METRICS = parseFontMetrics(FONT);
const SIZE = 15;
const width = (s: string) => measureText(s, SIZE, METRICS);
const widest = (lines: string[]) => Math.max(...lines.map(width));

describe("wrapUnits", () => {
  it("keeps a one-letter word and a list number with the word after them", () => {
    expect(wrapUnits("1. Lo que va a ejecutar")).toEqual(["1. Lo", "que", "va", "a ejecutar"]);
    expect(wrapUnits("Escribe y envía o borra")).toEqual(["Escribe", "y envía", "o borra"]);
  });

  it("leaves a trailing one-letter word on its own unit", () => {
    expect(wrapUnits("Plan A")).toEqual(["Plan", "A"]);
  });
});

describe("breakWord", () => {
  const fitsIn = (max: number) => (s: string) => width(s) <= max;

  it("breaks a path after its separators before it breaks between letters", () => {
    const pieces = breakWord("~/projects/atlas-web/configuraciones", fitsIn(120));
    expect(pieces.join("")).toBe("~/projects/atlas-web/configuraciones");
    expect(pieces.slice(0, -1).every((p) => /[/\-_.:\\]$/.test(p))).toBe(true);
    expect(pieces.every((p) => width(p) <= 120)).toBe(true);
  });

  it("falls back to code points for a part wider than the line", () => {
    const pieces = breakWord("Desactívalaporcompleto", fitsIn(60));
    expect(pieces.join("")).toBe("Desactívalaporcompleto");
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.every((p) => width(p) <= 60)).toBe(true);
  });
});

describe("wrapBalanced", () => {
  const SPANISH = [
    "Escribe el primer mensaje y envíalo para empezar la sesión",
    "2. Describe la tarea aquí y pulsa el botón para enviarla",
    "Aprobar similares también permite cualquier llamada a shell en este espacio de trabajo",
    "Desactívala para usar la clásica en este dispositivo",
  ];

  it.each([138, 160, 185, 250])("keeps the greedy line count at %i px", (max) => {
    for (const text of SPANISH) {
      const greedy = wrapText(text, SIZE, max, METRICS);
      const balanced = wrapBalanced(text, SIZE, max, METRICS);
      expect(balanced.join(" ")).toBe(text);
      expect(balanced.length).toBeLessThanOrEqual(greedy.length);
      expect(widest(balanced)).toBeLessThanOrEqual(max);
    }
  });

  it("evens out a last line the greedy wrap leaves with one word", () => {
    const text = SPANISH[0]!;
    const greedy = wrapText(text, SIZE, 185, METRICS);
    expect(greedy.at(-1)).toBe("sesión");
    const balanced = wrapBalanced(text, SIZE, 185, METRICS);
    expect(balanced).toHaveLength(greedy.length);
    expect(balanced.at(-1)!.split(" ").length).toBeGreaterThan(1);
    expect(widest(balanced)).toBeLessThan(widest(greedy));
  });

  it("never ends a line on a one-letter Spanish word", () => {
    for (const max of [80, 100, 138, 160]) {
      for (const text of ["1. Lo que va a ejecutar", ...SPANISH]) {
        const lines = wrapBalanced(text, SIZE, max, METRICS);
        for (const line of lines.slice(0, -1)) expect(line).not.toMatch(/(?:^|\s)[aeouy]$/);
      }
    }
  });

  it("keeps a list number with the first word", () => {
    const lines = wrapBalanced("1. Lo que va a ejecutar", SIZE, 110, METRICS);
    expect(lines[0]!.startsWith("1. Lo")).toBe(true);
  });

  it("returns one line unchanged when the text fits", () => {
    expect(wrapBalanced("Recházalo", SIZE, 200, METRICS)).toEqual(["Recházalo"]);
    expect(wrapBalanced("   ", SIZE, 200, METRICS)).toEqual([""]);
  });

  it("is deterministic", () => {
    const text = SPANISH[2]!;
    expect(wrapBalanced(text, SIZE, 160, METRICS)).toEqual(wrapBalanced(text, SIZE, 160, METRICS));
  });
});

describe("measureCallout with a wrap mode", () => {
  const text = "Escribe el primer mensaje y envíalo para empezar la sesión";

  it("wraps greedily by default, as without a theme", () => {
    const plain = measureCallout(text, METRICS, 215);
    expect(plain.lines).toEqual(wrapText(text, 14, 215 - 24, METRICS));
  });

  it("balances under `wrap: balance` and gets a narrower box with the same height", () => {
    const style = { ...DEFAULT_CALLOUT_STYLE, wrap: "balance" as const };
    const plain = measureCallout(text, METRICS, 215);
    const even = measureCallout(text, METRICS, 215, style);
    expect(even.size.height).toBe(plain.size.height);
    expect(even.size.width).toBeLessThan(plain.size.width);
  });
});
