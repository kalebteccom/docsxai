// What `docsxai init` leaves on disk: the order of the created files, the sample flow and who
// ignores it, the README's config line, a forced re-init next to files the user wrote, and a fresh
// workspace passing `docsxai doctor`.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listFlowFiles } from "../src/cli-shared.js";
import { buildDoctorChecks } from "../src/doctor.js";
import { parseFlowFile } from "../src/flow-file.js";
import { initWorkspace } from "../src/workspace.js";
import { SAMPLE_FLOW, SAMPLE_FLOW_PATH, workspaceReadme } from "../src/workspace-templates.js";

let tmp = "";
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-scaffold-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const read = (dir: string, rel: string) => fs.readFile(path.join(dir, rel), "utf8");

describe("the files init creates", () => {
  it("lists them in the order they are written, the sample before the README", async () => {
    const r = await initWorkspace({ dir: path.join(tmp, "ws") });
    expect(r.created).toEqual([
      "flows/",
      "docs/",
      "auth/",
      ".auth/",
      ".viewer/",
      ".gitignore",
      ".docsxai.json",
      "auth/strategy.yaml",
      SAMPLE_FLOW_PATH,
      "README.md",
    ]);
  });

  it("leaves out the auth descriptor for --auth none and keeps the sample", async () => {
    const r = await initWorkspace({ dir: path.join(tmp, "ws"), auth: "none" });
    expect(r.created).not.toContain("auth/strategy.yaml");
    expect(r.created.slice(-2)).toEqual([SAMPLE_FLOW_PATH, "README.md"]);
    await expect(fs.access(path.join(r.dir, SAMPLE_FLOW_PATH))).resolves.toBeUndefined();
  });

  it("writes nothing when it refuses a directory that is not empty", async () => {
    const dir = path.join(tmp, "busy");
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, "notes.txt"), "mine", "utf8");
    await expect(initWorkspace({ dir })).rejects.toThrow(/exists and is not empty/);
    expect(await fs.readdir(dir)).toEqual(["notes.txt"]);
  });
});

describe("the sample flow", () => {
  it("parses into the flow its comment promises", async () => {
    const dir = path.join(tmp, "ws");
    await initWorkspace({ dir });
    const flow = parseFlowFile(await read(dir, SAMPLE_FLOW_PATH), SAMPLE_FLOW_PATH);
    expect(flow.name).toBe("example");
    expect(flow.locators).toEqual({ heading: "h1" });
    expect(flow.steps.map((s) => [s.id, s.action])).toEqual([
      ["open-home", "navigate"],
      ["point-at-heading", "hover"],
    ]);
    expect(flow.steps[0]).toMatchObject({ value: "/", wait_for: "load" });
  });

  it("is not listed as a flow, so run, lint and render skip it", async () => {
    const dir = path.join(tmp, "ws");
    await initWorkspace({ dir });
    expect(await listFlowFiles(dir)).toEqual([]);
  });
});

describe("the README's config line", () => {
  const readme = async (opts: Parameters<typeof initWorkspace>[0]) => {
    const r = await initWorkspace(opts);
    return read(r.dir, "README.md");
  };

  it("shows app_url and the https flag when they are set", async () => {
    const text = await readme({
      dir: path.join(tmp, "a"),
      appUrl: "https://app.example.com",
      ignoreHttpsErrors: true,
    });
    expect(text).toContain("`app_url = https://app.example.com`, `ignore_https_errors = true`");
  });

  it("shows the bare key and false when they are not", async () => {
    const text = await readme({ dir: path.join(tmp, "b") });
    expect(text).toContain("`app_url`, `ignore_https_errors = false`");
    expect(text).not.toContain("app_url =");
  });

  it("names the config file in the theme section", () => {
    const text = workspaceReadme(
      { schema: "docsxai/workspace@1", created_at: "2026-01-01T00:00:00.000Z" },
      { auth: "none", configFile: "custom.json" },
    );
    expect(text).toContain("Add a `burn.theme` block to `custom.json`");
    expect(text).toContain("- `custom.json` ");
  });
});

describe("init over a workspace that has files of the user's", () => {
  it("leaves other flows alone, restores the sample and rewrites the README", async () => {
    const dir = path.join(tmp, "ws");
    await initWorkspace({ dir, appUrl: "https://one.example.com" });
    const mine = "name: mine\nsteps:\n  - id: s\n    action: navigate\n    value: /\n";
    await fs.writeFile(path.join(dir, "flows", "mine.flow.yaml"), mine, "utf8");
    await fs.writeFile(path.join(dir, SAMPLE_FLOW_PATH), "# edited\n", "utf8");
    await initWorkspace({ dir, force: true, appUrl: "https://two.example.com" });
    expect(await read(dir, "flows/mine.flow.yaml")).toBe(mine);
    expect(await read(dir, SAMPLE_FLOW_PATH)).toBe(SAMPLE_FLOW);
    expect(await read(dir, "README.md")).toContain("app_url = https://two.example.com");
    expect(await listFlowFiles(dir)).toEqual([path.join(dir, "flows", "mine.flow.yaml")]);
  });
});

describe("a fresh workspace and doctor", () => {
  const doctorOn = async (dir: string) => {
    const bin = path.join(tmp, "viewer.mjs");
    await fs.writeFile(bin, "export {};\n", "utf8");
    return buildDoctorChecks({
      workspaceDir: dir,
      nodeVersion: "26.0.0",
      chromiumProbe: async () => ({ ok: true, detail: "/fake/chromium" }),
      env: { DOCSX_VIEWER_BIN: bin, PATH: "" },
      offline: true,
    });
  };

  it.each([["manual-capture"], ["none"]] as const)(
    "passes every check right after init with auth %s",
    async (auth) => {
      const dir = path.join(tmp, "ws");
      await initWorkspace({ dir, auth, appUrl: "https://app.example.com" });
      const checks = await doctorOn(dir);
      expect(checks.filter((c) => !c.ok)).toEqual([]);
      const flows = checks.find((c) => c.name === "flows");
      expect(flows).toMatchObject({ ok: true, info: true });
      expect(flows?.detail).toContain("flows/ is empty");
    },
  );

  it("passes with a burn.theme block that init's README suggests", async () => {
    const dir = path.join(tmp, "ws");
    await initWorkspace({ dir });
    const file = path.join(dir, ".docsxai.json");
    const config = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
    config["burn"] = { theme: { preset: "readable", accent: "#0b6e4f" } };
    await fs.writeFile(file, JSON.stringify(config), "utf8");
    const checks = await doctorOn(dir);
    expect(checks.filter((c) => !c.ok)).toEqual([]);
    expect(checks.map((c) => c.name)).toContain("theme");
  });
});
