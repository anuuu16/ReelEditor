import { describe, expect, it } from "vitest";
import { buildFfmpegPlan } from "./ffmpeg-plan.js";
import { makeClip, makeProject } from "./test-fixtures.js";

const sourcePaths = { "src-1": "/tmp/clip.mp4" };

describe("buildFfmpegPlan", () => {
  it("refuses a project with no video clips", () => {
    expect(() => buildFfmpegPlan({ project: makeProject({ clips: [] }), sourcePaths })).toThrow(
      "Add at least one video clip before exporting.",
    );
  });

  it("refuses a clip whose file wasn't uploaded", () => {
    expect(() => buildFfmpegPlan({ project: makeProject(), sourcePaths: {} })).toThrow("Missing local file for source src-1");
  });

  it("builds an H.264 export of one clip", () => {
    const plan = buildFfmpegPlan({ project: makeProject(), sourcePaths });
    expect(plan.totalDurationSeconds).toBe(4);
    expect(plan.outputFileName).toBe("output.mp4");
    expect(plan.args[plan.args.length - 1]).toBe("output.mp4");
    expect(plan.args).toContain("/tmp/clip.mp4");
    expect(plan.args.join(" ")).toContain("-c:v libx264");
    expect(plan.args.join(" ")).toContain("-pix_fmt yuv420p");
  });

  it("uses the canvas size, or the export size when given", () => {
    const canvas = buildFfmpegPlan({ project: makeProject(), sourcePaths });
    expect(filterGraph(canvas.args)).toContain("scale=1080:1920");

    const small = buildFfmpegPlan({ project: makeProject(), sourcePaths, output: { width: 720, height: 1280 } });
    expect(filterGraph(small.args)).toContain("scale=720:1280");
  });

  it("adds two clips' lengths, minus the transition", () => {
    const project = makeProject({
      clips: [makeClip({ id: "a", transitionOutSeconds: 1 }), makeClip({ id: "b" })],
    });
    expect(buildFfmpegPlan({ project, sourcePaths }).totalDurationSeconds).toBe(7);
  });

  it("ignores clips on non-video tracks for the length", () => {
    const project = makeProject({
      tracks: [
        { id: "video-1", kind: "video", order: 0, volume: 1, fadeIn: 0, fadeOut: 0 },
        { id: "audio-1", kind: "audio", order: 1, volume: 1, fadeIn: 0, fadeOut: 0 },
      ],
      clips: [makeClip(), makeClip({ id: "music", trackId: "audio-1", outPoint: 9 })],
    });
    expect(buildFfmpegPlan({ project, sourcePaths }).totalDurationSeconds).toBe(4);
  });
});

function filterGraph(args: string[]): string {
  return args[args.indexOf("-filter_complex") + 1];
}
