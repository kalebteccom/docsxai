// path-scrub: over HTTP an error never quotes a path outside the workspace root.

import { describe, expect, it } from "vitest";
import { fail, ok } from "../src/shared.js";
import { scrubOutsideRoot, scrubResult } from "../src/path-scrub.js";

const root = "/srv/docsxai-root";

describe("scrubOutsideRoot", () => {
  it("replaces a path outside the root", () => {
    const text =
      "ENOENT: no such file or directory, open '/Users/alice/.cache/ms-playwright/chrome'";
    expect(scrubOutsideRoot(text, root)).toBe("ENOENT: no such file or directory, open '<path>'");
  });

  it("replaces a bare top-level directory and any other absolute path", () => {
    expect(scrubOutsideRoot("cwd is /tmp", root)).toBe("cwd is <path>");
    expect(scrubOutsideRoot("read /Library/Caches/x and /data/y/z", root)).toBe(
      "read <path> and <path>",
    );
    expect(scrubOutsideRoot("a /tmp/x/y then /var/log/z", root)).toBe("a <path> then <path>");
  });

  it("makes a path inside the root root-relative, and the root itself a dot", () => {
    const text = `no flows directory at ${root}/ws/flows (workspace ${root})`;
    expect(scrubOutsideRoot(text, root)).toBe("no flows directory at ws/flows (workspace .)");
  });

  it("keeps an inside path absolute when asked to", () => {
    expect(scrubOutsideRoot(`${root}/ws`, root, false)).toBe(`${root}/ws`);
  });

  it("replaces a sibling that only shares the root's name as a prefix", () => {
    expect(scrubOutsideRoot(`open ${root}-evil/ws/x.yaml`, root)).toBe("open <path>");
  });

  it("resolves .. before deciding, so a traversal out of the root is outside", () => {
    expect(scrubOutsideRoot(`open ${root}/../../etc/passwd`, root)).toBe("open <path>");
    expect(scrubOutsideRoot(`open ${root}/ws/../other/x.yaml`, root)).toBe("open other/x.yaml");
    expect(scrubOutsideRoot(`open '${root}/ws/../../etc/passwd'`, root)).toBe("open '<path>'");
  });

  it("replaces file URLs, with a drive letter or without", () => {
    expect(scrubOutsideRoot("loaded file:///Users/x/app/plugin.js failed", root)).toBe(
      "loaded <path> failed",
    );
    expect(scrubOutsideRoot("loaded file:///C:/Users/x/plugin.js", root)).toBe("loaded <path>");
    expect(scrubOutsideRoot(`loaded file://${root}/ws/a.js`, root)).toBe("loaded ws/a.js");
  });

  it("replaces drive-letter and UNC paths", () => {
    expect(scrubOutsideRoot("cannot read C:\\Users\\bob\\token.txt", root)).toBe(
      "cannot read <path>",
    );
    expect(scrubOutsideRoot("cannot read D:/data/x.json.", root)).toBe("cannot read <path>.");
    expect(scrubOutsideRoot("cannot read \\\\fileserver\\share\\docs\\x.md", root)).toBe(
      "cannot read <path>",
    );
  });

  it("replaces a path that follows a colon, a quote or a parenthesis", () => {
    expect(scrubOutsideRoot("error:/home/svc/x", root)).toBe("error:<path>");
    expect(scrubOutsideRoot("at run (/home/svc/app/dist/x.js:10:5)", root)).toBe("at run (<path>)");
    expect(scrubOutsideRoot('path="/opt/tool/bin"', root)).toBe('path="<path>"');
  });

  it("replaces a quoted path with spaces whole", () => {
    expect(scrubOutsideRoot("open '/Users/me/My Docs/x y.txt' failed", root)).toBe(
      "open '<path>' failed",
    );
    expect(scrubOutsideRoot('open "C:\\Program Files\\Tool\\a.exe" failed', root)).toBe(
      'open "<path>" failed',
    );
    expect(scrubOutsideRoot("loaded (/Users/me/My Docs/x.js:1:2)", root)).toBe("loaded (<path>)");
  });

  it("leaves URLs, routes and relative paths alone", () => {
    for (const text of [
      "cannot reach https://example.com/var/tmp/x",
      "cannot reach http://localhost:8765/mcp",
      "POST /v1/workspaces -> 401: no",
      "no flow-files in docs/recap-open/halts and flows/a.flow.yaml",
      "read ./flows/a.flow.yaml and ../docs/x",
      "tool is not available over the HTTP transport",
    ]) {
      expect(scrubOutsideRoot(text, root)).toBe(text);
    }
  });
});

describe("scrubResult", () => {
  it("scrubs the text fields of a failure", () => {
    const r = scrubResult(fail("failed at /opt/tool/bin/x", "see /etc/hosts"), root);
    expect(r).toEqual({ ok: false, error: "failed at <path>", hint: "see <path>" });
  });

  it("scrubs error text nested in a successful result and leaves content alone", () => {
    const r = scrubResult(
      ok({
        flows: [{ flow: "a", ok: false, error: "launch failed: /Users/x/browsers/chrome" }],
        annotations: [{ copy: "Open /Users/x/notes in the sidebar", selector: "/html/body/div" }],
        workspace: `${root}/ws`,
      }),
      root,
    );
    expect(r).toEqual({
      ok: true,
      flows: [{ flow: "a", ok: false, error: "launch failed: <path>" }],
      annotations: [{ copy: "Open /Users/x/notes in the sidebar", selector: "/html/body/div" }],
      workspace: `${root}/ws`,
    });
  });

  it("scrubs a plugin source that is a path, lint messages and recommendation text", () => {
    const r = scrubResult(
      ok({
        plugins: [
          { name: "a", source: "path:/Users/x/plugins/a", statusReason: "cannot load /Users/x/a" },
          { name: "b", source: "package:@scope/b" },
          { name: "c", source: `path:${root}/ws/plugins/c` },
        ],
        issues: [{ message: "see /home/x/y", suggestion: "move /home/x/y to ws" }],
        report: { recommendations: [{ rationale: "kept /var/z" }] },
      }),
      root,
    );
    expect(r).toEqual({
      ok: true,
      plugins: [
        { name: "a", source: "path:<path>", statusReason: "cannot load <path>" },
        { name: "b", source: "package:@scope/b" },
        { name: "c", source: `path:${root}/ws/plugins/c` },
      ],
      issues: [{ message: "see <path>", suggestion: "move <path> to ws" }],
      report: { recommendations: [{ rationale: "kept <path>" }] },
    });
  });
});
