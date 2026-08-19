import { useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Overlay } from "@reel-studio/shared-types";
import {
  buildCanvasFilterString,
  computeEffectiveVolume,
  computeFadeMultiplier,
  computeFitRect,
  computeOverlayAlpha,
  computeOverlayPopScale,
  computeOverlaySlideOffsetRatio,
  findActiveClip,
  getSequenceDuration,
  getTracksByKind,
  isOverlayActive,
  layoutSequentialClips,
  layoutTrackClips,
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
      const activeVideo = findActiveClip(laidOutVideo, queryTime);

      laidOutVideo.forEach((clip) => {
        const el = videoElsRef.current.get(clip.id);
        if (!el) return;
        const isActive = activeVideo?.clip.id === clip.id;
        const isUpNext = activeVideo != null && laidOutVideo[activeVideo.index + 1]?.id === clip.id;

        if (isActive && activeVideo) {
          if (Math.abs(el.currentTime - activeVideo.localTime) > SEEK_THRESHOLD) {
            el.currentTime = activeVideo.localTime;
          }
          el.volume = s.masterMuted ? 0 : computeEffectiveVolume(clip, s.playhead - clip.timelineStart, clip.duration) * s.masterVolume;
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

      if (activeVideo) {
        const source = s.project.sources.find((src) => src.id === activeVideo.clip.sourceId);
        const el = videoElsRef.current.get(activeVideo.clip.id);
        if (source && el && el.readyState >= 2) {
          const rect = computeFitRect(canvas.width, canvas.height, source.width, source.height, activeVideo.clip.fitMode);
          const fadeMultiplier = computeFadeMultiplier(
            activeVideo.clip.fadeInSeconds,
            activeVideo.clip.fadeOutSeconds,
            s.playhead - activeVideo.clip.timelineStart,
            activeVideo.clip.duration
          );
          ctx.globalAlpha = activeVideo.clip.opacity * fadeMultiplier;
          ctx.filter = buildCanvasFilterString(activeVideo.clip.filter);
          ctx.drawImage(el, rect.x, rect.y, rect.width, rect.height);
          ctx.filter = "none";
          ctx.globalAlpha = 1;
        }
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
