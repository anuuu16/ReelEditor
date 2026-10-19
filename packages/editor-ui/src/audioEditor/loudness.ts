// Loudness analysis for the mix-health meter. Answers the question Normalize alone can't: "how
// loud does this actually sound", not just "what's the single loudest instant". Peak normalize
// (the original/default Normalize mode) deliberately only looks at the loudest sample — two clips
// normalized to the same peak can still sound wildly different in practice (a brickwalled,
// compressed music bed reads far louder than a dynamic voice recording at the same peak), which is
// exactly how a loud-music/inaudible-voice mix slips through even after "normalizing" everything.
import { gainToDb } from "./dbUtils.js";
import { computePeakAmplitude, computeRmsAmplitude } from "./waveform.js";

export function computePeakDb(buffer: AudioBuffer, startSec = 0, endSec = buffer.duration): number {
  return gainToDb(computePeakAmplitude(buffer, startSec, endSec));
}

const LOUDNESS_BLOCK_SEC = 0.4;
// Blocks quieter than this are treated as silence/background noise and excluded from the average —
// otherwise a clip that's mostly silence with one loud moment reads as "quiet" overall, which is
// the opposite of what you'd want a loudness meter to tell you.
const LOUDNESS_GATE_DB = -50;

// Deliberately NOT true EBU R128 / ITU-1770 LUFS (no K-weighting filter, no relative gate) — this is
// a cheap block-RMS-with-a-silence-gate stand-in, close enough to be a useful "is this balanced"
// signal without pulling in a full loudness-measurement library. Labelled "approx. loudness" in the
// UI, never "LUFS", so it isn't mistaken for a spec-accurate reading.
export function computeIntegratedLoudnessDb(buffer: AudioBuffer, startSec = 0, endSec = buffer.duration, floorDb = -90): number {
  const span = Math.max(0, endSec - startSec);
  if (span <= 0) return floorDb;
  const blocks = Math.max(1, Math.round(span / LOUDNESS_BLOCK_SEC));
  const energies: number[] = [];
  for (let i = 0; i < blocks; i++) {
    const s = startSec + (span * i) / blocks;
    const e = startSec + (span * (i + 1)) / blocks;
    const rms = computeRmsAmplitude(buffer, s, e);
    if (gainToDb(rms, floorDb) > LOUDNESS_GATE_DB) energies.push(rms * rms);
  }
  return meanEnergyToDb(energies, floorDb);
}

// Same gated-block-average as computeIntegratedLoudnessDb, but over an arbitrary boolean mask of
// frames (e.g. "only while the voice-over is speaking") instead of the whole buffer — how the
// mix-health meter measures "how loud is the music specifically while someone's talking over it".
export function computeLoudnessOverMask(buffer: AudioBuffer, frameSec: number, mask: ArrayLike<number>, floorDb = -90): number {
  const energies: number[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const s = i * frameSec;
    if (s >= buffer.duration) break;
    const e = Math.min(buffer.duration, s + frameSec);
    const rms = computeRmsAmplitude(buffer, s, e);
    if (gainToDb(rms, floorDb) > LOUDNESS_GATE_DB) energies.push(rms * rms);
  }
  return meanEnergyToDb(energies, floorDb);
}

function meanEnergyToDb(energies: number[], floorDb: number): number {
  if (energies.length === 0) return floorDb;
  const meanEnergy = energies.reduce((a, b) => a + b, 0) / energies.length;
  return gainToDb(Math.sqrt(meanEnergy), floorDb);
}

/** How far under the voice-over's own level backing audio should sit while voice is active, to
 * not be perceived as competing with it — a common mixing rule of thumb (6-15 dB under). */
export const VOICE_MASKING_MARGIN_DB = 6;
