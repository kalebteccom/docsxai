// node --test scripts/release-approve.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findStage, main, parseArgs, parsePackages, readPackages } from "./release-approve.mjs";

const PACKAGES = [
  "@docsxai/engine",
  "@docsxai/viewer",
  "docsxai",
  "@docsxai/plugin",
  "@docsxai/plugin-sharepoint",
  "@docsxai/skill",
  "@docsxai/backend",
];
const VERSION = "0.3.0-rc.4";
const TAG = `v${VERSION}`;

/** A fake npm. `stages[pkg]` is the `npm stage list` answer; `live` holds approved packages. */
function fakeNpm({ stages = {}, live = new Set(), failApprove = null } = {}) {
  const calls = [];
  const idOf = (pkg) => `st-${pkg.replace(/\W/g, "")}`;
  const defaults = Object.fromEntries(
    PACKAGES.map((p) => [p, [{ id: idOf(p), version: VERSION, tag: "next", status: "ready" }]]),
  );
  const run = (cmd, args, env = {}) => {
    calls.push({ cmd, args, env });
    const [a, b, c] = args;
    if (a === "stage" && b === "list") {
      return { status: 0, stdout: JSON.stringify((stages[c] ?? defaults[c]) || []), stderr: "" };
    }
    if (a === "stage" && b === "approve") {
      if (c === failApprove) return { status: 1, stdout: "", stderr: `EOTP ${env.NPM_CONFIG_OTP}` };
      const pkg = PACKAGES.find((p) => idOf(p) === c);
      live.add(pkg);
      return { status: 0, stdout: "", stderr: "" };
    }
    if (a === "view" && args[2] === "version") {
      const pkg = b.slice(0, b.lastIndexOf("@"));
      return live.has(pkg)
        ? { status: 0, stdout: `${VERSION}\n`, stderr: "" }
        : { status: 1, stdout: "", stderr: "E404" };
    }
    if (a === "view" && args[2] === "dist-tags") {
      return { status: 0, stdout: JSON.stringify({ latest: "0.2.0", next: VERSION }), stderr: "" };
    }
    return { status: 1, stdout: "", stderr: "unexpected" };
  };
  return { run, calls, idOf, live };
}

function harness(npm, extra = {}) {
  const lines = [];
  const errs = [];
  return {
    lines,
    errs,
    deps: {
      env: {},
      packages: PACKAGES,
      run: npm.run,
      out: (s) => lines.push(s),
      err: (s) => errs.push(s),
      isTTY: false,
      ...extra,
    },
  };
}

test("the package list is read from release-publish.sh, in publish order", () => {
  assert.deepEqual(readPackages(), PACKAGES);
  const script = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "release-publish.sh"),
    "utf8",
  );
  assert.deepEqual(parsePackages(script), PACKAGES);
  assert.throws(() => parsePackages("echo nothing"), /no packages/);
});

test("arguments: tag from argv or RELEASE_TAG, prerelease means next, --otp needs --approve", () => {
  assert.equal(parseArgs([TAG]).distTag, "next");
  assert.equal(parseArgs([], { RELEASE_TAG: "v1.2.3" }).distTag, "latest");
  assert.equal(parseArgs([TAG, "--approve", "--otp", "123456"]).otps[0], "123456");
  assert.throws(() => parseArgs([]), /not vX\.Y\.Z/);
  assert.throws(() => parseArgs([TAG, "--otp", "123456"]), /--approve/);
  assert.throws(() => parseArgs([TAG, "--approve", "--otp", "abc"]), /digit/);
  assert.throws(() => parseArgs([TAG, "--approve", "--dry-run"]), /exclude/);
});

test("findStage matches version and tag and reports missing, duplicated and wrong-tag", () => {
  const e = (o) => ({ id: "s1", version: VERSION, tag: "next", status: "ready", ...o });
  assert.deepEqual(findStage([e()], VERSION, "next"), { id: "s1", status: "ready" });
  assert.deepEqual(
    findStage({ stages: [e({ status: "Validating" })] }, VERSION, "next").status,
    "validating",
  );
  assert.equal(findStage([e({ version: "0.3.0-rc.3" })], VERSION, "next").problem, "missing");
  assert.match(findStage([e({ tag: "latest" })], VERSION, "next").problem, /wrong tag/);
  assert.match(findStage([e(), e({ id: "s2" })], VERSION, "next").problem, /duplicated/);
});

test("dry run prints the table and the approve commands in order, and approves nothing", async () => {
  const npm = fakeNpm();
  const h = harness(npm);
  assert.equal(await main([TAG], h.deps), 0);
  const text = h.lines.join("\n");
  const cmds = h.lines.filter((l) => l.startsWith("npm stage approve"));
  assert.equal(cmds.length, 7);
  PACKAGES.forEach((p, i) => assert.ok(cmds[i].includes(npm.idOf(p)), cmds[i]));
  assert.ok(cmds.every((c) => c.includes("--otp <code>")));
  assert.match(text, /package\s+version\s+stage id\s+status/);
  assert.equal(npm.calls.filter((c) => c.args[1] === "approve").length, 0);
});

test("refuses on a missing, duplicated or validating stage, saying to wait and rerun", async () => {
  const ready = { version: VERSION, tag: "next", status: "ready" };
  for (const [stages, message] of [
    [{ docsxai: [] }, /refusing/],
    [
      {
        docsxai: [
          { id: "a", ...ready },
          { id: "b", ...ready },
        ],
      },
      /refusing/,
    ],
    [{ docsxai: [{ id: "a", ...ready, status: "validating" }] }, /wait and rerun/],
  ]) {
    const npm = fakeNpm({ stages });
    const h = harness(npm, { isTTY: true, prompt: async () => "123456" });
    assert.equal(await main([TAG, "--approve"], h.deps), 1);
    assert.match(h.errs.join("\n"), message);
    assert.equal(npm.calls.filter((c) => c.args[1] === "approve").length, 0);
  }
});

test("--approve without a code or a terminal does nothing", async () => {
  const npm = fakeNpm();
  const h = harness(npm);
  assert.equal(await main([TAG, "--approve"], h.deps), 1);
  assert.equal(npm.calls.filter((c) => c.args[1] === "approve").length, 0);
});

test("--approve prompts per package, keeps the code off argv and verifies at the end", async () => {
  const npm = fakeNpm();
  let n = 0;
  const h = harness(npm, { isTTY: true, prompt: async () => String(100000 + ++n) });
  assert.equal(await main([TAG, "--approve"], h.deps), 0);
  const approves = npm.calls.filter((c) => c.args[1] === "approve");
  assert.equal(approves.length, 7);
  approves.forEach((c, i) => {
    assert.equal(c.env.NPM_CONFIG_OTP, String(100001 + i));
    assert.ok(!c.args.some((a) => /\d{6}/.test(a) || a === "--otp"), c.args.join(" "));
  });
  assert.match(h.lines.join("\n"), /All packages are live/);
});

test("--otp codes are used in order; the last one is reused when there are fewer", async () => {
  const npm = fakeNpm();
  const h = harness(npm);
  assert.equal(await main([TAG, "--approve", "--otp", "111111", "--otp", "222222"], h.deps), 0);
  const codes = npm.calls.filter((c) => c.args[1] === "approve").map((c) => c.env.NPM_CONFIG_OTP);
  assert.deepEqual(codes, ["111111", "222222", "222222", "222222", "222222", "222222", "222222"]);
});

test("stops at the first failed approve and prints what is live and what is staged", async () => {
  const probe = fakeNpm();
  const npm = fakeNpm({ failApprove: probe.idOf("@docsxai/plugin") });
  const h = harness(npm);
  assert.equal(await main([TAG, "--approve", "--otp", "111111"], h.deps), 1);
  assert.equal(npm.calls.filter((c) => c.args[1] === "approve").length, 4);
  const text = h.lines.join("\n");
  assert.match(text, /Live: @docsxai\/engine, @docsxai\/viewer, docsxai/);
  assert.match(text, /Still staged: @docsxai\/plugin, @docsxai\/plugin-sharepoint/);
  assert.ok(!h.errs.join("\n").includes("111111"), "the code is masked in npm output");
});

test("a rerun skips packages that are already live", async () => {
  const npm = fakeNpm({
    live: new Set(["@docsxai/engine", "@docsxai/viewer"]),
    stages: { "@docsxai/engine": [], "@docsxai/viewer": [] },
  });
  const h = harness(npm);
  assert.equal(await main([TAG, "--approve", "--otp", "111111"], h.deps), 0);
  assert.equal(npm.calls.filter((c) => c.args[1] === "approve").length, 5);
  assert.match(h.lines.join("\n"), /already live/);
});
