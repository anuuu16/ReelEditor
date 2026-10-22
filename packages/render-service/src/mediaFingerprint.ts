import { createHash } from "node:crypto";
import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fingerprintPrefix, fingerprintRanges } from "@reel-studio/timeline-core";
import { mediaDir } from "./projects.js";

// The service's half of media-fingerprint.ts (timeline-core): the same samples, read straight from
// the file with three small reads — never the whole file.

export async function fingerprintFile(filePath: string): Promise<{ bytes: number; fingerprint: string }> {
  const { size } = await stat(filePath);
  const hash = createHash("sha256");
  hash.update(fingerprintPrefix(size));
  const handle = await open(filePath, "r");
  try {
    for (const range of fingerprintRanges(size)) {
      const buffer = Buffer.alloc(range.end - range.start);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, range.start);
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    await handle.close();
  }
  return { bytes: size, fingerprint: hash.digest("hex") };
}

export interface StoredMediaEntry {
  bytes: number;
  fingerprint: string;
}

/** Every media file a saved project has, keyed by source id — what the editor needn't upload again. */
export async function listProjectMedia(projectId: string): Promise<Record<string, StoredMediaEntry>> {
  let files: string[];
  try {
    files = await readdir(mediaDir(projectId));
  } catch {
    return {};
  }
  const entries: Record<string, StoredMediaEntry> = {};
  for (const file of files) {
    const sourceId = file.includes(".") ? file.slice(0, file.indexOf(".")) : file;
    try {
      entries[sourceId] = await fingerprintFile(path.join(mediaDir(projectId), file));
    } catch {
      // A file that vanished or can't be read just isn't on offer.
    }
  }
  return entries;
}
