// `docsxai doctor` site row: printed only for a workspace that holds an emitted site folder with no
// astro installed in it, and absent (byte-identical output) in every other case.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import {
  buildDoctorChecks,
  checkSite,
  doctorReport,
  formatDoctorChecks,
  type DoctorCheck,
} from "../src/doctor.js";

let tmp = "";
let ws = "";
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-doctor-site-"));
  ws = path.join(tmp, "ws");
  await fs.mkdir(path.join(ws, "flows"), { recursive: true });
  await fs.writeFile(
    path.join(ws, ".docsxai.json"),
    JSON.stringify({ schema: "docsxai/workspace@1", created_at: "2026-01-01T00:00:00.000Z" }),
  );
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tmp, { recursive: true, force: true });
});

/** A site folder as `docsxai site` emits it: package.json and astro.config.mjs. */
async function emitSite(dir = path.join(ws, "site")): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "package.json"), '{"name":"site","scripts":{}}');
  await fs.writeFile(path.join(dir, "astro.config.mjs"), "export default {};\n");
  return dir;
}

async function installAstro(dir: string): Promise<void> {
  await fs.mkdir(path.join(dir, "node_modules", "astro"), { recursive: true });
  await fs.writeFile(path.join(dir, "node_modules", "astro", "package.json"), '{"name":"astro"}');
}

async function rows(): Promise<DoctorCheck[]> {
  return buildDoctorChecks({
    workspaceDir: ws,
    env: {},
    offline: true,
    chromiumProbe: () => Promise.resolve({ ok: true, detail: "stub chromium" }),
    fetchImpl: (() => Promise.reject(new Error("no network in tests"))),
    now: Date.parse("2026-06-12T12:00:00.000Z"),
  });
}

describe("checkSite", () => {
  it("prints nothing without a site folder", async () => {
    expect(checkSite(ws)).toBeNull();
  });

  it("prints nothing for a site folder that docsxai did not emit", async () => {
    await fs.mkdir(path.join(ws, "site"));
    await fs.writeFile(path.join(ws, "site", "index.html"), "<p>mine</p>");
    expect(checkSite(ws)).toBeNull();
  });

  it("prints nothing when astro is installed in the site folder", async () => {
    await installAstro(await emitSite());
    expect(checkSite(ws)).toBeNull();
  });

  it("asks for npm install when the site folder has no node_modules", async () => {
    await emitSite();
    const dir = path.join(ws, "site");
    expect(checkSite(ws)).toEqual({
      name: "site",
      ok: true,
      info: true,
      detail: `${dir} has no astro installed`,
      fix: `cd ${dir} && npm install, then npm run build`,
    });
  });

  it("asks for npm install when node_modules holds no astro", async () => {
    const dir = await emitSite();
    await fs.mkdir(path.join(dir, "node_modules", "left-pad"), { recursive: true });
    expect(checkSite(ws)?.name).toBe("site");
  });

  it("quotes a path with a space in the command", async () => {
    ws = path.join(tmp, "my ws");
    await emitSite(path.join(ws, "site"));
    const row = checkSite(ws);
    expect(row?.fix).toBe(`cd '${path.join(ws, "site")}' && npm install, then npm run build`);
  });
});

describe("doctor with a site folder", () => {
  it("leaves the output byte-identical when there is no site folder or astro is installed", async () => {
    const plain = formatDoctorChecks(await rows(), { version: "1.0.0", next: "docsxai run ." });
    expect(plain).not.toContain("site:");
    await installAstro(await emitSite());
    expect(formatDoctorChecks(await rows(), { version: "1.0.0", next: "docsxai run ." })).toBe(
      plain,
    );
  });

  it("adds one informational row that does not fail doctor", async () => {
    const before = await rows();
    await emitSite();
    const after = await rows();
    expect(after.filter((c) => c.name === "site")).toHaveLength(1);
    expect(after.filter((c) => c.name !== "site")).toEqual(before);
    const row = after.find((c) => c.name === "site")!;
    expect(row.ok).toBe(true);
    const text = formatDoctorChecks(after, { version: "1.0.0" });
    expect(text).toContain(`ok: site: ${path.join(ws, "site")} has no astro installed next: cd `);
    expect(after.filter((c) => !c.ok)).toEqual(before.filter((c) => !c.ok));
  });

  it("carries the row in --format json with the keys every row has", async () => {
    await emitSite();
    const report = doctorReport(await rows(), { version: "1.0.0" });
    const row = report.checks.find((c) => c.name === "site")!;
    expect(Object.keys(row)).toEqual(["name", "ok", "info", "detail", "next"]);
    expect(row.info).toBe(true);
    expect(row.next).toContain("npm install");
  });

  it("prints the row through the CLI", async () => {
    await emitSite();
    let out = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      out += String(chunk);
      return true;
    });
    await main(["doctor", ws, "--offline", "--format", "json"]);
    const names = (JSON.parse(out) as { checks: { name: string }[] }).checks.map((c) => c.name);
    expect(names).toContain("site");
    expect(names.indexOf("site")).toBeLessThan(names.indexOf("viewer"));
  });
});
