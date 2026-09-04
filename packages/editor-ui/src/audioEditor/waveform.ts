// A per-column min/max envelope of the (channel-averaged) signal — the shape a waveform view draws.
// `columns` is typically the canvas pixel width. Result is a flat [min0, max0, min1, max1, …] pair
// list so it can be a single Float32Array with no per-column allocation.
export function computeWaveformPeaks(buffer: AudioBuffer, columns: number): Float32Array {
  const cols = Math.max(1, Math.floor(columns));
  const out = new Float32Array(cols * 2);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const samplesPerCol = buffer.length / cols;

  for (let col = 0; col < cols; col++) {
    const start = Math.floor(col * samplesPerCol);
    const end = Math.min(buffer.length, Math.floor((col + 1) * samplesPerCol));
    let min = 0;
    let max = 0;
    for (let i = start; i < end; i++) {
      let sample = 0;
      for (const data of channels) sample += data[i];
      sample /= channels.length;
      if (sample < min) min = sample;
      if (sample > max) max = sample;
    }
    out[col * 2] = min;
    out[col * 2 + 1] = max;
  }
  return out;
}

// Same envelope, from a raw single-channel sample slice — for a timeline clip's mini-waveform,
// where the samples come straight off one AudioBuffer channel with no re-decode.
export function peaksFromChannel(data: Float32Array, columns: number): Float32Array {
  const cols = Math.max(1, Math.floor(columns));
  const out = new Float32Array(cols * 2);
  const samplesPerCol = data.length / cols;
  for (let col = 0; col < cols; col++) {
    const start = Math.floor(col * samplesPerCol);
    const end = Math.min(data.length, Math.floor((col + 1) * samplesPerCol));
    let min = 0;
    let max = 0;
    for (let i = start; i < end; i++) {
      const s = data[i];
      if (s < min) min = s;
      if (s > max) max = s;
    }
    out[col * 2] = min;
    out[col * 2 + 1] = max;
  }
  return out;
}

// Peak absolute sample across the buffer (or a [startSec, endSec] slice of it). getChannelData is
// already normalized float, so this is effectively 0..1. Used to resolve Normalize to a fixed gain.
export function computePeakAmplitude(buffer: AudioBuffer, startSec = 0, endSec = buffer.duration): number {
  const start = Math.max(0, Math.floor(startSec * buffer.sampleRate));
  const end = Math.min(buffer.length, Math.ceil(endSec * buffer.sampleRate));
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = start; i < end; i++) {
      const v = Math.abs(data[i]);
      if (v > peak) peak = v;
    }
  }
  return peak;
}

// First/last sample times (seconds) whose level rises above `thresholdDb` (relative to full scale),
// with a small pad so a hard onset isn't clipped. Returns the whole buffer's span when it never
// crosses the threshold. Drives "trim leading/trailing silence".
export function detectSilenceBounds(
  buffer: AudioBuffer,
  thresholdDb: number,
  padSeconds = 0.05
): { startSec: number; endSec: number } {
  const threshold = Math.pow(10, thresholdDb / 20);
  const sampleRate = buffer.sampleRate;
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));

  const isLoud = (i: number): boolean => {
    for (const data of channels) if (Math.abs(data[i]) >= threshold) return true;
    return false;
  };

  let first = -1;
  for (let i = 0; i < buffer.length; i++) {
    if (isLoud(i)) {
      first = i;
      break;
    }
  }
  if (first === -1) return { startSec: 0, endSec: buffer.duration };

  let last = buffer.length - 1;
  for (let i = buffer.length - 1; i >= 0; i--) {
    if (isLoud(i)) {
      last = i;
      break;
    }
  }

  return {
    startSec: Math.max(0, first / sampleRate - padSeconds),
    endSec: Math.min(buffer.duration, last / sampleRate + padSeconds),
  };
}
