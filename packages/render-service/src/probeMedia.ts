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

// Whether each uploaded file has an audio stream, keyed by source id. Files that can't be probed
// are left out, so the render plan falls back to assuming audio is there (the old behaviour).
export async function probeSourcesForAudio(sourcePaths: Record<string, string>): Promise<Record<string, boolean>> {
  const entries = Object.entries(sourcePaths);
  const result: Record<string, boolean> = {};
  let next = 0;
  async function worker(): Promise<void> {
    while (next < entries.length) {
      const [sourceId, filePath] = entries[next++];
      const info = await readStreamInfo(filePath);
      if (info !== null && /Stream #\d+:\d+/.test(info)) result[sourceId] = parseHasAudioStream(info);
    }
  }
  await Promise.all(Array.from({ length: Math.min(PROBE_CONCURRENCY, entries.length) }, worker));
  return result;
}
