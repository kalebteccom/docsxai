// `docsxai init <dir> --example`: a workspace for example.com with no login and the hello flow
// already in flows/, so `run` and `render --open` are the only commands left. Without --example,
// init prints what it printed before.

import { existsSync, promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import { EXAMPLE_APP_URL, EXAMPLE_FLOW } from "../src/workspace-templates.js";
import { parseFlowFile } from "../src/flow-file.js";

let out = "";
let err = "";
let tmp = "";
beforeEach(async () => {
  out = "";
  err = "";
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-init-example-"));
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    out += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    err += String(chunk);
    return true;
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("init --example", () => {
  it("writes the hello flow, app_url example.com and no auth descriptor", async () => {
    const ws = path.join(tmp, "hello");
    expect(await main(["init", ws, "--example"])).toBe(0);
    expect(await fs.readFile(path.join(ws, "flows", "hello.flow.yaml"), "utf8")).toBe(EXAMPLE_FLOW);
    const cfg = JSON.parse(await fs.readFile(path.join(ws, ".docsxai.json"), "utf8")) as {
      app_url?: string;
    };
    expect(cfg.app_url).toBe(EXAMPLE_APP_URL);
    expect(EXAMPLE_APP_URL).toBe("https://example.com");
    expect(existsSync(path.join(ws, "auth", "strategy.yaml"))).toBe(false);
    expect(existsSync(path.join(ws, "docs", "style.yaml"))).toBe(true);
    expect(err).toBe("");
  });

  it("names the two commands left", async () => {
    const ws = path.join(tmp, "hello");
    expect(await main(["init", ws, "--example"])).toBe(0);
    const lines = out.trimEnd().split("\n");
    expect(lines[0]).toBe(`init: workspace at ${ws}`);
    expect(lines[1]).toMatch(/^ {2}created: .*flows\/hello\.flow\.yaml, docs\/style\.yaml$/);
    expect(lines[2]).toBe(`  next: docsxai run ${ws}  →  docsxai render ${ws} --open`);
  });

  it("is a flow lint accepts as written", async () => {
    const flow = parseFlowFile(EXAMPLE_FLOW, "hello.flow.yaml");
    expect(flow.name).toBe("hello");
    expect(flow.steps.map((s) => s.id)).toEqual(["open-home"]);
    const ws = path.join(tmp, "hello");
    expect(await main(["init", ws, "--example"])).toBe(0);
    out = "";
    expect(await main(["lint", ws])).toBe(0);
  });

  it("is the flow the README shows", async () => {
    const readme = await fs.readFile(new URL("../../../README.md", import.meta.url), "utf8");
    const body = EXAMPLE_FLOW.split("\n")
      .filter((l) => !l.startsWith("#"))
      .join("\n");
    expect(readme).toContain("```yaml\n" + body + "```");
  });

  it.each(["--app-url", "--auth", "--role", "--ttl", "--capture-trigger", "--auth-cookie"])(
    "rejects %s with exit 2, since the example sets its own app and login",
    async (flag) => {
      const value = flag === "--app-url" ? "https://app.test" : "x";
      expect(await main(["init", path.join(tmp, "w"), "--example", flag, value])).toBe(2);
      expect(err).toContain(`init: --example can't be combined with ${flag}`);
      expect(existsSync(path.join(tmp, "w"))).toBe(false);
    },
  );

  it("works with --persist tmp", async () => {
    expect(await main(["init", "--persist", "tmp", "--example"])).toBe(0);
    const dir = /^init: workspace \(ephemeral\) at (.+)$/m.exec(out)![1]!;
    try {
      expect(existsSync(path.join(dir, "flows", "hello.flow.yaml"))).toBe(true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe("init without --example", () => {
  it("prints the same three lines as before", async () => {
    const ws = path.join(tmp, "app");
    expect(await main(["init", ws, "--app-url", "https://app.test", "--auth", "none"])).toBe(0);
    expect(out).toBe(
      [
        `init: workspace at ${ws}`,
        "  created: flows/, docs/, auth/, .auth/, .viewer/, .gitignore, .docsxai.json, flows/example.flow.yaml.sample, README.md",
        `  next: docsxai add-flow ${ws} --from <flow.yaml>  →  docsxai run ${ws}  →  docsxai render ${ws}`,
        "",
      ].join("\n"),
    );
    expect(existsSync(path.join(ws, "flows", "hello.flow.yaml"))).toBe(false);
  });
});
