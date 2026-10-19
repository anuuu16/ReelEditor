import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseHasAudioStream, probeSourcesForAudio } from "./probeMedia.js";

const SAMPLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../samples");
const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

describe("parseHasAudioStream", () => {
  it("spots an audio stream in ffmpeg's stream listing", () => {
    const stderr = [
      "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'clip.mp4':",
      "  Duration: 00:00:04.00, start: 0.000000, bitrate: 350 kb/s",
      "  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 1280x720, 30 fps",
      "  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, mono, fltp, 69 kb/s (default)",
      "At least one output file must be specified",
    ].join("\n");
    expect(parseHasAudioStream(stderr)).toBe(true);
  });

  it("reports no audio for a video-only listing", () => {
    const stderr = "  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p, 720x1280, 30 fps\n";
    expect(parseHasAudioStream(stderr)).toBe(false);
  });

  it("isn't fooled by the word Audio elsewhere (a file name, say)", () => {
    expect(parseHasAudioStream("Input #0, mov, from 'My Audio: the movie.mp4':\n  Stream #0:0: Video: h264\n")).toBe(false);
  });
});

describe.skipIf(!hasFfmpeg)("probeSourcesForAudio (real ffmpeg, samples/)", () => {
  it("tells a silent screen-recording-style clip from ones with sound, and skips unreadable files", async () => {
    const result = await probeSourcesForAudio({
      land: path.join(SAMPLES, "clip-landscape-4s.mp4"),
      silent: path.join(SAMPLES, "clip-portrait-3s-silent.mp4"),
      music: path.join(SAMPLES, "music-9s.m4a"),
      missing: "/definitely/not/here.mp4",
      notMedia: path.join(SAMPLES, "README.md"),
    });
    expect(result).toEqual({ land: true, silent: false, music: true });
  }, 30_000);

  it("is empty for no sources", async () => {
    expect(await probeSourcesForAudio({})).toEqual({});
  });
});
