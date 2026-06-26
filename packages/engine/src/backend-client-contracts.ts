// Wire contracts for `@docsxai/backend` — the leaf shared by the transport, token, OAuth-login and
// state-cache siblings (`backend-client-*.ts`), re-exported in full from `./backend-client.js`.
//
// The contract types are *redeclared* here (not imported from the backend package) so the engine
// stays decoupled at the package level — there's no runtime nor build-time dep on the backend.
// Drift is caught by the round-trip integration test that spins up a real stub. The shapes mirror
// the backend's `api.ts` exactly; if you change one, update the other and the test will tell you.

import { type RevisionKind } from "./doc-pack.js";

export const API_VERSION = "1" as const;
export const API_VERSION_HEADER = "docsxai-api-version";

export type RevisionArtifact = "flows" | "annotations" | "screenshots" | "style" | "locators";

export interface Workspace {
  id: string;
  name: string;
  created_at: string;
}

export interface Project {
  id: string;
  workspace_id: string;
  name: string;
  created_at: string;
  head_revision_id: string | null;
}

export interface Revision {
  id: string;
  project_id: string;
  parent_revision_id: string | null;
  kind: RevisionKind;
  author: string;
  created_at: string;
  artifacts: RevisionArtifact[];
  /** True once finalized — artifact PUTs are rejected with 409 from then on. */
  finalized: boolean;
}

export interface RunRecord {
  id: string;
  project_id: string;
  revision_id: string;
  ok: boolean;
  duration_ms: number;
  summary: string;
  created_at: string;
}

/** Reference to a content-addressed blob stored on the backend. */
export interface BlobRef {
  sha256: string;
  bytes: number;
}

export class BackendClientError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "BackendClientError";
  }
}

export interface BackendClientOptions {
  baseUrl: string;
  /** Bearer token. Reads from `DOCSX_TOKEN` env if omitted. */
  token?: string;
  /** Override the HTTP fetch (for tests). Defaults to `globalThis.fetch`. */
  fetch?: typeof globalThis.fetch;
}

// --- payload helpers --------------------------------------------------------
// What we ship in each artifact slot. The backend doesn't validate these shapes; the engine does.
// Screenshot bytes travel as content-addressed blobs (`/v1/blobs`); the artifact slot carries only
// a manifest of sha256 references.

export interface FlowsPayload {
  schema: "docsxai/flows@1";
  files: Record<string, string>; // filename → YAML text
}

export interface AnnotationsPayload {
  schema: "docsxai/annotations-bundle@1";
  files: Record<string, unknown>; // `<flow>/annotations.json` content
}

export interface ScreenshotsPayload {
  schema: "docsxai/screenshots@2";
  files: Record<string, BlobRef>; // workspace-relative path (under docs/) → blob reference
}

export interface StylePayload {
  schema: "docsxai/style-bundle@1";
  yaml: string | null;
  json: unknown;
}

export interface LocatorsPayload {
  schema: "docsxai/locators@1";
  yaml: string | null;
}

// --- stored OAuth tokens (`.auth/backend-token.json`) ------------------------

export interface BackendTokenFile {
  access_token: string;
  refresh_token: string;
  /** Epoch ms the access token expires. */
  expires_at: number;
}

// --- OAuth 2.1 + PKCE login (`docsxai login --oauth`) ----------------------

export interface OAuthLoginOptions {
  backendUrl: string;
  /** Receives the authorization URL the operator must open in a browser (the CLI prints it). */
  onAuthorizeUrl: (url: string) => void;
  fetch?: typeof globalThis.fetch;
  /** How long to wait for the browser redirect before giving up. Default 5 minutes. */
  timeoutMs?: number;
}
