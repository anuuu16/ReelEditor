import { useEffect, useRef } from "react";
import {
  computeEffectiveVolume,
  computeFitRect,
  computeOverlayAlpha,
  findActiveClip,
  getSequenceDuration,
  isOverlayActive,
  layoutSequentialClips,
  type LaidOutClip,
} from "@reel-studio/timeline-core";
import { useEditorDispatch, useEditorState, type EditorState } from "../state/EditorContext.js";
import { AUDIO_TRACK_ID, VIDEO_TRACK_ID } from "../state/initialProject.js";
import { previewCanvasRef } from "../state/previewCanvasRef.js";

const SEEK_THRESHOLD = 0.12;
const PREBUFFER_WINDOW = 0.4;
const MAX_PREVIEW_DIMENSION = 640;

function drawOverlays(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, s: EditorState) {
  const scale = canvas.width / s.project.canvas.width;

  for (const overlay of s.project.overlays) {
    if (!isOverlayActive(overlay, s.playhead)) continue;
    const alpha = computeOverlayAlpha(overlay, s.playhead);
    if (alpha <= 0) continue;

    const x = overlay.position.x * canvas.width;
    const y = overlay.position.y * canvas.height;
    const fontSize = overlay.style.size * scale;
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

export function PreviewCanvas() {
  const state = useEditorState();
  const dispatch = useEditorDispatch();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoElsRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const audioElsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const stateRef = useRef(state);
  stateRef.current = state;

  const videoClips = state.project.clips.filter((c) => c.trackId === VIDEO_TRACK_ID);
  const audioClips = state.project.clips.filter((c) => c.trackId === AUDIO_TRACK_ID);

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
      laidOutAudio: LaidOutClip[],
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
          el.volume = s.masterMuted ? 0 : computeEffectiveVolume(clip, s.playhead - clip.timelineStart, clip.duration);
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
          ctx.globalAlpha = activeVideo.clip.opacity;
          ctx.drawImage(el, rect.x, rect.y, rect.width, rect.height);
          ctx.globalAlpha = 1;
        }
      }

      const activeAudio = findActiveClip(laidOutAudio, queryTime);
      laidOutAudio.forEach((clip) => {
        const el = audioElsRef.current.get(clip.id);
        if (!el) return;
        if (activeAudio?.clip.id === clip.id) {
          if (Math.abs(el.currentTime - activeAudio.localTime) > SEEK_THRESHOLD) {
            el.currentTime = activeAudio.localTime;
          }
          el.volume = s.masterMuted ? 0 : computeEffectiveVolume(clip, s.playhead - clip.timelineStart, clip.duration);
          if (s.isPlaying && el.paused) el.play().catch(() => {});
          if (!s.isPlaying && !el.paused) el.pause();
        } else if (!el.paused) {
          el.pause();
        }
      });

      drawOverlays(ctx, canvas, s);
    }

    function tick(ts: number) {
      const current = stateRef.current;
      const laidOutVideo = layoutSequentialClips(current.project.clips.filter((c) => c.trackId === VIDEO_TRACK_ID));
      const laidOutAudio = layoutSequentialClips(current.project.clips.filter((c) => c.trackId === AUDIO_TRACK_ID));
      const overlaysEnd = current.project.overlays.reduce((end, o) => Math.max(end, o.end), 0);
      const totalDuration = Math.max(getSequenceDuration(laidOutVideo), getSequenceDuration(laidOutAudio), overlaysEnd);

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

      renderFrame(stateRef.current, laidOutVideo, laidOutAudio, totalDuration);
      raf = requestAnimationFrame(tick);
    }

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [dispatch]);

  const { width: canvasWidth, height: canvasHeight } = state.project.canvas;
  const scale = MAX_PREVIEW_DIMENSION / Math.max(canvasWidth, canvasHeight);

  return (
    <div className="preview">
      <canvas
        ref={canvasRef}
        width={Math.round(canvasWidth * scale)}
        height={Math.round(canvasHeight * scale)}
        className="preview-canvas"
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
      </div>
    </div>
  );
}
