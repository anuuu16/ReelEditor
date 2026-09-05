import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type DragEvent, type PointerEvent as ReactPointerEvent } from "react";
import { AudioClipBlock } from "./AudioClipBlock.js";
import { NoteMarker } from "./NoteMarker.js";
import {
  clipEnd,
  findGapInLane,
  MAX_PX_PER_SEC,
  MIN_PX_PER_SEC,
  SOURCE_DRAG_TYPE,
  sourceById,
  timelineDuration,
  type AudioClip,
  type AudioTimeline as AudioTimelineModel,
  type Gap,
  type TimelineNote,
} from "./timeline.js";

export const LANE_HEIGHT = 72;
const RULER_HEIGHT = 28;
const NOTES_STRIP_HEIGHT = 18;
const MIN_VISIBLE_SEC = 30;

interface AudioTimelineProps {
  timeline: AudioTimelineModel;
  pxPerSec: number;
  onZoomChange: (pxPerSec: number) => void;
  playheadSec: number;
  selectedClipId: string | null;
  onSelectClip: (id: string | null) => void;
  selectedGap: Gap | null;
  onSelectGap: (gap: Gap | null) => void;
  onScrub: (sec: number) => void;
  onGestureStart: () => void;
  onClipLive: (id: string, patch: Partial<AudioClip>) => void;
  onDropFiles: (files: File[], laneIndex: number, startSec: number) => void;
  onDropSourceId: (sourceId: string, laneIndex: number, startSec: number) => void;
  onSplitClip: (id: string) => void;
  onDuplicateClip: (id: string) => void;
  onDeleteClip: (id: string) => void;
  onRippleDeleteClip: (id: string) => void;
  notes: TimelineNote[];
  openNoteId: string | null;
  onToggleNote: (id: string) => void;
  onUpdateNoteText: (id: string, text: string) => void;
  onDeleteNote: (id: string) => void;
}

function tickLabel(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m}:${s.toString().padStart(2, "0")}` : `${s}s`;
}

export function AudioTimeline({
  timeline,
  pxPerSec,
  onZoomChange,
  playheadSec,
  selectedClipId,
  onSelectClip,
  selectedGap,
  onSelectGap,
  onScrub,
  onGestureStart,
  onClipLive,
  onDropFiles,
  onDropSourceId,
  onSplitClip,
  onDuplicateClip,
  onDeleteClip,
  onRippleDeleteClip,
  notes,
  openNoteId,
  onToggleNote,
  onUpdateNoteText,
  onDeleteNote,
}: AudioTimelineProps) {
  const lanesRef = useRef<HTMLDivElement>(null);
  const rulerCanvasRef = useRef<HTMLCanvasElement>(null);
  const rulerBarRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrubbingRef = useRef(false);
  const zoomAnchorRef = useRef<{ sec: number; offsetX: number } | null>(null);
  const scrollLeftRef = useRef(0);

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

  // 1-based position of each clip among its own lane's clips in timeline order — lets a stack of
  // same-named repeats on one lane be told apart at a glance.
  const orderIndexByClipId = useMemo(() => {
    const map = new Map<string, number>();
    for (let lane = 0; lane < timeline.laneCount; lane++) {
      const laneClips = timeline.clips.filter((c) => c.laneIndex === lane).sort((a, b) => a.startSec - b.startSec);
      laneClips.forEach((c, i) => map.set(c.id, i + 1));
    }
    return map;
  }, [timeline.clips, timeline.laneCount]);

  // The ruler is a *fixed-size* canvas matching the visible viewport, not the whole (potentially
  // very long) timeline — redrawn from the current scroll position instead of ever allocating a
  // canvas proportional to project duration. A single giant canvas hit two problems as projects
  // got longer: Chromium renders an oversized one as blank white past its internal size limit, and
  // squeezing it back under that limit by compressing the drawing scale made every tick/label
  // blurry. Redrawing just what's on screen has neither problem and is exactly how real DAW rulers
  // work — it stays crisp and cheap at any project length or zoom.
  const drawRuler = useCallback(() => {
    const canvas = rulerCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    const bar = rulerBarRef.current;
    if (!canvas || !ctx || !bar) return;
    const dpr = window.devicePixelRatio || 1;
    const viewportW = Math.max(1, bar.clientWidth);
    if (canvas.width !== Math.round(viewportW * dpr)) canvas.width = Math.round(viewportW * dpr);
    if (canvas.height !== Math.round(RULER_HEIGHT * dpr)) canvas.height = Math.round(RULER_HEIGHT * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, viewportW, RULER_HEIGHT);

    const scrollLeft = scrollLeftRef.current;
    ctx.fillStyle = "#c7c9d6";
    ctx.font = "600 11px system-ui, sans-serif";
    const targetPx = 80;
    const niceSteps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
    const step = niceSteps.find((s) => s * pxPerSec >= targetPx) ?? 3600;
    const firstSec = Math.max(0, Math.floor(scrollLeft / pxPerSec / step) * step);
    const lastSec = Math.min(totalSec, (scrollLeft + viewportW) / pxPerSec + step);
    for (let sec = firstSec; sec <= lastSec; sec += step) {
      const x = sec * pxPerSec - scrollLeft;
      ctx.fillRect(x, RULER_HEIGHT - 8, 1, 8);
      ctx.fillText(tickLabel(sec), x + 4, RULER_HEIGHT - 12);
    }

    const playheadX = playheadSec * pxPerSec - scrollLeft;
    if (playheadX >= -2 && playheadX <= viewportW + 2) {
      ctx.fillStyle = "#7da2ff";
      ctx.fillRect(playheadX - 4, RULER_HEIGHT - 6, 8, 6);
    }
  }, [pxPerSec, totalSec, playheadSec]);

  useEffect(() => drawRuler(), [drawRuler]);

  useEffect(() => {
    const bar = rulerBarRef.current;
    if (!bar || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => drawRuler());
    ro.observe(bar);
    return () => ro.disconnect();
  }, [drawRuler]);

  // Keeps the ruler in sync as the timeline scrolls horizontally — imperative (a ref, not React
  // state) so scrolling doesn't trigger a re-render on every pixel.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function onScroll() {
      scrollLeftRef.current = el!.scrollLeft;
      drawRuler();
    }
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [drawRuler]);

  // Ctrl/Cmd+scroll (and trackpad pinch, which browsers report as wheel events with ctrlKey set)
  // zooms in/out centered on the cursor. A native listener (not React's onWheel) so preventDefault
  // reliably stops the page/container from also scrolling or the browser from zooming the page.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function handleWheel(e: WheelEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const rect = el!.getBoundingClientRect();
      const offsetX = e.clientX - rect.left;
      const sec = (el!.scrollLeft + offsetX) / pxPerSec;
      zoomAnchorRef.current = { sec, offsetX };
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      onZoomChange(Math.max(MIN_PX_PER_SEC, Math.min(MAX_PX_PER_SEC, pxPerSec * factor)));
    }
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [pxPerSec, onZoomChange]);

  // Runs after a zoom-driven re-render: restores the anchor point set above under the cursor.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const anchor = zoomAnchorRef.current;
    if (!el || !anchor) return;
    el.scrollLeft = anchor.sec * pxPerSec - anchor.offsetX;
    zoomAnchorRef.current = null;
  }, [pxPerSec]);

  function scrubFromClientX(clientX: number) {
    const rect = lanesRef.current?.getBoundingClientRect();
    if (!rect) return;
    onScrub(Math.max(0, (clientX - rect.left) / pxPerSec));
  }

  function rulerSecFromClientX(clientX: number): number {
    const rect = rulerBarRef.current?.getBoundingClientRect();
    const offset = rect ? clientX - rect.left : 0;
    return Math.max(0, (scrollLeftRef.current + offset) / pxPerSec);
  }

  function handleRulerPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    scrubbingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    onScrub(rulerSecFromClientX(e.clientX));
  }
  function handleRulerPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (scrubbingRef.current) onScrub(rulerSecFromClientX(e.clientX));
  }
  function handleRulerPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    scrubbingRef.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }

  function handleLanesPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    // clicks that reach here missed every clip
    onSelectClip(null);
    const rect = lanesRef.current?.getBoundingClientRect();
    if (rect) {
      const laneIndex = Math.max(0, Math.min(timeline.laneCount - 1, Math.floor((e.clientY - rect.top) / LANE_HEIGHT)));
      const atSec = Math.max(0, (e.clientX - rect.left) / pxPerSec);
      onSelectGap(findGapInLane(timeline, laneIndex, atSec));
    }
    scrubFromClientX(e.clientX);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const rect = lanesRef.current?.getBoundingClientRect();
    if (!rect) return;
    const laneIndex = Math.max(0, Math.min(timeline.laneCount - 1, Math.floor((e.clientY - rect.top) / LANE_HEIGHT)));
    const startSec = Math.max(0, (e.clientX - rect.left) / pxPerSec);

    const sourceId = e.dataTransfer.getData(SOURCE_DRAG_TYPE);
    if (sourceId) {
      onDropSourceId(sourceId, laneIndex, startSec);
      return;
    }
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("audio/"));
    if (files.length > 0) onDropFiles(files, laneIndex, startSec);
  }

  return (
    <div className="ae-timeline">
      <div
        ref={rulerBarRef}
        className="ae-ruler"
        style={{ height: RULER_HEIGHT }}
        onPointerDown={handleRulerPointerDown}
        onPointerMove={handleRulerPointerMove}
        onPointerUp={handleRulerPointerUp}
        onPointerCancel={handleRulerPointerUp}
      >
        <canvas ref={rulerCanvasRef} style={{ width: "100%", height: RULER_HEIGHT, display: "block" }} />
      </div>

      <div className="ae-timeline-scroll" ref={scrollRef}>
        <div style={{ width: widthPx, position: "relative" }}>
          <div className="ae-notes-strip" style={{ height: NOTES_STRIP_HEIGHT }}>
            {notes.map((note) => (
              <NoteMarker
                key={note.id}
                note={note}
                leftPx={note.atSec * pxPerSec}
                open={openNoteId === note.id}
                onToggle={() => onToggleNote(note.id)}
                onChangeText={(text) => onUpdateNoteText(note.id, text)}
                onDelete={() => onDeleteNote(note.id)}
              />
            ))}
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

            {selectedGap && (
              <div
                className="ae-gap-highlight"
                style={{
                  left: selectedGap.startSec * pxPerSec,
                  width: (selectedGap.endSec - selectedGap.startSec) * pxPerSec,
                  top: selectedGap.laneIndex * LANE_HEIGHT,
                  height: LANE_HEIGHT,
                }}
              />
            )}

            {timeline.clips.map((clip) => {
              const source = sourceById(timeline, clip.sourceId);
              if (!source) return null;
              return (
                <AudioClipBlock
                  key={clip.id}
                  clip={clip}
                  source={source}
                  orderIndex={orderIndexByClipId.get(clip.id) ?? 0}
                  pxPerSec={pxPerSec}
                  laneHeight={LANE_HEIGHT}
                  laneCount={timeline.laneCount}
                  selected={clip.id === selectedClipId}
                  snapTargets={snapTargets}
                  lanesRef={lanesRef}
                  onSelect={() => onSelectClip(clip.id)}
                  onGestureStart={onGestureStart}
                  onLive={(patch) => onClipLive(clip.id, patch)}
                  playheadSec={playheadSec}
                  onSplit={() => onSplitClip(clip.id)}
                  onDuplicate={() => onDuplicateClip(clip.id)}
                  onDelete={() => onDeleteClip(clip.id)}
                  onRippleDelete={() => onRippleDeleteClip(clip.id)}
                />
              );
            })}
          </div>

          <div className="ae-playhead" style={{ left: playheadSec * pxPerSec, height: NOTES_STRIP_HEIGHT + lanesHeight }} />
        </div>
      </div>
    </div>
  );
}
