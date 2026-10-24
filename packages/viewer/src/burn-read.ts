// Reads a flow's `annotations.json` for `burnFlow`: a missing file, an unreadable one and one that
// is not valid JSON each stop the burn with a message that names the file.

import * as path from "node:path";
import type { AnnotationsFile } from "./annotations.js";
import { readTextIfPresent } from "./safe-read.js";

export async function readBurnAnnotations(flowDir: string): Promise<AnnotationsFile> {
  const file = path.join(flowDir, "annotations.json");
  const raw = await readTextIfPresent(file);
  if (raw === null) throw new Error(`burnFlow: no annotations.json under ${flowDir}`);
  try {
    return JSON.parse(raw) as AnnotationsFile;
  } catch {
    throw new Error(`burnFlow: ${file} is not valid JSON`);
  }
}
