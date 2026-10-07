// Plugin entry point. `package.json#docsxai.register` points here (built form). The runtime
// prefixes the bare name with the manifest namespace: the publisher is `notion:push`.

import type { PluginRegisterApi } from "@docsxai/engine";
import { createNotionPublisher } from "./publisher.js";

export function register(api: PluginRegisterApi): void {
  api.registerPublisher("push", createNotionPublisher());
}

export { createNotionPublisher, type NotionPublisherOptions } from "./publisher.js";
export { type NotionPublishConfig, maskToken, parseConfig } from "./config.js";
export { MANIFEST_SCHEMA, MANIFEST_TITLE } from "./manifest.js";
export { adfToBlocks } from "./notion-blocks.js";
