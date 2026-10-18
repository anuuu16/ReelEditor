// End-to-end: builds render plans for projects made from the files in samples/, runs them through
// the real ffmpeg and checks the exported file against the timeline the editor plays — same length,
// picture and sound where the timeline has them. Skipped when ffmpeg/ffprobe aren't installed.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import type { Clip, ProjectModel } from "@reel-studio/shared-types";
import { buildFfmpegPlan } from "./ffmpeg-plan.js";
import { getTimelineDuration } from "./track-utils.js";
import { makeClip, makeProject, makeSource, makeTitle } from "./test-fixtures.js";

const SAMPLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../samples");
const OUTPUT = { width: 180, height: 320 };

const hasTool = (tool: string) => spawnSync(tool, ["-version"], { stdio: "ignore" }).status === 0;
const canRun = hasTool("ffmpeg") && hasTool("ffprobe");

const workDirs: string[] = [];
afterAll(() => workDirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "reel-parity-"));
  workDirs.push(dir);
  return dir;
}

// Three solid-colour stills (with a white square) for slideshow clips; there's no image in samples/.
function makeStills(): Record<string, string> {
  if (!canRun) return {};
  const dir = tempDir();
  return Object.fromEntries(
    ["red", "green", "blue"].map((colour, i) => {
      const file = path.join(dir, `still${i + 1}.png`);
      const args = ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=${colour}:s=800x600:d=1`];
      spawnSync("ffmpeg", [...args, "-vf", "drawbox=x=300:y=200:w=200:h=200:c=white:t=fill", "-frames:v", "1", file]);
      return [`still${i + 1}`, file];
    }),
  );
}

const FILES: Record<string, string> = {
  land: path.join(SAMPLES, "clip-landscape-4s.mp4"),
  silent: path.join(SAMPLES, "clip-portrait-3s-silent.mp4"),
  music: path.join(SAMPLES, "music-9s.m4a"),
  ...makeStills(),
};

const TRACKS: ProjectModel["tracks"] = [
  { id: "video-1", kind: "video", order: 0, volume: 1, fadeIn: 0, fadeOut: 0 },
  { id: "audio-1", kind: "audio", order: 1, volume: 1, fadeIn: 0, fadeOut: 0 },
];
const SOURCES = [
  makeSource({ id: "land", durationSeconds: 4, width: 1280, height: 720 }),
  makeSource({ id: "silent", durationSeconds: 3, width: 720, height: 1280 }),
  makeSource({ id: "music", kind: "audio", durationSeconds: 9, width: 0, height: 0 }),
  ...[1, 2, 3].map((i) => makeSource({ id: `still${i}`, kind: "image", durationSeconds: 300, width: 800, height: 600 })),
];
const video = (id: string, sourceId: "land" | "silent", overrides: Partial<Clip> = {}) =>
  makeClip({ id, sourceId, outPoint: sourceId === "land" ? 4 : 3, ...overrides });
const music = (overrides: Partial<Clip> = {}) =>
  makeClip({ id: "music", sourceId: "music", trackId: "audio-1", outPoint: 9, ...overrides });
const still = (id: string, n: 1 | 2 | 3, seconds: number, overrides: Partial<Clip> = {}) =>
  makeClip({ id, sourceId: `still${n}`, outPoint: seconds, muted: true, ...overrides });

// What the render service's probe reports for each sample.
function probeHasAudio(file: string): boolean {
  const out = spawnSync("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", file], {
    encoding: "utf8",
  });
  return out.stdout.trim().length > 0;
}

interface Rendered {
  duration: number;
  videoDuration: number;
  audioDuration: number;
  /** Mean luma of the picture (ignoring the bottom strip where titles sit) at the given time. */
  lumaAt: (t: number) => number;
  /** The whole grayscale frame nearest `t`, for pixel-exact comparisons (e.g. "is this frame held?"). */
  frameAt: (t: number) => Buffer;
  /** Audio RMS in dBFS over [t, t + 0.5). */
  loudnessAt: (t: number) => number;
}

// Mean absolute difference between two equally-sized grayscale frames, 0–255.
function frameDiff(a: Buffer, b: Buffer): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

// ffmpeg runs asynchronously: a synchronous spawn blocks this worker's event loop for the whole
// encode (tens of seconds for the longer cases) and vitest's runner then times out talking to it.
function runFfmpeg(args: string[], cwd: string): Promise<{ status: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn("ffmpeg", ["-v", "error", ...args], { cwd, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    proc.on("close", (status) => resolve({ status, stderr }));
  });
}

async function render(project: ProjectModel): Promise<Rendered> {
  const workDir = tempDir();
  const sourceHasAudio = Object.fromEntries(Object.entries(FILES).map(([id, file]) => [id, probeHasAudio(file)]));
  const plan = buildFfmpegPlan({ project, sourcePaths: FILES, output: OUTPUT, sourceHasAudio });
  for (const file of plan.overlayTextFiles) writeFileSync(path.join(workDir, file.fileName), file.content);
  const args = plan.args.filter((arg, i, all) => arg !== "-progress" && all[i - 1] !== "-progress" && arg !== "-nostats");
  const run = await runFfmpeg(args, workDir);
  if (run.status !== 0) throw new Error(`ffmpeg failed (${run.status}): ${run.stderr}`);
  const output = path.join(workDir, plan.outputFileName);

  const probe = JSON.parse(
    spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,duration", "-of", "json", output], {
      encoding: "utf8",
    }).stdout,
  ) as { format: { duration: string }; streams: { codec_type: string; duration: string }[] };
  const streamDuration = (type: string) => Number(probe.streams.find((s) => s.codec_type === type)?.duration ?? NaN);

  const { width, height } = OUTPUT;
  const frames = spawnSync("ffmpeg", ["-v", "error", "-i", output, "-vf", "fps=4", "-f", "rawvideo", "-pix_fmt", "gray", "-"], {
    maxBuffer: 1 << 28,
  }).stdout;
  const pcm = spawnSync("ffmpeg", ["-v", "error", "-i", output, "-ac", "1", "-ar", "8000", "-f", "f32le", "-"], {
    maxBuffer: 1 << 28,
  }).stdout;
  const samples = new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 4));

  return {
    duration: Number(probe.format.duration),
    videoDuration: streamDuration("video"),
    audioDuration: streamDuration("audio"),
    lumaAt: (t) => {
      const frameSize = width * height;
      const offset = Math.round(t * 4) * frameSize;
      let sum = 0;
      const rows = Math.floor(height * 0.75);
      for (let i = 0; i < rows * width; i++) sum += frames[offset + i];
      return sum / (rows * width);
    },
    frameAt: (t) => {
      const frameSize = width * height;
      const offset = Math.round(t * 4) * frameSize;
      return Buffer.from(frames.subarray(offset, offset + frameSize));
    },
    loudnessAt: (t) => {
      const slice = samples.subarray(Math.round(t * 8000), Math.round((t + 0.5) * 8000));
      const meanSquare = slice.reduce((acc, v) => acc + v * v, 0) / Math.max(1, slice.length);
      return 10 * Math.log10(meanSquare + 1e-12);
    },
  };
}

function expectLength(result: Rendered, project: ProjectModel) {
  const timeline = getTimelineDuration(project);
  expect(result.duration).toBeCloseTo(timeline, 1);
  expect(result.videoDuration).toBeCloseTo(timeline, 1);
  expect(result.audioDuration).toBeCloseTo(timeline, 1);
}

describe.skipIf(!canRun)("export matches the timeline (real ffmpeg, samples/)", () => {
  it("12 s title + 4 s clip + 9 s music → a 12 s reel: clip, then black; music, then silence", async () => {
    const project = makeProject({
      tracks: TRACKS,
      sources: SOURCES,
      clips: [video("v", "land"), music()],
      overlays: [makeTitle({ start: 0, end: 12 })],
    });
    const result = await render(project);
    expectLength(result, project);
    expect(result.lumaAt(2)).toBeGreaterThan(20); // the clip
    expect(result.lumaAt(6)).toBeLessThan(2); // black after the clip, as in the preview
    expect(result.loudnessAt(6)).toBeGreaterThan(-30); // music keeps playing past the clip
    expect(result.loudnessAt(10)).toBeLessThan(-60); // silence once the music ends
  }, 60_000);

  it("exports a video that has no audio track", async () => {
    const project = makeProject({ sources: SOURCES, clips: [video("v", "silent")] });
    const result = await render(project);
    expectLength(result, project);
    expect(result.loudnessAt(1)).toBeLessThan(-60);
  }, 60_000);

  it("mixes a silent clip with sound clips, a dissolve, a gap and music", async () => {
    const project = makeProject({
      tracks: TRACKS,
      sources: SOURCES,
      clips: [
        video("a", "land", { transitionOutSeconds: 0.5 }),
        video("b", "silent"),
        video("c", "land", { gapBeforeSeconds: 1 }),
        music({ gapBeforeSeconds: 2 }),
      ],
    });
    const result = await render(project);
    expectLength(result, project); // 4 + 3 - 0.5 + 1 + 4 = 11.5 s
    expect(result.lumaAt(7)).toBeLessThan(2); // the 1 s gap is black
  }, 60_000);

  it("loops a silent clip repeated back-to-back", async () => {
    const project = makeProject({ sources: SOURCES, clips: [video("a", "silent"), video("b", "silent"), video("c", "silent")] });
    expectLength(await render(project), project);
  }, 60_000);

  it("music shorter than the video: the clips keep playing after the music ends", async () => {
    const project = makeProject({
      tracks: TRACKS,
      sources: SOURCES,
      clips: [video("a", "land"), video("b", "silent"), video("c", "land"), music()],
    });
    const result = await render(project);
    expectLength(result, project); // 11 s of video over 9 s of music
    expect(result.lumaAt(10)).toBeGreaterThan(20); // last clip still showing
    expect(result.loudnessAt(5)).toBeGreaterThan(-30); // music under the silent clip
    expect(result.loudnessAt(10)).toBeGreaterThan(-30); // the last clip's own sound after the music ended
  }, 60_000);

  it("a gap before the first clip is black (with the music playing) in the export too", async () => {
    const project = makeProject({ tracks: TRACKS, sources: SOURCES, clips: [video("a", "land", { gapBeforeSeconds: 2 }), music()] });
    const result = await render(project);
    expectLength(result, project); // 9 s: the music outlasts 2 s gap + 4 s clip
    expect(result.lumaAt(1)).toBeLessThan(2);
    expect(result.lumaAt(3)).toBeGreaterThan(20);
    expect(result.lumaAt(7)).toBeLessThan(2);
    expect(result.loudnessAt(1)).toBeGreaterThan(-30);
  }, 60_000);

  it("a transition on the last clip changes nothing (there's nothing to transition into)", async () => {
    const project = makeProject({
      sources: SOURCES,
      clips: [video("a", "land", { transitionOutSeconds: 1 }), video("b", "silent", { transitionOutSeconds: 1 })],
    });
    const result = await render(project);
    expect(getTimelineDuration(project)).toBe(6);
    expectLength(result, project);
    expect(result.lumaAt(5)).toBeGreaterThan(20); // the last clip plays out in full
  }, 60_000);

  it("a muted clip (e.g. a screen recording) is silent, the rest keep their sound", async () => {
    const project = makeProject({
      sources: SOURCES,
      clips: [video("a", "land", { muted: true }), video("b", "silent"), video("c", "land")],
    });
    const result = await render(project);
    expectLength(result, project);
    expect(result.loudnessAt(2)).toBeLessThan(-60);
    expect(result.loudnessAt(5)).toBeLessThan(-60);
    expect(result.loudnessAt(9)).toBeGreaterThan(-30);
  }, 60_000);

  it("a slideshow of stills with dissolves, over music", async () => {
    const project = makeProject({
      tracks: TRACKS,
      sources: SOURCES,
      clips: [
        still("s1", 1, 2, { transitionOutSeconds: 0.5 }),
        still("s2", 2, 2, { transitionOutSeconds: 0.5 }),
        still("s3", 3, 2),
        music(),
      ],
    });
    const result = await render(project);
    expect(getTimelineDuration(project)).toBe(9); // 2 + 2 + 2 - 0.5 - 0.5 = 5 s of stills, 9 s of music
    expectLength(result, project);
    expect(result.lumaAt(0.5)).toBeGreaterThan(20);
    expect(result.lumaAt(4)).toBeGreaterThan(20);
    expect(result.lumaAt(7)).toBeLessThan(2); // black after the last still
    expect(result.loudnessAt(7)).toBeGreaterThan(-30);
  }, 60_000);

  it("a title that starts before the first clip shows over black", async () => {
    const project = makeProject({
      sources: SOURCES,
      clips: [video("a", "land", { gapBeforeSeconds: 2 })],
      overlays: [makeTitle({ start: 0, end: 3, content: "Before the clip", position: { x: 0.5, y: 0.5 } })],
    });
    const result = await render(project);
    expectLength(result, project); // 6 s
    expect(result.lumaAt(1)).toBeGreaterThan(0.3); // title text on an otherwise black frame
    expect(result.lumaAt(1)).toBeLessThan(10);
    expect(result.loudnessAt(1)).toBeLessThan(-60);
    expect(result.lumaAt(4)).toBeGreaterThan(20);
  }, 60_000);

  it("first and last clips at 2x speed", async () => {
    const project = makeProject({
      sources: SOURCES,
      clips: [video("a", "land", { speed: 2 }), video("b", "silent"), video("c", "land", { speed: 2 })],
    });
    const result = await render(project);
    expect(getTimelineDuration(project)).toBe(7); // 2 + 3 + 2
    expectLength(result, project);
    expect(result.loudnessAt(1)).toBeGreaterThan(-30);
    expect(result.loudnessAt(3.5)).toBeLessThan(-60);
    expect(result.loudnessAt(6)).toBeGreaterThan(-30);
  }, 60_000);

  it("endBehavior 'black' (the default): the screen goes black once the clip runs out", async () => {
    const project = makeProject({ tracks: TRACKS, sources: SOURCES, clips: [video("a", "land"), music()] });
    const result = await render(project);
    expectLength(result, project); // 9 s: the music outlasts the 4 s clip
    expect(result.lumaAt(2)).toBeGreaterThan(20); // the clip is playing
    expect(result.lumaAt(7)).toBeLessThan(2); // black once it's over, music still going
    expect(result.loudnessAt(7)).toBeGreaterThan(-30);
  }, 60_000);

  it("endBehavior 'freeze': the clip's last frame holds instead of cutting to black", async () => {
    const project = makeProject({ tracks: TRACKS, sources: SOURCES, clips: [video("a", "land"), music()], endBehavior: "freeze" });
    const result = await render(project);
    expectLength(result, project); // same 9 s as "black" — only the picture differs
    const lastFrame = result.frameAt(3.9); // just before the 4 s clip ends
    expect(frameDiff(lastFrame, result.frameAt(6))).toBeLessThan(3); // held, not black, not still changing
    expect(frameDiff(lastFrame, result.frameAt(8.7))).toBeLessThan(3); // still held right up to the end
    expect(result.lumaAt(8.7)).toBeGreaterThan(20); // (the held frame itself isn't black)
    expect(result.loudnessAt(7)).toBeGreaterThan(-30); // "freeze" is picture-only — audio still plays
  }, 60_000);

  it("endBehavior 'freeze' with no video clip falls back to black (there's no frame to hold)", async () => {
    const project = makeProject({ tracks: TRACKS, sources: SOURCES, clips: [music()], endBehavior: "freeze" });
    const result = await render(project);
    expectLength(result, project);
    expect(result.lumaAt(5)).toBeLessThan(2);
  }, 60_000);

  it("endBehavior 'trim': the reel ends with the video track, dropping the title and music past it", async () => {
    const project = makeProject({
      tracks: TRACKS,
      sources: SOURCES,
      clips: [video("a", "land"), music()],
      overlays: [makeTitle({ start: 0, end: 12 })],
      endBehavior: "trim",
    });
    expect(getTimelineDuration(project)).toBe(4); // the clip, not the 9 s of music or the 12 s title
    const result = await render(project);
    expectLength(result, project);
    expect(result.duration).toBeLessThan(4.5);
  }, 60_000);

  it("one small clip repeated 12 times with dissolves comes out exactly the timeline's length", async () => {
    const clips = Array.from({ length: 12 }, (_, i) => video(`r${i}`, "land", { transitionOutSeconds: i < 11 ? 0.5 : 0 }));
    const project = makeProject({ sources: SOURCES, clips });
    expect(getTimelineDuration(project)).toBe(12 * 4 - 11 * 0.5);
    const result = await render(project);
    expectLength(result, project);
    expect(result.loudnessAt(20)).toBeGreaterThan(-30);
    expect(result.lumaAt(41)).toBeGreaterThan(20);
  }, 120_000);

  it("one small clip repeated 12 times back-to-back (one looped input) is exactly 12x its length", async () => {
    const project = makeProject({ sources: SOURCES, clips: Array.from({ length: 12 }, (_, i) => video(`r${i}`, "land")) });
    const result = await render(project);
    expect(getTimelineDuration(project)).toBe(48);
    expectLength(result, project); // the old export drifted ~0.04 s longer per repeat
  }, 120_000);

  it("renders a title over music with no video clips on black", async () => {
    const project = makeProject({ tracks: TRACKS, sources: SOURCES, clips: [music()], overlays: [makeTitle({ start: 1, end: 4 })] });
    const result = await render(project);
    expectLength(result, project);
    expect(result.loudnessAt(2)).toBeGreaterThan(-30);
  }, 60_000);
});
