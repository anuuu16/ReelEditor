// Web Worker entry: runs the EBU R128 measurement off the main thread so a long timeline's
// K-weighting + 4× true-peak pass never freezes the editor. Plain message protocol: receives the
// channel data + sample rate, posts back the LoudnessMeasurement. See measureLoudness.ts.
import { measureLoudnessChannels, type LoudnessMeasurement } from "./ebur128.js";

export interface LoudnessWorkerRequest {
  id: number;
  sampleRate: number;
  channels: Float32Array[];
}

export interface LoudnessWorkerResponse {
  id: number;
  measurement: LoudnessMeasurement;
}

self.onmessage = (event: MessageEvent<LoudnessWorkerRequest>) => {
  const { id, sampleRate, channels } = event.data;
  const measurement = measureLoudnessChannels(channels, sampleRate);
  const response: LoudnessWorkerResponse = { id, measurement };
  self.postMessage(response);
};
