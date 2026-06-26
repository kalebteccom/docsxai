// Confluence Cloud REST v2 transport — the provider-neutral half of the egress path.
//
// A thin `fetch`-only client over the v2 API: page CRUD, content-properties, and multipart
// attachment uploads, plus the wire DTOs they exchange. It carries no docsxai semantics —
// the push orchestration (idempotency, doc-pack mapping) lives in publisher.ts and drives
// this client. The API token is masked via the `mask` callback the constructor receives, so
// every error line this module produces is scrubbed before it surfaces.

import { type AdfDoc } from "@docsxai/engine";

// ---------------------------------------------------------------------------
// REST v2 wire DTOs
// ---------------------------------------------------------------------------

export interface V2Page {
  id: string;
  title: string;
  version: { number: number };
  _links?: { webui?: string };
}

export interface V2Property {
  id: string;
  key: string;
  value: unknown;
  version: { number: number };
}

export interface V2Attachment {
  id: string;
  title: string;
  comment?: string;
  fileId?: string;
}

// ---------------------------------------------------------------------------
// REST v2 client (built-in fetch only)
// ---------------------------------------------------------------------------

export class ConfluenceClient {
  private readonly authHeader: string;
  constructor(
    private readonly baseUrl: string,
    email: string,
    token: string,
    private readonly mask: (s: string) => string,
  ) {
    this.authHeader = `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`;
  }

  private async request<T>(
    method: string,
    apiPath: string,
    body?: string | FormData,
    contentType?: string,
  ): Promise<T> {
    const url = `${this.baseUrl}${apiPath}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          authorization: this.authHeader,
          accept: "application/json",
          ...(contentType ? { "content-type": contentType } : {}),
          ...(method !== "GET" ? { "x-atlassian-token": "nocheck" } : {}),
        },
        ...(body !== undefined ? { body } : {}),
      });
    } catch (e) {
      throw new Error(
        this.mask(`confluence: ${method} ${apiPath} failed: ${(e as Error).message}`),
      );
    }
    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        this.mask(`confluence: ${method} ${apiPath} → HTTP ${res.status}: ${text.slice(0, 500)}`),
      );
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  private json<T>(method: string, apiPath: string, payload: unknown): Promise<T> {
    return this.request<T>(method, apiPath, JSON.stringify(payload), "application/json");
  }

  getPage(id: string): Promise<V2Page> {
    return this.request<V2Page>("GET", `/wiki/api/v2/pages/${id}`);
  }

  createPage(opts: {
    spaceId: string;
    title: string;
    parentId?: string;
    adf: AdfDoc;
  }): Promise<V2Page> {
    return this.json<V2Page>("POST", "/wiki/api/v2/pages", {
      spaceId: opts.spaceId,
      status: "current",
      title: opts.title,
      ...(opts.parentId ? { parentId: opts.parentId } : {}),
      body: { representation: "atlas_doc_format", value: JSON.stringify(opts.adf) },
    });
  }

  updatePage(opts: { id: string; title: string; version: number; adf: AdfDoc }): Promise<V2Page> {
    return this.json<V2Page>("PUT", `/wiki/api/v2/pages/${opts.id}`, {
      id: opts.id,
      status: "current",
      title: opts.title,
      version: { number: opts.version },
      body: { representation: "atlas_doc_format", value: JSON.stringify(opts.adf) },
    });
  }

  async getContentProperty(pageId: string, key: string): Promise<V2Property | null> {
    const res = await this.request<{ results: V2Property[] }>(
      "GET",
      `/wiki/api/v2/pages/${pageId}/properties?key=${encodeURIComponent(key)}`,
    );
    return res.results.find((p) => p.key === key) ?? null;
  }

  createContentProperty(pageId: string, key: string, value: unknown): Promise<V2Property> {
    return this.json<V2Property>("POST", `/wiki/api/v2/pages/${pageId}/properties`, {
      key,
      value,
    });
  }

  updateContentProperty(pageId: string, property: V2Property, value: unknown): Promise<V2Property> {
    return this.json<V2Property>("PUT", `/wiki/api/v2/pages/${pageId}/properties/${property.id}`, {
      key: property.key,
      value,
      version: { number: property.version.number + 1 },
    });
  }

  async listAttachments(pageId: string): Promise<V2Attachment[]> {
    const res = await this.request<{ results: V2Attachment[] }>(
      "GET",
      `/wiki/api/v2/pages/${pageId}/attachments`,
    );
    return res.results;
  }

  /** Multipart upload; `comment` carries the sha marker the skip-unchanged check reads back. */
  async uploadAttachment(opts: {
    pageId: string;
    fileName: string;
    data: Uint8Array;
    comment: string;
  }): Promise<V2Attachment> {
    const form = new FormData();
    form.append("file", new Blob([opts.data], { type: "image/png" }), opts.fileName);
    form.append("comment", opts.comment);
    form.append("minorEdit", "true");
    const res = await this.request<{ results: V2Attachment[] } | V2Attachment>(
      "POST",
      `/wiki/api/v2/pages/${opts.pageId}/attachments`,
      form,
    );
    return "results" in res ? res.results[0]! : res;
  }
}
