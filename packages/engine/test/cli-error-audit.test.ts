// CLI error wording found by an audit of every user-reachable message: flags that took no value and
// were ignored, internal option names in messages, a schema error reported as "not a flow-guide",
// absolute paths in a report meant to be pasted, and raw ENOENT text. Real directories, no stubs.

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import { describePageLoad } from "../src/browser-launch-error.js";
import { extractFlowFile } from "../src/calibrate.js";
import { parseFlowFile } from "../src/flow-file.js";
import { runFlow } from "../src/flow-runtime.js";
import { RecordingDriver } from "./recording-driver.js";

let out = "";
let err = "";
let tmp = "";
let ws = "";
beforeEach(async () => {
  out = "";
  err = "";
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-erraudit-"));
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    out += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    err += String(chunk);
    return true;
  });
  ws = path.join(tmp, "ws");
  expect(await main(["init", ws, "--app-url", "http://127.0.0.1:1", "--auth", "none"])).toBe(0);
  out = "";
  err = "";
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(tmp, { recursive: true, force: true });
});

const GOOD_FLOW = "name: ok\nsteps:\n  - id: a\n    action: navigate\n    value: /\n";

async function writeFlow(name: string, text: string): Promise<string> {
  const file = path.join(ws, "flows", `${name}.flow.yaml`);
  await fs.writeFile(file, text);
  return file;
}

describe("a value flag with no value is a usage error, not a flag to ignore", () => {
  it.each([
    [["zip", "--out"], "zip", "out"],
    [["export", "adf", "--flow"], "export adf", "flow"],
    [["export", "adf", "--mode"], "export adf", "mode"],
    [["export", "playwright", "--out"], "export playwright", "out"],
    [["lint", "--flow"], "lint", "flow"],
    [["lint", "--format"], "lint", "format"],
    [["flow-tree", "--format"], "flow-tree", "format"],
    [["style", "--format"], "style", "format"],
    [["inspect", "--url"], "inspect", "url"],
    [["inspect", "--wait"], "inspect", "wait"],
    [["capture-auth", "--role"], "capture-auth", "role"],
    [["push", "--kind"], "push", "kind"],
    [["pull", "--rev"], "pull", "rev"],
    [["init", "--app-url"], "init", "app-url"],
    [["calibrate", "--name"], "calibrate", "name"],
    [["diagnose", "--cdp"], "diagnose", "cdp"],
  ])("%j", async (argv, label, flag) => {
    const [cmd, ...rest] = argv;
    const withDir =
      cmd === "export" ? ["export", rest[0]!, ws, ...rest.slice(1)] : [cmd!, ws, ...rest];
    const target = cmd === "init" ? path.join(tmp, "fresh") : undefined;
    if (target) withDir[1] = target;
    expect(await main(withDir)).toBe(2);
    expect(err).toContain(`${label}: --${flag} needs a value`);
    expect(err).toContain("usage: docsxai ");
    await expect(fs.access(path.join(tmp, "fresh"))).rejects.toThrow();
    expect(path.join(tmp, "ws.zip")).toBeTruthy();
    await expect(fs.access(path.join(tmp, "ws.zip"))).rejects.toThrow();
  });

  it("a flag with its value, or a boolean flag, is untouched", async () => {
    expect(await main(["zip", ws, "--out", path.join(tmp, "x.zip"), "--include-viewer"])).toBe(0);
    expect(err).toBe("");
  });
});

describe("init flag values", () => {
  it("--auth shows the value it got and the usage line", async () => {
    expect(await main(["init", path.join(tmp, "n"), "--auth", "foo"])).toBe(2);
    expect(err).toContain(`init: --auth must be manual-capture or none (got "foo")`);
    expect(err).toContain("usage: docsxai init ");
    expect(err).not.toContain("Notes:");
  });

  it("--capture-trigger shows the value it got and the usage line", async () => {
    expect(await main(["init", path.join(tmp, "n"), "--capture-trigger", "zz"])).toBe(2);
    expect(err).toContain(`init: --capture-trigger must be console or button (got "zz")`);
    expect(err).toContain("usage: docsxai init ");
  });
});

describe("--start-from and --stop-after name the flag's meaning, not an internal option", () => {
  it("names the step, the flow and the steps that exist", async () => {
    await writeFlow("ok", GOOD_FLOW);
    const flow = parseFlowFile(GOOD_FLOW);
    const driver = {} as never;
    await expect(runFlow(flow, driver, { startFrom: "nope" })).rejects.toThrow(
      'cannot start from step "nope": flow "ok" has no such step (steps: a)',
    );
    await expect(runFlow(flow, driver, { stopAfter: "nope" })).rejects.toThrow(
      'cannot stop after step "nope": flow "ok" has no such step (steps: a)',
    );
  });
});

describe("calibrate", () => {
  it("a .yaml flow-file with a schema error names the field", () => {
    const bad = "name: x\nsteps:\n  - id: a\n    action: teleport\n";
    expect(() => extractFlowFile(bad, "g.flow.yaml")).toThrow(/steps\.0\.action/);
    expect(() => extractFlowFile(bad, "g.flow.yaml")).not.toThrow(/not a structured flow-guide/);
  });

  it("a .yaml file with broken YAML says so", () => {
    expect(() => extractFlowFile("steps: [\n", "g.flow.yaml")).toThrow(/not valid YAML/);
    expect(() => extractFlowFile("steps: [\n", "g.flow.yaml")).not.toThrow(
      /not a structured flow-guide/,
    );
  });

  it("prose still gets the flow-guide explanation, with no em dash", () => {
    let message = "";
    try {
      extractFlowFile("Just some prose about a test.", "guide.md");
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("not a structured flow-guide");
    expect(message).not.toContain("—");
  });

  it("a bad --name points at --name, not at the flow-file", async () => {
    const file = path.join(tmp, "g.flow.yaml");
    await fs.writeFile(file, GOOD_FLOW);
    expect(await main(["calibrate", ws, "--from", file, "--name", "bad name"])).toBe(1);
    expect(err).toContain('calibrate: flow name "bad name" is not usable');
    expect(err).toContain(`next: docsxai calibrate ${ws} --from ${file} --name <flow>`);
    expect(err).not.toContain(`next: fix ${file}`);
  });
});

describe("diff report", () => {
  const cwd = process.cwd();
  afterEach(() => process.chdir(cwd));

  it("prints the baseline as typed, not an absolute path, in text, md and json", async () => {
    await writeFlow("ok", GOOD_FLOW);
    expect(await main(["baseline", ws])).toBe(0);
    process.chdir(tmp);
    for (const format of ["text", "md", "json"]) {
      out = "";
      expect(await main(["diff", "ws", "--format", format])).toBe(0);
      expect(out).toContain(path.join("ws", ".baseline"));
      expect(out).not.toContain(await fs.realpath(tmp));
      expect(out).not.toContain(os.tmpdir());
    }
  });

  it("--against prints the directory as typed", async () => {
    await writeFlow("ok", GOOD_FLOW);
    expect(await main(["baseline", ws])).toBe(0);
    process.chdir(tmp);
    out = "";
    expect(await main(["diff", "ws", "--against", "ws/.baseline", "--format", "json"])).toBe(0);
    expect(JSON.parse(out).a).toBe("ws/.baseline");
  });

  it("an annotations.json that fails the schema says which field", async () => {
    await writeFlow("ok", GOOD_FLOW);
    await fs.mkdir(path.join(ws, "docs", "ok"), { recursive: true });
    expect(await main(["baseline", ws])).toBe(0);
    await fs.writeFile(
      path.join(ws, "docs", "ok", "annotations.json"),
      JSON.stringify({ annotations: [{ step: 1 }] }),
    );
    expect(await main(["diff", ws])).toBe(1);
    expect(err).toContain("docs/ok/annotations.json: invalid annotations file");
    expect(err).toMatch(/annotations\.0\./);
  });

  it("an annotations.json that is not JSON has no em dash", async () => {
    await writeFlow("ok", GOOD_FLOW);
    await fs.mkdir(path.join(ws, "docs", "ok"), { recursive: true });
    expect(await main(["baseline", ws])).toBe(0);
    await fs.writeFile(path.join(ws, "docs", "ok", "annotations.json"), "{{");
    expect(await main(["diff", ws])).toBe(1);
    expect(err).toContain("docs/ok/annotations.json: not valid JSON: ");
    expect(err).not.toContain("—");
  });
});

describe("an `extends` target that does not exist", () => {
  beforeEach(async () => {
    await writeFlow(
      "kid",
      "name: kid\nextends: ghost\nsteps:\n  - id: b\n    action: navigate\n    value: /x\n",
    );
  });

  it.each([["run"], ["export adf"], ["export playwright"], ["diagnose"]])(
    "%s names the flow that extends it and the file that is missing",
    async (label) => {
      const argv =
        label === "diagnose"
          ? ["diagnose", ws, "--flow", "kid", "--step", "b"]
          : label === "run"
            ? ["run", ws]
            : [...label.split(" "), ws];
      expect(await main(argv)).toBe(1);
      expect(err).toMatch(/flow "kid".*"ghost".*ghost\.flow\.yaml/s);
      expect(err).not.toContain("ENOENT");
      expect(err).toContain("next: ");
    },
  );

  it("lint reports it as a finding and flow-tree as an orphan", async () => {
    expect(await main(["lint", ws])).toBe(1);
    expect(out).toContain("`extends: ghost` names a flow that doesn't exist");
  });
});

describe("lint and flow-tree parse errors", () => {
  it.each([["lint"], ["flow-tree"]])("%s names the file once", async (cmd) => {
    const file = await writeFlow("bad", "name: bad\nsteps:\n  - id: a\n    action: teleport\n");
    expect(await main([cmd, ws])).toBe(1);
    expect(err).toContain(`${cmd}: ${file}: invalid flow-file:`);
    expect(err).not.toContain("parse error in");
    expect(err.split("bad.flow.yaml").length).toBe(2);
  });
});

describe("run with a flow that does not exist", () => {
  it("ends with the command that lists or creates flows", async () => {
    expect(await main(["run", ws, "--flow", "nope"])).toBe(1);
    expect(err).toContain('run: no flow named "nope" (flows: none)');
    expect(err).toContain(`next: docsxai calibrate ${ws} --from <flow.yaml>`);
    err = "";
    await writeFlow("ok", GOOD_FLOW);
    expect(await main(["run", ws, "--flow", "nope"])).toBe(1);
    expect(err).toContain('run: no flow named "nope" (flows: ok)');
    expect(err).toContain(`next: docsxai flow-tree ${ws}`);
  });
});

describe("diagnose with a step that does not exist", () => {
  it("lists the steps and ends with a command", async () => {
    await writeFlow("ok", GOOD_FLOW);
    expect(await main(["diagnose", ws, "--flow", "ok", "--step", "zz"])).toBe(1);
    expect(err).toContain('diagnose: no step "zz" in flow "ok" (steps: a)');
    expect(err).toContain(`next: docsxai diagnose ${ws} --flow ok --step <step-id>`);
  });
});

describe("plugins", () => {
  it("an unknown subcommand prints one line and the usage line, not the whole help", async () => {
    expect(await main(["plugins", ws])).toBe(2);
    expect(err).toContain(`plugins: unknown subcommand "${ws}"`);
    expect(err).toContain("usage: docsxai plugins <list|info|sync> <workspace-dir>");
    expect(err).not.toContain("Notes:");
    expect(err.split("\n").length).toBeLessThan(6);
  });

  it("no subcommand is a usage error with the usage line", async () => {
    expect(await main(["plugins"])).toBe(2);
    expect(err).toContain("usage: docsxai plugins <list|info|sync> <workspace-dir>");
    expect(err).not.toContain("Notes:");
  });

  it("--format names the value it got", async () => {
    expect(await main(["plugins", "list", ws, "--format", "xml"])).toBe(2);
    expect(err).toContain('plugins list: --format must be "text" or "json" (got "xml")');
  });
});

describe("inspect page-load failure", () => {
  it("explains a refused connection the way a halt does", () => {
    const why = describePageLoad(
      "page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/\nCall log:\n  - navigating",
      "http://localhost:3000",
    );
    expect(why).toBe(
      "could not load http://localhost:3000 (net::ERR_CONNECTION_REFUSED): the app did not answer; start it, or fix --url or app_url in .docsxai.json",
    );
  });

  it("drops Playwright's prefix and repeated URL for any other error", () => {
    const why = describePageLoad(
      "page.goto: net::ERR_UNSAFE_PORT at http://localhost:1/\nCall log:\n  - x",
      "http://localhost:1",
    );
    expect(why).toBe(
      "could not load http://localhost:1: net::ERR_UNSAFE_PORT; is the app running?",
    );
  });

  it("never prints user:password from the url", () => {
    const why = describePageLoad(
      "page.goto: net::ERR_FAILED",
      `http://u:${"pass" + "word"}@host:81/p?q=1`,
    );
    expect(why).not.toContain("password");
    expect(why).toContain("http://host:81/p");
  });
});

describe("capture-auth with a descriptor it cannot use", () => {
  const strategy = (body: string) =>
    `schema: docsxai/auth-strategy@1\ndefault_role: editor\nroles:\n  editor:\n    strategy: manual-capture\n${body}`;

  it("missing credential env vars end with the command to run once they are set", async () => {
    await fs.writeFile(
      path.join(ws, "auth", "strategy.yaml"),
      strategy(
        "    creds_env:\n      username: DOCSX_TEST_AUDIT_USER\n      password: DOCSX_TEST_AUDIT_PASS\n",
      ),
    );
    delete process.env.DOCSX_TEST_AUDIT_USER;
    delete process.env.DOCSX_TEST_AUDIT_PASS;
    expect(await main(["capture-auth", ws])).toBe(1);
    expect(err).toContain("capture-auth: missing credential env vars");
    expect(err).toContain("username → $DOCSX_TEST_AUDIT_USER");
    expect(err).toContain(
      `next: export the variables named above, then docsxai capture-auth ${ws}`,
    );
  });

  it("an invalid descriptor ends with the file to fix", async () => {
    const file = path.join(ws, "auth", "strategy.yaml");
    await fs.writeFile(file, strategy("    bogus_key: 1\n"));
    expect(await main(["capture-auth", ws])).toBe(1);
    expect(err).toContain(`next: fix ${file}, then docsxai capture-auth ${ws}`);
  });
});

describe("runtime notes on stderr", () => {
  const FLOW = `name: f
locators:
  b: "#b"
steps:
  - id: go
    action: navigate
    value: /
  - id: maybe
    action: click
    target: $b
    optional: true
  - id: boom
    action: click
    target: "#boom"
`;

  it("a skipped optional step is one 'run:' line with no call log and no em dash", async () => {
    const driver = new RecordingDriver();
    driver.failClicks.add("#b");
    driver.failClicks.add("#boom");
    await expect(runFlow(parseFlowFile(FLOW), driver, { captureDocs: false })).rejects.toThrow();
    expect(err).toContain('run: optional step "maybe" (click) skipped: element is not visible: #b');
    expect(err).not.toContain("runFlow:");
    expect(err).not.toContain("—");
  });

  it("a driver that rejects with a string halts with that string, not 'undefined'", async () => {
    const driver = new RecordingDriver();
    // A driver (or a plugin) can reject with a bare string; the halt text must still carry it.
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    driver.click = () => Promise.reject("socket closed");
    const flow = parseFlowFile(FLOW.replace("    optional: true\n", ""));
    await expect(runFlow(flow, driver, { captureDocs: false })).rejects.toThrow(
      /failed at \S+: socket closed/,
    );
  });
});
