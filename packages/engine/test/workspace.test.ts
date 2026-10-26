import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseAuthStrategyFile } from "../src/auth.js";
import { USAGE } from "../src/cli-usage.js";
import { parseFlowFile } from "../src/flow-file.js";
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

describe("scaffolded README and sample flow", () => {
  const readme = async (opts: Parameters<typeof initWorkspace>[0]): Promise<string> => {
    const r = await initWorkspace(opts);
    return fs.readFile(path.join(r.dir, "README.md"), "utf8");
  };

  it("writes a sample flow that parses and that run, lint and render do not load", async () => {
    const dir = path.join(tmp, "sample");
    await initWorkspace({ dir });
    const file = path.join(dir, "flows", "example.flow.yaml.sample");
    const flow = parseFlowFile(await fs.readFile(file, "utf8"), file);
    expect(flow.name).toBe("example");
    expect(flow.steps.length).toBeGreaterThan(0);
    expect(
      (await fs.readdir(path.join(dir, "flows"))).filter((f) => f.endsWith(".flow.yaml")),
    ).toEqual([]);
  });

  it("names the real commands, and every docsxai subcommand it shows is in the usage text", async () => {
    const text = await readme({ dir: path.join(tmp, "cmds") });
    const shown = [...text.matchAll(/^docsxai ([a-z-]+)/gm)].map((m) => m[1]);
    expect(shown).toEqual(["doctor", "capture-auth", "add-flow", "run", "render"]);
    for (const cmd of shown) expect(USAGE).toContain(`docsxai ${cmd} `);
    expect(text).toContain("docsxai add-flow . --from flows/example.flow.yaml.sample");
    expect(text).not.toContain("--description");
  });

  it("documents burn.theme in a short optional section", async () => {
    const text = await readme({ dir: path.join(tmp, "theme") });
    const section = text.slice(text.indexOf("## Optional: caption theme"));
    expect(section).toContain('"burn": { "theme"');
    expect(section).toContain("docs/burn-theming.md");
    expect(section.trim().split("\n").length).toBeLessThanOrEqual(10);
  });

  it("guides an app without a login to --auth none, and drops the login steps for it", async () => {
    const withLogin = await readme({ dir: path.join(tmp, "login") });
    expect(withLogin).toContain("--auth none");
    expect(withLogin).toContain("auth/strategy.yaml");
    const none = await readme({ dir: path.join(tmp, "nologin"), auth: "none" });
    expect(none).not.toContain("capture-auth");
    expect(none).toContain("--auth none");
    expect(none).not.toContain("`.auth/<role>.json`");
  });
});
