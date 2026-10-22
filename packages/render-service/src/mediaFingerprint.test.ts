import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { FINGERPRINT_SAMPLE_BYTES, fingerprintPrefix, fingerprintRanges } from "@reel-studio/timeline-core";
import { fingerprintFile } from "./mediaFingerprint.js";

const dir = mkdtempSync(path.join(os.tmpdir(), "reel-fingerprint-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function reference(bytes: Buffer): string {
  const hash = createHash("sha256").update(fingerprintPrefix(bytes.length));
  for (const r of fingerprintRanges(bytes.length)) hash.update(bytes.subarray(r.start, r.end));
  return hash.digest("hex");
}

function write(name: string, bytes: Buffer): string {
  const file = path.join(dir, name);
  writeFileSync(file, bytes);
  return file;
}

describe("fingerprintFile", () => {
  it("matches the shared definition exactly, for small and big files", async () => {
    const small = Buffer.from("hello, reel");
    expect(await fingerprintFile(write("small.bin", small))).toEqual({ bytes: small.length, fingerprint: reference(small) });
    const big = Buffer.alloc(4 * FINGERPRINT_SAMPLE_BYTES + 123, 7);
    expect(await fingerprintFile(write("big.bin", big))).toEqual({ bytes: big.length, fingerprint: reference(big) });
  });

  it("tells files apart by a change in any sampled region, or in length", async () => {
    const base = Buffer.alloc(4 * FINGERPRINT_SAMPLE_BYTES, 1);
    const baseFp = (await fingerprintFile(write("base.bin", base))).fingerprint;
    for (const at of [0, Math.floor(base.length / 2), base.length - 1]) {
      const changed = Buffer.from(base);
      changed[at] = 2;
      expect((await fingerprintFile(write(`changed-${at}.bin`, changed))).fingerprint).not.toBe(baseFp);
    }
    expect((await fingerprintFile(write("longer.bin", Buffer.concat([base, Buffer.from([1])])))).fingerprint).not.toBe(baseFp);
  });

  it("is the same for the same bytes under another name", async () => {
    const bytes = Buffer.alloc(1000, 9);
    expect(await fingerprintFile(write("a.mp4", bytes))).toEqual(await fingerprintFile(write("b.mov", bytes)));
  });
});
