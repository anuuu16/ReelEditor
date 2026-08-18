import type { Clip, FitMode, ProjectModel } from "@reel-studio/shared-types";
import { getSequenceDuration, layoutSequentialClips } from "./sequential-layout.js";

export interface RenderPlanInput {
  project: ProjectModel;
  sourcePaths: Record<string, string>;
}

export interface RenderPlan {
  args: string[];
  outputFileName: string;
  totalDurationSeconds: number;
}

function buildFitFilter(fitMode: FitMode, width: number, height: number): string {
  switch (fitMode) {
    case "fill":
      return `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
    case "stretch":
      return `scale=${width}:${height}`;
    case "fit":
    default:
      return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`;
  }
}

function buildFadeSuffix(clip: Clip, duration: number): string {
  const parts: string[] = [];
  const fadeIn = Math.min(Math.max(clip.fadeInSeconds, 0), duration / 2);
  const fadeOut = Math.min(Math.max(clip.fadeOutSeconds, 0), duration / 2);
  // afade's default ("tri") curve is linear, matching the preview compositor's linear fade ramp.
  if (fadeIn > 0) parts.push(`afade=t=in:st=0:d=${fadeIn.toFixed(3)}`);
  if (fadeOut > 0) parts.push(`afade=t=out:st=${(duration - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}`);
  return parts.length > 0 ? `,${parts.join(",")}` : "";
}

function buildAtempoChain(speed: number): string {
  if (speed === 1) return "";
  const factors: number[] = [];
  let remaining = speed;
  while (remaining > 2.0) {
    factors.push(2.0);
    remaining /= 2.0;
  }
  while (remaining < 0.5) {
    factors.push(0.5);
    remaining /= 0.5;
  }
  factors.push(remaining);
  return "," + factors.map((f) => `atempo=${f.toFixed(4)}`).join(",");
}

export function buildFfmpegPlan(input: RenderPlanInput): RenderPlan {
  const { project, sourcePaths } = input;
  const trackKindById = new Map(project.tracks.map((t) => [t.id, t.kind] as const));
  const videoClips = layoutSequentialClips(project.clips.filter((c) => trackKindById.get(c.trackId) === "video"));
  const audioClips = layoutSequentialClips(project.clips.filter((c) => trackKindById.get(c.trackId) === "audio"));

  if (videoClips.length === 0) {
    throw new Error("Add at least one video clip before exporting.");
  }

  const inputPaths: string[] = [];
  const inputIndexBySourceId = new Map<string, number>();
  function inputIndexFor(sourceId: string): number {
    const existing = inputIndexBySourceId.get(sourceId);
    if (existing !== undefined) return existing;
    const path = sourcePaths[sourceId];
    if (!path) throw new Error(`Missing local file for source ${sourceId}`);
    const index = inputPaths.length;
    inputPaths.push(path);
    inputIndexBySourceId.set(sourceId, index);
    return index;
  }

  const { width, height, frameRate } = project.canvas;
  const filterChains: string[] = [];
  const videoLabels: string[] = [];
  const clipAudioLabels: string[] = [];

  function buildAudioChain(clip: Clip, inputIdx: number, duration: number, label: string): string {
    if (clip.muted) {
      return `anullsrc=r=48000:cl=stereo,atrim=duration=${duration.toFixed(3)}[${label}]`;
    }
    return (
      `[${inputIdx}:a]atrim=start=${clip.inPoint}:end=${clip.outPoint},asetpts=PTS-STARTPTS` +
      `${buildAtempoChain(clip.speed)},volume=${clip.volume}${buildFadeSuffix(clip, duration)}[${label}]`
    );
  }

  videoClips.forEach((clip, i) => {
    const inputIdx = inputIndexFor(clip.sourceId);
    const fitFilter = buildFitFilter(clip.fitMode, width, height);
    const vLabel = `v${i}`;
    filterChains.push(
      `[${inputIdx}:v]trim=start=${clip.inPoint}:end=${clip.outPoint},setpts=(PTS-STARTPTS)/${clip.speed},${fitFilter},fps=${frameRate}[${vLabel}]`
    );
    videoLabels.push(`[${vLabel}]`);

    const aLabel = `ca${i}`;
    filterChains.push(buildAudioChain(clip, inputIdx, clip.duration, aLabel));
    clipAudioLabels.push(`[${aLabel}]`);
  });

  const musicLabels: string[] = [];
  audioClips.forEach((clip, i) => {
    const inputIdx = inputIndexFor(clip.sourceId);
    const label = `ma${i}`;
    filterChains.push(buildAudioChain(clip, inputIdx, clip.duration, label));
    musicLabels.push(`[${label}]`);
  });

  filterChains.push(`${videoLabels.join("")}concat=n=${videoLabels.length}:v=1:a=0[vout]`);
  filterChains.push(`${clipAudioLabels.join("")}concat=n=${clipAudioLabels.length}:v=0:a=1[aclips]`);

  let finalAudioLabel = "[aclips]";
  if (musicLabels.length > 0) {
    filterChains.push(`${musicLabels.join("")}concat=n=${musicLabels.length}:v=0:a=1[amusic]`);
    // duration=first anchors output length to the video track; if the audio track runs longer,
    // the tail is dropped (unlike the preview compositor, which keeps playing past the last video frame).
    filterChains.push(`[aclips][amusic]amix=inputs=2:duration=first:dropout_transition=0[aout]`);
    finalAudioLabel = "[aout]";
  }

  const outputFileName = "output.mp4";
  const args: string[] = ["-y"];
  for (const path of inputPaths) {
    args.push("-i", path);
  }
  args.push(
    "-filter_complex",
    filterChains.join(";"),
    "-map",
    "[vout]",
    "-map",
    finalAudioLabel,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    "-progress",
    "pipe:1",
    "-nostats",
    outputFileName
  );

  return {
    args,
    outputFileName,
    totalDurationSeconds: getSequenceDuration(videoClips),
  };
}
