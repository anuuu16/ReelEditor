import { describe, expect, it } from "vitest";
import type { Overlay, ProjectModel, Track } from "@reel-studio/shared-types";
import { buildFfmpegPlan, VIDEO_PAD_SLACK_SECONDS } from "./ffmpeg-plan.js";
import { makeClip, makeProject, makeSource } from "./test-fixtures.js";
import { getProjectDuration } from "./track-utils.js";

const sourcePaths = { "src-1": "/tmp/clip.mp4", "src-music": "/tmp/music.m4a", "src-silent": "/tmp/screen-recording.mp4" };

const audioTrack: Track = { id: "audio-1", kind: "audio", order: 1, volume: 1, fadeIn: 0, fadeOut: 0 };
const overlayTrack: Track = { id: "overlay-1", kind: "overlay", order: 2, volume: 1, fadeIn: 0, fadeOut: 0 };

function makeTitle(overrides: Partial<Overlay> = {}): Overlay {
  return {
    id: "title-1",
    trackId: "overlay-1",
    kind: "text",
    content: "Hello",
    imageSourceId: null,
    widthRatio: 1,
    heightRatio: 1,
    start: 0,
    end: 3,
    position: { x: 0.5, y: 0.85 },
    style: { font: "system-ui", size: 48, color: "#ffffff", align: "center", background: null, outline: null },
    animation: "none",
    ...overrides,
  };
}

// The scenario from the bug report: a 12 s title, a 4 s video clip and 9 s of music. The editor
// plays 12 s; the export used to come out at 4 s.
function makeTitleVideoMusicProject(): ProjectModel {
  return makeProject({
    tracks: [{ id: "video-1", kind: "video", order: 0, volume: 1, fadeIn: 0, fadeOut: 0 }, audioTrack, overlayTrack],
    sources: [makeSource(), makeSource({ id: "src-music", kind: "audio", durationSeconds: 9, width: 0, height: 0 })],
    clips: [makeClip(), makeClip({ id: "music", sourceId: "src-music", trackId: "audio-1", outPoint: 9 })],
    overlays: [makeTitle({ end: 12 })],
  });
}

describe("buildFfmpegPlan", () => {
  it("refuses a completely empty timeline", () => {
    expect(() => buildFfmpegPlan({ project: makeProject({ clips: [] }), sourcePaths })).toThrow(
      "Add a clip, audio or title to the timeline before exporting.",
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

  it("pins the output file to the planned length", () => {
    const args = buildFfmpegPlan({ project: makeProject(), sourcePaths }).args;
    expect(args[args.indexOf("-t") + 1]).toBe("4.000");
  });
});

describe("buildFfmpegPlan — export length matches the editor's timeline", () => {
  it("runs to the end of the longest audio track, not just the video track", () => {
    const project = makeProject({
      tracks: [{ id: "video-1", kind: "video", order: 0, volume: 1, fadeIn: 0, fadeOut: 0 }, audioTrack],
      sources: [makeSource(), makeSource({ id: "src-music", kind: "audio", durationSeconds: 9, width: 0, height: 0 })],
      clips: [makeClip(), makeClip({ id: "music", sourceId: "src-music", trackId: "audio-1", outPoint: 9 })],
    });
    const plan = buildFfmpegPlan({ project, sourcePaths });
    expect(plan.totalDurationSeconds).toBe(9);
    expect(plan.totalDurationSeconds).toBe(getProjectDuration(project));
    // 5 s of black after the 4 s clip, silence under the music's tail, and a mix that doesn't stop early.
    expect(filterGraph(plan.args)).toContain("tpad=stop_mode=add:stop_duration=6.000:color=black,trim=end=9.000");
    expect(filterGraph(plan.args)).toContain("apad=whole_dur=9.000");
    expect(filterGraph(plan.args)).toContain("amix=inputs=2:duration=longest:normalize=0");
    expect(filterGraph(plan.args)).not.toContain("duration=first");
  });

  it("runs to the end of a title that outlasts every clip", () => {
    const project = makeProject({
      tracks: [{ id: "video-1", kind: "video", order: 0, volume: 1, fadeIn: 0, fadeOut: 0 }, overlayTrack],
      overlays: [makeTitle({ end: 12 })],
    });
    const plan = buildFfmpegPlan({ project, sourcePaths });
    expect(plan.totalDurationSeconds).toBe(12);
    const graph = filterGraph(plan.args);
    expect(graph).toContain("tpad=stop_mode=add:stop_duration=9.000:color=black,trim=end=12.000[vpad]");
    // The title is drawn onto the padded video, so it's visible over the black tail too.
    expect(graph).toMatch(/\[vpad\]drawtext=.*enable='between\(t,0,12\)'/);
    expect(graph).toContain("apad=whole_dur=12.000");
  });

  it("12 s title + 4 s clip + 9 s music exports as 12 s, like the preview plays it", () => {
    const project = makeTitleVideoMusicProject();
    expect(getProjectDuration(project)).toBe(12);
    const plan = buildFfmpegPlan({ project, sourcePaths });
    expect(plan.totalDurationSeconds).toBe(12);
    expect(plan.args[plan.args.indexOf("-t") + 1]).toBe("12.000");
    const graph = filterGraph(plan.args);
    expect(graph).toContain("tpad=stop_mode=add:stop_duration=9.000:color=black,trim=end=12.000");
    // Both the clip-audio lane and the music lane are padded to 12 s before mixing.
    expect(graph.match(/apad=whole_dur=12\.000/g)).toHaveLength(2);
  });

  it("still pins both lanes to the project length when the video track is the longest thing", () => {
    const graph = filterGraph(buildFfmpegPlan({ project: makeProject(), sourcePaths }).args);
    // Only the slack is padded (then trimmed away again), so a clip whose file holds slightly fewer
    // frames than its metadata claims still comes out exactly as long as the timeline says.
    expect(graph).toContain(`tpad=stop_mode=add:stop_duration=${VIDEO_PAD_SLACK_SECONDS.toFixed(3)}:color=black,trim=end=4.000`);
    // apad is a harmless no-op on a lane that already reaches the end, so it's still applied.
    expect(graph).toContain("apad=whole_dur=4.000");
  });

  it("exports black frames under music and a title when the video track is empty", () => {
    const project = makeProject({
      tracks: [{ id: "video-1", kind: "video", order: 0, volume: 1, fadeIn: 0, fadeOut: 0 }, audioTrack, overlayTrack],
      sources: [makeSource({ id: "src-music", kind: "audio", durationSeconds: 9, width: 0, height: 0 })],
      clips: [makeClip({ id: "music", sourceId: "src-music", trackId: "audio-1", outPoint: 9 })],
      overlays: [makeTitle({ end: 3 })],
    });
    const plan = buildFfmpegPlan({ project, sourcePaths });
    expect(plan.totalDurationSeconds).toBe(9);
    const graph = filterGraph(plan.args);
    expect(graph).toContain("color=c=black:s=1080x1920:r=30:d=9.000,format=yuv420p,setsar=1[vblack]");
    expect(graph).toContain("[vblack]drawtext=");
    expect(graph).toContain("anullsrc=r=48000:cl=stereo,atrim=duration=9.000[asilence]");
    expect(plan.args).not.toContain("/tmp/clip.mp4");
  });

  it("still refuses when nothing on the timeline has any length", () => {
    const project = makeProject({
      tracks: [{ id: "video-1", kind: "video", order: 0, volume: 1, fadeIn: 0, fadeOut: 0 }, audioTrack],
      clips: [],
    });
    expect(() => buildFfmpegPlan({ project, sourcePaths })).toThrow("before exporting");
  });
});

describe("buildFfmpegPlan — sources without an audio stream", () => {
  const silentProject = () =>
    makeProject({
      sources: [makeSource({ id: "src-silent", name: "screen-recording.mp4", durationSeconds: 3 })],
      clips: [makeClip({ sourceId: "src-silent", outPoint: 3 })],
    });

  it("wires a silent video clip's audio lane as generated silence instead of [N:a]", () => {
    const plan = buildFfmpegPlan({ project: silentProject(), sourcePaths, sourceAudioChannels: { "src-silent": 0 } });
    const graph = filterGraph(plan.args);
    expect(graph).not.toContain(":a]");
    expect(graph).toContain("anullsrc=r=48000:cl=stereo,atrim=duration=3.000[ca0]");
    // The picture is untouched.
    expect(graph).toContain("[0:v]trim=start=0:end=3");
  });

  it("uses the file's audio when it isn't flagged (the probe found an audio stream)", () => {
    const plan = buildFfmpegPlan({ project: silentProject(), sourcePaths });
    expect(filterGraph(plan.args)).toContain("[0:a]atrim=start=0:end=3");
  });

  it("applies to a repeated whole-file run (the -stream_loop path) too", () => {
    const project = makeProject({
      sources: [makeSource({ id: "src-silent", durationSeconds: 3 })],
      clips: [makeClip({ id: "a", sourceId: "src-silent", outPoint: 3 }), makeClip({ id: "b", sourceId: "src-silent", outPoint: 3 })],
    });
    const plan = buildFfmpegPlan({ project, sourcePaths, sourceAudioChannels: { "src-silent": 0 } });
    const graph = filterGraph(plan.args);
    expect(plan.args).toContain("-stream_loop");
    expect(graph).not.toContain(":a]");
    expect(graph).toContain("anullsrc=r=48000:cl=stereo,atrim=duration=6.000[ca0]");
  });

  it("copies a mono file to both channels at full level, like the browser does", () => {
    const plan = buildFfmpegPlan({ project: makeProject(), sourcePaths, sourceAudioChannels: { "src-1": 1 } });
    expect(filterGraph(plan.args)).toContain("[0:a]atrim=start=0:end=4,asetpts=PTS-STARTPTS,pan=stereo|c0=c0|c1=c0,volume=1");
  });

  it("leaves stereo, wider and unprobed layouts to ffmpeg", () => {
    for (const channels of [2, 6, undefined]) {
      const plan = buildFfmpegPlan({
        project: makeProject(),
        sourcePaths,
        sourceAudioChannels: channels === undefined ? {} : { "src-1": channels },
      });
      expect(filterGraph(plan.args)).not.toContain("pan=");
      expect(filterGraph(plan.args)).toContain("[0:a]atrim=start=0:end=4,asetpts=PTS-STARTPTS,volume=1");
    }
  });

  it("applies to a clip on an audio track whose file has no audio stream", () => {
    const project = makeProject({
      tracks: [{ id: "video-1", kind: "video", order: 0, volume: 1, fadeIn: 0, fadeOut: 0 }, audioTrack],
      sources: [makeSource(), makeSource({ id: "src-silent", kind: "audio", durationSeconds: 3 })],
      clips: [makeClip(), makeClip({ id: "m", sourceId: "src-silent", trackId: "audio-1", outPoint: 3 })],
    });
    const plan = buildFfmpegPlan({ project, sourcePaths, sourceAudioChannels: { "src-silent": 0 } });
    const graph = filterGraph(plan.args);
    expect(graph).toContain("[0:a]atrim=start=0:end=4");
    expect(graph).toContain("anullsrc=r=48000:cl=stereo,atrim=duration=3.000[ma0_0]");
  });
});

function filterGraph(args: string[]): string {
  return args[args.indexOf("-filter_complex") + 1];
}
