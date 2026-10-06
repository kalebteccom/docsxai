// Plugin entry point. `package.json#docsxai.register` points here (built form). The runtime
// prefixes the bare name with the manifest namespace: the publisher is `sharepoint:push`.

import type { PluginRegisterApi } from "@docsxai/engine";
import { createSharePointPublisher } from "./publisher.js";

export function register(api: PluginRegisterApi): void {
  api.registerPublisher("push", createSharePointPublisher());
}

export {
  createSharePointPublisher,
  maskToken,
  MANIFEST_FILE,
  parseConfig,
  type SharePointPublishConfig,
} from "./publisher.js";
export { adfToMarkdown } from "./adf-markdown.js";
