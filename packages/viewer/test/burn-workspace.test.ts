import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnnotationRecord } from "../src/annotations.js";
import { burnAnnotations } from "../src/burn.js";
import { BurnThemeError } from "../src/burn-theme-config.js";
import { parseHexColor } from "../src/color.js";
import { burnWithWorkspaceTheme as exported } from "../src/index.js";
import { burnWithWorkspaceTheme, clearWorkspaceThemeCache } from "../src/burn-workspace.js";
import { decodePng, pixelAt, solidPng } from "./helpers/png.js";

const SCREENSHOT = solidPng(400, 300);
const annotations = (): AnnotationRecord[] => [
  {
    step: "open-sidebar",
    selector: "#play",
    bounding_box: { x: 150, y: 120, width: 80, height: 40 },
    copy: "Click Play",
    index: 1,
  },
];

let ws: string;
beforeEach(async () => {
  clearWorkspaceThemeCache();
  ws = await fs.mkdtemp(path.join(os.tmpdir(), "burn-workspace-"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(ws, { recursive: true, force: true });
});

const writeConfig = (config: unknown) =>
  fs.writeFile(path.join(ws, ".docsxai.json"), JSON.stringify(config), "utf8");
const burn = (options?: Parameters<typeof burnWithWorkspaceTheme>[0]["options"]) =>
  burnWithWorkspaceTheme({
    workspace: ws,
    screenshotBuffer: SCREENSHOT,
    annotations: annotations(),
    ...(options ? { options } : {}),
  });
const isColour = (px: number[], hex: string): boolean =>
  [...parseHexColor(hex)!].every((c, i) => Math.abs(px[i]! - c) <= 4);

describe("burnWithWorkspaceTheme", () => {
  it("is exported from the package entry", () => {
    expect(exported).toBe(burnWithWorkspaceTheme);
  });

  it("draws the default look for a workspace without a theme", async () => {
    const direct = await burnAnnotations({
      screenshotBuffer: SCREENSHOT,
      annotations: annotations(),
    });
    expect((await burn()).equals(direct)).toBe(true);
    await writeConfig({ schema: "docsxai/workspace@1" });
    expect((await burn()).equals(direct)).toBe(true);
  });

  it("changes pixels when the workspace has a theme", async () => {
    await writeConfig({ burn: { theme: { preset: "high-contrast" } } });
    const img = decodePng(await burn());
    expect(isColour(pixelAt(img, 215, 121), "#d10000")).toBe(true);
  });

  it("loads once per workspace and warns once per load", async () => {
    await writeConfig({ burn: { theme: { ink: "#aaaaaa" } } });
    const warn = vi.fn();
    await burn({ warn });
    await burn({ warn });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("ink on callout_background");
  });

  it("loads again when .docsxai.json changes", async () => {
    await writeConfig({ burn: { theme: { ink: "#aaaaaa" } } });
    const warn = vi.fn();
    await burn({ warn });
    await writeConfig({ burn: { theme: { ink: "#bbbbbb" } } });
    const later = new Date(Date.now() + 5000);
    await fs.utimes(path.join(ws, ".docsxai.json"), later, later);
    await burn({ warn });
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("throws a BurnThemeError naming the file and every key when the block is invalid", async () => {
    await writeConfig({ burn: { theme: { accent: "red", radius: 99 } } });
    const error = await burn().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BurnThemeError);
    expect((error as BurnThemeError).problems).toHaveLength(2);
    expect((error as Error).message).toContain(".docsxai.json burn.theme has 2 problems:");
    expect((error as Error).message).toContain("accent");
    expect((error as Error).message).toContain("radius");
  });
});
