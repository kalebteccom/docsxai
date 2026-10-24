// Order for step ids that carry numbers: `step-2` before `step-10`. Plain code-unit order puts
// `step-10` first, which scrambles a flow of a dozen or more numbered steps. No locale tables, so
// the order is the same on every machine. Leaf: no imports.

const CHUNK = /(\d+)/;

/** Compares digit runs by value and everything else by code unit; equal values fall back to plain order. */
export function compareNatural(a: string, b: string): number {
  const left = a.split(CHUNK);
  const right = b.split(CHUNK);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const x = left[i]!;
    const y = right[i]!;
    if (x === y) continue;
    if (i % 2 === 1) {
      const xs = x.replace(/^0+(?=\d)/, "");
      const ys = y.replace(/^0+(?=\d)/, "");
      if (xs.length !== ys.length) return xs.length - ys.length;
      if (xs !== ys) return xs < ys ? -1 : 1;
    } else return x < y ? -1 : 1;
  }
  if (left.length !== right.length) return left.length - right.length;
  return a < b ? -1 : a > b ? 1 : 0;
}
