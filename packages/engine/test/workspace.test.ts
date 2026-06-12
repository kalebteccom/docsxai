import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseAuthStrategyFile } from "../src/auth.js";
import { initWorkspace, loadWorkspaceConfig } from "../src/workspace.js";

let tmp = "";
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-ws-test-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("initWorkspace", () => {
  it("scaffolds a workspace with auth descriptor + config + gitignore", async () => {
    const dir = path.join(tmp, "ws");
    const r = await initWorkspace({
      dir,
      appUrl: "https://localhost:5173",
      ignoreHttpsErrors: true,
    });
    expect(r.dir).toBe(dir);
    expect(r.ephemeral).toBe(false);
    for (const sub of ["flows", "docs", "auth", ".auth", ".viewer"]) {
      await expect(fs.access(path.join(dir, sub))).resolves.toBeUndefined();
    }
    expect(await fs.readFile(path.join(dir, ".gitignore"), "utf8")).toContain(".auth/");

    const cfg = await loadWorkspaceConfig(dir);
    expect(cfg).toMatchObject({
      schema: "docsxai/workspace@1",
      app_url: "https://localhost:5173",
      ignore_https_errors: true,
    });

    const descriptor = parseAuthStrategyFile(
      await fs.readFile(path.join(dir, "auth", "strategy.yaml"), "utf8"),
    );
    expect(descriptor.default_role).toBe("editor");
    expect(descriptor.roles.editor!.strategy).toBe("manual-capture");
    expect(descriptor.roles.editor!.cache).toEqual({ enabled: true, store: "local", ttl: "1h" });

    await expect(fs.access(path.join(dir, "README.md"))).resolves.toBeUndefined();
  });

  it("honours --auth none (no auth/strategy.yaml), --role, --ttl, --capture-trigger", async () => {
    const dir = path.join(tmp, "ws2");
    await initWorkspace({
      dir,
      auth: "none",
      role: "viewer",
      ttl: "session",
      captureTrigger: "button",
    });
    await expect(fs.access(path.join(dir, "auth", "strategy.yaml"))).rejects.toThrow();
    // (role/ttl/trigger only matter when auth=manual-capture; check they're accepted, not that they appear)
    const dir3 = path.join(tmp, "ws3");
    await initWorkspace({ dir: dir3, role: "viewer", ttl: "30m", captureTrigger: "button" });
    const d = parseAuthStrategyFile(
      await fs.readFile(path.join(dir3, "auth", "strategy.yaml"), "utf8"),
    );
    expect(d.default_role).toBe("viewer");
    expect(d.roles.viewer!.cache.ttl).toBe("30m");
    expect(d.roles.viewer!.options).toEqual({ capture_trigger: "button" });
  });

  it("--persist tmp creates an ephemeral workspace in the temp dir", async () => {
    const r = await initWorkspace({ persistTmp: true });
    expect(r.ephemeral).toBe(true);
    expect(r.dir.startsWith(os.tmpdir())).toBe(true);
    await expect(fs.access(path.join(r.dir, "auth", "strategy.yaml"))).resolves.toBeUndefined();
    await fs.rm(r.dir, { recursive: true, force: true });
  });

  it("refuses a non-empty directory unless --force", async () => {
    const dir = path.join(tmp, "ws-existing");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "something"), "x");
    await expect(initWorkspace({ dir })).rejects.toThrow(/exists and is not empty/);
    await expect(initWorkspace({ dir, force: true })).resolves.toMatchObject({ dir });
  });

  it("requires a dir when not using --persist tmp", async () => {
    await expect(initWorkspace({})).rejects.toThrow(/target directory is required/);
  });
});

describe("loadWorkspaceConfig", () => {
  it("returns null for a dir without (or with a bad) .docsxai.json", async () => {
    expect(await loadWorkspaceConfig(tmp)).toBeNull();
    await fs.writeFile(path.join(tmp, ".docsxai.json"), "{not json");
    expect(await loadWorkspaceConfig(tmp)).toBeNull();
    await fs.writeFile(path.join(tmp, ".docsxai.json"), JSON.stringify({ schema: "wrong" }));
    expect(await loadWorkspaceConfig(tmp)).toBeNull();
  });
});
