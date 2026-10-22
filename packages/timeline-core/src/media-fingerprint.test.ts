import { describe, expect, it } from "vitest";
import { FINGERPRINT_SAMPLE_BYTES, fingerprintPrefix, fingerprintRanges, toHex } from "./media-fingerprint.js";

describe("fingerprintRanges", () => {
  it("samples a small file whole, and an empty one not at all", () => {
    expect(fingerprintRanges(0)).toEqual([]);
    expect(fingerprintRanges(10)).toEqual([{ start: 0, end: 10 }]);
    expect(fingerprintRanges(3 * FINGERPRINT_SAMPLE_BYTES)).toEqual([{ start: 0, end: 3 * FINGERPRINT_SAMPLE_BYTES }]);
  });

  it("samples the head, the middle and the tail of a big file, each exactly one sample long", () => {
    const size = 10_000_000;
    const ranges = fingerprintRanges(size);
    expect(ranges).toHaveLength(3);
    for (const r of ranges) expect(r.end - r.start).toBe(FINGERPRINT_SAMPLE_BYTES);
    expect(ranges[0].start).toBe(0);
    expect(ranges[1].start).toBe(5_000_000 - FINGERPRINT_SAMPLE_BYTES / 2);
    expect(ranges[2].end).toBe(size);
    expect(ranges[0].end).toBeLessThanOrEqual(ranges[1].start);
    expect(ranges[1].end).toBeLessThanOrEqual(ranges[2].start);
  });

  it("prefixes with the size and renders hex", () => {
    expect(fingerprintPrefix(1234)).toBe("1234:");
    expect(toHex([0, 15, 255])).toBe("000fff");
  });
});
