import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildStarlightSite } from "../src/starlight.js";

let dir = "";
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-site-build-"));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("buildStarlightSite failures", () => {
  it("says so, and creates nothing, when the site directory is not there", async () => {
    const siteDir = path.join(dir, "no-such-site");
    const r = await buildStarlightSite({ siteDir, astroBin: path.join(dir, "astro.mjs") });
    expect(r.ok).toBe(false);
    expect(r.stderr).toContain("does not exist");
    await expect(fs.access(siteDir)).rejects.toThrow();
  });

  it("says so when the build runs past its time limit", async () => {
    const bin = path.join(dir, "slow.mjs");
    await fs.writeFile(bin, "setTimeout(() => {}, 60000);\n");
    const r = await buildStarlightSite({ siteDir: dir, astroBin: bin, timeoutMs: 300 });
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/timed out after 300 ms/i);
  });

  it("keeps the build's own output when it fails", async () => {
    const bin = path.join(dir, "fail.mjs");
    await fs.writeFile(bin, 'console.error("boom"); process.exit(3);\n');
    const r = await buildStarlightSite({ siteDir: dir, astroBin: bin });
    expect(r.ok).toBe(false);
    expect(r.stderr).toContain("boom");
  });
});
