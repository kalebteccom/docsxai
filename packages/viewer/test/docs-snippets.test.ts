// Config a new user copies out of the docs has to load. Every ```json block in docs/burn-theming.md
// that holds a `burn` block is written as the `.docsxai.json` of a scratch workspace and loaded with
// the loader `burn`, `pack` and `render` use; the manifest example in docs/pack-manifest.md goes
// through `validatePack`; the import in docs/annotation-placement.md has to name real exports.

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import * as viewer from "../src/index.js";
import { loadBurnTheme } from "../src/burn-theme-load.js";
import { validatePack } from "../src/pack-validate.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const read = (...p: string[]) => readFileSync(path.join(repo, ...p), "utf8");

/** The bodies of the ```json blocks of a markdown text, with the line each starts on. */
function jsonBlocks(markdown: string): { line: number; value: unknown }[] {
  const out: { line: number; value: unknown }[] = [];
  const re = /^```json\n([\s\S]*?)\n```$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown))) {
    const line = markdown.slice(0, m.index).split("\n").length;
    out.push({ line, value: JSON.parse(m[1]!) });
  }
  return out;
}

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A workspace holding what the doc examples point at: a font and a tokens file. */
function workspaceWith(config: unknown): string {
  const dir = mkdtempSync(path.join(tmpdir(), "docs-snippets-"));
  scratch.push(dir);
  mkdirSync(path.join(dir, "fonts"));
  cpSync(
    path.join(repo, "packages/viewer/assets/fonts/inter-regular.ttf"),
    path.join(dir, "fonts/brand-regular.ttf"),
  );
  mkdirSync(path.join(dir, "design"));
  writeFileSync(
    path.join(dir, "design/tokens.json"),
    JSON.stringify({ brand: { primary: "#0b6e4f", text: "#111827" } }),
  );
  writeFileSync(path.join(dir, ".docsxai.json"), JSON.stringify(config));
  return dir;
}

describe("docs/burn-theming.md", () => {
  const blocks = jsonBlocks(read("docs", "burn-theming.md")).filter(
    (b) => typeof b.value === "object" && b.value !== null && "burn" in b.value,
  );

  it("has the config examples this test is meant to read", () => {
    expect(blocks.length).toBeGreaterThanOrEqual(5);
  });

  for (const { line, value } of blocks) {
    it(`the json block at line ${line} loads as a workspace burn.theme`, async () => {
      const loaded = await loadBurnTheme(workspaceWith(value));
      expect(loaded, "the block has no burn.theme").toBeDefined();
      expect(loaded!.warnings).toEqual([]);
    });
  }
});

describe("examples/burn-theme/docsxai.json", () => {
  it("loads without warnings", async () => {
    const loaded = await loadBurnTheme(
      workspaceWith(JSON.parse(read("examples", "burn-theme", "docsxai.json"))),
    );
    expect(loaded?.warnings).toEqual([]);
    expect(loaded?.theme.accent).toBe("#0b6e4f");
    expect(loaded?.theme.displayWidth).toBe(720);
  });
});

describe("docs/pack-manifest.md", () => {
  it("shows a manifest that validatePack accepts", () => {
    const [block] = jsonBlocks(read("docs", "pack-manifest.md"));
    expect(block, "no json block").toBeDefined();
    expect(validatePack(block!.value)).toEqual({ ok: true, errors: [] });
  });
});

describe("docs/annotation-placement.md", () => {
  const md = read("docs", "annotation-placement.md");
  const code = /```ts\n([\s\S]*?)\n```/.exec(md)?.[1] ?? "";

  it("imports names that @docsxai/viewer exports", () => {
    const names = /import \{([^}]*)\} from "@docsxai\/viewer"/
      .exec(code)?.[1]
      ?.split(",")
      .map((n) => n.trim())
      .filter((n) => n !== "" && !n.startsWith("type "));
    expect(names?.length).toBeGreaterThan(0);
    for (const name of names ?? []) expect(viewer, name).toHaveProperty(name);
  });

  it("names BurnTheme keys that exist", () => {
    for (const key of ["displayWidth", "displayWidthNarrow", "narrowBelow", "fontSize", "scale"]) {
      expect(viewer.DEFAULT_BURN_THEME, key).toHaveProperty(key);
    }
  });
});
