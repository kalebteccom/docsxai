// House style: no em dash in anything the CLI prints (help, doctor, stdout progress lines,
// diagnose recommendations, generated workspace files). Comments may keep them. The scan reads
// the engine and viewer sources and skips comment lines.

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const roots = [path.join(here, "..", "src"), path.join(here, "..", "..", "viewer", "src")];

async function sources(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await sources(p)));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

// Generated Playwright specs are an export format with golden files; their comments keep the dash.
const EMITTED_FORMATS = [path.join("export", "playwright-test.ts")];

function outputLinesWithEmDash(text: string): string[] {
  return text.split("\n").flatMap((line, i) => {
    if (!line.includes("—")) return [];
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return [];
    if (/\s\/\/[^"'`]*—/.test(line)) return [];
    return [`${i + 1}: ${line.trim().slice(0, 100)}`];
  });
}

describe("no em dash in printed text", () => {
  it("engine and viewer sources hold none outside comments", async () => {
    const found: string[] = [];
    for (const root of roots) {
      for (const file of await sources(root)) {
        if (EMITTED_FORMATS.some((f) => file.endsWith(f))) continue;
        const hits = outputLinesWithEmDash(await fs.readFile(file, "utf8"));
        found.push(...hits.map((h) => `${path.relative(path.join(here, "..", ".."), file)}:${h}`));
      }
    }
    expect(found).toEqual([]);
  });
});
