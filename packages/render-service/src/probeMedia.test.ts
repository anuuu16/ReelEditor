import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import {
  parseDurationSeconds,
  parseHasAudioStream,
  parseIsReadable,
  probeDurationSeconds,
  probeSources,
  probeSourcesForAudio,
} from "./probeMedia.js";

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

  it("tells readable files from damaged ones, and reads an audio flag only off readable ones", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "reel-probe-"));
    try {
      const garbage = path.join(dir, "garbage.mp4");
      writeFileSync(garbage, Buffer.alloc(200_000, 0x5a));
      const empty = path.join(dir, "empty.png");
      writeFileSync(empty, "");
      const result = await probeSources({
        land: path.join(SAMPLES, "clip-landscape-4s.mp4"),
        silent: path.join(SAMPLES, "clip-portrait-3s-silent.mp4"),
        photo: path.join(SAMPLES, "photo-tiny-160x90.png"),
        garbage,
        empty,
        missing: "/definitely/not/here.mp4",
      });
      expect(result).toEqual({
        land: { readable: true, hasAudio: true },
        silent: { readable: true, hasAudio: false },
        photo: { readable: true, hasAudio: false },
        garbage: { readable: false, hasAudio: false },
        empty: { readable: false, hasAudio: false },
        missing: { readable: false, hasAudio: false },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("reads a file's duration back", async () => {
    expect(await probeDurationSeconds(path.join(SAMPLES, "clip-long-30s.mp4"))).toBeCloseTo(30, 1);
    expect(await probeDurationSeconds(path.join(SAMPLES, "README.md"))).toBeNull();
  }, 30_000);
});

describe("parseIsReadable / parseDurationSeconds", () => {
  it("needs a stream line to call a file readable", () => {
    expect(parseIsReadable("  Stream #0:0[0x1](und): Video: h264\n")).toBe(true);
    expect(parseIsReadable("[mov @ 0x1] moov atom not found\nError opening input: Invalid data found when processing input\n")).toBe(false);
    expect(parseIsReadable("")).toBe(false);
  });

  it("reads hours, minutes and fractional seconds out of the Duration line", () => {
    expect(parseDurationSeconds("  Duration: 00:00:15.00, start: 0.000000, bitrate: 331 kb/s\n")).toBe(15);
    expect(parseDurationSeconds("  Duration: 01:02:03.50, start: 0\n")).toBe(3723.5);
    expect(parseDurationSeconds("  Duration: N/A, bitrate: N/A\n")).toBeNull();
    expect(parseDurationSeconds("nothing here")).toBeNull();
  });
});
