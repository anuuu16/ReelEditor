import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { ImageDocument } from "./document.js";
import { renderDocument, type MediaMap } from "./renderImage.js";
import { useFittedSize } from "./useFittedSize.js";

export type CompareMode = "slider" | "side-by-side" | "toggle";
export const COMPARE_MODES: Array<{ id: CompareMode; label: string }> = [
  { id: "slider", label: "Slider" },
  { id: "side-by-side", label: "Side by side" },
  { id: "toggle", label: "Toggle" },
];

interface CompareStageProps {
  before: ImageDocument;
  after: ImageDocument;
  media: MediaMap;
  matte: string | null;
  mode: CompareMode;
  beforeLabel?: string;
  afterLabel?: string;
}

/** Draws a document into a canvas whenever it changes. */
function useRenderedCanvas(doc: ImageDocument, media: MediaMap, matte: string | null) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) renderDocument({ canvas: ref.current, doc, media, matte });
  }, [doc, media, matte]);
  return ref;
}

export function CompareStage({ before, after, media, matte, mode, beforeLabel = "Before", afterLabel = "After" }: CompareStageProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const { width: W, height: H } = after.canvas;
  const sideBySide = mode === "side-by-side";
  // Side by side shows two frames in the same host, so each gets half the width.
  const { displayW, displayH } = useFittedSize(hostRef, sideBySide ? W * 2 + 16 : W, H);
  const frameW = sideBySide ? (displayW - 16) / 2 : displayW;

  const beforeRef = useRenderedCanvas(before, media, matte);
  const afterRef = useRenderedCanvas(after, media, matte);
  const [split, setSplit] = useState(0.5);
  const [showAfter, setShowAfter] = useState(true);
  const dragging = useRef(false);

  function updateSplit(e: ReactPointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    setSplit(Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)));
  }

  const frame = { width: frameW || undefined, height: displayH || undefined };

  if (sideBySide) {
    return (
      <div className="ie-stage-host" ref={hostRef}>
        <div className="ie-compare-pair">
          <figure className="ie-compare-frame" style={frame}>
            <canvas ref={beforeRef} className="ie-canvas" />
            <figcaption className="ie-compare-label">{beforeLabel}</figcaption>
          </figure>
          <figure className="ie-compare-frame" style={frame}>
            <canvas ref={afterRef} className="ie-canvas" />
            <figcaption className="ie-compare-label">{afterLabel}</figcaption>
          </figure>
        </div>
      </div>
    );
  }

  if (mode === "toggle") {
    return (
      <div className="ie-stage-host" ref={hostRef}>
        <div
          className="ie-stage ie-compare-toggle"
          style={frame}
          role="button"
          tabIndex={0}
          title="Click or hold to flip between before and after"
          onPointerDown={() => setShowAfter(false)}
          onPointerUp={() => setShowAfter(true)}
          onPointerLeave={() => setShowAfter(true)}
          onKeyDown={(e) => {
            if (e.key === " " || e.key === "Enter") setShowAfter((v) => !v);
          }}
        >
          <canvas ref={afterRef} className="ie-canvas" style={{ visibility: showAfter ? "visible" : "hidden" }} />
          <canvas ref={beforeRef} className="ie-canvas ie-compare-over" style={{ visibility: showAfter ? "hidden" : "visible" }} />
          <span className="ie-compare-label">
            {showAfter ? afterLabel : beforeLabel} — hold to see {showAfter ? beforeLabel : afterLabel}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="ie-stage-host" ref={hostRef}>
      <div
        className="ie-stage ie-compare-slider"
        style={frame}
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          updateSplit(e);
        }}
        onPointerMove={(e) => dragging.current && updateSplit(e)}
        onPointerUp={() => {
          dragging.current = false;
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
      >
        <canvas ref={afterRef} className="ie-canvas" />
        <canvas ref={beforeRef} className="ie-canvas ie-compare-over" style={{ clipPath: `inset(0 ${(1 - split) * 100}% 0 0)` }} />
        <span className="ie-compare-label ie-compare-label-left">{beforeLabel}</span>
        <span className="ie-compare-label ie-compare-label-right">{afterLabel}</span>
        <div className="ie-compare-divider" style={{ left: `${split * 100}%` }} data-testid="compare-divider">
          <span className="ie-compare-knob">⇔</span>
        </div>
      </div>
    </div>
  );
}
