import { describe, expect, it } from "vitest";
import { buildFfmpegPlan } from "./ffmpeg-plan.js";
import { getTimelineDuration } from "./track-utils.js";
import { makeClip, makeProject, makeSource, makeTitle } from "./test-fixtures.js";

const sourcePaths = { "src-1": "/tmp/clip.mp4" };
const withAudioTrack = {
  tracks: [
    { id: "video-1", kind: "video" as const, order: 0, volume: 1, fadeIn: 0, fadeOut: 0 },
    { id: "audio-1", kind: "audio" as const, order: 1, volume: 1, fadeIn: 0, fadeOut: 0 },
  ],
};

describe("buildFfmpegPlan", () => {
  it("refuses an empty timeline", () => {
    expect(() => buildFfmpegPlan({ project: makeProject({ clips: [] }), sourcePaths })).toThrow("Nothing to export yet");
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

  it("runs as long as the longest audio track, like the preview", () => {
    const project = makeProject({
      ...withAudioTrack,
      clips: [makeClip(), makeClip({ id: "music", sourceId: "music", trackId: "audio-1", outPoint: 9 })],
      sources: [makeSource(), makeSource({ id: "music", kind: "audio", durationSeconds: 9 })],
    });
    const plan = buildFfmpegPlan({ project, sourcePaths: { ...sourcePaths, music: "/tmp/music.m4a" } });
    expect(plan.totalDurationSeconds).toBe(9);
    // The 4 s of video is followed by 5 s of black; the clip audio lane by 5 s of silence.
    expect(filterGraph(plan.args)).toContain("color=c=black:s=1080x1920:r=30:d=5.000");
    expect(filterGraph(plan.args)).toContain("anullsrc=r=48000:cl=stereo,atrim=duration=5.000");
  });

  it("runs as long as the last title: 12 s title + 4 s clip + 9 s music exports 12 s", () => {
    const project = makeProject({
      ...withAudioTrack,
      clips: [makeClip(), makeClip({ id: "music", sourceId: "music", trackId: "audio-1", outPoint: 9 })],
      sources: [makeSource({ durationSeconds: 4 }), makeSource({ id: "music", kind: "audio", durationSeconds: 9 })],
      overlays: [makeTitle({ start: 0, end: 12 })],
    });
    const plan = buildFfmpegPlan({ project, sourcePaths: { ...sourcePaths, music: "/tmp/music.m4a" } });
    expect(plan.totalDurationSeconds).toBe(12);
    expect(plan.totalDurationSeconds).toBe(getTimelineDuration(project));
    const graph = filterGraph(plan.args);
    expect(graph).toContain("color=c=black:s=1080x1920:r=30:d=8.000"); // video padded 4 → 12
    expect(graph).toContain("anullsrc=r=48000:cl=stereo,atrim=duration=3.000"); // music padded 9 → 12
    expect(argAfter(plan.args, "-t")).toBe("12.000");
  });

  it("renders a title over music on black when there's no video clip", () => {
    const project = makeProject({
      ...withAudioTrack,
      clips: [makeClip({ id: "music", sourceId: "music", trackId: "audio-1", outPoint: 9 })],
      sources: [makeSource({ id: "music", kind: "audio", durationSeconds: 9 })],
      overlays: [makeTitle({ start: 0, end: 5 })],
    });
    const plan = buildFfmpegPlan({ project, sourcePaths: { music: "/tmp/music.m4a" } });
    expect(plan.totalDurationSeconds).toBe(9);
    expect(filterGraph(plan.args)).toContain("color=c=black:s=1080x1920:r=30:d=9.000");
  });

  it("plays a video with no audio stream as silence instead of referencing it", () => {
    const plan = buildFfmpegPlan({ project: makeProject(), sourcePaths, sourceHasAudio: { "src-1": false } });
    expect(filterGraph(plan.args)).not.toContain("[0:a]");
    expect(filterGraph(plan.args)).toContain("anullsrc=r=48000:cl=stereo,atrim=duration=4.000");
  });

  it("plays a silent source repeated back-to-back as silence too", () => {
    const project = makeProject({ clips: [makeClip({ id: "a", outPoint: 10 }), makeClip({ id: "b", outPoint: 10 })] });
    const plan = buildFfmpegPlan({ project, sourcePaths, sourceHasAudio: { "src-1": false } });
    expect(plan.args).toContain("-stream_loop");
    expect(filterGraph(plan.args)).not.toContain(":a]");
  });

  it("uses a source's audio when it has some, or wasn't probed", () => {
    expect(filterGraph(buildFfmpegPlan({ project: makeProject(), sourcePaths, sourceHasAudio: { "src-1": true } }).args)).toContain(
      "[1:a]",
    );
    expect(filterGraph(buildFfmpegPlan({ project: makeProject(), sourcePaths }).args)).toContain("[1:a]");
  });

  it("opens each clip twice — a video-only and an audio-only input — so audio demand can't queue up video", () => {
    const { args } = buildFfmpegPlan({ project: makeProject(), sourcePaths });
    const inputs = args.map((a, i) => (a === "-i" ? args.slice(Math.max(0, i - 4), i + 2).join(" ") : null)).filter((x) => x !== null);
    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toContain("-an -i /tmp/clip.mp4");
    expect(inputs[1]).toContain("-vn -i /tmp/clip.mp4");
    expect(filterGraph(args)).toContain("[0:v]");
    expect(filterGraph(args)).toContain("[1:a]");
  });

  it("doesn't open an audio input for a muted clip or one with no audio stream", () => {
    const muted = buildFfmpegPlan({ project: makeProject({ clips: [makeClip({ muted: true })] }), sourcePaths });
    expect(muted.args.filter((a) => a === "-i")).toHaveLength(1);
    const silent = buildFfmpegPlan({ project: makeProject(), sourcePaths, sourceHasAudio: { "src-1": false } });
    expect(silent.args.filter((a) => a === "-i")).toHaveLength(1);
  });

  it("holds every clip to exactly its timeline length", () => {
    const graph = filterGraph(buildFfmpegPlan({ project: makeProject(), sourcePaths }).args);
    expect(graph).toContain("tpad=stop_mode=clone:stop_duration=4.000,trim=duration=4.000");
    expect(graph).toContain("apad,atrim=duration=4.000");
  });

  it("mixes audio tracks at full level, as the preview plays them", () => {
    const project = makeProject({
      ...withAudioTrack,
      clips: [makeClip(), makeClip({ id: "music", sourceId: "music", trackId: "audio-1" })],
      sources: [makeSource(), makeSource({ id: "music", kind: "audio" })],
    });
    const graph = filterGraph(buildFfmpegPlan({ project, sourcePaths: { ...sourcePaths, music: "/tmp/music.m4a" } }).args);
    expect(graph).toContain("amix=inputs=2:duration=longest:dropout_transition=0,volume=2[aout]");
  });

  it("caps clip volume at 100%, like the preview", () => {
    const graph = filterGraph(buildFfmpegPlan({ project: makeProject({ clips: [makeClip({ volume: 1.8 })] }), sourcePaths }).args);
    expect(graph).toContain("volume=1,");
  });

  it("applies clip opacity over black", () => {
    const graph = filterGraph(buildFfmpegPlan({ project: makeProject({ clips: [makeClip({ opacity: 0.5 })] }), sourcePaths }).args);
    expect(graph).toContain("colorchannelmixer=rr=0.5000:gg=0.5000:bb=0.5000");
  });

  it("endBehavior 'black' (the default) pads the short video lane with a black filler clip", () => {
    const project = makeProject({
      ...withAudioTrack,
      clips: [makeClip(), makeClip({ id: "music", sourceId: "music", trackId: "audio-1", outPoint: 9 })],
      sources: [makeSource(), makeSource({ id: "music", kind: "audio", durationSeconds: 9 })],
    });
    const graph = filterGraph(buildFfmpegPlan({ project, sourcePaths: { ...sourcePaths, music: "/tmp/music.m4a" } }).args);
    expect(graph).toContain("color=c=black:s=1080x1920:r=30:d=5.000");
    expect(graph).not.toContain("stop_mode=clone:stop_duration=5.000"); // no lane-level freeze-pad
  });

  it("endBehavior 'freeze' holds the video lane's last frame instead of cutting to black", () => {
    const project = makeProject({
      ...withAudioTrack,
      clips: [makeClip(), makeClip({ id: "music", sourceId: "music", trackId: "audio-1", outPoint: 9 })],
      sources: [makeSource(), makeSource({ id: "music", kind: "audio", durationSeconds: 9 })],
      endBehavior: "freeze",
    });
    const plan = buildFfmpegPlan({ project, sourcePaths: { ...sourcePaths, music: "/tmp/music.m4a" } });
    expect(plan.totalDurationSeconds).toBe(9); // same length as "black" — only the filler differs
    const graph = filterGraph(plan.args);
    expect(graph).toContain("tpad=stop_mode=clone:stop_duration=5.000");
    expect(graph).not.toMatch(/color=c=black.*\[vlanefill\]/); // no black filler clip spliced in
    // The clip audio lane (and the music) still just go silent — "freeze" is picture-only.
    expect(graph).toContain("anullsrc=r=48000:cl=stereo,atrim=duration=5.000");
  });

  it("endBehavior 'freeze' with no video clip at all falls back to black (nothing to hold)", () => {
    const project = makeProject({
      ...withAudioTrack,
      clips: [makeClip({ trackId: "audio-1", outPoint: 5, sourceId: "music" })],
      sources: [makeSource({ id: "music", kind: "audio", durationSeconds: 5 })],
      endBehavior: "freeze",
    });
    const graph = filterGraph(buildFfmpegPlan({ project, sourcePaths: { music: "/tmp/music.m4a" } }).args);
    expect(graph).toContain("color=c=black:s=1080x1920:r=30:d=5.000");
    expect(graph).not.toContain("stop_mode=clone:stop_duration=5.000");
  });

  it("endBehavior 'trim' cuts the export down to the video track's own length", () => {
    const project = makeProject({
      ...withAudioTrack,
      clips: [makeClip(), makeClip({ id: "music", sourceId: "music", trackId: "audio-1", outPoint: 9 })],
      sources: [makeSource(), makeSource({ id: "music", kind: "audio", durationSeconds: 9 })],
      overlays: [makeTitle({ start: 0, end: 12 })],
      endBehavior: "trim",
    });
    const plan = buildFfmpegPlan({ project, sourcePaths: { ...sourcePaths, music: "/tmp/music.m4a" } });
    expect(plan.totalDurationSeconds).toBe(4); // the 4 s clip, not the 9 s of music or the 12 s title
    expect(argAfter(plan.args, "-t")).toBe("4.000");
    const graph = filterGraph(plan.args);
    expect(graph).not.toContain("vlanefill"); // no padding needed — the video lane already fills the whole reel
    expect(graph).not.toContain("vlanefrozen");
  });

  it("sizes titles for the export resolution and draws them literally", () => {
    const project = makeProject({ overlays: [makeTitle({ start: 0, end: 2 })] });
    const graph = filterGraph(buildFfmpegPlan({ project, sourcePaths, output: { width: 540, height: 960 } }).args);
    expect(graph).toContain("fontsize='24'"); // 48 px on the 1080-wide canvas → 24 px at 540 wide
    expect(graph).toContain("expansion=none");
    expect(graph).toContain("enable='gte(t,0)*lt(t,2)'");
  });
});

function argAfter(args: string[], flag: string): string | undefined {
  const index = args.lastIndexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function filterGraph(args: string[]): string {
  return args[args.indexOf("-filter_complex") + 1];
}

describe("buildFfmpegPlan — output formats", () => {
  it("defaults to mp4, exactly as before", () => {
    const plan = buildFfmpegPlan({ project: makeProject(), sourcePaths });
    expect(plan.format).toBe("mp4");
    expect(plan.outputFileName).toBe("output.mp4");
    expect(plan.args.join(" ")).toContain("-c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart");
  });

  it("writes webm with VP9 + Opus and the audio lane mapped", () => {
    const plan = buildFfmpegPlan({ project: makeProject(), sourcePaths, output: { width: 540, height: 960, format: "webm" } });
    expect(plan.outputFileName).toBe("output.webm");
    expect(plan.args[plan.args.length - 1]).toBe("output.webm");
    expect(plan.args.join(" ")).toContain("-c:v libvpx-vp9");
    expect(plan.args.join(" ")).toContain("-c:a libopus");
    expect(plan.args.filter((a) => a === "-map")).toHaveLength(2);
    expect(filterGraph(plan.args)).toContain("scale=540:960");
  });

  it("writes mov with the same encoder settings as mp4", () => {
    const mov = buildFfmpegPlan({ project: makeProject(), sourcePaths, output: { width: 1080, height: 1920, format: "mov" } });
    const mp4 = buildFfmpegPlan({ project: makeProject(), sourcePaths, output: { width: 1080, height: 1920, format: "mp4" } });
    expect(mov.outputFileName).toBe("output.mov");
    expect(mov.args.slice(0, -1)).toEqual(mp4.args.slice(0, -1));
  });

  it("writes gif through a generated palette at 15 fps, with no audio stream mapped", () => {
    const plan = buildFfmpegPlan({ project: makeProject(), sourcePaths, output: { width: 270, height: 480, format: "gif" } });
    expect(plan.outputFileName).toBe("output.gif");
    const graph = filterGraph(plan.args);
    expect(graph).toContain("fps=15,split[gifsrc][gifpal];[gifpal]palettegen=stats_mode=diff[pal];[gifsrc][pal]paletteuse=");
    expect(graph).toMatch(/anullsink$/);
    expect(plan.args.filter((a) => a === "-map")).toHaveLength(1);
    expect(argAfter(plan.args, "-map")).toBe("[gifout]");
    expect(plan.args.join(" ")).not.toContain("libx264");
    expect(plan.args.join(" ")).not.toContain("-c:a");
  });
});
