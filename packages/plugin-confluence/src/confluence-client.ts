// Confluence Cloud REST transport — the provider-neutral half of the egress path.
//
// A thin `fetch`-only client: v2 page CRUD, content-properties and attachment listing, plus
// attachment uploads on the v1 `child/attachment` resource (Confluence Cloud answers 405 to a
// v2 attachment POST), and the wire DTOs they exchange. It carries no docsxai semantics —
// the push orchestration (idempotency, doc-pack mapping) lives in publisher.ts and drives
// this client. The API token is masked via the `mask` callback the constructor receives, so
// every error line this module produces is scrubbed before it surfaces.

import { type AdfDoc } from "@docsxai/engine";

// ---------------------------------------------------------------------------
// REST wire DTOs
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

/** v1 attachment content object, as returned by `child/attachment` and `.../data`. */
interface V1Attachment {
  id: string;
  title: string;
  extensions?: { comment?: string; fileId?: string };
  metadata?: { comment?: string };
}

function fromV1(att: V1Attachment): V2Attachment {
  const comment = att.extensions?.comment ?? att.metadata?.comment;
  const fileId = att.extensions?.fileId;
  return {
    id: att.id,
    title: att.title,
    ...(comment !== undefined ? { comment } : {}),
    ...(fileId !== undefined ? { fileId } : {}),
  };
}

// ---------------------------------------------------------------------------
// REST client (built-in fetch only)
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
          ...(method !== "GET" ? { "x-atlassian-token": "no-check" } : {}),
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
      `/wiki/api/v2/pages/${pageId}/attachments?limit=250`,
    );
    return res.results;
  }

  /**
   * Multipart upload on the v1 resource; `comment` carries the sha marker the skip-unchanged
   * check reads back. With `existingId` the bytes become a new version of that attachment
   * (`.../{id}/data`), because v1 refuses a second attachment with the same file name.
   */
  async uploadAttachment(opts: {
    pageId: string;
    fileName: string;
    data: Uint8Array;
    comment: string;
    existingId?: string;
  }): Promise<V2Attachment> {
    const form = new FormData();
    form.append("file", new Blob([opts.data], { type: "image/png" }), opts.fileName);
    form.append("comment", opts.comment);
    form.append("minorEdit", "true");
    const base = `/wiki/rest/api/content/${opts.pageId}/child/attachment`;
    const res = await this.request<{ results: V1Attachment[] } | V1Attachment>(
      "POST",
      opts.existingId ? `${base}/${opts.existingId}/data` : base,
      form,
    );
    const att = "results" in res ? res.results[0] : res;
    if (!att) {
      throw new Error(
        this.mask(`confluence: attachment upload for ${opts.fileName} returned no attachment`),
      );
    }
    return fromV1(att);
  }
}
