import type { Clip, ClipFilter, FitMode, MediaSource, Overlay, ProjectModel, Transform, TransitionType } from "@reel-studio/shared-types";
import { buildAtempoFilters } from "./audio-edit.js";
import { getOverlapSeconds, getSequenceDuration, type LaidOutClip } from "./sequential-layout.js";
import { FADE_DURATION_SECONDS, slideStartOffsetRatio } from "./overlay-animation.js";
import { buildFfmpegColorFilter } from "./filter-presets.js";
import { buildPanZoomFilter } from "./fit-rect.js";
import { buildEncoderArgs, DEFAULT_OUTPUT_FORMAT, getOutputFormat, GIF_FRAME_RATE, type OutputFormatId } from "./export-formats.js";
import { getPrimaryVideoTrack, getTimelineDuration, getTracksByKind, layoutTrackClips } from "./track-utils.js";

export interface RenderPlanInput {
  project: ProjectModel;
  sourcePaths: Record<string, string>;
  /**
   * Overrides the project canvas size for the final render (e.g. a 4K/2K/720p export quality
   * choice) and picks the container/codec (`format`, default mp4 — see export-formats.ts).
   */
  output?: { width: number; height: number; format?: OutputFormatId };
  /**
   * Whether each source's actual file has at least one audio stream, as probed by the render
   * service. A video with no audio track at all (screen recordings, GIF-style clips, stock B-roll)
   * must not be referenced as `[n:a]` — ffmpeg aborts the whole export on a stream specifier that
   * matches nothing — so a source mapped to `false` plays as silence instead, exactly like the
   * preview (where such a clip is simply silent). Sources missing from the map are assumed to have
   * audio.
   */
  sourceHasAudio?: Record<string, boolean>;
}

export interface OverlayTextFile {
  fileName: string;
  content: string;
}

export interface RenderPlan {
  args: string[];
  outputFileName: string;
  format: OutputFormatId;
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

// Every audio stream in the graph is normalised to this one format, so concat/acrossfade/amix
// never have to reconcile a 44.1 kHz mono music file with a 48 kHz stereo clip or silence filler.
const AUDIO_FORMAT = "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo";

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
}

// A clip's opacity, composited over the black canvas the way the preview's globalAlpha does it.
function buildOpacitySuffix(opacity: number | undefined): string {
  const alpha = clamp01(opacity ?? 1);
  if (alpha >= 1) return "";
  const a = alpha.toFixed(4);
  return `,colorchannelmixer=rr=${a}:gg=${a}:bb=${a}`;
}

function buildAtempoChain(speed: number): string {
  const filters = buildAtempoFilters(speed);
  return filters.length > 0 ? "," + filters.join(",") : "";
}

function transformsEqual(a: Transform, b: Transform): boolean {
  return a.scale === b.scale && a.x === b.x && a.y === b.y && a.rotation === b.rotation;
}

function clipFiltersEqual(a: ClipFilter, b: ClipFilter): boolean {
  return (
    a.preset === b.preset && a.brightness === b.brightness && a.contrast === b.contrast && a.saturation === b.saturation && a.hue === b.hue
  );
}

// `-stream_loop` repeats a source's ENTIRE file, so folding a clip into a repeat block is only
// correct when the clip plays that file start-to-finish untrimmed.
function isWholeFileVideoClip(clip: LaidOutClip, sources: MediaSource[]): boolean {
  const source = sources.find((s) => s.id === clip.sourceId);
  if (!source || source.kind !== "video") return false;
  return clip.inPoint <= 0.0005 && Math.abs(clip.outPoint - source.durationSeconds) <= 0.01;
}

function isIdenticalRepeatOf(a: LaidOutClip, b: LaidOutClip): boolean {
  return (
    a.sourceId === b.sourceId &&
    a.inPoint === b.inPoint &&
    a.outPoint === b.outPoint &&
    a.speed === b.speed &&
    a.fitMode === b.fitMode &&
    transformsEqual(a.transform, b.transform) &&
    clipFiltersEqual(a.filter, b.filter) &&
    a.volume === b.volume &&
    a.muted === b.muted &&
    a.opacity === b.opacity &&
    a.fadeInSeconds === 0 &&
    a.fadeOutSeconds === 0 &&
    b.fadeInSeconds === 0 &&
    b.fadeOutSeconds === 0
  );
}

// Groups consecutive video clips into runs eligible for a single `-stream_loop` input: an
// identical whole-file clip repeated back-to-back with plain hard cuts (no gap, no transition) in
// between. Exporting a clip repeated many times over — e.g. a chant video looped 100+ times — used
// to give each repeat its own trim/scale/color filter chain, all branching off the same source
// input and folded through one big concat; at 4K that many parallel decode branches of the same
// source is enough to exhaust memory and get ffmpeg killed by the OS mid-encode. A run like this
// collapses to one dedicated `-stream_loop` input feeding a single linear filter chain instead —
// memory-flat regardless of the repeat count. A run of length 1 falls through to the exact
// original per-clip path unchanged.
function groupIntoVideoUnits(clips: LaidOutClip[], sources: MediaSource[]): LaidOutClip[][] {
  const units: LaidOutClip[][] = [];
  for (const clip of clips) {
    const currentUnit = units[units.length - 1];
    const prev = currentUnit?.[currentUnit.length - 1];
    const isHardCutFromPrev = prev !== undefined && Math.abs(clip.timelineStart - (prev.timelineStart + prev.duration)) <= 0.0005;
    const canExtend =
      prev !== undefined &&
      isHardCutFromPrev &&
      isWholeFileVideoClip(prev, sources) &&
      isWholeFileVideoClip(clip, sources) &&
      isIdenticalRepeatOf(prev, clip);
    if (canExtend) {
      currentUnit.push(clip);
    } else {
      units.push([clip]);
    }
  }
  return units;
}

// The preview's isOverlayActive: visible from `start` up to, but not including, `end`.
function buildEnableExpr(overlay: Overlay): string {
  return `enable='gte(t,${overlay.start})*lt(t,${overlay.end})'`;
}

// No `font=`/`fontfile=` option: there's no font-family control in the UI yet, so this
// intentionally falls back to ffmpeg's compiled-in default rather than guessing a system font.
//
// `sizeScale` converts the overlay's size (authored in project-canvas pixels, which is how the
// preview scales it) to the export's pixels — without it a title rendered at 4K came out at half
// the size the preview showed, and at 720p it came out 1.5x too big.
function buildDrawtextFilter(overlay: Overlay, fileName: string, sizeScale: number): string {
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

  const size = Number((overlay.style.size * sizeScale).toFixed(3));
  const fontSizeExpr =
    overlay.animation === "pop" && animDuration > 0
      ? `if(lt(t,${overlay.start}+${animDuration}),${size}*(0.5+0.5*(t-${overlay.start})/${animDuration}),${size})`
      : `${size}`;

  const parts = [
    `textfile=${fileName}`,
    // Titles are literal text, as the preview draws them — without this, drawtext treats `%` as the
    // start of an expansion sequence (a "100%" title logs "Stray %" and `%{...}` gets substituted).
    "expansion=none",
    `fontsize='${fontSizeExpr}'`,
    `fontcolor=${overlay.style.color}`,
    `x='${xExpr}'`,
    `y='${yExpr}'`,
    buildEnableExpr(overlay),
    `alpha='${alphaExpr}'`,
  ];
  if (overlay.style.background) parts.push(`box=1:boxcolor=${overlay.style.background}:boxborderw=${Math.round(size * 0.2)}`);
  // The preview strokes the outline at 0.06 x font size centred on the glyph edge, then fills the
  // glyph over it — so only the outer half (0.03 x size) is visible. drawtext's border is drawn
  // entirely outside the glyph, hence half the preview's stroke width.
  if (overlay.style.outline) parts.push(`bordercolor=${overlay.style.outline}:borderw=${Math.max(1, Math.round(size * 0.03))}`);

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
  // Exactly the lane the preview plays (see getPrimaryVideoTrack), laid out by the same function.
  const videoTrack = getPrimaryVideoTrack(project);
  const videoClips = videoTrack ? layoutTrackClips(project, videoTrack.id) : [];
  // Each audio track is its own independent sequential lane; tracks are mixed together (not
  // concatenated) so clips on different tracks can overlap in time.
  const audioTracks = getTracksByKind(project, "audio");

  // The export is exactly as long as the timeline the editor plays — normally the longest of the
  // video track, every audio track and every title/logo, with `project.endBehavior` (see
  // getTimelineDuration) deciding what fills the part past the end of the video track: black,
  // the video track's last frame held, or (for "trim") the rest of the timeline is cut off instead.
  const totalDurationSeconds = getTimelineDuration(project);
  if (!(totalDurationSeconds > 0)) {
    throw new Error("Nothing to export yet — add a video clip, some audio or a title first.");
  }

  function sourceHasAudio(sourceId: string): boolean {
    const source = project.sources.find((s) => s.id === sourceId);
    if (source?.kind === "image") return false;
    return input.sourceHasAudio?.[sourceId] !== false;
  }

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

  // Every per-clip input decodes single-threaded (see PER_INPUT_THREAD_ARGS below): a project with
  // hundreds of clips each gets its own `-i` (see addVideoInput's note), and ffmpeg's default decoder
  // thread count is ~one per CPU core *per input*. At a few hundred inputs that's thousands of OS
  // threads competing for the same process thread-limit ffmpeg itself needs for its filter graph and
  // encoder, and libavfilter's own scaler init starts failing with EAGAIN ("Resource temporarily
  // unavailable") well before any frame is decoded. Pinning each input to one decode thread keeps the
  // total thread count proportional to input count instead of input count × core count; aggregate
  // throughput barely changes since there are already as many branches as cores to keep busy.
  const PER_INPUT_THREAD_ARGS = ["-threads", "1"];

  // Video clips deliberately bypass inputIndexFor's sourceId cache too: when the same source is
  // placed on the timeline more than once, sharing one decoded input means ffmpeg auto-splits it
  // into as many consumers, all pulling from the *same* physical decode range at once. Each
  // consumer's fit/color/scale output then has to sit buffered in memory until its own place in
  // the output timeline comes up — for clip N of an M-times-repeated source that's most of clip N's
  // full duration of already-4K frames held in RAM. With enough repeats (or even just a handful at
  // 4K) that's enough to get ffmpeg OOM-killed mid-encode. A dedicated `-i` per clip instance gives
  // each its own independent decoder that paces itself off its own downstream consumer instead.
  //
  // `-an`: this input is picture only. A clip's sound comes from a *second* input of the same file
  // (addClipAudioInput) rather than this one's audio stream. With one shared input, every packet
  // ffmpeg reads to satisfy an audio request also carries that file's video packets, which get
  // decoded and queued in the graph right away — and acrossfade asks for the *next* clip's audio
  // early, so with a run of dissolves every later clip's frames were piling up long before its
  // xfade wanted them: 30 dissolving clips peaked at 5.3 GB at 540x960 (and slowed to ~1.2x
  // realtime) — at 1080p that's an OOM kill. Separate inputs keep audio demand from dragging video
  // into memory: the same 30 clips peak at ~0.8 GB and run twice as fast.
  function addVideoInput(sourceId: string): number {
    const path = sourcePaths[sourceId];
    if (!path) throw new Error(`Missing local file for source ${sourceId}`);
    const index = inputs.length;
    inputs.push({ path, extraArgs: [...PER_INPUT_THREAD_ARGS, "-an"] });
    return index;
  }

  // The audio half of a video clip — see addVideoInput for why it's a separate, video-less input.
  function addClipAudioInput(sourceId: string): number {
    const path = sourcePaths[sourceId];
    if (!path) throw new Error(`Missing local file for source ${sourceId}`);
    const index = inputs.length;
    inputs.push({ path, extraArgs: [...PER_INPUT_THREAD_ARGS, "-vn"] });
    return index;
  }

  // Image clips deliberately bypass inputIndexFor's sourceId cache: each needs its own -t matching
  // that specific clip's duration, and two clips could reuse the same image at different durations.
  function addImageInput(sourceId: string, durationSeconds: number): number {
    const path = sourcePaths[sourceId];
    if (!path) throw new Error(`Missing local file for source ${sourceId}`);
    const index = inputs.length;
    inputs.push({ path, extraArgs: [...PER_INPUT_THREAD_ARGS, "-loop", "1", "-t", durationSeconds.toFixed(3)] });
    return index;
  }

  // Like addImageInput, bypasses the sourceId cache: a `-stream_loop` input is exclusive to one
  // repeat run and must not be reused by another (possibly non-looped) usage of the same source.
  function addLoopedInput(sourceId: string, extraLoops: number): number {
    const path = sourcePaths[sourceId];
    if (!path) throw new Error(`Missing local file for source ${sourceId}`);
    const index = inputs.length;
    inputs.push({ path, extraArgs: ["-stream_loop", String(extraLoops)] });
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
  //
  // A maximal run of clips that are all plain hard cuts (no transition, no gap) is joined by ONE
  // N-way `concat` rather than folded pairwise: a 100-still slideshow otherwise built ~100 nested
  // `concat`+`fps` filters, and at 4K each of those buffers multi-MB frames — enough chained
  // filters to push ffmpeg past available RAM and get it OOM-killed mid-encode. One `concat=n=100`
  // consumes its inputs sequentially and keeps memory flat.
  function chainSequential(
    labels: string[],
    clips: LaidOutClip[],
    kind: "video" | "audio",
    labelPrefix: string,
    buildGapFiller: (durationSeconds: number, label: string) => string,
  ): string {
    const streamArgs = kind === "video" ? "v=1:a=0" : "v=0:a=1";
    // concat's output timebase isn't guaranteed to match the 1/frameRate timebase every per-clip
    // chain gets from its own `fps=` filter — it can come out as a generic microsecond timebase
    // instead. That's invisible until the concat's output later feeds an xfade alongside a plain
    // per-clip label: ffmpeg then refuses to reinitialize the filter graph ("First input link main
    // timebase ... do not match the corresponding second input link xfade timebase"). Re-applying
    // `fps=` right after every video concat keeps every label's timebase identical regardless of how
    // many concats it passed through, so a later transition never sees a mismatch. Audio has no
    // equivalent timebase coupling with acrossfade, so this is video-only.
    const retimebase = kind === "video" ? `,fps=${frameRate}` : "";

    let labelCounter = 0;
    const nextLabel = () => `${labelPrefix}${labelCounter++}`;

    // Partition the sequence into "chunks" of clips joined by nothing but plain hard cuts, with a
    // separator (a gap, or an overlap/transition) sitting between each adjacent pair of chunks.
    interface Chunk {
      labels: string[];
      durationSeconds: number;
    }
    type Separator = { kind: "gap"; seconds: number } | { kind: "xfade"; transition: TransitionType; overlap: number };

    const chunks: Chunk[] = [{ labels: [labels[0]], durationSeconds: clips[0].duration }];
    const separators: Separator[] = [];
    for (let i = 1; i < labels.length; i++) {
      const gap = Math.max(0, clips[i].timelineStart - (clips[i - 1].timelineStart + clips[i - 1].duration));
      const overlap = getOverlapSeconds(clips[i - 1], clips[i]);
      if (gap > 0.0005) {
        separators.push({ kind: "gap", seconds: gap });
        chunks.push({ labels: [labels[i]], durationSeconds: clips[i].duration });
      } else if (overlap > 0) {
        separators.push({ kind: "xfade", transition: clips[i - 1].transitionOutType, overlap });
        chunks.push({ labels: [labels[i]], durationSeconds: clips[i].duration });
      } else {
        const chunk = chunks[chunks.length - 1];
        chunk.labels.push(labels[i]);
        chunk.durationSeconds += clips[i].duration;
      }
    }

    // Collapse a chunk to a single label — a lone clip passes through untouched, a run is concat'd.
    const renderChunk = (chunk: Chunk): string => {
      if (chunk.labels.length === 1) return chunk.labels[0];
      const out = nextLabel();
      filterChains.push(`${chunk.labels.join("")}concat=n=${chunk.labels.length}:${streamArgs}${retimebase}[${out}]`);
      return `[${out}]`;
    };

    let acc = renderChunk(chunks[0]);
    let cumulative = chunks[0].durationSeconds;

    // Leading gap: empty space that plays before any clip on the track.
    if (clips[0].timelineStart > 0.0005) {
      const gapLabel = nextLabel();
      filterChains.push(buildGapFiller(clips[0].timelineStart, gapLabel));
      const spliced = nextLabel();
      filterChains.push(`[${gapLabel}]${acc}concat=n=2:${streamArgs}${retimebase}[${spliced}]`);
      acc = `[${spliced}]`;
      cumulative += clips[0].timelineStart;
    }

    for (let k = 0; k < separators.length; k++) {
      const separator = separators[k];
      const chunkLabel = renderChunk(chunks[k + 1]);
      const chunkDuration = chunks[k + 1].durationSeconds;
      if (separator.kind === "gap") {
        const gapLabel = nextLabel();
        filterChains.push(buildGapFiller(separator.seconds, gapLabel));
        const out = nextLabel();
        filterChains.push(`${acc}[${gapLabel}]${chunkLabel}concat=n=3:${streamArgs}${retimebase}[${out}]`);
        acc = `[${out}]`;
        cumulative += separator.seconds + chunkDuration;
      } else {
        const offset = cumulative - separator.overlap;
        const transitionFilter =
          kind === "video"
            ? `xfade=transition=${XFADE_TRANSITION_NAMES[separator.transition]}:duration=${separator.overlap.toFixed(3)}:offset=${offset.toFixed(3)}`
            : `acrossfade=d=${separator.overlap.toFixed(3)}`;
        const out = nextLabel();
        filterChains.push(`${acc}${chunkLabel}${transitionFilter}[${out}]`);
        acc = `[${out}]`;
        cumulative += chunkDuration - separator.overlap;
      }
    }

    return acc;
  }

  function buildVideoGapFiller(durationSeconds: number, label: string): string {
    return `color=c=black:s=${width}x${height}:r=${frameRate}:d=${durationSeconds.toFixed(3)},format=yuv420p,setsar=1[${label}]`;
  }

  function buildAudioGapFiller(durationSeconds: number, label: string): string {
    return `anullsrc=r=48000:cl=stereo,atrim=duration=${durationSeconds.toFixed(3)},${AUDIO_FORMAT}[${label}]`;
  }

  // Every per-clip stream is forced to *exactly* its laid-out duration — padded (last frame held /
  // silence) if the file runs out early, cut if it runs long. Real files rarely have streams that
  // end precisely at the container duration the browser reported (screen recordings and phone
  // clips often have audio a few hundred ms shorter or longer than video), and concat/xfade place
  // every later clip by the *actual* length of the ones before it — so without this, one short
  // stream quietly shifts all later cuts, transitions and audio out of sync with the timeline.
  function exactVideoLength(duration: number): string {
    const d = duration.toFixed(3);
    return `,tpad=stop_mode=clone:stop_duration=${d},trim=duration=${d}`;
  }

  function exactAudioLength(duration: number): string {
    return `,${AUDIO_FORMAT},apad,atrim=duration=${duration.toFixed(3)}`;
  }

  // `audible` is false for anything the preview would play silently: a muted clip, an image, or a
  // video whose file has no audio stream at all (referencing `[n:a]` on one aborts the export).
  function buildAudioChain(clip: Clip, inputIdx: number, duration: number, label: string, audible: boolean): string {
    if (clip.muted || !audible) return buildAudioGapFiller(duration, label);
    return (
      `[${inputIdx}:a]atrim=start=${clip.inPoint}:end=${clip.outPoint},asetpts=PTS-STARTPTS` +
      `${buildAtempoChain(clip.speed)},volume=${clamp01(clip.volume)}${exactAudioLength(duration)}${buildFadeSuffix(clip, duration)}[${label}]`
    );
  }

  function buildSingleClipFilters(clip: LaidOutClip, vLabel: string, aLabel: string): void {
    const clipSource = project.sources.find((s) => s.id === clip.sourceId);
    const isImageClip = clipSource?.kind === "image";
    const fitFilter = buildFitFilter(clip.fitMode, width, height);
    const panZoomFilter = buildPanZoomFilter(clip.transform, width, height);
    const colorFilter = buildFfmpegColorFilter(clip.filter);

    // An image clip has no in/out point or speed to trim/stretch — the input is already looped to
    // exactly this clip's duration (addImageInput), and it has no audio track at all (forced silent).
    const inputIdx = isImageClip ? addImageInput(clip.sourceId, clip.duration) : addVideoInput(clip.sourceId);
    const audible = !isImageClip && !clip.muted && sourceHasAudio(clip.sourceId);
    const audioInputIdx = audible ? addClipAudioInput(clip.sourceId) : -1;
    // setsar=1 is required before concat: scale/pad/crop can leave clips with slightly different
    // sample aspect ratios even at identical pixel dimensions, which concat refuses to join.
    const trimAndSpeed = isImageClip ? "" : `trim=start=${clip.inPoint}:end=${clip.outPoint},setpts=(PTS-STARTPTS)/${clip.speed},`;
    filterChains.push(
      `[${inputIdx}:v]${trimAndSpeed}${fitFilter}${panZoomFilter},${colorFilter}${buildOpacitySuffix(clip.opacity)},setsar=1,fps=${frameRate}` +
        `${exactVideoLength(clip.duration)}${buildVideoFadeSuffix(clip, clip.duration)}[${vLabel}]`,
    );
    filterChains.push(buildAudioChain(clip, audioInputIdx, clip.duration, aLabel, audible));
  }

  // The whole run plays through one `-stream_loop` input and one linear filter chain — panZoom and
  // colorFilter are static (no time-varying animation), so applying them once over the full looped
  // stream is identical to applying them per-repeat. fadeIn/fadeOut are required to be 0 by
  // isIdenticalRepeatOf, so buildVideoFadeSuffix/buildFadeSuffix have nothing to contribute here.
  function buildRepeatUnitFilters(unit: LaidOutClip[], vLabel: string, aLabel: string): void {
    const first = unit[0];
    const repeatCount = unit.length;
    const fitFilter = buildFitFilter(first.fitMode, width, height);
    const panZoomFilter = buildPanZoomFilter(first.transform, width, height);
    const colorFilter = buildFfmpegColorFilter(first.filter);
    const inputIdx = addLoopedInput(first.sourceId, repeatCount - 1);
    const totalDuration = first.duration * repeatCount;
    filterChains.push(
      `[${inputIdx}:v]setpts=(PTS-STARTPTS)/${first.speed},${fitFilter}${panZoomFilter},${colorFilter}${buildOpacitySuffix(first.opacity)},setsar=1,fps=${frameRate}` +
        `${exactVideoLength(totalDuration)}[${vLabel}]`,
    );
    filterChains.push(
      first.muted || !sourceHasAudio(first.sourceId)
        ? buildAudioGapFiller(totalDuration, aLabel)
        : `[${inputIdx}:a]asetpts=PTS-STARTPTS${buildAtempoChain(first.speed)},volume=${clamp01(first.volume)}${exactAudioLength(totalDuration)}[${aLabel}]`,
    );
  }

  const videoUnits = groupIntoVideoUnits(videoClips, project.sources);
  videoUnits.forEach((unit, i) => {
    const vLabel = `v${i}`;
    const aLabel = `ca${i}`;
    if (unit.length > 1) {
      buildRepeatUnitFilters(unit, vLabel, aLabel);
    } else {
      buildSingleClipFilters(unit[0], vLabel, aLabel);
    }
    videoLabels.push(`[${vLabel}]`);
    clipAudioLabels.push(`[${aLabel}]`);
  });

  // One synthetic entry per unit (matching videoLabels/clipAudioLabels 1:1) so chainSequential's
  // gap/transition sequencing sees a repeat run as a single clip spanning its full combined
  // duration, with the run's *last* clip's outgoing transition into whatever follows it.
  const sequencingClips: LaidOutClip[] = videoUnits.map((unit) => {
    if (unit.length === 1) return unit[0];
    const first = unit[0];
    const last = unit[unit.length - 1];
    return {
      ...first,
      transitionOutType: last.transitionOutType,
      transitionOutSeconds: last.transitionOutSeconds,
      duration: first.duration * unit.length,
    };
  });

  // Extends a finished lane (the video track, the clip-audio lane, or one audio track) with black /
  // silence so it runs the whole timeline — e.g. a 4 s clip under a 12 s title keeps going as black
  // for the remaining 8 s, exactly what the preview plays there, instead of ending the export early.
  function padLaneToTimeline(
    label: string,
    laneDuration: number,
    kind: "video" | "audio",
    labelPrefix: string,
    buildGapFiller: (durationSeconds: number, label: string) => string,
    freeze = false,
  ): string {
    const missing = totalDurationSeconds - laneDuration;
    if (missing <= 0.0005) return label;
    // `endBehavior: "freeze"` only ever applies to the video lane (there's no equivalent "hold the
    // last sample" for audio — it stays silent there exactly like "black" does): clone the last
    // decoded frame for the missing time instead of splicing in a black filler clip.
    if (kind === "video" && freeze) {
      const out = `${labelPrefix}frozen`;
      filterChains.push(`${label}tpad=stop_mode=clone:stop_duration=${missing.toFixed(3)},fps=${frameRate}[${out}]`);
      return `[${out}]`;
    }
    const fillerLabel = `${labelPrefix}fill`;
    filterChains.push(buildGapFiller(missing, fillerLabel));
    const out = `${labelPrefix}padded`;
    const streamArgs = kind === "video" ? `v=1:a=0,fps=${frameRate}` : "v=0:a=1";
    filterChains.push(`${label}[${fillerLabel}]concat=n=2:${streamArgs}[${out}]`);
    return `[${out}]`;
  }

  // A lane with nothing on it at all is one filler for the whole timeline (e.g. a title over music
  // with no video clips renders on black, as in the preview).
  function emptyLane(labelPrefix: string, buildGapFiller: (durationSeconds: number, label: string) => string): string {
    const label = `${labelPrefix}empty`;
    filterChains.push(buildGapFiller(totalDurationSeconds, label));
    return `[${label}]`;
  }

  const musicTrackLabels: string[] = [];
  audioTracks.forEach((track, trackIndex) => {
    const trackClips = layoutTrackClips(project, track.id);
    if (trackClips.length === 0) return;
    const labels: string[] = [];
    trackClips.forEach((clip, i) => {
      const audible = sourceHasAudio(clip.sourceId);
      const inputIdx = audible && !clip.muted ? inputIndexFor(clip.sourceId) : -1;
      const label = `ma${trackIndex}_${i}`;
      filterChains.push(buildAudioChain(clip, inputIdx, clip.duration, label, audible));
      labels.push(`[${label}]`);
    });
    // chainSequential (not a flat concat) so a gap opened by dragging a clip on this track is
    // filled with real silence instead of being silently dropped.
    const trackLabel = chainSequential(labels, trackClips, "audio", `amusic${trackIndex}_`, buildAudioGapFiller);
    musicTrackLabels.push(
      padLaneToTimeline(trackLabel, getSequenceDuration(trackClips), "audio", `amusic${trackIndex}_`, buildAudioGapFiller),
    );
  });

  const videoSequenceDuration = getSequenceDuration(videoClips);
  const videoConcatLabel =
    videoLabels.length > 0
      ? padLaneToTimeline(
          chainSequential(videoLabels, sequencingClips, "video", "vxf", buildVideoGapFiller),
          videoSequenceDuration,
          "video",
          "vlane",
          buildVideoGapFiller,
          project.endBehavior === "freeze",
        )
      : // No video clip at all means there's no frame to freeze — black is the only sensible filler.
        emptyLane("vlane", buildVideoGapFiller);

  // Titles are authored in project-canvas pixels; the export may render at a different size.
  const overlaySizeScale = width / project.canvas.width;
  const overlayTextFiles: OverlayTextFile[] = [];
  let finalVideoLabel = videoConcatLabel;
  project.overlays.forEach((overlay, i) => {
    if (!(overlay.end > overlay.start)) return;
    if (overlay.kind === "image") {
      if (!overlay.imageSourceId) return;
      const inputIdx = inputIndexFor(overlay.imageSourceId, ["-loop", "1", "-t", totalDurationSeconds.toFixed(3)]);
      const scaledLabel = `logo${i}`;
      filterChains.push(`[${inputIdx}:v]${buildImageScaleChain(overlay, width, height)}[${scaledLabel}]`);

      const xExpr = `${overlay.position.x}*main_w-overlay_w/2`;
      const yExpr = `${overlay.position.y}*main_h-overlay_h/2`;
      const nextLabel = `vimg${i}`;
      filterChains.push(`${finalVideoLabel}[${scaledLabel}]overlay=x=${xExpr}:y=${yExpr}:${buildEnableExpr(overlay)}[${nextLabel}]`);
      finalVideoLabel = `[${nextLabel}]`;
      return;
    }

    const fileName = `overlay_${overlay.id}.txt`;
    overlayTextFiles.push({ fileName, content: overlay.content });
    const nextLabel = `vtext${i}`;
    filterChains.push(`${finalVideoLabel}${buildDrawtextFilter(overlay, fileName, overlaySizeScale)}[${nextLabel}]`);
    finalVideoLabel = `[${nextLabel}]`;
  });

  const clipAudioConcatLabel =
    clipAudioLabels.length > 0
      ? padLaneToTimeline(
          chainSequential(clipAudioLabels, sequencingClips, "audio", "axf", buildAudioGapFiller),
          videoSequenceDuration,
          "audio",
          "alane",
          buildAudioGapFiller,
        )
      : emptyLane("alane", buildAudioGapFiller);

  let finalAudioLabel = clipAudioConcatLabel;
  if (musicTrackLabels.length > 0) {
    // Every lane is padded to the full timeline above, so nothing drops out of the mix early.
    // amix scales each input by 1/N; the preview just plays every track at its own volume on top of
    // the others (the browser sums them), so `volume=N` undoes that scaling — otherwise adding a
    // music track made the clip audio (and the music) ~6 dB quieter in the export than in the
    // preview. (Spelled this way rather than amix's `normalize=0` so older ffmpeg builds work too.)
    const mixInputLabels = [clipAudioConcatLabel, ...musicTrackLabels];
    filterChains.push(
      `${mixInputLabels.join("")}amix=inputs=${mixInputLabels.length}:duration=longest:dropout_transition=0,volume=${mixInputLabels.length}[aout]`,
    );
    finalAudioLabel = "[aout]";
  }

  const formatId = input.output?.format ?? DEFAULT_OUTPUT_FORMAT;
  const format = getOutputFormat(formatId);
  const outputFileName = `output.${format.extension}`;

  if (formatId === "gif") {
    // GIF is palette-based: a palette computed from the whole output (one colour table, tracking
    // what changes between frames) dithered back over it looks far better than the encoder's
    // default per-frame 256-colour quantisation — and the frame rate drops to GIF_FRAME_RATE so
    // the file stays a fraction of the size a full-rate GIF would be.
    filterChains.push(
      `${finalVideoLabel}fps=${GIF_FRAME_RATE},split[gifsrc][gifpal];[gifpal]palettegen=stats_mode=diff[pal];` +
        `[gifsrc][pal]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle[gifout]`,
    );
    finalVideoLabel = "[gifout]";
  }

  // Caps the filter graph's own thread pool the same way PER_INPUT_THREAD_ARGS caps decoders: a
  // graph with hundreds of nodes (one scale/xfade chain per clip) otherwise gets a pool sized to
  // the core count for the graph *plus* per-decoder threads for every input, multiplying the same
  // thread-exhaustion risk described above. 4 keeps the graph itself responsive without adding to
  // that total materially.
  const args: string[] = ["-y", "-filter_complex_threads", "4"];
  for (const input of inputs) {
    args.push(...input.extraArgs, "-i", input.path);
  }
  // A format with no sound (GIF) must not map the audio lane at all — ffmpeg would refuse to mux
  // it. The audio graph is still built above (every filter output has to be connected to
  // something), so it is sunk into `anullsink` and simply discarded.
  if (!format.hasAudio) {
    filterChains.push(`${finalAudioLabel}anullsink`);
  }
  args.push("-filter_complex", filterChains.join(";"), "-map", finalVideoLabel);
  if (format.hasAudio) {
    args.push("-map", finalAudioLabel);
  }
  args.push(
    ...buildEncoderArgs(formatId),
    // Belt and braces: every lane is already exactly the timeline's length; this pins the file to it.
    "-t",
    totalDurationSeconds.toFixed(3),
    "-progress",
    "pipe:1",
    "-nostats",
    outputFileName,
  );

  return {
    args,
    outputFileName,
    format: formatId,
    overlayTextFiles,
    totalDurationSeconds,
  };
}
