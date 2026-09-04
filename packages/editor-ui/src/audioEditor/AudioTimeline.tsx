import { useEffect, useMemo, useRef, type DragEvent, type PointerEvent as ReactPointerEvent } from "react";
import { AudioClipBlock } from "./AudioClipBlock.js";
import {
  clipEnd,
  sourceById,
  timelineDuration,
  type AudioClip,
  type AudioTimeline as AudioTimelineModel,
} from "./timeline.js";

export const LANE_HEIGHT = 72;
const RULER_HEIGHT = 22;
const MIN_VISIBLE_SEC = 30;

interface AudioTimelineProps {
  timeline: AudioTimelineModel;
  pxPerSec: number;
  playheadSec: number;
  selectedClipId: string | null;
  onSelectClip: (id: string | null) => void;
  onScrub: (sec: number) => void;
  onGestureStart: () => void;
  onClipLive: (id: string, patch: Partial<AudioClip>) => void;
  onDropFiles: (files: File[], laneIndex: number, startSec: number) => void;
}

function tickLabel(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m}:${s.toString().padStart(2, "0")}` : `${s}s`;
}

export function AudioTimeline({
  timeline,
  pxPerSec,
  playheadSec,
  selectedClipId,
  onSelectClip,
  onScrub,
  onGestureStart,
  onClipLive,
  onDropFiles,
}: AudioTimelineProps) {
  const lanesRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLCanvasElement>(null);
  const scrubbingRef = useRef(false);

  const totalSec = Math.max(MIN_VISIBLE_SEC, timelineDuration(timeline) + 5);
  const widthPx = totalSec * pxPerSec;
  const lanesHeight = timeline.laneCount * LANE_HEIGHT;

  // snap targets: 0, playhead, and every clip's start + end (excluding the clip being dragged is
  // handled implicitly — snapping to your own edges is a no-op).
  const snapTargets = useMemo(() => {
    const t = [0, playheadSec];
    for (const c of timeline.clips) {
      t.push(c.startSec, clipEnd(c));
    }
    return t;
  }, [timeline.clips, playheadSec]);

  useEffect(() => {
    const canvas = rulerRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(widthPx * dpr);
    canvas.height = RULER_HEIGHT * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, widthPx, RULER_HEIGHT);
    ctx.fillStyle = "#8b8d99";
    ctx.font = "10px system-ui, sans-serif";
    // aim for a tick roughly every ~80px
    const targetPx = 80;
    const niceSteps = [1, 2, 5, 10, 15, 30, 60, 120, 300];
    const step = niceSteps.find((s) => s * pxPerSec >= targetPx) ?? 600;
    for (let sec = 0; sec <= totalSec; sec += step) {
      const x = sec * pxPerSec;
      ctx.fillRect(x, RULER_HEIGHT - 6, 1, 6);
      ctx.fillText(tickLabel(sec), x + 3, 11);
    }
  }, [widthPx, pxPerSec, totalSec]);

  function scrubFromClientX(clientX: number) {
    const rect = lanesRef.current?.getBoundingClientRect();
    if (!rect) return;
    onScrub(Math.max(0, (clientX - rect.left) / pxPerSec));
  }

  function handleRulerPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    scrubbingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubFromClientX(e.clientX);
  }
  function handleRulerPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (scrubbingRef.current) scrubFromClientX(e.clientX);
  }
  function handleRulerPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    scrubbingRef.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }

  function handleLanesPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    // clicks that reach here missed every clip
    onSelectClip(null);
    scrubFromClientX(e.clientX);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("audio/"));
    if (files.length === 0) return;
    const rect = lanesRef.current?.getBoundingClientRect();
    if (!rect) return;
    const laneIndex = Math.max(0, Math.min(timeline.laneCount - 1, Math.floor((e.clientY - rect.top) / LANE_HEIGHT)));
    const startSec = Math.max(0, (e.clientX - rect.left) / pxPerSec);
    onDropFiles(files, laneIndex, startSec);
  }

  return (
    <div className="ae-timeline">
      <div className="ae-timeline-scroll">
        <div style={{ width: widthPx, position: "relative" }}>
          <div
            className="ae-ruler"
            style={{ height: RULER_HEIGHT }}
            onPointerDown={handleRulerPointerDown}
            onPointerMove={handleRulerPointerMove}
            onPointerUp={handleRulerPointerUp}
            onPointerCancel={handleRulerPointerUp}
          >
            <canvas ref={rulerRef} style={{ width: widthPx, height: RULER_HEIGHT, display: "block" }} />
          </div>

          <div
            ref={lanesRef}
            className="ae-lanes"
            style={{ height: lanesHeight }}
            onPointerDown={handleLanesPointerDown}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          >
            {Array.from({ length: timeline.laneCount }, (_, i) => (
              <div key={i} className="ae-lane" style={{ top: i * LANE_HEIGHT, height: LANE_HEIGHT }} />
            ))}

            {timeline.clips.map((clip) => {
              const source = sourceById(timeline, clip.sourceId);
              if (!source) return null;
              return (
                <AudioClipBlock
                  key={clip.id}
                  clip={clip}
                  source={source}
                  pxPerSec={pxPerSec}
                  laneHeight={LANE_HEIGHT}
                  laneCount={timeline.laneCount}
                  selected={clip.id === selectedClipId}
                  snapTargets={snapTargets}
                  lanesRef={lanesRef}
                  onSelect={() => onSelectClip(clip.id)}
                  onGestureStart={onGestureStart}
                  onLive={(patch) => onClipLive(clip.id, patch)}
                />
              );
            })}
          </div>

          <div className="ae-playhead" style={{ left: playheadSec * pxPerSec, height: RULER_HEIGHT + lanesHeight }} />
        </div>
      </div>
    </div>
  );
}
