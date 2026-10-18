import { useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Overlay } from "@reel-studio/shared-types";
import {
  applyPanZoom,
  buildCanvasFilterString,
  computeEffectiveVolume,
  computeFadeMultiplier,
  computeFitRect,
  computeOverlayAlpha,
  computeOverlayPopScale,
  computeOverlaySlideOffsetRatio,
  findActiveClip,
  findTransitionAt,
  getSequenceDuration,
  getTimelineDuration,
  getTracksByKind,
  isOverlayActive,
  layoutSequentialClips,
  layoutTrackClips,
  type ActiveClip,
  type LaidOutClip,
} from "@reel-studio/timeline-core";
import { useEditorDispatch, useEditorState, type EditorState } from "../state/EditorContext.js";
import { VIDEO_TRACK_ID } from "../state/initialProject.js";
import { previewCanvasRef } from "../state/previewCanvasRef.js";

const SEEK_THRESHOLD = 0.12;
const PREBUFFER_WINDOW = 0.4;
const MAX_PREVIEW_DIMENSION = 640;
const MIN_OVERLAY_SIZE_RATIO = 0.02;
const RESIZE_HANDLE_SIZE = 10;

// HTMLMediaElement.playbackRate throws/clamps outside roughly this range depending on the browser
// (Chrome supports ~0.0625–16); guard against a clip.speed that's 0, negative, or absurd from bad
// data rather than let the assignment silently no-op and fall back to the drift-seek stutter.
function clampPlaybackRate(speed: number): number {
  if (!Number.isFinite(speed) || speed <= 0) return 1;
  return Math.min(16, Math.max(0.0625, speed));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

interface FrameLayer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

interface ImageOverlayRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function computeImageOverlayRect(overlay: Overlay, canvas: HTMLCanvasElement): ImageOverlayRect {
  const width = overlay.widthRatio * canvas.width;
  const height = overlay.heightRatio * canvas.height;
  return {
    x: overlay.position.x * canvas.width - width / 2,
    y: overlay.position.y * canvas.height - height / 2,
    width,
    height,
  };
}

function drawOverlays(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, s: EditorState, imageEls: Map<string, HTMLImageElement>) {
  const scale = canvas.width / s.project.canvas.width;

  for (const overlay of s.project.overlays) {
    if (!isOverlayActive(overlay, s.playhead)) continue;
    const alpha = computeOverlayAlpha(overlay, s.playhead);
    if (alpha <= 0) continue;

    if (overlay.kind === "image") {
      const el = overlay.imageSourceId ? imageEls.get(overlay.imageSourceId) : undefined;
      if (!el || !el.complete) continue;
      const rect = computeImageOverlayRect(overlay, canvas);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.drawImage(el, rect.x, rect.y, rect.width, rect.height);
      ctx.restore();

      if (s.selectedOverlayId === overlay.id) {
        ctx.save();
        ctx.strokeStyle = "#5b7cff";
        ctx.lineWidth = 1;
        ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
        ctx.fillStyle = "#5b7cff";
        ctx.fillRect(
          rect.x + rect.width - RESIZE_HANDLE_SIZE / 2,
          rect.y + rect.height - RESIZE_HANDLE_SIZE / 2,
          RESIZE_HANDLE_SIZE,
          RESIZE_HANDLE_SIZE,
        );
        ctx.restore();
      }
      continue;
    }

    const slideOffsetRatio = computeOverlaySlideOffsetRatio(overlay, s.playhead);
    const popScale = computeOverlayPopScale(overlay, s.playhead);
    const x = (overlay.position.x + slideOffsetRatio) * canvas.width;
    const y = overlay.position.y * canvas.height;
    const fontSize = overlay.style.size * scale * popScale;
    const lines = overlay.content.split("\n");
    const lineHeight = fontSize * 1.2;
    const blockHeight = lineHeight * lines.length;
    const startY = y - blockHeight / 2 + lineHeight / 2;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `${fontSize}px ${overlay.style.font}`;
    ctx.textAlign = overlay.style.align;
    ctx.textBaseline = "middle";

    if (overlay.style.background) {
      const maxWidth = Math.max(...lines.map((line) => ctx.measureText(line).width), 0);
      const paddingX = fontSize * 0.4;
      const paddingY = fontSize * 0.2;
      let boxX = x;
      if (overlay.style.align === "center") boxX = x - maxWidth / 2;
      else if (overlay.style.align === "right") boxX = x - maxWidth;
      ctx.fillStyle = overlay.style.background;
      ctx.fillRect(boxX - paddingX, startY - lineHeight / 2 - paddingY, maxWidth + paddingX * 2, blockHeight + paddingY * 2);
    }

    lines.forEach((line, i) => {
      const lineY = startY + i * lineHeight;
      if (overlay.style.outline) {
        ctx.strokeStyle = overlay.style.outline;
        ctx.lineWidth = Math.max(1, fontSize * 0.06);
        ctx.strokeText(line, x, lineY);
      }
      ctx.fillStyle = overlay.style.color;
      ctx.fillText(line, x, lineY);
    });

    ctx.restore();
  }
}

type OverlayDragMode = "move" | "resize";

interface OverlayDragState {
  overlayId: string;
  mode: OverlayDragMode;
  startClientX: number;
  startClientY: number;
  startPosX: number;
  startPosY: number;
  startWidthRatio: number;
  startHeightRatio: number;
}

export function PreviewCanvas() {
  const state = useEditorState();
  const dispatch = useEditorDispatch();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // An image-kind clip on the video track (e.g. a still filling a gap between two videos) mounts an
  // <img> into this same map instead of a <video> — keyed by clip.id either way, since fit/pan-zoom/
  // filter are per-clip regardless of the underlying media type.
  const videoElsRef = useRef<Map<string, HTMLVideoElement | HTMLImageElement>>(new Map());
  const audioElsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const imageElsRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const overlayDragRef = useRef<OverlayDragState | null>(null);
  // Offscreen canvases a transition renders each clip's full frame into before blending them.
  const frameLayersRef = useRef<FrameLayer[]>([]);
  const stateRef = useRef(state);
  stateRef.current = state;

  const audioTrackIds = new Set(getTracksByKind(state.project, "audio").map((t) => t.id));
  const videoClips = state.project.clips.filter((c) => c.trackId === VIDEO_TRACK_ID);
  const audioClips = state.project.clips.filter((c) => audioTrackIds.has(c.trackId));
  const imageSources = [
    ...new Set(state.project.overlays.filter((o) => o.kind === "image" && o.imageSourceId).map((o) => o.imageSourceId as string)),
  ]
    .map((sourceId) => state.project.sources.find((s) => s.id === sourceId))
    .filter((s): s is NonNullable<typeof s> => s != null);

  useEffect(() => {
    previewCanvasRef.current = canvasRef.current;
    return () => {
      previewCanvasRef.current = null;
    };
  }, []);

  useEffect(() => {
    let raf: number;
    let lastTs: number | null = null;

    function getLayer(index: number, width: number, height: number): FrameLayer | null {
      let layer = frameLayersRef.current[index];
      if (!layer) {
        const cv = document.createElement("canvas");
        const context = cv.getContext("2d");
        if (!context) return null;
        layer = { canvas: cv, ctx: context };
        frameLayersRef.current[index] = layer;
      }
      if (layer.canvas.width !== width) layer.canvas.width = width;
      if (layer.canvas.height !== height) layer.canvas.height = height;
      return layer;
    }

    function renderFrame(s: EditorState, laidOutVideo: LaidOutClip[], laidOutAudioTracks: LaidOutClip[][], totalDuration: number) {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;

      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const queryTime = totalDuration > 0 ? Math.min(s.playhead, totalDuration - 0.0001) : s.playhead;
      // During a cross-dissolve, both clips are "active" (both decoding and playing) at once —
      // outside of one, exactly one clip is active, same as before transitions existed.
      const transition = findTransitionAt(laidOutVideo, queryTime);
      const activeVideo = transition ? null : findActiveClip(laidOutVideo, queryTime);

      // `endBehavior: "freeze"`: once the video track has nothing left to play but the playhead is
      // still short of the full timeline (a longer music track, a later title), hold the video
      // track's very last clip on its final frame — exactly what the export's tpad clone does to
      // the same lane. `localTime` points just short of that clip's outPoint: an element's
      // currentTime can't usefully sit *at* its own duration, and the export's last decoded frame
      // is, for the same reason, never quite the frame at the nominal end either.
      const videoSequenceEnd = getSequenceDuration(laidOutVideo);
      const lastVideoClip = laidOutVideo[laidOutVideo.length - 1];
      const freezeInfo: ActiveClip | null =
        !transition && !activeVideo && s.project.endBehavior === "freeze" && lastVideoClip && queryTime >= videoSequenceEnd - 0.0005
          ? {
              clip: lastVideoClip,
              localTime: Math.max(lastVideoClip.inPoint, lastVideoClip.outPoint - 0.05),
              index: laidOutVideo.length - 1,
            }
          : null;

      function activeInfoFor(clipId: string): ActiveClip | null {
        if (transition) {
          if (transition.outgoing.clip.id === clipId) return transition.outgoing;
          if (transition.incoming.clip.id === clipId) return transition.incoming;
          return null;
        }
        return activeVideo?.clip.id === clipId ? activeVideo : null;
      }

      laidOutVideo.forEach((clip) => {
        const el = videoElsRef.current.get(clip.id);
        // Image clips have no playback state (no seeking, no volume) — only the draw step below
        // treats them differently; this loop only drives actual <video> elements.
        if (!el || !(el instanceof HTMLVideoElement)) return;
        const activeInfo = activeInfoFor(clip.id);
        const isUpNext = !transition && activeVideo != null && laidOutVideo[activeVideo.index + 1]?.id === clip.id;

        if (activeInfo) {
          // Without this the element always plays at its own native 1× regardless of clip.speed,
          // while localTime (below) advances at `speed` — the two drift apart and the periodic
          // correction above snaps currentTime back, which looks like a stutter/repeat-frame
          // "blink" instead of smooth slow motion. Matching the element's own rate to the clip's
          // means currentTime tracks localTime on its own; the seek above is then just drift/seek
          // correction, not the primary way playback speed happens.
          const rate = clampPlaybackRate(clip.speed);
          if (el.playbackRate !== rate) el.playbackRate = rate;
          if (Math.abs(el.currentTime - activeInfo.localTime) > SEEK_THRESHOLD) {
            el.currentTime = activeInfo.localTime;
          }
          // Crossfade this clip's own (embedded) audio in lockstep with the visual dissolve.
          const crossfade = transition ? (transition.outgoing.clip.id === clip.id ? 1 - transition.progress : transition.progress) : 1;
          el.volume = s.masterMuted
            ? 0
            : computeEffectiveVolume(clip, s.playhead - clip.timelineStart, clip.duration) * s.masterVolume * crossfade;
          if (s.isPlaying && el.paused) el.play().catch(() => {});
          if (!s.isPlaying && !el.paused) el.pause();
        } else if (freezeInfo?.clip.id === clip.id) {
          // Hold this (the last) clip's element on its final frame rather than letting it sit
          // wherever it happened to stop — seeking once and leaving it paused there.
          if (el.playbackRate !== 1) el.playbackRate = 1;
          if (Math.abs(el.currentTime - freezeInfo.localTime) > SEEK_THRESHOLD) el.currentTime = freezeInfo.localTime;
          if (!el.paused) el.pause();
        } else {
          if (!el.paused) el.pause();
          if (isUpNext) {
            const timeToBoundary = clip.timelineStart - s.playhead;
            if (timeToBoundary >= 0 && timeToBoundary <= PREBUFFER_WINDOW && Math.abs(el.currentTime - clip.inPoint) > SEEK_THRESHOLD) {
              el.currentTime = clip.inPoint;
            }
          }
        }
      });

      // One clip's complete frame: the black canvas with the clip fit/pan-zoomed, filtered and faded
      // on top — exactly the per-clip frame the export builds (scale/pad to the canvas, fade to
      // black) before it joins clips together. Transitions then blend these whole frames, as
      // ffmpeg's xfade does, so black letterbox bars and fades take part in a transition the same
      // way in both places.
      function drawClipFrame(cv: HTMLCanvasElement, context: CanvasRenderingContext2D, activeInfo: ActiveClip) {
        context.save();
        context.globalAlpha = 1;
        context.filter = "none";
        context.fillStyle = "#000000";
        context.fillRect(0, 0, cv.width, cv.height);
        context.restore();

        const source = s.project.sources.find((src) => src.id === activeInfo.clip.sourceId);
        const el = videoElsRef.current.get(activeInfo.clip.id);
        if (!source || !el) return;
        const isReady = el instanceof HTMLVideoElement ? el.readyState >= 2 : el.complete;
        if (!isReady) return;
        const fitRect = computeFitRect(cv.width, cv.height, source.width, source.height, activeInfo.clip.fitMode);
        const rect = applyPanZoom(fitRect, activeInfo.clip.transform, cv.width, cv.height);
        // Clamped to the clip's own duration: a frozen frame (playhead long past the clip's end)
        // reads as "exactly at the end", not as drifting further into a fade-out that already
        // finished — the export's held frame is likewise whatever the fade looked like right at
        // the clip's last decoded frame, not one that keeps fading after the clip stops playing.
        const positionInClip = Math.min(s.playhead - activeInfo.clip.timelineStart, activeInfo.clip.duration);
        const fadeMultiplier = computeFadeMultiplier(
          activeInfo.clip.fadeInSeconds,
          activeInfo.clip.fadeOutSeconds,
          positionInClip,
          activeInfo.clip.duration,
        );
        context.save();
        context.globalAlpha = Math.max(0, Math.min(1, activeInfo.clip.opacity ?? 1)) * fadeMultiplier;
        context.filter = buildCanvasFilterString(activeInfo.clip.filter);
        context.drawImage(el, rect.x, rect.y, rect.width, rect.height);
        context.restore();
      }

      if (transition) {
        const p = transition.progress;
        const w = canvas.width;
        const h = canvas.height;
        const outgoingFrame = getLayer(0, w, h);
        const incomingFrame = getLayer(1, w, h);
        if (outgoingFrame && incomingFrame) {
          drawClipFrame(outgoingFrame.canvas, outgoingFrame.ctx, transition.outgoing);
          drawClipFrame(incomingFrame.canvas, incomingFrame.ctx, transition.incoming);
          const a = outgoingFrame.canvas;
          const b = incomingFrame.canvas;
          ctx.save();
          switch (transition.outgoing.clip.transitionOutType) {
            case "slide":
              // xfade "slideleft": the outgoing frame is pushed off to the left as the incoming one
              // slides in from the right edge.
              ctx.drawImage(a, -p * w, 0);
              ctx.drawImage(b, (1 - p) * w, 0);
              break;
            case "wipe": {
              // xfade "wiperight": a hard vertical edge sweeps left-to-right revealing the incoming frame.
              ctx.drawImage(a, 0, 0);
              const revealed = Math.min(w, p * w);
              if (revealed >= 1) ctx.drawImage(b, 0, 0, revealed, h, 0, 0, revealed, h);
              break;
            }
            case "zoom": {
              // xfade "zoomin": the camera pushes into the centre of the outgoing frame during the first
              // half, then that (fully zoomed) frame cross-fades into the incoming one — both on
              // smoothstep curves, measured against ffmpeg's output.
              const q = 1 - p;
              const zoom = smoothstep(0.5, 1, q);
              const outgoingWeight = smoothstep(0, 0.5, q);
              const sw = Math.max(1, zoom * w);
              const sh = Math.max(1, zoom * h);
              ctx.drawImage(b, 0, 0);
              ctx.globalAlpha = outgoingWeight;
              ctx.drawImage(a, (w - sw) / 2, (h - sh) / 2, sw, sh, 0, 0, w, h);
              break;
            }
            case "dissolve":
            default:
              // (1 - p)·outgoing + p·incoming — xfade's "fade". (Drawing the outgoing frame at 1 - p
              // first, as this used to, dimmed the middle of every dissolve to ~75% brightness.)
              ctx.drawImage(a, 0, 0);
              ctx.globalAlpha = p;
              ctx.drawImage(b, 0, 0);
              break;
          }
          ctx.restore();
        }
      } else if (activeVideo) {
        drawClipFrame(canvas, ctx, activeVideo);
      } else if (freezeInfo) {
        drawClipFrame(canvas, ctx, freezeInfo);
      }

      // Each audio track plays independently (and simultaneously with the others) — a track's
      // own active clip is found and driven the same way the single audio lane used to be.
      laidOutAudioTracks.forEach((laidOutAudio) => {
        // Two overlapping clips on an audio track cross-fade, like the export's acrossfade.
        const audioTransition = findTransitionAt(laidOutAudio, queryTime);
        const activeAudio = audioTransition ? null : findActiveClip(laidOutAudio, queryTime);
        laidOutAudio.forEach((clip) => {
          const el = audioElsRef.current.get(clip.id);
          if (!el) return;
          let info: ActiveClip | null = activeAudio?.clip.id === clip.id ? activeAudio : null;
          let crossfade = 1;
          if (audioTransition?.outgoing.clip.id === clip.id) {
            info = audioTransition.outgoing;
            crossfade = 1 - audioTransition.progress;
          } else if (audioTransition?.incoming.clip.id === clip.id) {
            info = audioTransition.incoming;
            crossfade = audioTransition.progress;
          }
          if (info) {
            const rate = clampPlaybackRate(clip.speed);
            if (el.playbackRate !== rate) el.playbackRate = rate;
            if (Math.abs(el.currentTime - info.localTime) > SEEK_THRESHOLD) {
              el.currentTime = info.localTime;
            }
            el.volume = s.masterMuted
              ? 0
              : computeEffectiveVolume(clip, s.playhead - clip.timelineStart, clip.duration) * s.masterVolume * crossfade;
            if (s.isPlaying && el.paused) el.play().catch(() => {});
            if (!s.isPlaying && !el.paused) el.pause();
          } else if (!el.paused) {
            el.pause();
          }
        });
      });

      drawOverlays(ctx, canvas, s, imageElsRef.current);
    }

    function tick(ts: number) {
      const current = stateRef.current;
      const laidOutVideo = layoutSequentialClips(current.project.clips.filter((c) => c.trackId === VIDEO_TRACK_ID));
      const laidOutAudioTracks = getTracksByKind(current.project, "audio").map((track) => layoutTrackClips(current.project, track.id));
      // Same definition of "how long is this reel" as the timeline, transport and the export.
      const totalDuration = getTimelineDuration(current.project);

      if (current.isPlaying && lastTs !== null) {
        const dt = (ts - lastTs) / 1000;
        const nextTime = current.playhead + dt;
        if (totalDuration > 0 && nextTime >= totalDuration) {
          dispatch({ type: "SET_PLAYHEAD", time: totalDuration });
          dispatch({ type: "PAUSE" });
        } else {
          dispatch({ type: "SET_PLAYHEAD", time: nextTime });
        }
      }
      lastTs = ts;

      renderFrame(stateRef.current, laidOutVideo, laidOutAudioTracks, totalDuration);
      raf = requestAnimationFrame(tick);
    }

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [dispatch]);

  function findResizeHandleAt(canvasX: number, canvasY: number): Overlay | null {
    const canvas = canvasRef.current;
    const s = stateRef.current;
    if (!canvas || !s.selectedOverlayId) return null;
    const overlay = s.project.overlays.find((o) => o.id === s.selectedOverlayId);
    if (!overlay || overlay.kind !== "image" || !isOverlayActive(overlay, s.playhead)) return null;
    const rect = computeImageOverlayRect(overlay, canvas);
    const hx = rect.x + rect.width;
    const hy = rect.y + rect.height;
    if (Math.abs(canvasX - hx) <= RESIZE_HANDLE_SIZE && Math.abs(canvasY - hy) <= RESIZE_HANDLE_SIZE) {
      return overlay;
    }
    return null;
  }

  function findImageOverlayAt(canvasX: number, canvasY: number): Overlay | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const s = stateRef.current;
    for (let i = s.project.overlays.length - 1; i >= 0; i--) {
      const overlay = s.project.overlays[i];
      if (overlay.kind !== "image" || !isOverlayActive(overlay, s.playhead)) continue;
      const rect = computeImageOverlayRect(overlay, canvas);
      if (canvasX >= rect.x && canvasX <= rect.x + rect.width && canvasY >= rect.y && canvasY <= rect.y + rect.height) {
        return overlay;
      }
    }
    return null;
  }

  function handleCanvasPointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const canvasX = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const canvasY = ((e.clientY - rect.top) / rect.height) * canvas.height;

    const resizeOverlay = findResizeHandleAt(canvasX, canvasY);
    const overlay = resizeOverlay ?? findImageOverlayAt(canvasX, canvasY);
    if (!overlay) return;

    e.currentTarget.setPointerCapture(e.pointerId);
    overlayDragRef.current = {
      overlayId: overlay.id,
      mode: resizeOverlay ? "resize" : "move",
      startClientX: e.clientX,
      startClientY: e.clientY,
      startPosX: overlay.position.x,
      startPosY: overlay.position.y,
      startWidthRatio: overlay.widthRatio,
      startHeightRatio: overlay.heightRatio,
    };
    dispatch({ type: "SELECT_OVERLAY", overlayId: overlay.id });
  }

  function handleCanvasPointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    const drag = overlayDragRef.current;
    const canvas = canvasRef.current;
    if (!drag || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const deltaX = (e.clientX - drag.startClientX) / rect.width;
    const deltaY = (e.clientY - drag.startClientY) / rect.height;

    if (drag.mode === "move") {
      dispatch({
        type: "UPDATE_OVERLAY",
        overlayId: drag.overlayId,
        patch: {
          position: {
            x: Math.max(0, Math.min(1, drag.startPosX + deltaX)),
            y: Math.max(0, Math.min(1, drag.startPosY + deltaY)),
          },
        },
      });
      return;
    }

    const topLeftX = drag.startPosX - drag.startWidthRatio / 2;
    const topLeftY = drag.startPosY - drag.startHeightRatio / 2;
    const widthRatio = Math.max(MIN_OVERLAY_SIZE_RATIO, Math.min(1, drag.startWidthRatio + deltaX));
    const heightRatio = Math.max(MIN_OVERLAY_SIZE_RATIO, Math.min(1, drag.startHeightRatio + deltaY));
    dispatch({
      type: "UPDATE_OVERLAY",
      overlayId: drag.overlayId,
      patch: {
        widthRatio,
        heightRatio,
        position: { x: topLeftX + widthRatio / 2, y: topLeftY + heightRatio / 2 },
      },
    });
  }

  function handleCanvasPointerUp() {
    overlayDragRef.current = null;
  }

  const { width: canvasWidth, height: canvasHeight } = state.project.canvas;
  const scale = MAX_PREVIEW_DIMENSION / Math.max(canvasWidth, canvasHeight);

  return (
    <div className="preview">
      <canvas
        ref={canvasRef}
        width={Math.round(canvasWidth * scale)}
        height={Math.round(canvasHeight * scale)}
        className="preview-canvas"
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
      />
      <div className="hidden-media" aria-hidden="true">
        {videoClips.map((clip) => {
          const source = state.project.sources.find((s) => s.id === clip.sourceId);
          if (!source) return null;
          if (source.kind === "image") {
            return (
              <img
                key={clip.id}
                ref={(el) => {
                  if (el) videoElsRef.current.set(clip.id, el);
                  else videoElsRef.current.delete(clip.id);
                }}
                src={source.previewUrl}
                alt=""
              />
            );
          }
          return (
            <video
              key={clip.id}
              ref={(el) => {
                if (el) videoElsRef.current.set(clip.id, el);
                else videoElsRef.current.delete(clip.id);
              }}
              src={source.previewUrl}
              playsInline
              preload="auto"
            />
          );
        })}
        {audioClips.map((clip) => {
          const source = state.project.sources.find((s) => s.id === clip.sourceId);
          if (!source) return null;
          return (
            <audio
              key={clip.id}
              ref={(el) => {
                if (el) audioElsRef.current.set(clip.id, el);
                else audioElsRef.current.delete(clip.id);
              }}
              src={source.previewUrl}
              preload="auto"
            />
          );
        })}
        {imageSources.map((source) => (
          <img
            key={source.id}
            ref={(el) => {
              if (el) imageElsRef.current.set(source.id, el);
              else imageElsRef.current.delete(source.id);
            }}
            src={source.previewUrl}
            alt=""
          />
        ))}
      </div>
    </div>
  );
}
