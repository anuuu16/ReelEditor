import { fingerprintPrefix, fingerprintRanges, toHex } from "@reel-studio/timeline-core";

// The browser's half of media-fingerprint.ts (timeline-core): the same samples, sliced out of the
// Blob — so fingerprinting a 2 GB clip reads 768 KB of it, not 2 GB into memory.

export async function fingerprintBlob(blob: Blob): Promise<string> {
  const parts: Uint8Array[] = [new TextEncoder().encode(fingerprintPrefix(blob.size))];
  for (const range of fingerprintRanges(blob.size)) {
    parts.push(new Uint8Array(await blob.slice(range.start, range.end).arrayBuffer()));
  }
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", joined)));
}

// A source's bytes never change under the same id (replacing media mints a new source), so one
// fingerprint per source per session is enough; the size check is belt and braces.
const cache = new Map<string, { size: number; fingerprint: string }>();

export async function fingerprintForSource(sourceId: string, blob: Blob): Promise<string> {
  const cached = cache.get(sourceId);
  if (cached && cached.size === blob.size) return cached.fingerprint;
  const fingerprint = await fingerprintBlob(blob);
  cache.set(sourceId, { size: blob.size, fingerprint });
  return fingerprint;
}

/** Test hook. */
export function clearFingerprintCacheForTests(): void {
  cache.clear();
}
