import { spawn } from "node:child_process";
import type { ProjectModel } from "@reel-studio/shared-types";
import { FFMPEG_PATH, FFPROBE_PATH } from "./ffmpegBinary.js";

const PROBE_CONCURRENCY = 4;

interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
  /** The binary couldn't be started at all (not installed / not executable), as opposed to ran and failed. */
  spawnError: boolean;
}

function run(command: string, args: string[]): Promise<ProcessResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", () => resolve({ code: null, stdout, stderr, spawnError: true }));
    child.on("close", (code) => resolve({ code, stdout, stderr, spawnError: false }));
  });
}

// `ffmpeg -i` describes a stream's layout by name ("mono", "stereo", "5.1", "7.1(wide)") or as
// "N channels". Only three answers matter to the render plan — none, mono, or stereo-and-wider —
// so any named layout that isn't mono counts as "at least stereo".
function channelsFromLayoutName(layout: string): number {
  const trimmed = layout.trim();
  if (trimmed === "mono") return 1;
  const counted = trimmed.match(/^(\d+) channels?$/);
  if (counted) return Number(counted[1]);
  return 2;
}

// How many audio channels a media file's (first) audio stream has; 0 when the file has no audio
// stream at all. Resolves to null when that can't be determined (no usable ffprobe/ffmpeg,
// unreadable file…) so the caller can decide what to assume.
export async function probeAudioChannels(filePath: string): Promise<number | null> {
  if (FFPROBE_PATH) {
    const result = await run(FFPROBE_PATH, [
      "-v",
      "error",
      "-select_streams",
      "a",
      "-show_entries",
      "stream=channels",
      "-of",
      "csv=p=0",
      filePath,
    ]);
    if (!result.spawnError && result.code === 0) {
      const counts = result.stdout
        .split("\n")
        .map((line) => Number(line.trim()))
        .filter((n) => Number.isFinite(n) && n > 0);
      return counts.length > 0 ? counts[0] : 0;
    }
  }

  // No ffprobe (e.g. only the bundled @ffmpeg-installer binary): `ffmpeg -i <file>` with no output
  // exits non-zero but still prints every stream it found to stderr, one line per stream, e.g.
  // "Stream #0:1(und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, mono, fltp, 69 kb/s".
  const result = await run(FFMPEG_PATH, ["-hide_banner", "-nostdin", "-i", filePath]);
  if (result.spawnError || !/^\s*Input #0/m.test(result.stderr)) return null;
  const audioLine = result.stderr.match(/^\s*Stream #\d+:\d+.*: Audio: (.*)$/m);
  if (!audioLine) return 0;
  const layout = audioLine[1].split(",")[2];
  return layout ? channelsFromLayoutName(layout) : 2;
}

// Audio channel count for every source a clip plays from (0 = the uploaded file has no audio
// stream). buildFfmpegPlan needs this up front: wiring a screen recording's (non-existent) audio
// into the filter graph makes ffmpeg abort the whole export, while the preview just plays the clip
// silently; and a mono voice/TTS file has to be laid out to match how the browser plays it. Images
// are skipped (never have audio, and the plan already forces them silent); a file that can't be
// probed is left out so the plan assumes audio of an unknown layout — what the export always did.
export async function probeSourceAudioChannels(
  project: ProjectModel,
  sourcePaths: Record<string, string>,
): Promise<Record<string, number>> {
  const kindById = new Map(project.sources.map((s) => [s.id, s.kind] as const));
  const candidateIds = [...new Set(project.clips.map((c) => c.sourceId))].filter((id) => kindById.get(id) !== "image" && sourcePaths[id]);

  const channelsBySourceId: Record<string, number> = {};
  let next = 0;
  async function worker() {
    while (next < candidateIds.length) {
      const id = candidateIds[next++];
      const channels = await probeAudioChannels(sourcePaths[id]);
      if (channels !== null) channelsBySourceId[id] = channels;
    }
  }
  await Promise.all(Array.from({ length: Math.min(PROBE_CONCURRENCY, candidateIds.length) }, worker));
  return channelsBySourceId;
}
