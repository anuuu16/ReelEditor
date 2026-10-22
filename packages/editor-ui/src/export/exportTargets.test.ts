import { describe, expect, it } from "vitest";
import type { ProjectModel } from "@reel-studio/shared-types";
import { createInitialProject } from "../state/initialProject.js";
import { createTarget, duplicateTargetIds, fileNamesFor, formatBytes, outputFor, outputsFor, warningsFor } from "./exportTargets.js";

function project(overrides: Partial<ProjectModel> = {}): ProjectModel {
  const base = createInitialProject();
  return { ...base, metadata: { ...base.metadata, name: "My reel" }, ...overrides };
}

describe("export targets", () => {
  it("sizes an output from the canvas and the quality tier, rounded to even pixels", () => {
    const p = project();
    expect(outputFor(createTarget(), p)).toEqual({ width: 1080, height: 1920, format: "mp4", label: null });
    expect(outputFor(createTarget({ qualityId: "720p", format: "webm" }), p)).toMatchObject({ width: 720, height: 1280, format: "webm" });
    expect(outputFor(createTarget({ qualityId: "4k", presetId: "instagram-reel" }), p)).toMatchObject({
      width: 2160,
      height: 3840,
      label: "Instagram Reel",
    });
  });

  it("previews exactly the file names the service will use, duplicates numbered", () => {
    const p = project();
    const targets = [
      createTarget({ presetId: "instagram-reel" }),
      createTarget({ format: "gif", qualityId: "720p" }),
      createTarget({ presetId: "instagram-reel" }),
    ];
    expect(fileNamesFor(targets, p)).toEqual([
      "My reel - Instagram Reel 1080x1920.mp4",
      "My reel - 720x1280.gif",
      "My reel - Instagram Reel 1080x1920 (2).mp4",
    ]);
    expect(duplicateTargetIds(targets)).toEqual(new Set([targets[2].id]));
    expect(outputsFor(targets, p)).toHaveLength(3);
  });

  it("warns about the things worth knowing per output", () => {
    const p = project();
    const fine = warningsFor(createTarget({ presetId: "instagram-reel" }), p, 30, 1920);
    expect(fine).toEqual({ aspectMismatch: null, overDuration: null, upscaleFrom: null, silent: false });

    const square = warningsFor(createTarget({ presetId: "square-post" }), p, 30, 1920);
    expect(square.aspectMismatch?.id).toBe("square-post");

    const long = warningsFor(createTarget({ presetId: "youtube-shorts" }), p, 61, 1920);
    expect(long.overDuration?.id).toBe("youtube-shorts");

    const upscaled = warningsFor(createTarget({ qualityId: "4k" }), p, 30, 1280);
    expect(upscaled.upscaleFrom).toBe(1280);

    expect(warningsFor(createTarget({ format: "gif" }), p, 30, 0).silent).toBe(true);
  });

  it("formats sizes the way a download dialog would", () => {
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(45_000)).toBe("44 KB");
    expect(formatBytes(12_345_678)).toBe("11.8 MB");
    expect(formatBytes(3_000_000_000)).toBe("2.79 GB");
  });
});
