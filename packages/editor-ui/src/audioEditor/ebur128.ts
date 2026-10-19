// EBU R128 / ITU-R BS.1770-4 loudness measurement — the real thing, not the block-RMS stand-in in
// loudness.ts. Produces the same numbers a DAW's loudness meter or `ffmpeg -af ebur128=peak=true`
// reports, so what the editor shows can be checked 1:1 against the exported file.
//
//   - Integrated loudness (LUFS): K-weighted (pre-filter high shelf + RLB high-pass) mean square,
//     400 ms blocks at 75% overlap, channel-weighted sum, absolute gate at -70 LUFS then relative
//     gate 10 LU under the gated mean.
//   - Loudness range (LU): EBU Tech 3342 — 3 s short-term loudness every 100 ms, absolute gate
//     -70, relative gate -20 LU, LRA = 95th − 10th percentile.
//   - True peak (dBTP): BS.1770 Annex 2 — 4× oversampling through a polyphase low-pass FIR,
//     peak of the interpolated signal (2× when the source is already ≥ 96 kHz).
//
// Pure functions over plain Float32Array channels + a sample rate, no Web Audio — so the same code
// runs in a Worker (see measureLoudness.ts) and under vitest against the repo's sample files.

export interface LoudnessMeasurement {
  /** Integrated (programme) loudness, LUFS. -Infinity when everything is gated out (silence). */
  integratedLufs: number;
  /** Loudness range, LU. 0 when there's too little un-gated material to measure. */
  loudnessRangeLu: number;
  /** Highest 400 ms (momentary) block loudness, LUFS. */
  momentaryMaxLufs: number;
  /** Highest 3 s (short-term) window loudness, LUFS. */
  shortTermMaxLufs: number;
  /** True peak across all channels, dBTP. */
  truePeakDbtp: number;
  /** Plain highest |sample| across all channels, dBFS — what a non-oversampled peak meter shows. */
  samplePeakDbfs: number;
}

export const ABSOLUTE_GATE_LUFS = -70;
const RELATIVE_GATE_LU = -10;
const LRA_RELATIVE_GATE_LU = -20;
const BLOCK_SEC = 0.4;
const HOP_SEC = 0.1;
const SHORT_TERM_SEC = 3;

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

// BS.1770's pre-filter (stage 1, a ~+4 dB high shelf modelling the head's acoustic effect) and RLB
// weighting (stage 2, a 2nd-order high-pass around 38 Hz). The standard only tabulates the
// coefficients for 48 kHz; these are the analog-prototype parameters those tables were derived
// from, re-evaluated at whatever rate the buffer actually is.
// Both stages are derived the way libebur128 does it — a bilinear transform of the analog
// prototype with frequency pre-warping — which reproduces BS.1770's tabulated 48 kHz coefficients
// to ~1e-15 and stays on the same curve at 44.1 kHz. (A textbook RBJ shelf from the same f0/G/Q is
// ~0.25 dB off around 1 kHz, enough to read 0.2–0.3 LU low against ffmpeg.)
function preFilterHighShelf(sampleRate: number): Biquad {
  const f0 = 1681.974450955533;
  const gainDb = 3.999843853973347;
  const q = 0.7071752369554196;
  const K = Math.tan((Math.PI * f0) / sampleRate);
  const Vh = Math.pow(10, gainDb / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  const a0 = 1 + K / q + K * K;
  return {
    b0: (Vh + (Vb * K) / q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / q + K * K) / a0,
  };
}

function rlbHighPass(sampleRate: number): Biquad {
  const f0 = 38.13547087602444;
  const q = 0.5003270373238773;
  const K = Math.tan((Math.PI * f0) / sampleRate);
  const a0 = 1 + K / q + K * K;
  return {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / q + K * K) / a0,
  };
}

function kWeightingStages(sampleRate: number): [Biquad, Biquad] {
  return [preFilterHighShelf(sampleRate), rlbHighPass(sampleRate)];
}

// Both stages in one pass, in doubles — a separate pass per stage through Float32 intermediates
// costs ~2× for no accuracy benefit.
export function kWeight(channel: Float32Array, sampleRate: number): Float32Array {
  const [s1, s2] = kWeightingStages(sampleRate);
  const { b0: b10, b1: b11, b2: b12, a1: a11, a2: a12 } = s1;
  const { b0: b20, b1: b21, b2: b22, a1: a21, a2: a22 } = s2;
  const out = new Float32Array(channel.length);
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0; // stage 1 state
  let u1 = 0,
    u2 = 0,
    v1 = 0,
    v2 = 0; // stage 2 state
  for (let i = 0; i < channel.length; i++) {
    const x0 = channel[i];
    const y0 = b10 * x0 + b11 * x1 + b12 * x2 - a11 * y1 - a12 * y2;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    const v0 = b20 * y0 + b21 * u1 + b22 * u2 - a21 * v1 - a22 * v2;
    u2 = u1;
    u1 = y0;
    v2 = v1;
    v1 = v0;
    out[i] = v0;
  }
  return out;
}

// BS.1770 channel weights for the usual layouts: L/R/C = 1, surrounds (Ls/Rs) = +1.5 dB, LFE
// excluded. Anything past 5 channels is treated as 1.0 — this editor only ever renders stereo.
function channelWeights(count: number): number[] {
  if (count <= 3) return Array.from({ length: count }, () => 1);
  if (count === 4) return [1, 1, 1.41, 1.41];
  if (count === 5) return [1, 1, 1, 1.41, 1.41];
  // 5.1: L R C LFE Ls Rs
  return Array.from({ length: count }, (_, i) => (i === 3 ? 0 : i === 4 || i === 5 ? 1.41 : 1));
}

// Loudness (LUFS) of a weighted mean-square sum, per BS.1770: -0.691 + 10·log10(Σ Gi·zi).
function msToLufs(weightedMeanSquare: number): number {
  return weightedMeanSquare > 0 ? -0.691 + 10 * Math.log10(weightedMeanSquare) : -Infinity;
}

// Mean-square of each channel over every `blockSec` window hopped by `hopSec`, summed with the
// channel weights — one weighted-mean-square value per window. Uses a running cumulative sum of
// squares so each window is O(1) regardless of length.
function windowedWeightedMeanSquares(kChannels: Float32Array[], sampleRate: number, blockSec: number, hopSec: number): Float64Array {
  const length = kChannels[0]?.length ?? 0;
  const block = Math.round(blockSec * sampleRate);
  const hop = Math.round(hopSec * sampleRate);
  if (length < block || block <= 0) return new Float64Array(0);
  const count = Math.floor((length - block) / hop) + 1;
  const out = new Float64Array(count);
  const weights = channelWeights(kChannels.length);
  for (let c = 0; c < kChannels.length; c++) {
    const data = kChannels[c];
    const cumulative = new Float64Array(length + 1);
    for (let i = 0; i < length; i++) cumulative[i + 1] = cumulative[i] + data[i] * data[i];
    const w = weights[c];
    for (let j = 0; j < count; j++) {
      const start = j * hop;
      out[j] += (w * (cumulative[start + block] - cumulative[start])) / block;
    }
  }
  return out;
}

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

// Integrated loudness: absolute gate, then relative gate at (gated mean − 10 LU).
export function integratedLoudnessFromBlocks(blockMeanSquares: ArrayLike<number>): number {
  const absGate = Math.pow(10, (ABSOLUTE_GATE_LUFS + 0.691) / 10);
  const aboveAbs: number[] = [];
  for (let i = 0; i < blockMeanSquares.length; i++) if (blockMeanSquares[i] > absGate) aboveAbs.push(blockMeanSquares[i]);
  if (aboveAbs.length === 0) return -Infinity;
  const relGateLufs = msToLufs(mean(aboveAbs)) + RELATIVE_GATE_LU;
  const relGate = Math.pow(10, (relGateLufs + 0.691) / 10);
  const aboveRel = aboveAbs.filter((z) => z > relGate);
  if (aboveRel.length === 0) return -Infinity;
  return msToLufs(mean(aboveRel));
}

// Loudness range (EBU Tech 3342) from short-term loudness values.
export function loudnessRangeFromShortTerm(shortTermLufs: ArrayLike<number>): number {
  const aboveAbs: number[] = [];
  for (let i = 0; i < shortTermLufs.length; i++) if (shortTermLufs[i] > ABSOLUTE_GATE_LUFS) aboveAbs.push(shortTermLufs[i]);
  if (aboveAbs.length === 0) return 0;
  // Relative gate is set from the power mean of the absolute-gated values, not their dB mean.
  const powerMean = mean(aboveAbs.map((l) => Math.pow(10, (l + 0.691) / 10)));
  const relGate = msToLufs(powerMean) + LRA_RELATIVE_GATE_LU;
  const kept = aboveAbs.filter((l) => l > relGate).sort((a, b) => a - b);
  if (kept.length < 2) return 0;
  const percentile = (p: number) => kept[Math.min(kept.length - 1, Math.max(0, Math.round((kept.length - 1) * p)))];
  return Math.max(0, percentile(0.95) - percentile(0.1));
}

// 4× (or 2×) polyphase interpolation low-pass: a windowed-sinc FIR of `tapsPerPhase × factor`
// taps with cutoff at the original Nyquist, split per output phase so each input sample costs
// factor × tapsPerPhase multiply-adds. Blackman window — the standard's own 48-tap filter is of
// the same family and this tracks it to within a few hundredths of a dB on real material.
function interpolationPhases(factor: number, tapsPerPhase: number): Float64Array[] {
  const taps = factor * tapsPerPhase;
  const center = (taps - 1) / 2;
  const h = new Float64Array(taps);
  for (let n = 0; n < taps; n++) {
    const x = (n - center) / factor;
    const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    const window = 0.42 - 0.5 * Math.cos((2 * Math.PI * n) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * n) / (taps - 1));
    h[n] = sinc * window;
  }
  // Normalise each phase to unity DC gain so a flat signal interpolates to the same flat level.
  const phases: Float64Array[] = [];
  for (let p = 0; p < factor; p++) {
    const ph = new Float64Array(tapsPerPhase);
    let sum = 0;
    for (let k = 0; k < tapsPerPhase; k++) {
      ph[k] = h[k * factor + p];
      sum += ph[k];
    }
    for (let k = 0; k < tapsPerPhase; k++) ph[k] /= sum;
    phases.push(ph);
  }
  return phases;
}

export function truePeakOf(channel: Float32Array, sampleRate: number): number {
  const factor = sampleRate >= 96000 ? 2 : 4;
  const tapsPerPhase = 12;
  const phases = interpolationPhases(factor, tapsPerPhase);
  // Flattened as coeff[k * factor + p] so the inner loop walks memory linearly.
  const coeff = new Float64Array(factor * tapsPerPhase);
  for (let p = 0; p < factor; p++) for (let k = 0; k < tapsPerPhase; k++) coeff[k * factor + p] = phases[p][k];
  const n = channel.length;
  let peak = 0;
  // Output sample for phase p at input index i = Σ_k phases[p][k] · x[i − k + tapsPerPhase/2]
  // (the half-length offset just centres the filter; it doesn't change the peak). Every phase
  // reads the same input window, so accumulate all of them per input sample and only
  // bounds-check at the two ends.
  const half = tapsPerPhase >> 1;
  const acc = new Float64Array(factor);
  for (let i = 0; i < n; i++) {
    acc.fill(0);
    const interior = i - tapsPerPhase + 1 + half >= 0 && i + half < n;
    for (let k = 0; k < tapsPerPhase; k++) {
      const idx = i - k + half;
      if (!interior && (idx < 0 || idx >= n)) continue;
      const x = channel[idx];
      const base = k * factor;
      for (let p = 0; p < factor; p++) acc[p] += coeff[base + p] * x;
    }
    for (let p = 0; p < factor; p++) {
      const a = acc[p] < 0 ? -acc[p] : acc[p];
      if (a > peak) peak = a;
    }
  }
  return peak;
}

function toDb(linear: number): number {
  return linear > 0 ? 20 * Math.log10(linear) : -Infinity;
}

export function measureLoudnessChannels(channels: Float32Array[], sampleRate: number): LoudnessMeasurement {
  if (channels.length === 0 || channels[0].length === 0) {
    return {
      integratedLufs: -Infinity,
      loudnessRangeLu: 0,
      momentaryMaxLufs: -Infinity,
      shortTermMaxLufs: -Infinity,
      truePeakDbtp: -Infinity,
      samplePeakDbfs: -Infinity,
    };
  }

  const kChannels = channels.map((ch) => kWeight(ch, sampleRate));

  const momentary = windowedWeightedMeanSquares(kChannels, sampleRate, BLOCK_SEC, HOP_SEC);
  const shortTerm = windowedWeightedMeanSquares(kChannels, sampleRate, SHORT_TERM_SEC, HOP_SEC);

  let momentaryMax = 0;
  for (let i = 0; i < momentary.length; i++) if (momentary[i] > momentaryMax) momentaryMax = momentary[i];
  let shortTermMax = 0;
  for (let i = 0; i < shortTerm.length; i++) if (shortTerm[i] > shortTermMax) shortTermMax = shortTerm[i];

  // A clip shorter than one 400 ms block still deserves a reading: fall back to one block over
  // whatever there is (same as padding with silence up to a block, which is what a meter does).
  let blocksForIntegration: ArrayLike<number> = momentary;
  if (momentary.length === 0) {
    const weights = channelWeights(kChannels.length);
    let sum = 0;
    kChannels.forEach((ch, c) => {
      let s = 0;
      for (let i = 0; i < ch.length; i++) s += ch[i] * ch[i];
      sum += (weights[c] * s) / Math.round(BLOCK_SEC * sampleRate);
    });
    blocksForIntegration = [sum];
    momentaryMax = sum;
  }

  const shortTermLufs = Array.from(shortTerm, msToLufs);

  let samplePeak = 0;
  let truePeak = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const a = ch[i] < 0 ? -ch[i] : ch[i];
      if (a > samplePeak) samplePeak = a;
    }
    truePeak = Math.max(truePeak, truePeakOf(ch, sampleRate));
  }

  return {
    integratedLufs: integratedLoudnessFromBlocks(blocksForIntegration),
    loudnessRangeLu: loudnessRangeFromShortTerm(shortTermLufs),
    momentaryMaxLufs: msToLufs(momentaryMax),
    shortTermMaxLufs: msToLufs(shortTermMax),
    truePeakDbtp: toDb(truePeak),
    samplePeakDbfs: toDb(samplePeak),
  };
}
