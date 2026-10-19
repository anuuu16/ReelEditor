import { describe, expect, it } from "vitest";
import { dbToGain, gainToDb } from "./dbUtils.js";

describe("dbToGain / gainToDb", () => {
  it("0 dB is unity gain", () => {
    expect(dbToGain(0)).toBeCloseTo(1, 6);
    expect(gainToDb(1)).toBeCloseTo(0, 6);
  });

  it("round-trips", () => {
    for (const db of [-40, -20, -6, -1, 0, 6, 12]) {
      expect(gainToDb(dbToGain(db))).toBeCloseTo(db, 5);
    }
  });

  it("-6 dB is roughly half amplitude", () => {
    expect(dbToGain(-6)).toBeCloseTo(0.5012, 3);
  });

  it("gainToDb floors at a silent gain instead of -Infinity", () => {
    expect(gainToDb(0)).toBe(-90);
    expect(gainToDb(0, -120)).toBe(-120);
    expect(Number.isFinite(gainToDb(0))).toBe(true);
  });
});
