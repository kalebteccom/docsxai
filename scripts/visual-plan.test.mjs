// node --test scripts/visual-plan.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SHOTS,
  candidateFiles,
  contentType,
  planCaptures,
  summaryMarkdown,
} from "./visual-plan.mjs";

test("every shot runs at both widths and schemes, mobile-only shots at 390 px only", () => {
  const plan = planCaptures();
  const mobileOnly = SHOTS.filter((s) => s.mobileOnly).length;
  assert.equal(plan.length, (SHOTS.length - mobileOnly) * 4 + mobileOnly * 2);
  assert.ok(plan.filter((p) => p.mobileOnly).every((p) => p.viewport.width === 390));
});

test("file names are unique, kebab-case and carry width and scheme", () => {
  const files = planCaptures().map((p) => p.file);
  assert.equal(new Set(files).size, files.length);
  for (const f of files)
    assert.match(f, /^(docs|viewer)\/[a-z0-9-]+--(390|1280)--(light|dark)\.png$/);
});

test("the plan covers the states the workflow promises", () => {
  const states = new Set(SHOTS.map((s) => `${s.surface}/${s.state}`));
  for (const s of [
    "docs/404",
    "docs/search-open",
    "docs/search-no-results",
    "docs/skip-link-followed",
    "docs/wide-table",
    "viewer/empty",
    "viewer/error",
    "viewer/focused-step",
  ])
    assert.ok(states.has(s), s);
});

test("candidateFiles maps directories to index.html and refuses to leave the root", () => {
  assert.deepEqual(candidateFiles("/"), ["index.html"]);
  assert.deepEqual(candidateFiles("/reference/flow-file/?q=1"), ["reference/flow-file/index.html"]);
  assert.deepEqual(candidateFiles("/a/b.png"), ["a/b.png", "a/b.png/index.html", "a/b.png.html"]);
  assert.equal(candidateFiles("/../etc/passwd"), null);
  assert.equal(candidateFiles("/a/%2e%2e/%2e%2e/x"), null);
  assert.equal(candidateFiles("/a%5c..%5cx"), null);
  assert.equal(candidateFiles("/%E0%A4%A"), null);
  assert.equal(candidateFiles("relative"), null);
});

test("contentType knows the site's asset types", () => {
  assert.equal(contentType("x/index.html"), "text/html; charset=utf-8");
  assert.equal(contentType("a.WOFF2"), "font/woff2");
  assert.equal(contentType("pagefind/wasm.en.pagefind"), "application/octet-stream");
});

test("summaryMarkdown lists files by surface and failures first", () => {
  const md = summaryMarkdown(
    [
      { surface: "docs", file: "docs/home--390--light.png" },
      { surface: "viewer", file: "viewer/error--390--dark.png", error: "Timeout\nstack" },
    ],
    "visual-captures",
  );
  assert.match(md, /1 screenshots in the `visual-captures` artifact/);
  assert.match(md, /1 captures failed:\n\n- `viewer\/error--390--dark.png`: Timeout\n/);
  assert.match(md, /<summary>docs \(1\)<\/summary>/);
  assert.doesNotMatch(md, /<summary>viewer/);
});
