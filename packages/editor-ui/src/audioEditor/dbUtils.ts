// Tiny, dependency-free dB <-> linear-gain helpers shared by mixdown, normalize, ducking, and the
// loudness meter — kept in one place so all of them agree on the same floor/rounding behaviour.

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

// Clamped at a silent floor instead of returning -Infinity for a true-zero signal — a UI label or a
// threshold comparison against -Infinity is more surprising than useful.
export function gainToDb(gain: number, floorDb = -90): number {
  if (!(gain > 0)) return floorDb;
  return Math.max(floorDb, 20 * Math.log10(gain));
}

/** Peak normalize target: the classic "loudest sample hits -1 dBFS" behaviour. */
export const NORMALIZE_PEAK_TARGET_DBFS = -1;

/** Loudness normalize target, in the same rough units the mix-health meter reports (see
 * loudness.ts) — chosen to sit in the middle of the healthy band used there. */
export const LOUDNESS_NORMALIZE_TARGET_DB = -16;
