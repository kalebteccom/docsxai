// Session table for the Streamable HTTP transport. One MCP server instance and one SDK transport
// per client session, capped in number and closed after an idle period. Every session serves the
// same tool registry the stdio entry point serves; this file only routes requests to it.

import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

export interface SessionRegistryOptions {
  maxSessions: number;
  /** A session with no request for this long is closed. A POST still in flight keeps it alive. */
  idleTimeoutMs: number;
  createServer: () => McpServer;
}

interface Entry {
  id?: string;
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  inFlight: number;
  timer?: NodeJS.Timeout;
}

export class SessionRegistry {
  private readonly entries = new Map<string, Entry>();
  /** Initialize requests admitted but not yet registered, so a burst cannot overshoot the cap. */
  private reserved = 0;

  constructor(private readonly opts: SessionRegistryOptions) {}

  get size(): number {
    return this.entries.size;
  }

  /** Route a request to an existing session. Returns false when the id is unknown. */
  async handleExisting(
    id: string,
    req: IncomingMessage,
    res: ServerResponse,
    body: unknown,
  ): Promise<boolean> {
    const entry = this.entries.get(id);
    if (!entry) return false;
    const counted = req.method === "POST";
    if (counted) entry.inFlight++;
    this.touch(entry);
    try {
      await entry.transport.handleRequest(req, res, body);
    } finally {
      if (counted) entry.inFlight--;
      this.touch(entry);
    }
    return true;
  }

  /** Open a session for an initialize request. Returns false when the session cap is reached. */
  async handleInitialize(
    req: IncomingMessage,
    res: ServerResponse,
    body: unknown,
  ): Promise<boolean> {
    if (this.entries.size + this.reserved >= this.opts.maxSessions) return false;
    this.reserved++;
    let held = true;
    const release = (): void => {
      if (held) {
        held = false;
        this.reserved--;
      }
    };
    const server = this.opts.createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        entry.id = id;
        this.entries.set(id, entry);
        release();
        this.touch(entry);
      },
    });
    const entry: Entry = { server, transport, inFlight: 0 };
    server.server.onclose = () => this.drop(entry);
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } finally {
      release();
      // An initialize the transport rejected never got an id; close what it left behind.
      if (!entry.id) await server.close().catch(() => undefined);
    }
    return true;
  }

  async closeAll(): Promise<void> {
    await Promise.allSettled([...this.entries.values()].map((e) => e.server.close()));
  }

  private drop(entry: Entry): void {
    clearTimeout(entry.timer);
    if (entry.id) this.entries.delete(entry.id);
  }

  private touch(entry: Entry): void {
    if (!entry.id || !this.entries.has(entry.id)) return;
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      if (entry.inFlight > 0) this.touch(entry);
      else void entry.server.close().catch(() => undefined);
    }, this.opts.idleTimeoutMs);
    entry.timer.unref();
  }
}
