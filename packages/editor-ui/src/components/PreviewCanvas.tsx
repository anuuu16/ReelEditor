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

function drawOverlays(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  s: EditorState,
  imageEls: Map<string, HTMLImageElement>
) {
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
          RESIZE_HANDLE_SIZE
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
  const videoElsRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const audioElsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const imageElsRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const overlayDragRef = useRef<OverlayDragState | null>(null);
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

    function renderFrame(
      s: EditorState,
      laidOutVideo: LaidOutClip[],
      laidOutAudioTracks: LaidOutClip[][],
      totalDuration: number
    ) {
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
        if (!el) return;
        const activeInfo = activeInfoFor(clip.id);
        const isUpNext = !transition && activeVideo != null && laidOutVideo[activeVideo.index + 1]?.id === clip.id;

        if (activeInfo) {
          if (Math.abs(el.currentTime - activeInfo.localTime) > SEEK_THRESHOLD) {
            el.currentTime = activeInfo.localTime;
          }
          // Crossfade this clip's own (embedded) audio in lockstep with the visual dissolve.
          const crossfade = transition ? (transition.outgoing.clip.id === clip.id ? 1 - transition.progress : transition.progress) : 1;
          el.volume =
            s.masterMuted ? 0 : computeEffectiveVolume(clip, s.playhead - clip.timelineStart, clip.duration) * s.masterVolume * crossfade;
          if (s.isPlaying && el.paused) el.play().catch(() => {});
          if (!s.isPlaying && !el.paused) el.pause();
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

      interface DrawOptions {
        alphaMultiplier?: number;
        xOffsetPx?: number; // horizontal shift, for the slide transition
        extraScale?: number; // additional uniform scale around center, for the zoom transition
        clipRectPx?: { x: number; y: number; width: number; height: number }; // for the wipe transition
      }

      function drawVideoClip(cv: HTMLCanvasElement, context: CanvasRenderingContext2D, activeInfo: ActiveClip, options: DrawOptions = {}) {
        const { alphaMultiplier = 1, xOffsetPx = 0, extraScale = 1, clipRectPx } = options;
        const source = s.project.sources.find((src) => src.id === activeInfo.clip.sourceId);
        const el = videoElsRef.current.get(activeInfo.clip.id);
        if (!source || !el || el.readyState < 2) return;
        const fitRect = computeFitRect(cv.width, cv.height, source.width, source.height, activeInfo.clip.fitMode);
        let rect = applyPanZoom(fitRect, activeInfo.clip.transform, cv.width, cv.height);
        if (extraScale !== 1) {
          const width = rect.width * extraScale;
          const height = rect.height * extraScale;
          rect = { x: rect.x - (width - rect.width) / 2, y: rect.y - (height - rect.height) / 2, width, height };
        }
        rect = { ...rect, x: rect.x + xOffsetPx };
        const fadeMultiplier = computeFadeMultiplier(
          activeInfo.clip.fadeInSeconds,
          activeInfo.clip.fadeOutSeconds,
          s.playhead - activeInfo.clip.timelineStart,
          activeInfo.clip.duration
        );
        context.save();
        if (clipRectPx) {
          context.beginPath();
          context.rect(clipRectPx.x, clipRectPx.y, clipRectPx.width, clipRectPx.height);
          context.clip();
        }
        context.globalAlpha = activeInfo.clip.opacity * fadeMultiplier * alphaMultiplier;
        context.filter = buildCanvasFilterString(activeInfo.clip.filter);
        context.drawImage(el, rect.x, rect.y, rect.width, rect.height);
        context.restore();
      }

      if (transition) {
        const p = transition.progress;
        switch (transition.outgoing.clip.transitionOutType) {
          case "slide":
            // Both clips move together — outgoing pushed fully off-screen left as incoming slides in from the right.
            drawVideoClip(canvas, ctx, transition.outgoing, { xOffsetPx: -p * canvas.width });
            drawVideoClip(canvas, ctx, transition.incoming, { xOffsetPx: (1 - p) * canvas.width });
            break;
          case "wipe":
            // A hard edge reveals the incoming clip left-to-right; no alpha blending, unlike dissolve/zoom.
            drawVideoClip(canvas, ctx, transition.outgoing, {});
            drawVideoClip(canvas, ctx, transition.incoming, {
              clipRectPx: { x: 0, y: 0, width: p * canvas.width, height: canvas.height },
            });
            break;
          case "zoom":
            // Crossfade plus the incoming clip growing in from half size, for a "punch in" reveal.
            drawVideoClip(canvas, ctx, transition.outgoing, { alphaMultiplier: 1 - p });
            drawVideoClip(canvas, ctx, transition.incoming, { alphaMultiplier: p, extraScale: 0.5 + 0.5 * p });
            break;
          case "dissolve":
          default:
            // Outgoing drawn first as the base layer, incoming blended over it at `progress` opacity —
            // equivalent to a linear crossfade and matches ffmpeg xfade's "fade" transition exactly.
            drawVideoClip(canvas, ctx, transition.outgoing, { alphaMultiplier: 1 - p });
            drawVideoClip(canvas, ctx, transition.incoming, { alphaMultiplier: p });
            break;
        }
      } else if (activeVideo) {
        drawVideoClip(canvas, ctx, activeVideo, {});
      }

      // Each audio track plays independently (and simultaneously with the others) — a track's
      // own active clip is found and driven the same way the single audio lane used to be.
      laidOutAudioTracks.forEach((laidOutAudio) => {
        const activeAudio = findActiveClip(laidOutAudio, queryTime);
        laidOutAudio.forEach((clip) => {
          const el = audioElsRef.current.get(clip.id);
          if (!el) return;
          if (activeAudio?.clip.id === clip.id) {
            if (Math.abs(el.currentTime - activeAudio.localTime) > SEEK_THRESHOLD) {
              el.currentTime = activeAudio.localTime;
            }
            el.volume = s.masterMuted ? 0 : computeEffectiveVolume(clip, s.playhead - clip.timelineStart, clip.duration) * s.masterVolume;
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
      const overlaysEnd = current.project.overlays.reduce((end, o) => Math.max(end, o.end), 0);
      const totalDuration = Math.max(
        getSequenceDuration(laidOutVideo),
        ...laidOutAudioTracks.map((clips) => getSequenceDuration(clips)),
        overlaysEnd
      );

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
