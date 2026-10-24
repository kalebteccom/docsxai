// Colour helpers for the caption theme: hex parsing, WCAG 2.x contrast and translucent
// variants. Pure; no IO.

export type Rgb = readonly [number, number, number];

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Channels of `#rgb` or `#rrggbb`; null for anything else. */
export function parseHexColor(value: string): Rgb | null {
  if (!HEX.test(value)) return null;
  const digits = value.slice(1);
  const full =
    digits.length === 3
      ? digits
          .split("")
          .map((c) => c + c)
          .join("")
      : digits;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as unknown as Rgb;
}

/** `#rrggbb` in lower case for a valid hex colour; null otherwise. */
export function normaliseHex(value: string): string | null {
  const rgb = parseHexColor(value);
  if (!rgb) return null;
  return "#" + rgb.map((c) => c.toString(16).padStart(2, "0")).join("");
}

/** WCAG 2.x relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as unknown as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio between two hex colours, 1 to 21. Throws on a value that is not hex. */
export function contrastRatio(a: string, b: string): number {
  const ca = parseHexColor(a);
  const cb = parseHexColor(b);
  if (!ca || !cb) throw new Error(`contrastRatio needs hex colours, got "${a}" and "${b}"`);
  const [hi, lo] = [relativeLuminance(ca), relativeLuminance(cb)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** `rgba(r,g,b,alpha)` of a hex colour. */
export function rgbaOf(hex: string, alpha: number): string {
  const rgb = parseHexColor(hex);
  if (!rgb) throw new Error(`rgbaOf needs a hex colour, got "${hex}"`);
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
}

/** `#rrggbb` of `a` moved `t` (0 to 1) of the way towards `b`; both must be hex colours. */
export function mixHex(a: string, b: string, t: number): string {
  const [ca, cb] = [parseHexColor(a), parseHexColor(b)];
  if (!ca || !cb) throw new Error(`mixHex needs hex colours, got "${a}" and "${b}"`);
  const mix = ca.map((v, i) => Math.round(v * (1 - t) + cb[i]! * t));
  return "#" + mix.map((v) => v.toString(16).padStart(2, "0")).join("");
}
