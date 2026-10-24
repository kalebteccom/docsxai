// A pack built from a 2x capture burns at 2x, as `burn` does: the device_scale_factor of the
// workspace's annotations.json or of a raw sidecar reaches the burner.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildPack, type Burner } from "../src/pack-build.js";
import { readRawCapture } from "../src/pack-source.js";
import { readWorkspace } from "../src/pack-workspace.js";
import {
  BOX,
  light,
  packConfig,
  sampleRaw,
  writeRawCapture,
  writeWorkspace,
} from "./helpers/pack-fixtures.js";

let root = "";
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-pack-ratio-"));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const record = { step: "board", selector: "#a", copy: "A", bounding_box: BOX, index: 1 };

async function workspaceWith(factor: unknown): Promise<string> {
  const ws = path.join(root, "ws");
  await writeWorkspace(ws, {
    config: packConfig({ "desktop-1280": "en.dark.1280" }, ["board"]),
    shots: { "desktop-1280": { board: light() } },
    annotations: { "desktop-1280": [record] },
  });
  const file = path.join(ws, "docs", "desktop-1280", "annotations.json");
  const doc = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
  if (factor !== undefined) doc["device_scale_factor"] = factor;
  await fs.writeFile(file, JSON.stringify(doc));
  return ws;
}

function seen(): { ratios: (number | undefined)[]; burn: Burner } {
  const ratios: (number | undefined)[] = [];
  return {
    ratios,
    burn: (png, _records, _warn, pixelRatio) => {
      ratios.push(pixelRatio);
      return Promise.resolve({ png, unplaceable: 0 });
    },
  };
}

describe("pack pixel ratio", () => {
  it("passes the workspace annotations.json device_scale_factor to the burner", async () => {
    const source = await readWorkspace(await workspaceWith(2));
    const { ratios, burn } = seen();
    await buildPack({ source, burn, warn: () => undefined });
    expect(ratios).toEqual([2]);
  });

  it("leaves the ratio unset when the file has none", async () => {
    const source = await readWorkspace(await workspaceWith(undefined));
    const { ratios, burn } = seen();
    await buildPack({ source, burn, warn: () => undefined });
    expect(ratios).toEqual([undefined]);
  });

  it("names the file for a device_scale_factor outside 1 to 4", async () => {
    await expect(readWorkspace(await workspaceWith(9))).rejects.toThrow(
      /docs\/desktop-1280\/annotations\.json.*device_scale_factor/,
    );
  });

  it("reads device_scale_factor from a raw capture sidecar", async () => {
    const flows = sampleRaw();
    const variant = flows["onboarding"]!.steps["pair"]!.variants["en.light.390"]!;
    variant.sidecar = { ...variant.sidecar, device_scale_factor: 2 };
    await writeRawCapture(path.join(root, "raw"), flows);
    const pair = (await readRawCapture(path.join(root, "raw")))[0]!.steps[1]!;
    expect(pair.variants.map((v) => v.pixelRatio)).toEqual([2, undefined]);
  });
});
