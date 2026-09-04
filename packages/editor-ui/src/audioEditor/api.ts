import type { AudioEditSpec } from "@reel-studio/timeline-core";
import { RENDER_SERVICE_URL } from "../constants.js";

export type AudioExportFormat = "mp3" | "m4a" | "opus" | "wav";

// A spec that changes nothing — used when the client has already produced the final mixed WAV and
// only needs the server to transcode it to a compressed format.
export function identitySpec(durationSec: number): AudioEditSpec {
  return { trimStartSec: 0, trimEndSec: Math.max(0.01, durationSec), fadeInSec: 0, fadeOutSec: 0, gainDb: 0, speed: 1 };
}

export const AUDIO_FORMATS: Array<{ id: AudioExportFormat; label: string; ext: string; lossy: boolean }> = [
  { id: "mp3", label: "MP3", ext: "mp3", lossy: true },
  { id: "m4a", label: "M4A (AAC)", ext: "m4a", lossy: true },
  { id: "opus", label: "Opus", ext: "opus", lossy: true },
  { id: "wav", label: "WAV", ext: "wav", lossy: false },
];

export interface EncodeAudioOptions {
  /** The untouched source file — the server trims/fades/encodes from this. */
  file: File | Blob;
  spec: AudioEditSpec;
  format: AudioExportFormat;
  bitrateKbps: number;
  /** Base name for the returned file (no extension). */
  name: string;
}

// One synchronous round-trip to render-service: POST the original file + edit spec, get the encoded
// result back as a Blob. Mirrors the "couldn't reach the render service" handling in ExportPanel.
export async function encodeAudio({ file, spec, format, bitrateKbps, name }: EncodeAudioOptions): Promise<Blob> {
  const formData = new FormData();
  formData.append("file", file, "input");
  formData.append("spec", JSON.stringify(spec));
  formData.append("format", format);
  formData.append("bitrateKbps", String(bitrateKbps));
  formData.append("name", name);

  let response: Response;
  try {
    response = await fetch(`${RENDER_SERVICE_URL}/audio/edit`, { method: "POST", body: formData });
  } catch {
    throw new Error(
      `Couldn't reach the render service at ${RENDER_SERVICE_URL}. Make sure it's running (pnpm --filter @reel-studio/render-service dev).`
    );
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "Audio export failed" }));
    throw new Error(body.error ?? "Audio export failed");
  }
  return response.blob();
}
