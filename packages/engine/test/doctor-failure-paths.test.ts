// `docsxai doctor` on a workspace that is broken in the ways a first run breaks it: a config file
// that cannot be read, is not an object, or is not JSON; a directory that is not there; a missing
// flows/. Each row names the file, the cause and the one step that fixes it. Inputs are injected,
// so nothing here touches the network or a browser.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDoctorChecks, checkFlows, checkWorkspace, runDoctor } from "../src/doctor.js";

let tmp = "";
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-doctor-fail-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const configFile = () => path.join(tmp, ".docsxai.json");

describe("checkWorkspace", () => {
  it.skipIf(isRoot)(
    "fails on a config file it cannot read, naming the file and the chmod",
    async () => {
      await fs.writeFile(configFile(), "{}", { mode: 0o000 });
      try {
        const ws = await checkWorkspace(tmp);
        expect(ws.check.ok).toBe(false);
        expect(ws.check.detail).toContain(`${configFile()} cannot be read (EACCES`);
        expect(ws.check.fix).toBe(`chmod u+r ${configFile()}`);
        expect(ws.present).toBe(true);
      } finally {
        await fs.chmod(configFile(), 0o644);
      }
    },
  );

  it.each([
    ["[]", "an array"],
    ["null", "null"],
    ['"text"', "a string"],
    ["5", "a number"],
  ])("fails on a config that holds %s, saying what it holds", async (text, kind) => {
    await fs.writeFile(configFile(), text);
    const ws = await checkWorkspace(tmp);
    expect(ws.check.ok).toBe(false);
    expect(ws.check.detail).toBe(`${configFile()} holds ${kind}, not a JSON object`);
    expect(ws.check.detail).not.toContain("undefined");
    expect(ws.check.fix).toContain('"schema": "docsxai/workspace@1"');
  });

  it("does not offer `init --force` as the fix for invalid JSON", async () => {
    await fs.writeFile(configFile(), "{bad json");
    const ws = await checkWorkspace(tmp);
    expect(ws.check.detail).toContain(`${configFile()} is not valid JSON`);
    expect(ws.check.fix).toContain(".docsxai.json");
    expect(ws.check.fix).not.toContain("--force");
  });

  it("fails when the workspace directory is not there", async () => {
    const missing = path.join(tmp, "typo");
    const ws = await checkWorkspace(missing);
    expect(ws.check.ok).toBe(false);
    expect(ws.check.detail).toBe(`workspace directory ${missing} does not exist`);
    expect(ws.check.fix).toBe(`docsxai init ${missing} --app-url <url>, or fix the path`);
    expect(ws.present).toBe(false);
  });

  it("fails when the workspace path is a file", async () => {
    const file = path.join(tmp, "notes.txt");
    await fs.writeFile(file, "x");
    const ws = await checkWorkspace(file);
    expect(ws.check.ok).toBe(false);
    expect(ws.check.detail).toBe(`workspace path ${file} is a file, not a directory`);
  });
});

describe("checkFlows", () => {
  it("tells a workspace that lost flows/ to make it, not to run init over it", async () => {
    const c = await checkFlows(tmp);
    expect(c.ok).toBe(false);
    expect(c.fix).toBe(
      `mkdir ${path.join(tmp, "flows")}, then docsxai add-flow ${tmp} --from <flow.yaml>`,
    );
    expect(c.fix).not.toContain("`docsxai init`");
  });
});

describe("buildDoctorChecks on a config that is not JSON", () => {
  it("reports the config once, without a second failure from the plugins row", async () => {
    await fs.writeFile(configFile(), "{bad json");
    await fs.mkdir(path.join(tmp, "flows"));
    const checks = await buildDoctorChecks({
      workspaceDir: tmp,
      env: {},
      nodeVersion: "26.0.0",
      chromiumProbe: async () => ({ ok: true, detail: "/chromium" }),
      offline: true,
    });
    const failed = checks.filter((c) => !c.ok && c.name !== "viewer");
    expect(failed.map((c) => c.name)).toEqual(["workspace"]);
  });
});

describe("runDoctor flags", () => {
  it("exits 2 on a flag it does not know, instead of probing the network anyway", async () => {
    let err = "";
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      err += String(chunk);
      return true;
    });
    try {
      expect(await runDoctor([tmp, "--offine"])).toBe(2);
    } finally {
      vi.restoreAllMocks();
    }
    expect(err).toContain("doctor: unknown flag --offine");
    expect(err).toContain("usage: docsxai doctor [<workspace-dir>] [--offline]");
  });
});
