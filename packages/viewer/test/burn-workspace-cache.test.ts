// burnWithWorkspaceTheme's cache: keyed by workspace path and config mtime, shared by concurrent
// calls, never keeping a failed load, and following the config as it appears, changes and goes.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnnotationRecord } from "../src/annotations.js";
import { burnAnnotations } from "../src/burn.js";
import { DEFAULT_BURN_THEME } from "../src/burn-theme.js";
import { BurnThemeError } from "../src/burn-theme-config.js";
import { burnWithWorkspaceTheme, clearWorkspaceThemeCache } from "../src/burn-workspace.js";
import { solidPng } from "./helpers/png.js";

const FONT = await fs.readFile(new URL("../assets/fonts/inter-regular.ttf", import.meta.url));
const SCREENSHOT = solidPng(200, 150);
const annotations = (): AnnotationRecord[] => [
  {
    step: "open-sidebar",
    selector: "#play",
    bounding_box: { x: 60, y: 60, width: 60, height: 30 },
    copy: "Click Play",
  },
];
/** A fixed mtime in whole milliseconds, so two writes can share one cache key. */
const FIXED = new Date(1_700_000_000_000);
const LOW_CONTRAST = { burn: { theme: { ink: "#aaaaaa" } } };

let ws: string;
beforeEach(async () => {
  clearWorkspaceThemeCache();
  ws = await fs.mkdtemp(path.join(os.tmpdir(), "burn-ws-cache-"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(ws, { recursive: true, force: true });
});

const configPath = (dir = ws) => path.join(dir, ".docsxai.json");
async function writeConfig(config: unknown, at?: Date, dir = ws): Promise<void> {
  await fs.writeFile(configPath(dir), JSON.stringify(config), "utf8");
  if (at) await fs.utimes(configPath(dir), at, at);
}
const burn = (
  options?: Parameters<typeof burnWithWorkspaceTheme>[0]["options"],
  workspace = ws,
): Promise<Buffer> =>
  burnWithWorkspaceTheme({
    workspace,
    screenshotBuffer: SCREENSHOT,
    annotations: annotations(),
    ...(options ? { options } : {}),
  });
const direct = () => burnAnnotations({ screenshotBuffer: SCREENSHOT, annotations: annotations() });

describe("sharing and keys", () => {
  it("lets two concurrent calls share one load", async () => {
    await writeConfig(LOW_CONTRAST);
    const warn = vi.fn();
    await Promise.all([burn({ warn }), burn({ warn })]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("keeps one theme per workspace", async () => {
    const other = await fs.mkdtemp(path.join(os.tmpdir(), "burn-ws-cache-other-"));
    try {
      await writeConfig(LOW_CONTRAST);
      const warn = vi.fn();
      await burn({ warn });
      await burn({ warn }, other);
      expect(warn).toHaveBeenCalledTimes(1);
      await writeConfig(LOW_CONTRAST, undefined, other);
      await burn({ warn }, other);
      await burn({ warn });
      await burn({ warn }, other);
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      await fs.rm(other, { recursive: true, force: true });
    }
  });

  it("reads a relative and an absolute spelling of one workspace as one entry", async () => {
    await writeConfig(LOW_CONTRAST);
    const warn = vi.fn();
    await burn({ warn }, ws);
    await burn({ warn }, path.relative(process.cwd(), ws));
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("serves the loaded theme while the mtime holds, even if the text changed", async () => {
    await writeConfig(LOW_CONTRAST, FIXED);
    const warn = vi.fn();
    await burn({ warn });
    await writeConfig({ burn: { theme: { ink: "#bbbbbb" } } }, FIXED);
    await burn({ warn });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("the config appearing and going", () => {
  it("picks up a config written after a burn without one", async () => {
    const plain = await direct();
    expect((await burn()).equals(plain)).toBe(true);
    await writeConfig({ burn: { theme: { preset: "high-contrast" } } });
    expect((await burn()).equals(plain)).toBe(false);
  });

  it("falls back to today's look when the config is deleted", async () => {
    await writeConfig({ burn: { theme: { preset: "high-contrast" } } });
    const plain = await direct();
    expect((await burn()).equals(plain)).toBe(false);
    await fs.rm(configPath());
    expect((await burn()).equals(plain)).toBe(true);
  });

  it("gives the same bytes for a config without a theme as for no config", async () => {
    await writeConfig({ schema: "docsxai/workspace@1", burn: {} });
    expect((await burn()).equals(await direct())).toBe(true);
  });
});

describe("a failed load", () => {
  it("is not kept: the fixed file is read at the same mtime", async () => {
    await writeConfig({ burn: { theme: { accent: "red" } } }, FIXED);
    const error = await burn().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BurnThemeError);
    await writeConfig({ burn: { theme: { accent: "#0b6e4f" } } }, FIXED);
    const fixed = await burn();
    expect(fixed.equals(await direct())).toBe(false);
  });

  it("is not kept for a font that shows up later, and is not a BurnThemeError", async () => {
    await writeConfig({ burn: { theme: { font: "fonts/brand.ttf" } } }, FIXED);
    const error = await burn().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(BurnThemeError);
    expect((error as Error).message).toContain("does not exist");
    await fs.mkdir(path.join(ws, "fonts"));
    await fs.writeFile(path.join(ws, "fonts", "brand.ttf"), FONT);
    expect((await burn()).length).toBeGreaterThan(0);
  });
});

describe("options", () => {
  it("never reads the config when options.theme is given", async () => {
    await writeConfig({ burn: { theme: { accent: "red" } } });
    const bytes = await burn({ theme: { ...DEFAULT_BURN_THEME, connectorStyle: "arrow" } });
    expect(bytes.equals(await direct())).toBe(true);
  });

  it("prints warnings through console.warn when no warn function is given", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await writeConfig(LOW_CONTRAST);
    await burn();
    await burn();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0]![0])).toContain("ink on callout_background");
  });
});
