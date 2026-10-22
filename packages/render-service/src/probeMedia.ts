import { spawn } from "node:child_process";
import { FFMPEG_PATH } from "./ffmpegBinary.js";

const PROBE_TIMEOUT_MS = 20_000;
const PROBE_CONCURRENCY = 4;

// `ffmpeg -i <file>` with no output lists every stream on stderr ("Stream #0:1[0x2](und): Audio:
// aac ..."), then exits non-zero because no output was given — that's expected and fine here. Only
// the ffmpeg binary is needed (no separate ffprobe, which @ffmpeg-installer doesn't ship).
export function parseHasAudioStream(ffmpegStderr: string): boolean {
  return /^\s*Stream #\d+:\d+.*?: Audio:/m.test(ffmpegStderr);
}

function readStreamInfo(filePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    let stderr = "";
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const proc = spawn(FFMPEG_PATH, ["-hide_banner", "-nostdin", "-i", filePath], { stdio: ["ignore", "ignore", "pipe"] });
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      finish(null);
    }, PROBE_TIMEOUT_MS);
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    proc.on("error", () => finish(null));
    proc.on("close", () => finish(stderr));
  });
}

// ffmpeg lists at least one "Stream #n:m" line for anything it can open; a file it can't make
// sense of (garbage, an mp4 cut off before its index, a zero-byte image) gets no streams at all.
export function parseIsReadable(ffmpegStderr: string): boolean {
  return /^\s*Stream #\d+:\d+/m.test(ffmpegStderr);
}

/** The "Duration: 00:00:15.00" line of ffmpeg's listing, in seconds — null when there isn't one. */
export function parseDurationSeconds(ffmpegStderr: string): number | null {
  const match = /^\s*Duration: (\d+):(\d\d):(\d\d(?:\.\d+)?)/m.exec(ffmpegStderr);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

export interface ProbedSource {
  /** ffmpeg could open it and found at least one stream. */
  readable: boolean;
  hasAudio: boolean;
}

/**
 * What ffmpeg makes of each uploaded file, keyed by source id. Files the probe itself couldn't
 * run on (ffmpeg missing, a timeout) are left out, so the caller falls back to assuming the best
 * — a definite "this file has no streams" answer is the one that matters.
 */
export async function probeSources(sourcePaths: Record<string, string>): Promise<Record<string, ProbedSource>> {
  const entries = Object.entries(sourcePaths);
  const result: Record<string, ProbedSource> = {};
  let next = 0;
  async function worker(): Promise<void> {
    while (next < entries.length) {
      const [sourceId, filePath] = entries[next++];
      const info = await readStreamInfo(filePath);
      if (info === null) continue;
      const readable = parseIsReadable(info);
      result[sourceId] = { readable, hasAudio: readable && parseHasAudioStream(info) };
    }
  }
  await Promise.all(Array.from({ length: Math.min(PROBE_CONCURRENCY, entries.length) }, worker));
  return result;
}

// Whether each uploaded file has an audio stream, keyed by source id. Unreadable files are left
// out, so the render plan falls back to assuming audio is there (the old behaviour).
export async function probeSourcesForAudio(sourcePaths: Record<string, string>): Promise<Record<string, boolean>> {
  const probed = await probeSources(sourcePaths);
  return Object.fromEntries(
    Object.entries(probed)
      .filter(([, info]) => info.readable)
      .map(([sourceId, info]) => [sourceId, info.hasAudio]),
  );
}

/** How long a finished file plays, as ffmpeg reads it back — null if it can't be read at all. */
export async function probeDurationSeconds(filePath: string): Promise<number | null> {
  const info = await readStreamInfo(filePath);
  return info === null ? null : parseDurationSeconds(info);
}
