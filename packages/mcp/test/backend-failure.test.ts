// backend_failure: the hint depends on what went wrong, and nothing in the result echoes a URL.

import { BackendClientError } from "@docsxai/engine";
import { describe, expect, it } from "vitest";
import { backendFailure } from "../src/backend-failure.js";

describe("backendFailure", () => {
  it("tells a person to sign in after a 401 or 403", () => {
    for (const status of [401, 403]) {
      const r = backendFailure(new BackendClientError(`GET /v1/x -> ${status}: no`, status));
      expect(r?.hint).toContain("sign in");
      expect(r?.hint).toContain("docsxai login");
    }
  });

  it("tells a person to sign in when no token exists or the refresh failed", () => {
    expect(
      backendFailure(new BackendClientError("no bearer token - set DOCSX_TOKEN"))?.hint,
    ).toContain("sign in");
    expect(
      backendFailure(new BackendClientError("stored backend token expired and the refresh failed"))
        ?.hint,
    ).toContain("sign in");
  });

  it("points a 404 at the ids and the revision", () => {
    const r = backendFailure(new BackendClientError("GET /v1/x -> 404: gone", 404));
    expect(r?.hint).toContain("backend_project_id");
    expect(r?.hint).toContain("revision id");
  });

  it("calls a 5xx the backend's own failure", () => {
    expect(backendFailure(new BackendClientError("boom", 503))?.hint).toContain("its side");
  });

  it("names the network code and no URL for a refused connection", () => {
    const cause = Object.assign(new Error("connect"), { code: "ECONNREFUSED" });
    const e = new TypeError("fetch failed", { cause });
    const r = backendFailure(e);
    expect(r).toEqual({
      ok: false,
      error: "cannot reach the backend (ECONNREFUSED)",
      hint: "check backend_url in .docsxai.json and that the backend is running, then retry",
    });
  });

  it("ignores a cause code that is not a plain error code", () => {
    const cause = { code: "http://user" + ":secret@host/path" };
    const r = backendFailure(new TypeError("fetch failed", { cause }));
    expect(r?.error).toBe("cannot reach the backend");
  });

  it("over HTTP replaces the engine's text, which carries backend output, with a fixed sentence", () => {
    const http = { workspaceRoot: "/srv/root" };
    const body = "<html>internal host db-7.corp /etc/secret</html>";
    const cases: Array<[BackendClientError, string]> = [
      [
        new BackendClientError(`GET /v1/x -> 401: ${body}`, 401),
        "the server has no accepted backend credentials",
      ],
      [
        new BackendClientError(`no bearer token - set DOCSX_TOKEN`),
        "the server has no accepted backend credentials",
      ],
      [
        new BackendClientError(`GET /v1/x -> 404: ${body}`, 404),
        "the backend does not know that workspace, project or revision (HTTP 404)",
      ],
      [
        new BackendClientError(`GET /v1/x -> 503: ${body}`, 503),
        "the backend failed on its side (HTTP 503)",
      ],
      [
        new BackendClientError(`GET /v1/x -> 400: ${body}`, 400),
        "the backend request failed (HTTP 400)",
      ],
    ];
    for (const [e, error] of cases) {
      const r = backendFailure(e, http);
      expect(r?.error).toBe(error);
      expect(JSON.stringify(r)).not.toContain("db-7");
    }
  });

  it("returns undefined for an error that is not a backend failure", () => {
    expect(backendFailure(new Error("disk full"))).toBeUndefined();
    expect(backendFailure("text")).toBeUndefined();
  });
});
