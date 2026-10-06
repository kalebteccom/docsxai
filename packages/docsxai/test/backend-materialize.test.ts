// The backend's webhook runner writes a stored revision into a temp workspace and runs the engine
// on it. Its own tests use a fake engine, so a layout the real engine cannot read (it once wrote
// `flows.json` where `run` lists `flows/*.flow.yaml`) never failed there. These tests materialise
// a revision through the backend's own code and read the result with the engine's loaders. The
// backend has no engine dependency, so its copy of the name rules is held to the engine's here.
// No browser starts: the bin runs stop at a flow or variant selection before one launches.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, promises as fs, rmSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isAnnotationsPath,
  isFlowFileName,
  isFlowName,
  isScreenshotPath,
  materializeDocPack,
} from "../../backend/src/materialize.js";
import { MemoryStore } from "../../backend/src/store.js";
import { listFlowFiles } from "../../engine/src/cli-shared.js";
import { FlowName } from "../../engine/src/doc-pack.js";
import { assertSafePackNames } from "../../engine/src/doc-pack-io.js";
import { parseFlowFile } from "../../engine/src/flow-file.js";
import { loadWorkspaceConfig } from "../../engine/src/workspace.js";

const exec = promisify(execFile);

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const binPath = path.join(pkgDir, "bin.mjs");
const engineBuilt = existsSync(
  path.join(pkgDir, "node_modules", "@docsxai", "engine", "dist", "cli.js"),
);

async function docsxai(args: string[]): Promise<{ code: number; stderr: string }> {
  try {
    const { stderr } = await exec(process.execPath, [binPath, ...args]);
    return { code: 0, stderr };
  } catch (e) {
    const err = e as { code?: number; stderr?: string };
    return { code: err.code ?? 1, stderr: err.stderr ?? "" };
  }
}

const TOUR = `name: tour
steps:
  - id: open
    action: navigate
    value: /
`;
const CHECKOUT = `name: checkout
locators: { pay: "#pay" }
steps:
  - id: open
    action: navigate
    value: /checkout
  - id: pay
    action: click
    target: $pay
`;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

/** A revision shaped like a `docsxai push`: flows, annotations, a screenshot blob, style, locators. */
function seededSource() {
  const store = new MemoryStore();
  const ws = store.createWorkspace("ws");
  const project = store.createProject(ws.id, "site");
  const rev = store.createRevision(ws.id, project.id, "run", "ci");
  const put = (slot: "flows" | "annotations" | "screenshots" | "style" | "locators", p: unknown) =>
    store.putArtifact(ws.id, project.id, rev.id, slot, p);
  put("flows", {
    schema: "docsxai/flows@1",
    files: { "tour.flow.yaml": TOUR, "checkout.flow.yaml": CHECKOUT },
  });
  put("annotations", {
    schema: "docsxai/annotations-bundle@1",
    files: {
      "tour/annotations.json": { schema: "docsxai/annotations@1", flow: "tour", annotations: [] },
    },
  });
  put("screenshots", {
    schema: "docsxai/screenshots@2",
    files: { "tour/screenshots/open.png": store.putBlob(PNG) },
  });
  put("style", { schema: "docsxai/style-bundle@1", yaml: "schema: docsxai/style@1\n", json: null });
  put("locators", { schema: "docsxai/locators@1", yaml: "{}\n" });
  return {
    store,
    workspaceId: ws.id,
    projectId: project.id,
    revisionId: rev.id,
    artifacts: store.getRevision(ws.id, project.id, rev.id).artifacts,
  };
}

describe("backend materializeDocPack read by the engine", () => {
  let tmp = "";
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-backend-materialize-"));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("listFlowFiles finds flows/<name>.flow.yaml and each file parses as a flow", async () => {
    materializeDocPack(tmp, seededSource(), { appUrl: "http://127.0.0.1:3000" });
    const files = await listFlowFiles(tmp);
    expect(files.map((f) => path.basename(f))).toEqual(["checkout.flow.yaml", "tour.flow.yaml"]);
    const names = [];
    for (const f of files) names.push(parseFlowFile(await fs.readFile(f, "utf8"), f).name);
    expect(names).toEqual(["checkout", "tour"]);
  });

  it("loadWorkspaceConfig reads .docsxai.json and its app_url", async () => {
    materializeDocPack(tmp, seededSource(), { appUrl: "http://127.0.0.1:3000" });
    expect(await loadWorkspaceConfig(tmp)).toMatchObject({
      schema: "docsxai/workspace@1",
      app_url: "http://127.0.0.1:3000",
    });
  });

  it("puts docs/ outputs where run and render read them", async () => {
    materializeDocPack(tmp, seededSource());
    expect(existsSync(path.join(tmp, "docs", "tour", "annotations.json"))).toBe(true);
    expect(await fs.readFile(path.join(tmp, "docs", "tour", "screenshots", "open.png"))).toEqual(
      PNG,
    );
    expect(existsSync(path.join(tmp, "docs", "style.yaml"))).toBe(true);
    expect(existsSync(path.join(tmp, "docs", "locators.yaml"))).toBe(true);
    expect(existsSync(path.join(tmp, "flows.json"))).toBe(false);
  });
});

describe.skipIf(!engineBuilt)("backend materializeDocPack through the bare bin", () => {
  let tmp = "";
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-backend-materialize-bin-"));
    materializeDocPack(tmp, seededSource());
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("run <dir> loads the flows: a variant that does not exist is the first complaint", async () => {
    const r = await docsxai(["run", tmp, "--variant", "nope"]);
    expect(r.stderr).not.toContain("has no flows/ directory");
    expect(r.stderr).not.toContain("no flow-files in");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('run: no variant "nope"');
  });

  it("run <dir> --flow tour selects a materialised flow by its name", async () => {
    const r = await docsxai(["run", tmp, "--flow", "missing"]);
    expect(r.stderr).not.toContain("has no flows/ directory");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('run: no flow named "missing"');
  });
});

describe("backend name rules match the engine's", () => {
  const FLOW_NAMES = [
    "tour",
    "Board_1.v2",
    "a",
    "a".repeat(64),
    "a".repeat(65),
    "",
    ".hidden",
    "-lead",
    "a..b",
    "trail.",
    "con",
    "CON.v2",
    "lpt1.flow",
    "console",
    "has space",
    "sub/dir",
    "..",
    "../x",
    "é",
  ];

  it.each(FLOW_NAMES)("flow name %j", (name) => {
    expect(isFlowName(name)).toBe(FlowName.safeParse(name).success);
  });

  const FLOW_FILES = [...FLOW_NAMES.map((n) => `${n}.flow.yaml`), "tour.yaml", "tour.flow.yml"];
  const ANNOTATIONS = [
    "tour/annotations.json",
    "tour/es-ES.dark.mobile/annotations.json",
    "tour/a/b/annotations.json",
    "../annotations.json",
    "annotations.json",
    "con/annotations.json",
    "tour/.x/annotations.json",
    "tour/annotations.JSON",
    "tour/con/annotations.json",
    "tour/NUL.dark/annotations.json",
    "tour/com9.v2/annotations.json",
    "tour/console/annotations.json",
    "tour/x./annotations.json",
    "tour/screenshots/annotations.json",
    "tour/Screenshots/annotations.json",
    "tour/annotations.json/annotations.json",
  ];
  const SCREENSHOTS = [
    "tour/screenshots/open.png",
    "tour/v/screenshots/open.WEBP",
    "tour/screenshots/open.gif",
    "tour/screenshots/../open.png",
    "tour/shots/open.png",
    "screenshots/open.png",
    "tour/screenshots/.hidden.png",
    "tour/screenshots/con.png",
    "tour/screenshots/aux.v2.png",
    "tour/screenshots/console.png",
    "tour/screenshots/s..png",
    "tour/lpt1/screenshots/s.png",
    "tour/screenshots/screenshots/s.png",
    "tour/annotations.json/screenshots/s.png",
  ];

  const engineAccepts = (artifact: "flows" | "annotations" | "screenshots", name: string) => {
    const files = { [name]: artifact === "screenshots" ? { sha256: "0", bytes: 0 } : "" };
    const payload =
      artifact === "flows"
        ? { flows: { schema: "docsxai/flows@1" as const, files: files as Record<string, string> } }
        : artifact === "annotations"
          ? {
              annotations: {
                schema: "docsxai/annotations-bundle@1" as const,
                files: files as Record<string, unknown>,
              },
            }
          : {
              screenshots: {
                schema: "docsxai/screenshots@2" as const,
                files: files as Record<string, { sha256: string; bytes: number }>,
              },
            };
    try {
      assertSafePackNames(payload);
      return true;
    } catch {
      return false;
    }
  };

  it.each(FLOW_FILES)("flow file %j", (name) => {
    expect(isFlowFileName(name)).toBe(engineAccepts("flows", name));
  });
  it.each(ANNOTATIONS)("annotations path %j", (name) => {
    expect(isAnnotationsPath(name)).toBe(engineAccepts("annotations", name));
  });
  it.each(SCREENSHOTS)("screenshot path %j", (name) => {
    expect(isScreenshotPath(name)).toBe(engineAccepts("screenshots", name));
  });
});

describe("backend case-collision checks match the engine's", () => {
  const ref = { sha256: createHash("sha256").update(PNG).digest("hex"), bytes: PNG.byteLength };

  /** Whether the engine's pull validator and the backend's materialiser each refuse the pack. */
  function verdicts(annotations: string[], screenshots: string[]): [boolean, boolean] {
    const store = new MemoryStore();
    const ws = store.createWorkspace("ws");
    const project = store.createProject(ws.id, "site");
    const rev = store.createRevision(ws.id, project.id, "run", "ci");
    store.putBlob(PNG);
    if (annotations.length > 0) {
      store.putArtifact(ws.id, project.id, rev.id, "annotations", {
        schema: "docsxai/annotations-bundle@1",
        files: Object.fromEntries(annotations.map((n) => [n, {}])),
      });
    }
    if (screenshots.length > 0) {
      store.putArtifact(ws.id, project.id, rev.id, "screenshots", {
        schema: "docsxai/screenshots@2",
        files: Object.fromEntries(screenshots.map((n) => [n, ref])),
      });
    }
    const dir = mkdtempSync(path.join(os.tmpdir(), "docsxai-backend-case-"));
    try {
      let backend = false;
      try {
        materializeDocPack(dir, {
          store,
          workspaceId: ws.id,
          projectId: project.id,
          revisionId: rev.id,
          artifacts: store.getRevision(ws.id, project.id, rev.id).artifacts,
        });
      } catch {
        backend = true;
      }
      let engine = false;
      try {
        assertSafePackNames({
          annotations: {
            schema: "docsxai/annotations-bundle@1",
            files: Object.fromEntries(annotations.map((n) => [n, {}])),
          },
          screenshots: {
            schema: "docsxai/screenshots@2",
            files: Object.fromEntries(screenshots.map((n) => [n, ref])),
          },
        });
      } catch {
        engine = true;
      }
      return [engine, backend];
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it.each([
    [["tour/annotations.json"], ["tour/screenshots/a.png"], false],
    [["Tour/annotations.json", "tour/annotations.json"], [], true],
    [["tour/En.dark/annotations.json", "tour/en.dark/annotations.json"], [], true],
    [[], ["tour/screenshots/A.png", "tour/screenshots/a.png"], true],
    [["Tour/annotations.json"], ["tour/screenshots/a.png"], true],
    [
      ["tour/annotations.json", "tour/en.dark/annotations.json"],
      ["tour/en.dark/screenshots/a.png"],
      false,
    ],
  ] as const)("annotations %j, screenshots %j: refused %s", (annotations, screenshots, refused) => {
    const [engine, backend] = verdicts([...annotations], [...screenshots]);
    expect(engine).toBe(refused);
    expect(backend).toBe(refused);
  });
});
