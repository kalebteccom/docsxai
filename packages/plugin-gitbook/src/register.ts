// Plugin entry point. `package.json#docsxai.register` points here (built form). The runtime
// prefixes the bare name with the manifest namespace: the publisher is `gitbook:push`.

import type { PluginRegisterApi } from "@docsxai/engine";
import { createGitBookPublisher } from "./publisher.js";

export function register(api: PluginRegisterApi): void {
  api.registerPublisher("push", createGitBookPublisher());
}

export { createGitBookPublisher, type GitBookPublisherOptions } from "./publisher.js";
export { type GitBookPublishConfig, maskToken, parseConfig } from "./config.js";
export { MANIFEST_SCHEMA, MANIFEST_TITLE } from "./manifest.js";
export { adfToMarkdown } from "./adf-markdown.js";
