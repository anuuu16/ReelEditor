import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { peaksFromChannel } from "./waveform.js";
import { sliceChannelData } from "./mixdown.js";
import { clipVisibleDuration, snap, MIN_CLIP_SEC, type AudioClip, type AudioSource } from "./timeline.js";

interface AudioClipBlockProps {
  clip: AudioClip;
  source: AudioSource;
  /** 1-based position among this clip's own lane, in timeline order — see AudioTimeline. */
  orderIndex: number;
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
  /** For the clip's own quick-action menu — split is only meaningful with the playhead inside it. */
  playheadSec: number;
  onSplit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onRippleDelete: () => void;
}

type Grab =
  | { kind: "body"; clientX: number; clientY: number; startSec: number; laneIndex: number }
  | { kind: "left"; clientX: number; trimStartSec: number; startSec: number }
  | { kind: "right"; clientX: number; trimEndSec: number }
  | { kind: "fadeIn"; clientX: number; fadeInSec: number }
  | { kind: "fadeOut"; clientX: number; fadeOutSec: number };

const EDGE_PX = 8;
const HANDLE_PX = 10;

// Browsers silently render an oversized canvas as a blank/white rectangle instead of erroring
// (Chromium does this once a canvas's physical pixel width crosses its internal limit) — a clip
// canvas sized 1:1 to duration*pxPerSec*devicePixelRatio hits that well before an 8+ minute file
// finishes zooming in. Capping the canvas's own resolution and letting CSS (width:100%) stretch it
// back up to the clip's real on-screen width keeps every clip rendering, just softer once a clip is
// far longer than this many columns can resolve.
const MAX_CANVAS_PHYSICAL_PX = 8000;

export function AudioClipBlock({
  clip,
  source,
  orderIndex,
  pxPerSec,
  laneHeight,
  laneCount,
  selected,
  snapTargets,
  lanesRef,
  onSelect,
  onGestureStart,
  onLive,
  playheadSec,
  onSplit,
  onDuplicate,
  onDelete,
  onRippleDelete,
}: AudioClipBlockProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Fixed-position + portal (not a plain absolutely-positioned child): .ae-clip and its scroll
  // ancestors all clip overflow for the waveform/scrollbar's sake, which would silently truncate a
  // dropdown rendered inside them regardless of position:fixed — painting it into document.body
  // via a portal sidesteps that entirely.
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const menuOpen = menuPos !== null;
  const grabRef = useRef<Grab | null>(null);

  const speed = clip.speed > 0 ? clip.speed : 1;
  const visibleDur = clipVisibleDuration(clip);
  const widthPx = Math.max(6, visibleDur * pxPerSec);
  const heightPx = laneHeight - 6;
  const dpr = window.devicePixelRatio || 1;
  // The clip's DOM/layout width (widthPx) stays exact for positioning and scrolling; only the
  // canvas's own drawing resolution is capped — canvasCols <= widthPx always, and CSS (width:100%)
  // stretches it back up to widthPx on screen.
  const canvasCols = Math.max(1, Math.min(Math.round(widthPx), Math.floor(MAX_CANVAS_PHYSICAL_PX / dpr)));

  const peaks = useMemo(
    () => peaksFromChannel(sliceChannelData(source, clip.trimStartSec, clip.trimEndSec), canvasCols),
    [source, clip.trimStartSec, clip.trimEndSec, canvasCols]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const w = canvasCols;
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
    // fade ramps — scaled into the (possibly compressed) canvas's own coordinate space, matching
    // where the CSS stretch will visually place them back at the real fade duration.
    const canvasPxPerSec = pxPerSec * (w / widthPx);
    const fiX = (clip.fadeInSec / speed) * canvasPxPerSec;
    const foX = w - (clip.fadeOutSec / speed) * canvasPxPerSec;
    ctx.strokeStyle = "#ffd479";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, clip.fadeInSec > 0 ? heightPx - 1 : 1);
    ctx.lineTo(fiX, 1);
    ctx.lineTo(foX, 1);
    ctx.lineTo(w, clip.fadeOutSec > 0 ? heightPx - 1 : 1);
    ctx.stroke();
  }, [peaks, canvasCols, widthPx, heightPx, selected, clip.fadeInSec, clip.fadeOutSec, speed, pxPerSec, dpr]);

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

  const canSplit = playheadSec > clip.startSec + MIN_CLIP_SEC && playheadSec < clip.startSec + visibleDur - MIN_CLIP_SEC;

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuPos(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  function runAction(action: () => void) {
    setMenuPos(null);
    onSelect();
    action();
  }

  // Clamped so the menu never renders partly off-screen for a clip near the timeline's right edge.
  const MENU_W = 160;
  const MENU_H = 150;
  const menuStyle = menuPos
    ? { left: Math.min(menuPos.x, window.innerWidth - MENU_W - 8), top: Math.min(menuPos.y, window.innerHeight - MENU_H - 8) }
    : undefined;

  return (
    <div
      className={`ae-clip${selected ? " selected" : ""}${clip.muted ? " muted" : ""}`}
      style={{ left: clip.startSec * pxPerSec, width: widthPx, height: heightPx, top: clip.laneIndex * laneHeight + 3 }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onContextMenu={(e) => {
        e.preventDefault();
        onSelect();
        setMenuPos({ x: e.clientX, y: e.clientY });
      }}
    >
      <canvas ref={canvasRef} className="ae-clip-canvas" />
      <span className="ae-clip-label">
        <span className="ae-clip-index">{orderIndex}</span> {clip.name}
      </span>
      <span className="ae-clip-edge ae-clip-edge-left" />
      <span className="ae-clip-edge ae-clip-edge-right" />

      <button
        type="button"
        className="ae-clip-menu-button"
        title="Clip options"
        aria-label="Clip options"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
          if (menuOpen) {
            setMenuPos(null);
          } else {
            const rect = e.currentTarget.getBoundingClientRect();
            setMenuPos({ x: rect.right, y: rect.bottom + 2 });
          }
        }}
      >
        ⋮
      </button>

      {menuOpen &&
        menuStyle &&
        createPortal(
          <div className="ae-clip-menu" style={menuStyle} onPointerDown={(e) => e.stopPropagation()}>
            <button
              type="button"
              disabled={!canSplit}
              title={canSplit ? "" : "Move the playhead inside this clip"}
              onClick={() => runAction(onSplit)}
            >
              Split at playhead
            </button>
            <button type="button" onClick={() => runAction(onDuplicate)}>
              Duplicate
            </button>
            <button type="button" onClick={() => runAction(onRippleDelete)} title="Delete and close the gap it leaves">
              Ripple delete
            </button>
            <button type="button" className="ae-danger" onClick={() => runAction(onDelete)}>
              Delete
            </button>
          </div>,
          document.body
        )}
    </div>
  );
}
