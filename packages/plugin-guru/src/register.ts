// Plugin entry point. `package.json#docsxai.register` points here (built form). The runtime
// prefixes the bare name with the manifest namespace: the publisher is `guru:push`.

import type { PluginRegisterApi } from "@docsxai/engine";
import { createGuruPublisher } from "./publisher.js";

export function register(api: PluginRegisterApi): void {
  api.registerPublisher("push", createGuruPublisher());
}

export { createGuruPublisher, type GuruPublisherOptions } from "./publisher.js";
export { type GuruPublishConfig, maskSecrets, parseConfig } from "./config.js";
export { MANIFEST_SCHEMA, MANIFEST_TITLE } from "./manifest.js";
export { adfToHtml } from "./adf-html.js";
