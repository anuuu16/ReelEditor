// Export-stage true-peak safety. Why it exists, shown by measuring the editor's own exports of a
// hot mix (float true peak +5.5 dBTP) with `ffmpeg -af ebur128=peak=true` / astats:
//
//   WAV  :  0.0 dBFS, flat factor 37.6   — the 16-bit WAV writer hard-clips anything past ±1.0,
//                                          so everything over full scale becomes flattened
//                                          (audibly distorted) sample runs pinned at the ceiling.
//   M4A  : +0.5 dBFS                     — lossy codecs don't reproduce the waveform exactly; their
//   Opus : +0.5 dBFS                       reconstruction overshoots peaks, so a no-headroom input
//   MP3  : -0.2 dBFS                       decodes to peaks *above* full scale and clips on playback.
//
// Even a mix that peaks at -0.5 dBTP leaves all four formats above the -1 dBTP delivery ceiling —
// that ceiling exists precisely to absorb codec overshoot. The fix is a plain static trim of the
// whole mix (every clip by the same amount, so the balance/ducking is untouched) down to the
// ceiling before the WAV intermediate is written. It is not a limiter and adds no processing when
// the mix already fits.
import { dbToGain } from "./dbUtils.js";
import { truePeakOf } from "./ebur128.js";

export const EXPORT_TRUE_PEAK_CEILING_DBTP = -1;

export function measureTruePeakDbtp(channels: Float32Array[], sampleRate: number): number {
  let peak = 0;
  for (const ch of channels) peak = Math.max(peak, truePeakOf(ch, sampleRate));
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}

/** How many dB to trim so a mix peaking at `truePeakDbtp` lands on `ceilingDb` — 0 when it
 * already fits (quiet mixes are never boosted; this is a safety, not a normalizer). */
export function truePeakSafetyTrimDb(truePeakDbtp: number, ceilingDb: number = EXPORT_TRUE_PEAK_CEILING_DBTP): number {
  if (!Number.isFinite(truePeakDbtp)) return 0;
  return Math.max(0, truePeakDbtp - ceilingDb);
}

/** The same channels, trimmed by `trimDb` (returned unchanged when trimDb is 0). */
export function applyTrimToChannels(channels: Float32Array[], trimDb: number): Float32Array[] {
  if (trimDb <= 0) return channels;
  const gain = dbToGain(-trimDb);
  return channels.map((ch) => {
    const out = new Float32Array(ch.length);
    for (let i = 0; i < ch.length; i++) out[i] = ch[i] * gain;
    return out;
  });
}

export interface PeakSafeResult {
  buffer: AudioBuffer;
  /** How far the mix was turned down, dB (0 = untouched). */
  trimDb: number;
  /** The mix's true peak before any trim, dBTP. */
  truePeakDbtp: number;
}

// Browser-side wrapper: measure the rendered mix and, if it pokes past the ceiling, return a
// trimmed copy to hand to the WAV writer. The original buffer (used for preview) is not modified.
export function makePeakSafe(buffer: AudioBuffer, ceilingDb: number = EXPORT_TRUE_PEAK_CEILING_DBTP): PeakSafeResult {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const truePeakDbtp = measureTruePeakDbtp(channels, buffer.sampleRate);
  const trimDb = truePeakSafetyTrimDb(truePeakDbtp, ceilingDb);
  if (trimDb <= 0) return { buffer, trimDb: 0, truePeakDbtp };
  const trimmed = applyTrimToChannels(channels, trimDb);
  const out = new AudioBuffer({ numberOfChannels: buffer.numberOfChannels, length: buffer.length, sampleRate: buffer.sampleRate });
  trimmed.forEach((ch, c) => out.copyToChannel(ch as Float32Array<ArrayBuffer>, c));
  return { buffer: out, trimDb, truePeakDbtp };
}
