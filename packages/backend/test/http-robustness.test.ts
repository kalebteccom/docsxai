import * as fs from "node:fs";
import * as http from "node:http";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JSON_BODY_LIMIT_BYTES } from "../src/api.js";
import { createBackendStub } from "../src/index.js";

const TOKEN = "test-token";
let base = "";
let stub: ReturnType<typeof createBackendStub>;

const h = (extra: Record<string, string> = {}) => ({
  authorization: `Bearer ${TOKEN}`,
  ...extra,
});

beforeAll(async () => {
  stub = createBackendStub({ token: TOKEN });
  base = await stub.listen(0);
});
afterAll(async () => {
  await stub.close();
});

describe("request path handling", () => {
  it("400s a malformed percent-encoding in the path", async () => {
    const r = await fetch(`${base}/v1/workspaces/%E0%A4%A`, { headers: h() });
    expect(r.status).toBe(400);
    expect(r.headers.get("content-type")).toContain("application/json");
    expect(((await r.json()) as { error: string }).error).toBe("bad_request");
  });
});

/** Send a raw request line so the target reaches the server unparsed by a client library. */
function rawGet(target: string): Promise<{ status: number; body: string }> {
  const port = Number(new URL(base).port);
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.write(
        `GET ${target} HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer ${TOKEN}\r\nConnection: close\r\n\r\n`,
      );
    });
    let raw = "";
    socket.on("data", (d) => (raw += String(d)));
    socket.on("error", reject);
    socket.on("close", () =>
      resolve({
        status: Number(/^HTTP\/1\.1 (\d+)/.exec(raw)?.[1]),
        body: raw.split("\r\n\r\n").slice(1).join("\r\n\r\n"),
      }),
    );
  });
}

describe("request targets the URL parser rejects", () => {
  it.each(["//", "//[", "http://[::1/x"])(
    "400s %s with a JSON error, not a 500",
    async (target) => {
      const r = await rawGet(target);
      expect(r.status).toBe(400);
      expect(r.body).toContain('"error": "bad_request"');
    },
  );
});

describe("HEAD on the liveness probe", () => {
  it("answers 200 with no body and no credentials", async () => {
    const r = await fetch(`${base}/v1/health`, { method: "HEAD" });
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("");
  });

  it("keeps HEAD a 405 on the other GET routes", async () => {
    const r = await fetch(`${base}/v1/workspaces`, { method: "HEAD", headers: h() });
    expect(r.status).toBe(405);
  });
});

describe("405 responses", () => {
  it("list the served methods in Allow", async () => {
    const del = await fetch(`${base}/v1/workspaces`, { method: "DELETE", headers: h() });
    expect(del.status).toBe(405);
    expect(del.headers.get("allow")).toBe("GET, POST");

    const opt = await fetch(`${base}/v1/workspaces/w/auth-cache/r`, {
      method: "OPTIONS",
      headers: h(),
    });
    expect(opt.status).toBe(405);
    expect(opt.headers.get("allow")).toBe("DELETE, GET, PUT");
  });
});

/** POST a body of `mib` one-MiB spaces with chunked transfer encoding (no Content-Length). */
function postChunked(urlPath: string, mib: number): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${base}${urlPath}`,
      { method: "POST", headers: h({ "transfer-encoding": "chunked" }) },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (d: string) => {
          body += d;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    const chunk = Buffer.alloc(1024 * 1024, 0x20);
    for (let i = 0; i < mib; i++) req.write(chunk);
    req.end();
  });
}

describe("body limits on chunked uploads", () => {
  it("413s with the JSON error body", async () => {
    const mib = JSON_BODY_LIMIT_BYTES / (1024 * 1024) + 1;
    const r = await postChunked("/v1/workspaces", mib);
    expect(r.status).toBe(413);
    expect((JSON.parse(r.body) as { error: string }).error).toBe("payload_too_large");
  });
});

describe("400 versus 500 for bad input and damaged data", () => {
  const post = (body: string) =>
    fetch(`${base}/v1/workspaces`, {
      method: "POST",
      headers: h({ "content-type": "application/json" }),
      body,
    });

  it("names the missing field in the 400 message", async () => {
    const r = await post("{}");
    expect(r.status).toBe(400);
    expect(((await r.json()) as { message: string }).message).toBe(
      "body requires a non-empty { name }",
    );
  });

  it("still reports unparsable JSON as a 400", async () => {
    const r = await post("{");
    expect(r.status).toBe(400);
    expect(((await r.json()) as { message: string }).message).toMatch(/^invalid JSON body:/);
  });

  it("answers 500, not 400, when a stored data file is damaged", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docsxai-damaged-"));
    fs.writeFileSync(path.join(dir, "workspaces.json"), "");
    const fsStub = createBackendStub({ token: TOKEN, dataDir: dir });
    try {
      const url = await fsStub.listen(0);
      const r = await fetch(`${url}/v1/workspaces`, { headers: h() });
      expect(r.status).toBe(500);
      expect(((await r.json()) as { message: string }).message).toContain("workspaces.json");
    } finally {
      await fsStub.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
