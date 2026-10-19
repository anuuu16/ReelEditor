// Minimal stand-ins for browser-only types (AudioBuffer, AudioClip defaults) so the pure analysis
// functions in this folder (loudness/duck/mixdown's non-Web-Audio pieces) can be unit tested under
// plain Node/vitest, with no jsdom or Web Audio polyfill involved.
import type { AudioClip, AudioClipRole, NormalizeMode } from "./timeline.js";

/** A fake AudioBuffer backed by plain Float32Arrays — implements just the bit of the real
 * AudioBuffer interface this folder's analysis code actually calls. */
export function makeFakeBuffer(channels: Float32Array[], sampleRate = 44100): AudioBuffer {
  const length = channels[0]?.length ?? 0;
  return {
    sampleRate,
    length,
    duration: length / sampleRate,
    numberOfChannels: channels.length,
    getChannelData: (channel: number) => channels[channel],
  } as unknown as AudioBuffer;
}

/** A constant-amplitude mono buffer of `durationSec` at `amplitude` (0..1) — handy for "what does a
 * steady tone at roughly -6dB look like to the loudness meter" style assertions. */
export function makeConstantBuffer(amplitude: number, durationSec: number, sampleRate = 44100): AudioBuffer {
  const n = Math.max(1, Math.round(durationSec * sampleRate));
  const data = new Float32Array(n).fill(amplitude);
  return makeFakeBuffer([data], sampleRate);
}

/** A mono buffer built from [amplitude, durationSec] segments back to back — for envelopes with
 * distinct loud/quiet stretches (e.g. "speech, then silence, then speech"). */
export function makeSegmentedBuffer(segments: Array<[number, number]>, sampleRate = 44100): AudioBuffer {
  const chunks = segments.map(([amp, dur]) => new Float32Array(Math.max(1, Math.round(dur * sampleRate))).fill(amp));
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const data = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    data.set(c, offset);
    offset += c.length;
  }
  return makeFakeBuffer([data], sampleRate);
}

export function makeClipFixture(overrides: Partial<AudioClip> = {}): AudioClip {
  return {
    id: "clip-1",
    sourceId: "src-1",
    name: "clip",
    laneIndex: 0,
    role: "music" as AudioClipRole,
    startSec: 0,
    trimStartSec: 0,
    trimEndSec: 1,
    gainDb: 0,
    normalizeMode: "off" as NormalizeMode,
    fadeInSec: 0,
    fadeOutSec: 0,
    speed: 1,
    muted: false,
    ...overrides,
  };
}

/** Decodes a 16-bit PCM WAV file (what the repo's sample files and the editor's own WAV export
 * are) into per-channel Float32Arrays — for measuring real material under vitest without a
 * browser's decodeAudioData. */
export function readPcm16Wav(bytes: ArrayBuffer): { sampleRate: number; channels: Float32Array[] } {
  const view = new DataView(bytes);
  const tag = (o: number) => String.fromCharCode(view.getUint8(o), view.getUint8(o + 1), view.getUint8(o + 2), view.getUint8(o + 3));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a RIFF/WAVE file");
  let offset = 12;
  let numChannels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let data: { start: number; size: number } | null = null;
  while (offset + 8 <= view.byteLength) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      if (view.getUint16(body, true) !== 1) throw new Error("only PCM WAV is supported");
      numChannels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bitsPerSample = view.getUint16(body + 14, true);
    } else if (id === "data") {
      data = { start: body, size: Math.min(size, view.byteLength - body) };
    }
    offset = body + size + (size % 2);
  }
  if (!data || bitsPerSample !== 16) throw new Error("expected a 16-bit PCM data chunk");
  const frames = Math.floor(data.size / (2 * numChannels));
  const channels = Array.from({ length: numChannels }, () => new Float32Array(frames));
  let p = data.start;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numChannels; c++) {
      channels[c][i] = view.getInt16(p, true) / 32768;
      p += 2;
    }
  }
  return { sampleRate, channels };
}
