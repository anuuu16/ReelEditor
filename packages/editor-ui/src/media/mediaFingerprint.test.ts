import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { FINGERPRINT_SAMPLE_BYTES, fingerprintPrefix, fingerprintRanges } from "@reel-studio/timeline-core";
import { clearFingerprintCacheForTests, fingerprintBlob, fingerprintForSource } from "./mediaFingerprint.js";

// The render service computes the same thing over a file with node's crypto; this is that
// computation, so the two halves are checked against each other here.
function reference(bytes: Uint8Array): string {
  const hash = createHash("sha256").update(fingerprintPrefix(bytes.length));
  for (const r of fingerprintRanges(bytes.length)) hash.update(bytes.subarray(r.start, r.end));
  return hash.digest("hex");
}

beforeEach(() => clearFingerprintCacheForTests());

describe("fingerprintBlob", () => {
  it("matches the service's computation for small and big blobs", async () => {
    const small = new TextEncoder().encode("hello, reel");
    expect(await fingerprintBlob(new Blob([small]))).toBe(reference(small));
    const big = new Uint8Array(4 * FINGERPRINT_SAMPLE_BYTES + 55).fill(3);
    expect(await fingerprintBlob(new Blob([big]))).toBe(reference(big));
  });

  it("changes when the head, middle or tail changes, or the length", async () => {
    const base = new Uint8Array(4 * FINGERPRINT_SAMPLE_BYTES).fill(1);
    const baseFp = await fingerprintBlob(new Blob([base]));
    for (const at of [0, base.length >> 1, base.length - 1]) {
      const changed = new Uint8Array(base);
      changed[at] = 2;
      expect(await fingerprintBlob(new Blob([changed]))).not.toBe(baseFp);
    }
    expect(await fingerprintBlob(new Blob([base, new Uint8Array([1])]))).not.toBe(baseFp);
  });
});

describe("fingerprintForSource", () => {
  it("computes once per source and session, unless the size no longer matches", async () => {
    const a = new Blob([new Uint8Array(100).fill(1)]);
    const first = await fingerprintForSource("src", a);
    // Same id, different bytes, same size: the cache answers (sources are immutable under an id).
    expect(await fingerprintForSource("src", new Blob([new Uint8Array(100).fill(2)]))).toBe(first);
    // A different size is never trusted to the cache.
    expect(await fingerprintForSource("src", new Blob([new Uint8Array(101).fill(1)]))).not.toBe(first);
  });
});
