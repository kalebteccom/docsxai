import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "../src/index.js";
import { MaterializeError, materializeDocPack } from "../src/materialize.js";
import { SpawnRunner } from "../src/runner.js";
import type { WebhookJob } from "../src/webhook.js";

const FLOW = "name: tour\nsteps:\n  - id: open\n    action: navigate\n    value: /\n";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

let tmp = "";
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "docsxai-materialize-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function seed(payloads: Partial<Record<string, unknown>>) {
  const store = new MemoryStore();
  const ws = store.createWorkspace("ws");
  const project = store.createProject(ws.id, "site");
  const rev = store.createRevision(ws.id, project.id, "run", "ci");
  for (const [slot, payload] of Object.entries(payloads)) {
    store.putArtifact(ws.id, project.id, rev.id, slot as never, payload);
  }
  const revision = store.getRevision(ws.id, project.id, rev.id);
  return {
    store,
    src: {
      store,
      workspaceId: ws.id,
      projectId: project.id,
      revisionId: rev.id,
      artifacts: revision.artifacts,
    },
  };
}

const read = (rel: string) => fs.readFileSync(path.join(tmp, rel), "utf8");

describe("materializeDocPack", () => {
  it("lays every artifact out the way push read it", () => {
    const { src } = seed({
      flows: { schema: "docsxai/flows@1", files: { "tour.flow.yaml": FLOW } },
      annotations: {
        schema: "docsxai/annotations-bundle@1",
        files: {
          "tour/annotations.json": { schema: "docsxai/annotations@1", flow: "tour" },
          "tour/es-ES.dark.mobile/annotations.json": { schema: "docsxai/annotations@1" },
        },
      },
      style: {
        schema: "docsxai/style-bundle@1",
        yaml: "schema: docsxai/style@1\n",
        json: { a: 1 },
      },
      locators: { schema: "docsxai/locators@1", yaml: "tour: {}\n" },
    });
    materializeDocPack(tmp, src, { appUrl: "http://localhost:3000" });
    expect(read("flows/tour.flow.yaml")).toBe(FLOW);
    expect(JSON.parse(read("docs/tour/annotations.json"))).toMatchObject({ flow: "tour" });
    expect(fs.existsSync(path.join(tmp, "docs/tour/es-ES.dark.mobile/annotations.json"))).toBe(
      true,
    );
    expect(read("docs/style.yaml")).toBe("schema: docsxai/style@1\n");
    expect(JSON.parse(read("docs/style.json"))).toEqual({ a: 1 });
    expect(read("docs/locators.yaml")).toBe("tour: {}\n");
    expect(JSON.parse(read(".docsxai.json"))).toMatchObject({
      schema: "docsxai/workspace@1",
      app_url: "http://localhost:3000",
    });
  });

  it("writes screenshot bytes from the blob store", () => {
    const store = new MemoryStore();
    const ws = store.createWorkspace("ws");
    const project = store.createProject(ws.id, "site");
    const rev = store.createRevision(ws.id, project.id, "run", "ci");
    const ref = store.putBlob(PNG);
    store.putArtifact(ws.id, project.id, rev.id, "screenshots", {
      schema: "docsxai/screenshots@2",
      files: { "tour/screenshots/open.png": ref },
    });
    materializeDocPack(tmp, {
      store,
      workspaceId: ws.id,
      projectId: project.id,
      revisionId: rev.id,
      artifacts: store.getRevision(ws.id, project.id, rev.id).artifacts,
    });
    expect(fs.readFileSync(path.join(tmp, "docs/tour/screenshots/open.png"))).toEqual(PNG);
  });

  it("still makes flows/ and docs/ for a revision with no artifacts", () => {
    const { src } = seed({});
    materializeDocPack(tmp, src);
    expect(fs.statSync(path.join(tmp, "flows")).isDirectory()).toBe(true);
    expect(fs.statSync(path.join(tmp, "docs")).isDirectory()).toBe(true);
    expect(JSON.parse(read(".docsxai.json")).app_url).toBeUndefined();
  });

  it.each([
    "../.docsxai.json",
    "../escape.flow.yaml",
    "sub/dir.flow.yaml",
    ".hidden.flow.yaml",
    "con.flow.yaml",
    "a..b.flow.yaml",
    "tour.yaml",
  ])("refuses the flow file name %s", (name) => {
    const { src } = seed({ flows: { schema: "docsxai/flows@1", files: { [name]: FLOW } } });
    expect(() => materializeDocPack(tmp, src)).toThrow(MaterializeError);
    expect(fs.existsSync(path.join(tmp, "flows", path.basename(name)))).toBe(false);
  });

  it("refuses two flow files that differ only by case", () => {
    const { src } = seed({
      flows: {
        schema: "docsxai/flows@1",
        files: { "Tour.flow.yaml": FLOW, "tour.flow.yaml": FLOW },
      },
    });
    expect(() => materializeDocPack(tmp, src)).toThrow(/differ only by case/);
  });

  it("refuses annotation paths and screenshot paths that differ only by case", () => {
    const store = new MemoryStore();
    const ws = store.createWorkspace("ws");
    const project = store.createProject(ws.id, "site");
    const rev = store.createRevision(ws.id, project.id, "run", "ci");
    const ref = store.putBlob(PNG);
    const put = (slot: "annotations" | "screenshots", files: Record<string, unknown>) =>
      store.putArtifact(ws.id, project.id, rev.id, slot, { files });
    put("annotations", { "Tour/annotations.json": {}, "tour/annotations.json": {} });
    const src = () => ({
      store,
      workspaceId: ws.id,
      projectId: project.id,
      revisionId: rev.id,
      artifacts: store.getRevision(ws.id, project.id, rev.id).artifacts,
    });
    expect(() => materializeDocPack(tmp, src())).toThrow(/annotations .* differ only by case/);
    put("annotations", {});
    put("screenshots", { "tour/screenshots/A.png": ref, "tour/screenshots/a.png": ref });
    expect(() => materializeDocPack(tmp, src())).toThrow(/screenshots .* differ only by case/);
    put("annotations", { "Tour/annotations.json": {} });
    put("screenshots", { "tour/screenshots/a.png": ref });
    expect(() => materializeDocPack(tmp, src())).toThrow(
      /output directories .* differ only by case/,
    );
  });

  it.each([
    "tour/con/annotations.json",
    "tour/NUL.dark/annotations.json",
    "tour/x./annotations.json",
  ])("refuses the Windows-hostile annotations path %s", (name) => {
    const { src } = seed({
      annotations: { schema: "docsxai/annotations-bundle@1", files: { [name]: {} } },
    });
    expect(() => materializeDocPack(tmp, src)).toThrow(MaterializeError);
  });

  it("refuses an annotations path that leaves docs/<flow>[/<variant>]/", () => {
    const { src } = seed({
      annotations: {
        schema: "docsxai/annotations-bundle@1",
        files: { "../x/annotations.json": {} },
      },
    });
    expect(() => materializeDocPack(tmp, src)).toThrow(MaterializeError);
  });

  it.each(["../../etc/passwd", "ABC", "a".repeat(63), "A".repeat(64), "g".repeat(64), ""])(
    "refuses the screenshot sha256 %j before it reaches the blob store",
    (sha256) => {
      const { src } = seed({
        screenshots: {
          schema: "docsxai/screenshots@2",
          files: { "tour/screenshots/open.png": { sha256, bytes: 1 } },
        },
      });
      expect(() => materializeDocPack(tmp, src)).toThrow(/malformed sha256|has no sha256/);
    },
  );

  it.each(["tour/screenshots/annotations.json", "tour/Screenshots/annotations.json"])(
    "refuses the reserved variant directory in %s",
    (name) => {
      const { src } = seed({
        annotations: { schema: "docsxai/annotations-bundle@1", files: { [name]: {} } },
      });
      expect(() => materializeDocPack(tmp, src)).toThrow(MaterializeError);
    },
  );

  it("refuses a variant named annotations.json for screenshots", () => {
    const { src } = seed({
      screenshots: {
        schema: "docsxai/screenshots@2",
        files: {
          "tour/annotations.json/screenshots/open.png": { sha256: "a".repeat(64), bytes: 1 },
        },
      },
    });
    expect(() => materializeDocPack(tmp, src)).toThrow(MaterializeError);
  });

  it("refuses a link-local app_url, and a private one only under denyPrivateAppUrl", () => {
    const { src } = seed({});
    expect(() => materializeDocPack(tmp, src, { appUrl: "http://169.254.169.254/" })).toThrow(
      /link-local or cloud-metadata/,
    );
    expect(() =>
      materializeDocPack(tmp, src, { appUrl: "http://localhost:3000", denyPrivateAppUrl: true }),
    ).toThrow(/loopback or private-network/);
    expect(() => materializeDocPack(tmp, src, { appUrl: "http://localhost:3000" })).not.toThrow();
  });

  it("refuses an app_url that is not an absolute http(s) URL", () => {
    const { src } = seed({});
    expect(() => materializeDocPack(tmp, src, { appUrl: "ftp://example.com" })).toThrow(/app_url/);
  });

  it("refuses a flows payload without a files map", () => {
    const { src } = seed({ flows: { flows: [{ id: "checkout" }] } });
    expect(() => materializeDocPack(tmp, src)).toThrow(/no files map/);
  });
});

/** A flow whose one step has `action` and `value`; the value goes in as a JSON string, which is valid YAML. */
const flowStepping = (value: string, action = "navigate"): string =>
  `name: tour\nsteps:\n  - id: open\n    action: ${action}\n    value: ${JSON.stringify(value)}\n`;

const APP = "https://app.example.com/base";

describe("materializeDocPack: flow navigate targets", () => {
  const run = (flow: string, opts: Parameters<typeof materializeDocPack>[2] = {}) => {
    const { src } = seed({
      flows: { schema: "docsxai/flows@1", files: { "tour.flow.yaml": flow } },
    });
    materializeDocPack(tmp, src, opts);
  };

  it.each([
    "http://169.254.169.254/latest/meta-data/",
    "https://169.254.169.254",
    "http://[fd00:ec2::254]/",
    "http://2852039166/",
    "http://168.63.129.16/machine",
    "http://metadata.google.internal/computeMetadata/v1/",
    "//169.254.169.254/latest",
    "/\\169.254.169.254/latest",
    "\\\\169.254.169.254\\latest",
    "  http://169.254.169.254/  ",
    "http:\t//169.254.169.254/",
  ])("refuses a navigate to %j with no app_url and with one", (value) => {
    expect(() => run(flowStepping(value))).toThrow(
      /flows file "tour.flow.yaml" has a navigate step whose value must not point at a link-local/,
    );
    expect(() => run(flowStepping(value), { appUrl: APP })).toThrow(MaterializeError);
  });

  it("refuses a navigate that is not an http(s) URL", () => {
    expect(() => run(flowStepping("javascript:alert(1)"))).toThrow(/absolute http\(s\) URL/);
    expect(() => run(flowStepping("file:///etc/passwd"), { appUrl: APP })).toThrow(
      /absolute http\(s\) URL/,
    );
  });

  it("refuses a navigate outside the app_url origin, whatever the host", () => {
    for (const value of [
      "https://other.example.com/",
      "http://app.example.com/",
      "//other.test/",
    ]) {
      expect(() => run(flowStepping(value), { appUrl: APP })).toThrow(
        /value is outside the app_url origin/,
      );
    }
  });

  it("finds a navigate written in YAML flow style and refuses text that is not YAML", () => {
    const flowStyle =
      'name: tour\nsteps: [{ id: a, action: navigate, value: "http://169.254.169.254/" }]\n';
    expect(() => run(flowStyle)).toThrow(/link-local/);
    expect(() => run("steps: [\n  - {")).toThrow(/is not valid YAML/);
  });

  it("refuses a loopback navigate only under denyPrivateAppUrl", () => {
    expect(() => run(flowStepping("http://localhost:3000/"))).not.toThrow();
    expect(() => run(flowStepping("http://localhost:3000/"), { denyPrivateAppUrl: true })).toThrow(
      /loopback or private-network/,
    );
  });

  it.each([
    "/checkout",
    "checkout",
    "../up",
    "?tab=1",
    "#top",
    "/a//b",
    "https://app.example.com/x",
  ])("allows a navigate to %j under an app_url", (value) => {
    expect(() => run(flowStepping(value), { appUrl: APP })).not.toThrow();
  });

  it.each(["/checkout", "?tab=1", "https://example.com/docs", "http://localhost:3000/"])(
    "allows a navigate to %j with no app_url",
    (value) => {
      expect(() => run(flowStepping(value))).not.toThrow();
    },
  );

  it.each([
    "/etc/passwd",
    "/proc/self/environ",
    "\\\\server\\share\\x",
    "C:\\Users\\x\\id_rsa",
    "../secret.txt",
    "fixtures/../../secret.txt",
    "fixtures\\..\\..\\secret.txt",
    ".auth/default.json",
    ".docsxai.json",
    "fixtures/.env",
    "webhook-job.json",
    "./Webhook-Job.json",
    "",
  ])("refuses an upload of %j", (value) => {
    expect(() => run(flowStepping(value, "upload"))).toThrow(
      /flows file "tour.flow.yaml" has an upload step whose value /,
    );
  });

  it.each(["fixtures/a.png", "a.png", "./a.png", "dir/with space.txt"])(
    "allows an upload of %j",
    (value) => {
      expect(() => run(flowStepping(value, "upload"))).not.toThrow();
    },
  );

  it("does not take a navigate-style value of an upload step for a URL", () => {
    expect(() =>
      run(flowStepping("https://example.com/a.png", "upload"), { appUrl: APP }),
    ).not.toThrow();
  });

  it("does not read the value of any other action as a navigation", () => {
    expect(() =>
      run(flowStepping("http://169.254.169.254/", "fill"), { appUrl: APP }),
    ).not.toThrow();
  });
});

describe("SpawnRunner.materializeWorkspace", () => {
  it("removes the temp dir when a payload is refused", () => {
    const { store, src } = seed({
      flows: { schema: "docsxai/flows@1", files: { "../x.flow.yaml": FLOW } },
    });
    const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "docsxai-materialize-root-"));
    try {
      const job = {
        delivery_id: "d",
        event: "push",
        workspace_id: src.workspaceId,
        project_id: src.projectId,
        repo: "o/r",
        config: { workspace_rev: src.revisionId },
        payload: {},
      } as unknown as WebhookJob;
      const runner = new SpawnRunner({ store, workRoot });
      expect(() => runner.materializeWorkspace(job)).toThrow(MaterializeError);
      expect(fs.readdirSync(workRoot)).toEqual([]);
    } finally {
      fs.rmSync(workRoot, { recursive: true, force: true });
    }
  });
});
