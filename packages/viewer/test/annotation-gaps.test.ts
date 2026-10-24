// A flow whose annotations.json holds records for some steps still shows every screenshot, and a
// annotations.json that cannot be read stops the command with a message naming the file.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { burnFlow } from "../src/burn.js";
import { buildViewer } from "../src/render.js";
import { emitStarlightSite } from "../src/starlight.js";
import { readTextIfPresent } from "../src/safe-read.js";
import { orderSteps } from "../src/step-order.js";
import { solidPng } from "./helpers/png.js";

let tmp = "";
let docsDir = "";

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-ann-gaps-"));
  docsDir = path.join(tmp, "docs");
  const shots = path.join(docsDir, "flow", "screenshots");
  await fs.mkdir(shots, { recursive: true });
  for (const step of ["open", "pay", "done"]) {
    await fs.writeFile(path.join(shots, `${step}.png`), solidPng(320, 200));
  }
  await fs.writeFile(
    path.join(docsDir, "flow", "annotations.json"),
    JSON.stringify({
      schema: "docsxai/annotations@1",
      flow: "flow",
      annotations: [
        {
          step: "pay",
          selector: "#pay",
          bounding_box: { x: 40, y: 50, width: 60, height: 24 },
          copy: "Pay now",
        },
      ],
    }),
  );
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("orderSteps", () => {
  it("lists annotated steps first, then the screenshots with no record in name order", () => {
    expect(orderSteps(["pay", "open"], ["done.png", "open.png", "pay.png", "a.png"])).toEqual([
      "pay",
      "open",
      "a",
      "done",
    ]);
  });

  it("falls back to the screenshot names alone, and ignores other files", () => {
    expect(orderSteps([], ["b.png", "a.png", "notes.txt"])).toEqual(["a", "b"]);
  });

  it("keeps an annotated step that has no screenshot", () => {
    expect(orderSteps(["ghost"], ["a.png"])).toEqual(["ghost", "a"]);
  });
});

describe("readTextIfPresent", () => {
  it("returns null for a missing file", async () => {
    expect(await readTextIfPresent(path.join(tmp, "nope.json"))).toBeNull();
  });

  it("names the file when it is a directory", async () => {
    const dir = path.join(tmp, "dir.json");
    await fs.mkdir(dir);
    await expect(readTextIfPresent(dir)).rejects.toThrow(dir);
  });
});

describe("steps with a screenshot and no annotation record", () => {
  it("buildViewer keeps them as plain screenshots after the annotated steps", async () => {
    const outDir = path.join(tmp, "out");
    await buildViewer({ docsDir, outDir });
    const html = await fs.readFile(path.join(outDir, "flow", "index.html"), "utf8");
    const order = ["pay", "done", "open"].map((s) => html.indexOf(`screenshots/${s}.png`));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order[0]).toBeLessThan(order[1]!);
    await expect(fs.access(path.join(outDir, "flow", "screenshots", "open.png"))).resolves.toBe(
      undefined,
    );
  });

  it("the Starlight page lists them too", async () => {
    const outDir = path.join(tmp, "site");
    const workspace = tmp;
    await emitStarlightSite({ workspaceDir: workspace, outDir });
    const mdx = await fs.readFile(path.join(outDir, "src/content/docs/flows/flow.mdx"), "utf8");
    for (const step of ["pay", "done", "open"]) expect(mdx).toContain(`${step}`);
    expect(mdx.indexOf("open")).toBeGreaterThan(-1);
    expect(mdx).toMatch(/done[\s\S]*open|open[\s\S]*done/);
  });
});

describe("an unreadable annotations.json", () => {
  beforeEach(async () => {
    const file = path.join(docsDir, "flow", "annotations.json");
    await fs.rm(file);
    await fs.mkdir(file);
  });

  it("stops buildViewer with a message that names the file", async () => {
    await expect(buildViewer({ docsDir, outDir: path.join(tmp, "out") })).rejects.toThrow(
      /annotations\.json/,
    );
  });

  it("stops the Starlight emit with a message that names the file", async () => {
    await expect(
      emitStarlightSite({ workspaceDir: tmp, outDir: path.join(tmp, "site") }),
    ).rejects.toThrow(/annotations\.json/);
  });

  it("stops burnFlow with the read error, not a missing-file message", async () => {
    const err = await burnFlow({ docsDir, flow: "flow" }).catch((e: unknown) => e as Error);
    expect(err.message).toContain(path.join(docsDir, "flow", "annotations.json"));
    expect(err.message).not.toMatch(/no annotations\.json/);
  });
});

describe("burnFlow with a missing or malformed annotations.json", () => {
  it("still says there is none when the file is absent", async () => {
    await fs.rm(path.join(docsDir, "flow", "annotations.json"));
    await expect(burnFlow({ docsDir, flow: "flow" })).rejects.toThrow(/no annotations\.json/);
  });

  it("names the file when it is not valid JSON", async () => {
    const file = path.join(docsDir, "flow", "annotations.json");
    await fs.writeFile(file, "{ nope");
    await expect(burnFlow({ docsDir, flow: "flow" })).rejects.toThrow(file);
  });
});
