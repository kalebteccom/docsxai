// Microsoft Graph transport for one SharePoint document library, `fetch` only.
//
// Two operations are enough for the publisher: read a file's content by path and upload a
// file by path (simple upload, `PUT .../root:/<path>:/content`). Graph creates missing parent
// folders on upload. The bearer token goes in the Authorization header and nowhere else; every
// error message passes through the `mask` callback before it leaves this module.

export const DEFAULT_GRAPH_URL = "https://graph.microsoft.com/v1.0";

export interface DriveItem {
  id: string;
  name?: string;
  size?: number;
  webUrl?: string;
}

export interface LibraryRef {
  /** `drives/{id}` for a library id, `sites/{id}/drive` for a site's default library. */
  root: string;
}

export class GraphClient {
  constructor(
    private readonly baseUrl: string,
    private readonly library: LibraryRef,
    private readonly token: string,
    private readonly mask: (s: string) => string,
  ) {}

  private itemUrl(itemPath: string): string {
    const encoded = itemPath.split("/").map(encodeURIComponent).join("/");
    return `${this.baseUrl}/${this.library.root}/root:/${encoded}:/content`;
  }

  private async send(
    method: "GET" | "PUT",
    itemPath: string,
    body?: { data: Uint8Array; contentType: string },
  ): Promise<Response> {
    const query = method === "PUT" ? "?@microsoft.graph.conflictBehavior=replace" : "";
    try {
      return await fetch(`${this.itemUrl(itemPath)}${query}`, {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          accept: "application/json",
          ...(body ? { "content-type": body.contentType } : {}),
        },
        ...(body ? { body: new Blob([body.data], { type: body.contentType }) } : {}),
      });
    } catch (e) {
      throw new Error(
        this.mask(`sharepoint: ${method} ${itemPath} failed: ${(e as Error).message}`),
      );
    }
  }

  private async fail(method: string, itemPath: string, res: Response): Promise<never> {
    const text = await res.text();
    throw new Error(
      this.mask(
        `sharepoint: ${method} ${itemPath} returned HTTP ${res.status}: ${text.slice(0, 500)}`,
      ),
    );
  }

  /** File content as text, or null when the item does not exist. */
  async readText(itemPath: string): Promise<string | null> {
    const res = await this.send("GET", itemPath);
    if (res.status === 404) return null;
    if (!res.ok) return this.fail("GET", itemPath, res);
    return res.text();
  }

  async upload(itemPath: string, data: Uint8Array, contentType: string): Promise<DriveItem> {
    const res = await this.send("PUT", itemPath, { data, contentType });
    if (!res.ok) return this.fail("PUT", itemPath, res);
    return (await res.json()) as DriveItem;
  }
}
