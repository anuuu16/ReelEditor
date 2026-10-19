// A cheap identity for a media file, computed the same way in the browser (over a Blob) and in
// the render service (over a file on disk), so the editor can ask "do you already have this
// exact file?" before uploading it again.
//
// It is deliberately NOT a hash of the whole file: hashing a multi-GB video in the browser means
// reading all of it into memory — the very cost this exists to avoid. Instead it hashes the size
// plus three samples (the head, the middle and the tail). A source's bytes never change under
// the same id (replacing media mints a new source), so this only ever has to tell "the same
// file" from "a different file", which a size match plus three 256 KB samples does in practice.

export const FINGERPRINT_SAMPLE_BYTES = 256 * 1024;

export interface ByteRange {
  /** Inclusive. */
  start: number;
  /** Exclusive. */
  end: number;
}

/** The byte ranges to sample for a file of `size` bytes: the whole file when it's small. */
export function fingerprintRanges(size: number): ByteRange[] {
  if (size <= 3 * FINGERPRINT_SAMPLE_BYTES) return size > 0 ? [{ start: 0, end: size }] : [];
  const middle = Math.floor(size / 2) - Math.floor(FINGERPRINT_SAMPLE_BYTES / 2);
  return [
    { start: 0, end: FINGERPRINT_SAMPLE_BYTES },
    { start: middle, end: middle + FINGERPRINT_SAMPLE_BYTES },
    { start: size - FINGERPRINT_SAMPLE_BYTES, end: size },
  ];
}

/** Mixed into the hash first, so two files that sample alike but differ in length still differ. */
export function fingerprintPrefix(size: number): string {
  return `${size}:`;
}

export function toHex(bytes: ArrayLike<number>): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
