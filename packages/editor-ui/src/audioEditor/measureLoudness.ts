// Main-thread entry point for the loudness meter: copies an AudioBuffer's channels into a Worker
// (transferring the copies, so the main thread keeps its own buffer untouched) and resolves with
// the measurement. Falls back to measuring inline when Workers aren't available (tests, very old
// browsers) — same function, same numbers, just on the calling thread.
import { measureLoudnessChannels, type LoudnessMeasurement } from "./ebur128.js";
import type { LoudnessWorkerRequest, LoudnessWorkerResponse } from "./loudnessWorker.js";

export type { LoudnessMeasurement } from "./ebur128.js";

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (m: LoudnessMeasurement) => void>();

function getWorker(): Worker | null {
  if (typeof Worker === "undefined") return null;
  if (!worker) {
    try {
      worker = new Worker(new URL("./loudnessWorker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<LoudnessWorkerResponse>) => {
        const resolve = pending.get(event.data.id);
        pending.delete(event.data.id);
        resolve?.(event.data.measurement);
      };
      worker.onerror = (err) => {
        console.error("Loudness worker failed; falling back to inline measurement", err);
        worker?.terminate();
        worker = null;
        // Anything in flight is lost with the worker — callers will re-request on the next change.
        pending.clear();
      };
    } catch {
      worker = null;
    }
  }
  return worker;
}

export function measureLoudness(buffer: AudioBuffer): Promise<LoudnessMeasurement> {
  const sampleRate = buffer.sampleRate;
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => new Float32Array(buffer.getChannelData(c)));
  const w = getWorker();
  if (!w) return Promise.resolve(measureLoudnessChannels(channels, sampleRate));
  return new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    const request: LoudnessWorkerRequest = { id, sampleRate, channels };
    w.postMessage(
      request,
      channels.map((ch) => ch.buffer),
    );
  });
}
