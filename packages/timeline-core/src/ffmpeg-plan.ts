import type { Clip, FitMode, Overlay, ProjectModel, TransitionType } from "@reel-studio/shared-types";
import { getOverlapSeconds, getSequenceDuration, layoutSequentialClips, type LaidOutClip } from "./sequential-layout.js";
import { FADE_DURATION_SECONDS, slideStartOffsetRatio } from "./overlay-animation.js";
import { buildFfmpegColorFilter } from "./filter-presets.js";
import { buildPanZoomFilter } from "./fit-rect.js";
import { getTracksByKind } from "./track-utils.js";

export interface RenderPlanInput {
  project: ProjectModel;
  sourcePaths: Record<string, string>;
  /** Overrides the project canvas size for the final render (e.g. a 4K/2K/720p export quality choice). */
  output?: { width: number; height: number };
}

export interface OverlayTextFile {
  fileName: string;
  content: string;
}

export interface RenderPlan {
  args: string[];
  outputFileName: string;
  totalDurationSeconds: number;
  overlayTextFiles: OverlayTextFile[];
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

// Same fadeInSeconds/fadeOutSeconds fields as the audio fade, applied as a fade-to-black
// transition on the video — the preview compositor achieves the same look by multiplying
// globalAlpha (computeFadeMultiplier) against a black-cleared canvas.
function buildVideoFadeSuffix(clip: Clip, duration: number): string {
  const parts: string[] = [];
  const fadeIn = Math.min(Math.max(clip.fadeInSeconds, 0), duration / 2);
  const fadeOut = Math.min(Math.max(clip.fadeOutSeconds, 0), duration / 2);
  if (fadeIn > 0) parts.push(`fade=t=in:st=0:d=${fadeIn.toFixed(3)}:color=black`);
  if (fadeOut > 0) parts.push(`fade=t=out:st=${(duration - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}:color=black`);
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

// No `font=`/`fontfile=` option: there's no font-family control in the UI yet, so this
// intentionally falls back to ffmpeg's compiled-in default rather than guessing a system font.
function buildDrawtextFilter(overlay: Overlay, fileName: string): string {
  const duration = overlay.end - overlay.start;
  const fadeDuration = Math.min(FADE_DURATION_SECONDS, duration / 2);
  const animDuration = Math.min(FADE_DURATION_SECONDS, duration);

  const slideTerm =
    overlay.animation === "slide-in" && animDuration > 0
      ? `+if(lt(t,${overlay.start}+${animDuration}),(${slideStartOffsetRatio(overlay)})*(1-(t-${overlay.start})/${animDuration}),0)`
      : "";

  const xExpr =
    overlay.style.align === "center"
      ? `(${overlay.position.x}${slideTerm})*w-text_w/2`
      : overlay.style.align === "right"
        ? `(${overlay.position.x}${slideTerm})*w-text_w`
        : `(${overlay.position.x}${slideTerm})*w`;
  const yExpr = `${overlay.position.y}*h-text_h/2`;

  const alphaExpr =
    overlay.animation === "fade" && fadeDuration > 0
      ? `if(lt(t,${overlay.start}+${fadeDuration}),(t-${overlay.start})/${fadeDuration},if(gt(t,${overlay.end}-${fadeDuration}),(${overlay.end}-t)/${fadeDuration},1))`
      : "1";

  const fontSizeExpr =
    overlay.animation === "pop" && animDuration > 0
      ? `if(lt(t,${overlay.start}+${animDuration}),${overlay.style.size}*(0.5+0.5*(t-${overlay.start})/${animDuration}),${overlay.style.size})`
      : `${overlay.style.size}`;

  const parts = [
    `textfile=${fileName}`,
    `fontsize='${fontSizeExpr}'`,
    `fontcolor=${overlay.style.color}`,
    `x='${xExpr}'`,
    `y='${yExpr}'`,
    `enable='between(t,${overlay.start},${overlay.end})'`,
    `alpha='${alphaExpr}'`,
  ];
  if (overlay.style.background) parts.push(`box=1:boxcolor=${overlay.style.background}:boxborderw=${overlay.style.size * 0.2}`);
  if (overlay.style.outline) parts.push(`bordercolor=${overlay.style.outline}:borderw=${Math.max(1, overlay.style.size * 0.06)}`);

  return `drawtext=${parts.join(":")}`;
}

function buildImageScaleChain(overlay: Overlay, canvasWidth: number, canvasHeight: number): string {
  const duration = overlay.end - overlay.start;
  const fadeDuration = Math.min(FADE_DURATION_SECONDS, duration / 2);
  const logoWidthPx = Math.max(1, Math.round(overlay.widthRatio * canvasWidth));
  const logoHeightPx = Math.max(1, Math.round(overlay.heightRatio * canvasHeight));

  let chain = `scale=${logoWidthPx}:${logoHeightPx}`;
  if (overlay.animation === "fade" && fadeDuration > 0) {
    chain +=
      `,fade=t=in:st=${overlay.start}:d=${fadeDuration.toFixed(3)}:alpha=1` +
      `,fade=t=out:st=${(overlay.end - fadeDuration).toFixed(3)}:d=${fadeDuration.toFixed(3)}:alpha=1`;
  }
  return chain;
}

export function buildFfmpegPlan(input: RenderPlanInput): RenderPlan {
  const { project, sourcePaths } = input;
  const trackKindById = new Map(project.tracks.map((t) => [t.id, t.kind] as const));
  const videoClips = layoutSequentialClips(project.clips.filter((c) => trackKindById.get(c.trackId) === "video"));
  // Each audio track is its own independent sequential lane; tracks are mixed together (not
  // concatenated) so clips on different tracks can overlap in time.
  const audioTracks = getTracksByKind(project, "audio");

  if (videoClips.length === 0) {
    throw new Error("Add at least one video clip before exporting.");
  }

  const totalDurationSeconds = getSequenceDuration(videoClips);

  interface InputSpec {
    path: string;
    extraArgs: string[];
  }
  const inputs: InputSpec[] = [];
  const inputIndexBySourceId = new Map<string, number>();
  function inputIndexFor(sourceId: string, extraArgs: string[] = []): number {
    const existing = inputIndexBySourceId.get(sourceId);
    if (existing !== undefined) return existing;
    const path = sourcePaths[sourceId];
    if (!path) throw new Error(`Missing local file for source ${sourceId}`);
    const index = inputs.length;
    inputs.push({ path, extraArgs });
    inputIndexBySourceId.set(sourceId, index);
    return index;
  }

  // Image clips deliberately bypass inputIndexFor's sourceId cache: each needs its own -t matching
  // that specific clip's duration, and two clips could reuse the same image at different durations.
  function addImageInput(sourceId: string, durationSeconds: number): number {
    const path = sourcePaths[sourceId];
    if (!path) throw new Error(`Missing local file for source ${sourceId}`);
    const index = inputs.length;
    inputs.push({ path, extraArgs: ["-loop", "1", "-t", durationSeconds.toFixed(3)] });
    return index;
  }

  const { frameRate } = project.canvas;
  const width = input.output?.width ?? project.canvas.width;
  const height = input.output?.height ?? project.canvas.height;
  const filterChains: string[] = [];
  const videoLabels: string[] = [];
  const clipAudioLabels: string[] = [];

  // ffmpeg's own named xfade transitions, matched to what the preview compositor draws for each type.
  const XFADE_TRANSITION_NAMES: Record<TransitionType, string> = {
    dissolve: "fade",
    slide: "slideleft",
    wipe: "wiperight",
    zoom: "zoomin",
  };

  // Chains consecutive per-clip streams into one, using an ffmpeg cross-dissolve (xfade for video,
  // acrossfade for audio) wherever two clips overlap, a plain concat wherever they sit directly
  // adjacent, and a generated filler (buildGapFiller) spliced in wherever gapBeforeSeconds opened a
  // gap between them — so a reel can freely mix hard cuts, dissolves, and empty space. `clips`
  // supplies each label's laid-out timing and the overlap/transition type between consecutive
  // entries, and must be 1:1 with `labels`. Overlap and gap are mutually exclusive by construction
  // (getOverlapSeconds floors at 0), so a pair is never both at once.
  function chainSequential(
    labels: string[],
    clips: LaidOutClip[],
    kind: "video" | "audio",
    labelPrefix: string,
    buildGapFiller: (durationSeconds: number, label: string) => string
  ): string {
    const concatArgs = kind === "video" ? "n=2:v=1:a=0" : "n=2:v=0:a=1";
    // concat's output timebase isn't guaranteed to match the 1/frameRate timebase every per-clip
    // chain gets from its own `fps=` filter — it can come out as a generic microsecond timebase
    // instead. That's invisible until the concat's output later feeds an xfade alongside a plain
    // per-clip label: ffmpeg then refuses to reinitialize the filter graph ("First input link main
    // timebase ... do not match the corresponding second input link xfade timebase"). Re-applying
    // `fps=` right after every video concat keeps every label's timebase identical regardless of how
    // many concats it passed through, so a later transition never sees a mismatch. Audio has no
    // equivalent timebase coupling with acrossfade, so this is video-only.
    const retimebase = kind === "video" ? `,fps=${frameRate}` : "";

    // Splices a gap-filler in next to `label`'s existing content. `gapFirst` controls play order:
    // true for the leading gap (empty space plays before anything else on the track), false for a
    // gap opened up between two clips (the accumulated content-so-far still plays first, then the
    // gap, then whatever gets concatenated after this call returns).
    function spliceGap(label: string, durationSeconds: number, gapLabel: string, gapFirst: boolean): string {
      filterChains.push(buildGapFiller(durationSeconds, gapLabel));
      const splicedLabel = `${gapLabel}spliced`;
      const ordered = gapFirst ? `[${gapLabel}]${label}` : `${label}[${gapLabel}]`;
      filterChains.push(`${ordered}concat=${concatArgs}${retimebase}[${splicedLabel}]`);
      return `[${splicedLabel}]`;
    }

    let prevLabel = labels[0];
    if (clips[0].timelineStart > 0.0005) {
      prevLabel = spliceGap(prevLabel, clips[0].timelineStart, `${labelPrefix}leadgap`, true);
    }

    let cumulative = clips[0].duration;
    for (let i = 1; i < labels.length; i++) {
      const gap = Math.max(0, clips[i].timelineStart - (clips[i - 1].timelineStart + clips[i - 1].duration));
      if (gap > 0.0005) {
        prevLabel = spliceGap(prevLabel, gap, `${labelPrefix}gap${i}`, false);
        cumulative += gap;
      }

      const overlap = getOverlapSeconds(clips[i - 1], clips[i]);
      const outLabel = `${labelPrefix}${i}`;
      if (overlap > 0) {
        const offset = cumulative - overlap;
        const transitionFilter =
          kind === "video"
            ? `xfade=transition=${XFADE_TRANSITION_NAMES[clips[i - 1].transitionOutType]}:duration=${overlap.toFixed(3)}:offset=${offset.toFixed(3)}`
            : `acrossfade=d=${overlap.toFixed(3)}`;
        filterChains.push(`${prevLabel}${labels[i]}${transitionFilter}[${outLabel}]`);
        cumulative += clips[i].duration - overlap;
      } else {
        filterChains.push(`${prevLabel}${labels[i]}concat=${concatArgs}${retimebase}[${outLabel}]`);
        cumulative += clips[i].duration;
      }
      prevLabel = `[${outLabel}]`;
    }
    return prevLabel;
  }

  function buildVideoGapFiller(durationSeconds: number, label: string): string {
    return `color=c=black:s=${width}x${height}:r=${frameRate}:d=${durationSeconds.toFixed(3)},format=yuv420p,setsar=1[${label}]`;
  }

  function buildAudioGapFiller(durationSeconds: number, label: string): string {
    return `anullsrc=r=48000:cl=stereo,atrim=duration=${durationSeconds.toFixed(3)}[${label}]`;
  }

  function buildAudioChain(clip: Clip, inputIdx: number, duration: number, label: string, forceSilent: boolean): string {
    if (clip.muted || forceSilent) {
      return `anullsrc=r=48000:cl=stereo,atrim=duration=${duration.toFixed(3)}[${label}]`;
    }
    return (
      `[${inputIdx}:a]atrim=start=${clip.inPoint}:end=${clip.outPoint},asetpts=PTS-STARTPTS` +
      `${buildAtempoChain(clip.speed)},volume=${clip.volume}${buildFadeSuffix(clip, duration)}[${label}]`
    );
  }

  videoClips.forEach((clip, i) => {
    const clipSource = project.sources.find((s) => s.id === clip.sourceId);
    const isImageClip = clipSource?.kind === "image";
    const fitFilter = buildFitFilter(clip.fitMode, width, height);
    const panZoomFilter = buildPanZoomFilter(clip.transform, width, height);
    const colorFilter = buildFfmpegColorFilter(clip.filter);
    const vLabel = `v${i}`;
    const aLabel = `ca${i}`;

    // An image clip has no in/out point or speed to trim/stretch — the input is already looped to
    // exactly this clip's duration (addImageInput), and it has no audio track at all (forced silent).
    const inputIdx = isImageClip ? addImageInput(clip.sourceId, clip.duration) : inputIndexFor(clip.sourceId);
    // setsar=1 is required before concat: scale/pad/crop can leave clips with slightly different
    // sample aspect ratios even at identical pixel dimensions, which concat refuses to join.
    const trimAndSpeed = isImageClip ? "" : `trim=start=${clip.inPoint}:end=${clip.outPoint},setpts=(PTS-STARTPTS)/${clip.speed},`;
    filterChains.push(
      `[${inputIdx}:v]${trimAndSpeed}${fitFilter}${panZoomFilter},${colorFilter},setsar=1,fps=${frameRate}${buildVideoFadeSuffix(clip, clip.duration)}[${vLabel}]`
    );
    videoLabels.push(`[${vLabel}]`);

    filterChains.push(buildAudioChain(clip, inputIdx, clip.duration, aLabel, isImageClip));
    clipAudioLabels.push(`[${aLabel}]`);
  });

  const musicTrackLabels: string[] = [];
  audioTracks.forEach((track, trackIndex) => {
    const trackClips = layoutSequentialClips(project.clips.filter((c) => c.trackId === track.id));
    if (trackClips.length === 0) return;
    const labels: string[] = [];
    trackClips.forEach((clip, i) => {
      const inputIdx = inputIndexFor(clip.sourceId);
      const label = `ma${trackIndex}_${i}`;
      filterChains.push(buildAudioChain(clip, inputIdx, clip.duration, label, false));
      labels.push(`[${label}]`);
    });
    // chainSequential (not a flat concat) so a gap opened by dragging a clip on this track is
    // filled with real silence instead of being silently dropped.
    const trackLabel = chainSequential(labels, trackClips, "audio", `amusic${trackIndex}_`, buildAudioGapFiller);
    musicTrackLabels.push(trackLabel);
  });

  const videoConcatLabel = chainSequential(videoLabels, videoClips, "video", "vxf", buildVideoGapFiller);

  const overlayTextFiles: OverlayTextFile[] = [];
  let finalVideoLabel = videoConcatLabel;
  project.overlays.forEach((overlay, i) => {
    if (overlay.kind === "image") {
      if (!overlay.imageSourceId) return;
      const inputIdx = inputIndexFor(overlay.imageSourceId, ["-loop", "1", "-t", totalDurationSeconds.toFixed(3)]);
      const scaledLabel = `logo${i}`;
      filterChains.push(`[${inputIdx}:v]${buildImageScaleChain(overlay, width, height)}[${scaledLabel}]`);

      const xExpr = `${overlay.position.x}*main_w-overlay_w/2`;
      const yExpr = `${overlay.position.y}*main_h-overlay_h/2`;
      const nextLabel = `vimg${i}`;
      filterChains.push(
        `${finalVideoLabel}[${scaledLabel}]overlay=x=${xExpr}:y=${yExpr}:enable='between(t,${overlay.start},${overlay.end})'[${nextLabel}]`
      );
      finalVideoLabel = `[${nextLabel}]`;
      return;
    }

    const fileName = `overlay_${overlay.id}.txt`;
    overlayTextFiles.push({ fileName, content: overlay.content });
    const nextLabel = `vtext${i}`;
    filterChains.push(`${finalVideoLabel}${buildDrawtextFilter(overlay, fileName)}[${nextLabel}]`);
    finalVideoLabel = `[${nextLabel}]`;
  });

  const clipAudioConcatLabel = chainSequential(clipAudioLabels, videoClips, "audio", "axf", buildAudioGapFiller);

  let finalAudioLabel = clipAudioConcatLabel;
  if (musicTrackLabels.length > 0) {
    // duration=first anchors output length to the video track; if an audio track runs longer,
    // the tail is dropped (unlike the preview compositor, which keeps playing past the last video frame).
    const mixInputLabels = [clipAudioConcatLabel, ...musicTrackLabels];
    filterChains.push(`${mixInputLabels.join("")}amix=inputs=${mixInputLabels.length}:duration=first:dropout_transition=0[aout]`);
    finalAudioLabel = "[aout]";
  }

  const outputFileName = "output.mp4";
  const args: string[] = ["-y"];
  for (const input of inputs) {
    args.push(...input.extraArgs, "-i", input.path);
  }
  args.push(
    "-filter_complex",
    filterChains.join(";"),
    "-map",
    finalVideoLabel,
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
    overlayTextFiles,
    totalDurationSeconds,
  };
}
