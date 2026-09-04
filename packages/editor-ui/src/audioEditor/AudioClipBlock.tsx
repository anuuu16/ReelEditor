import { useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { peaksFromChannel } from "./waveform.js";
import { sliceChannelData } from "./mixdown.js";
import { clipVisibleDuration, snap, MIN_CLIP_SEC, type AudioClip, type AudioSource } from "./timeline.js";

interface AudioClipBlockProps {
  clip: AudioClip;
  source: AudioSource;
  pxPerSec: number;
  laneHeight: number;
  laneCount: number;
  selected: boolean;
  /** Absolute-second positions a dragged edge/start should snap to (other clip edges, playhead, 0). */
  snapTargets: number[];
  lanesRef: RefObject<HTMLDivElement>;
  onSelect: () => void;
  onGestureStart: () => void;
  onLive: (patch: Partial<AudioClip>) => void;
}

type Grab =
  | { kind: "body"; clientX: number; clientY: number; startSec: number; laneIndex: number }
  | { kind: "left"; clientX: number; trimStartSec: number; startSec: number }
  | { kind: "right"; clientX: number; trimEndSec: number }
  | { kind: "fadeIn"; clientX: number; fadeInSec: number }
  | { kind: "fadeOut"; clientX: number; fadeOutSec: number };

const EDGE_PX = 8;
const HANDLE_PX = 10;

export function AudioClipBlock({
  clip,
  source,
  pxPerSec,
  laneHeight,
  laneCount,
  selected,
  snapTargets,
  lanesRef,
  onSelect,
  onGestureStart,
  onLive,
}: AudioClipBlockProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const grabRef = useRef<Grab | null>(null);

  const speed = clip.speed > 0 ? clip.speed : 1;
  const visibleDur = clipVisibleDuration(clip);
  const widthPx = Math.max(6, visibleDur * pxPerSec);
  const heightPx = laneHeight - 6;

  const peaks = useMemo(
    () => peaksFromChannel(sliceChannelData(source, clip.trimStartSec, clip.trimEndSec), Math.max(1, Math.round(widthPx))),
    [source, clip.trimStartSec, clip.trimEndSec, widthPx]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(widthPx));
    if (canvas.width !== w * dpr) canvas.width = w * dpr;
    if (canvas.height !== Math.round(heightPx * dpr)) canvas.height = Math.round(heightPx * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, heightPx);
    const mid = heightPx / 2;
    ctx.fillStyle = selected ? "#cfe0ff" : "#9fb8ef";
    for (let col = 0; col < w; col++) {
      const y0 = mid - peaks[col * 2 + 1] * mid * 0.9;
      const y1 = mid - peaks[col * 2] * mid * 0.9;
      ctx.fillRect(col, y0, 1, Math.max(1, y1 - y0));
    }
    // fade ramps
    const fiX = (clip.fadeInSec / speed) * pxPerSec;
    const foX = w - (clip.fadeOutSec / speed) * pxPerSec;
    ctx.strokeStyle = "#ffd479";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, clip.fadeInSec > 0 ? heightPx - 1 : 1);
    ctx.lineTo(fiX, 1);
    ctx.lineTo(foX, 1);
    ctx.lineTo(w, clip.fadeOutSec > 0 ? heightPx - 1 : 1);
    ctx.stroke();
  }, [peaks, widthPx, heightPx, selected, clip.fadeInSec, clip.fadeOutSec, speed, pxPerSec]);

  function laneFromClientY(clientY: number): number {
    const rect = lanesRef.current?.getBoundingClientRect();
    if (!rect) return clip.laneIndex;
    return Math.max(0, Math.min(laneCount - 1, Math.floor((clientY - rect.top) / laneHeight)));
  }

  function pickGrab(x: number, y: number, clientX: number, clientY: number): Grab {
    const fiX = (clip.fadeInSec / speed) * pxPerSec;
    const foX = widthPx - (clip.fadeOutSec / speed) * pxPerSec;
    if (y < 14 && Math.abs(x - fiX) <= HANDLE_PX) return { kind: "fadeIn", clientX, fadeInSec: clip.fadeInSec };
    if (y < 14 && Math.abs(x - foX) <= HANDLE_PX) return { kind: "fadeOut", clientX, fadeOutSec: clip.fadeOutSec };
    if (x <= EDGE_PX) return { kind: "left", clientX, trimStartSec: clip.trimStartSec, startSec: clip.startSec };
    if (x >= widthPx - EDGE_PX) return { kind: "right", clientX, trimEndSec: clip.trimEndSec };
    return { kind: "body", clientX, clientY, startSec: clip.startSec, laneIndex: clip.laneIndex };
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    onSelect();
    const rect = e.currentTarget.getBoundingClientRect();
    grabRef.current = pickGrab(e.clientX - rect.left, e.clientY - rect.top, e.clientX, e.clientY);
    onGestureStart();
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const grab = grabRef.current;
    if (!grab) return;
    const dSec = (e.clientX - grab.clientX) / pxPerSec;
    const dur = source.buffer.duration;

    switch (grab.kind) {
      case "body": {
        const nextStart = Math.max(0, snap(grab.startSec + dSec, snapTargets, pxPerSec));
        const nextLane = laneFromClientY(e.clientY);
        onLive({ startSec: nextStart, laneIndex: nextLane });
        break;
      }
      case "left": {
        // Trim from the head: reveal less of the source, clip's left edge follows.
        let nextTrimStart = grab.trimStartSec + dSec * speed;
        nextTrimStart = Math.max(0, Math.min(nextTrimStart, clip.trimEndSec - MIN_CLIP_SEC));
        // Also honour startSec floor: can't push the clip's left edge below 0.
        const minTrimStart = grab.trimStartSec - grab.startSec * speed;
        nextTrimStart = Math.max(nextTrimStart, minTrimStart);
        const snappedStart = snap(grab.startSec + (nextTrimStart - grab.trimStartSec) / speed, snapTargets, pxPerSec);
        const nextStart = Math.max(0, snappedStart);
        onLive({ trimStartSec: nextTrimStart, startSec: nextStart });
        break;
      }
      case "right": {
        let nextTrimEnd = grab.trimEndSec + dSec * speed;
        nextTrimEnd = Math.max(clip.trimStartSec + MIN_CLIP_SEC, Math.min(nextTrimEnd, dur));
        const end = clip.startSec + (nextTrimEnd - clip.trimStartSec) / speed;
        const snappedEnd = snap(end, snapTargets, pxPerSec);
        nextTrimEnd = clip.trimStartSec + (snappedEnd - clip.startSec) * speed;
        nextTrimEnd = Math.max(clip.trimStartSec + MIN_CLIP_SEC, Math.min(nextTrimEnd, dur));
        onLive({ trimEndSec: nextTrimEnd });
        break;
      }
      case "fadeIn":
        onLive({ fadeInSec: Math.max(0, Math.min((grab.fadeInSec / speed + dSec) * speed, (clip.trimEndSec - clip.trimStartSec) / 2)) });
        break;
      case "fadeOut":
        onLive({ fadeOutSec: Math.max(0, Math.min((grab.fadeOutSec / speed - dSec) * speed, (clip.trimEndSec - clip.trimStartSec) / 2)) });
        break;
    }
  }

  function handlePointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    grabRef.current = null;
  }

  return (
    <div
      className={`ae-clip${selected ? " selected" : ""}${clip.muted ? " muted" : ""}`}
      style={{ left: clip.startSec * pxPerSec, width: widthPx, height: heightPx, top: clip.laneIndex * laneHeight + 3 }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <canvas ref={canvasRef} className="ae-clip-canvas" />
      <span className="ae-clip-label">{clip.name}</span>
      <span className="ae-clip-edge ae-clip-edge-left" />
      <span className="ae-clip-edge ae-clip-edge-right" />
    </div>
  );
}
