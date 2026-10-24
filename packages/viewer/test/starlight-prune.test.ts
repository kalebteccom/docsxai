import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emitStarlightSite } from "../src/starlight.js";

let tmp = "";
const site = () => path.join(tmp, "site");
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-prune-"));
  for (const flow of ["a", "b"]) {
    const dir = path.join(tmp, "docs", flow, "screenshots");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(tmp, "docs", flow, "annotations.json"),
      JSON.stringify({ annotations: [{ step: "s", selector: "#x", copy: "Hi" }] }),
    );
    await fs.writeFile(path.join(dir, "s.png"), "x");
  }
});
afterEach(() => fs.rm(tmp, { recursive: true, force: true }));

const exists = (rel: string) =>
  fs.access(path.join(site(), rel)).then(
    () => true,
    () => false,
  );

describe("emitting a site over an earlier one", () => {
  it("removes the page and images of a flow that left the pack", async () => {
    await emitStarlightSite({ workspaceDir: tmp, outDir: site() });
    expect(await exists("src/content/docs/flows/b.mdx")).toBe(true);
    expect(await exists("src/assets/flows/b/s.png")).toBe(true);

    await fs.rm(path.join(tmp, "docs", "b"), { recursive: true });
    const r = await emitStarlightSite({ workspaceDir: tmp, outDir: site() });

    expect(r.flows).toEqual(["a"]);
    expect(await exists("src/content/docs/flows/b.mdx")).toBe(false);
    expect(await exists("src/assets/flows/b")).toBe(false);
    expect(await exists("src/content/docs/flows/a.mdx")).toBe(true);
    expect(await exists("src/assets/flows/a/s.png")).toBe(true);
  });

  it("removes an image of a step that left a flow and leaves other files in the project alone", async () => {
    await fs.writeFile(path.join(tmp, "docs", "a", "screenshots", "t.png"), "x");
    await fs.writeFile(
      path.join(tmp, "docs", "a", "annotations.json"),
      JSON.stringify({
        annotations: [
          { step: "s", selector: "#x", copy: "Hi" },
          { step: "t", selector: "#y", copy: "Yo" },
        ],
      }),
    );
    await emitStarlightSite({ workspaceDir: tmp, outDir: site() });
    expect(await exists("src/assets/flows/a/t.png")).toBe(true);
    await fs.writeFile(path.join(site(), "notes.md"), "mine");
    await fs.mkdir(path.join(site(), "src/pages"), { recursive: true });
    await fs.writeFile(path.join(site(), "src/pages/own.astro"), "mine");

    await fs.writeFile(
      path.join(tmp, "docs", "a", "annotations.json"),
      JSON.stringify({ annotations: [{ step: "s", selector: "#x", copy: "Hi" }] }),
    );
    await emitStarlightSite({ workspaceDir: tmp, outDir: site() });

    expect(await exists("src/assets/flows/a/t.png")).toBe(false);
    expect(await exists("src/assets/flows/a/s.png")).toBe(true);
    expect(await exists("notes.md")).toBe(true);
    expect(await exists("src/pages/own.astro")).toBe(true);
  });
});
