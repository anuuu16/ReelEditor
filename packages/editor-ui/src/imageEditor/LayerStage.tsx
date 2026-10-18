import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { ImageDocument, Layer } from "./document.js";
import { renderDocument, type BaseCache, type MediaMap } from "./renderImage.js";
import {
  computeResize,
  constrainToAxis,
  getLayerBox,
  hitTestLayers,
  rotationFromPointer,
  snapToCenter,
  type HandleId,
  type LayerBox,
  type ResizeGesture,
} from "./layerGeometry.js";
import { useFittedSize } from "./useFittedSize.js";

/** The base photo is selectable like a layer (to pan it and to show its settings) under this id. */
export const PHOTO_SELECTION = "photo";
export type Selection = string | typeof PHOTO_SELECTION | null;

const ALL_HANDLES: HandleId[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
/** Text boxes size their own height, so only the width (sides) and scale (corners) are draggable. */
const TEXT_HANDLES: HandleId[] = ["nw", "ne", "e", "se", "sw", "w"];

type Gesture =
  | { type: "move"; layerId: string; start: { x: number; y: number }; startLayer: Layer }
  | { type: "pan"; start: { x: number; y: number }; startOffset: { x: number; y: number } }
  | ({ type: "resize"; layerId: string } & ResizeGesture)
  | { type: "rotate"; layerId: string; box: LayerBox };

interface LayerStageProps {
  doc: ImageDocument;
  media: MediaMap;
  /** Matte to preview with — the one the current export format will actually produce. */
  matte: string | null;
  /** The owner gets the rendered canvas (for thumbnails) without re-rendering the document. */
  canvasRef: RefObject<HTMLCanvasElement>;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  /** Open one undo step for the gesture that's starting. */
  onGestureStart: () => void;
  /** Apply an in-gesture change (no history entry). */
  onGestureChange: (update: (doc: ImageDocument) => ImageDocument) => void;
  /** Double-click on a layer — the owner can jump to its text field, for instance. */
  onActivate?: (layerId: string) => void;
}

/** Name of the performance.measure() entry recorded for every preview render. */
export const RENDER_MEASURE = "image-editor:render";

/** Pointer distance (screen px) within which a dragged layer's centre snaps to the canvas centre. */
const SNAP_PX = 8;

export function LayerStage({
  doc,
  media,
  matte,
  canvasRef,
  selection,
  onSelect,
  onGestureStart,
  onGestureChange,
  onActivate,
}: LayerStageProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const baseCacheRef = useRef<BaseCache | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [guides, setGuides] = useState<{ x: boolean; y: boolean }>({ x: false, y: false });
  const [angleBadge, setAngleBadge] = useState<number | null>(null);

  const { width: W, height: H } = doc.canvas;

  // The canvas is drawn at full output resolution and scaled down by CSS; the overlay must match
  // its displayed size exactly, so that size is computed here rather than left to CSS max-* rules.
  const { displayW, displayH, scale } = useFittedSize(hostRef, W, H);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const started = performance.now();
    baseCacheRef.current = renderDocument({ canvas, doc, media, matte, baseCache: baseCacheRef.current });
    // User Timing entry per preview render — what DevTools' Performance panel and the e2e tests
    // read to check that dragging a layer over a huge photo stays interactive.
    performance.measure(RENDER_MEASURE, { start: started });
  }, [doc, media, matte]);

  /** Pointer position in canvas pixels. */
  const toCanvasPoint = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const overlay = overlayRef.current;
      if (!overlay) return { x: 0, y: 0 };
      const rect = overlay.getBoundingClientRect();
      return { x: ((e.clientX - rect.left) / rect.width) * W, y: ((e.clientY - rect.top) / rect.height) * H };
    },
    [W, H],
  );

  function layerById(id: string): Layer | undefined {
    return doc.layers.find((l) => l.id === id);
  }

  function startGesture(e: ReactPointerEvent<HTMLElement>, gesture: Gesture) {
    e.preventDefault();
    e.stopPropagation();
    // preventDefault above keeps focus wherever it was (e.g. a text field) — take it explicitly,
    // so keyboard shortcuts apply to the layer just grabbed rather than to that field.
    overlayRef.current?.focus();
    overlayRef.current?.setPointerCapture(e.pointerId);
    gestureRef.current = gesture;
    onGestureStart();
  }

  function handleOverlayPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const point = toCanvasPoint(e);
    const hit = hitTestLayers(doc.layers, point.x, point.y, W, H);
    if (hit) {
      onSelect(hit.id);
      startGesture(e, { type: "move", layerId: hit.id, start: point, startLayer: hit });
      return;
    }
    // Empty canvas = the photo: select it, and let a drag pan it.
    if (!doc.sourceMediaId) {
      overlayRef.current?.focus();
      onSelect(null);
      return;
    }
    onSelect(PHOTO_SELECTION);
    startGesture(e, { type: "pan", start: point, startOffset: { x: doc.photo.offsetX, y: doc.photo.offsetY } });
  }

  function handleHandlePointerDown(e: ReactPointerEvent<HTMLElement>, handle: HandleId) {
    const layer = selection && selection !== PHOTO_SELECTION ? layerById(selection) : undefined;
    if (!layer || e.button !== 0) return;
    startGesture(e, {
      type: "resize",
      layerId: layer.id,
      handle,
      start: toCanvasPoint(e),
      startLayer: layer,
      startBox: getLayerBox(layer, W, H),
    });
  }

  function handleRotatePointerDown(e: ReactPointerEvent<HTMLElement>) {
    const layer = selection && selection !== PHOTO_SELECTION ? layerById(selection) : undefined;
    if (!layer || e.button !== 0) return;
    startGesture(e, { type: "rotate", layerId: layer.id, box: getLayerBox(layer, W, H) });
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const gesture = gestureRef.current;
    const point = toCanvasPoint(e);
    if (!gesture) {
      setHoveredId(hitTestLayers(doc.layers, point.x, point.y, W, H)?.id ?? null);
      return;
    }

    switch (gesture.type) {
      case "move": {
        const dx = (point.x - gesture.start.x) / W;
        const dy = (point.y - gesture.start.y) / H;
        const { startLayer } = gesture;
        const moved = e.shiftKey ? constrainToAxis(startLayer, dx, dy, W, H) : { x: startLayer.x + dx, y: startLayer.y + dy };
        // Snap the centre to the canvas centre (Alt to override), with guides showing why it stuck.
        const threshold = !e.altKey && scale > 0 ? SNAP_PX / scale : 0;
        const { x, y, snappedX, snappedY } = snapToCenter(moved, threshold, W, H);
        setGuides({ x: snappedX, y: snappedY });
        onGestureChange((d) => ({ ...d, layers: d.layers.map((l) => (l.id === gesture.layerId ? { ...l, x, y } : l)) }));
        break;
      }
      case "pan": {
        const offsetX = gesture.startOffset.x + (point.x - gesture.start.x) / W;
        const offsetY = gesture.startOffset.y + (point.y - gesture.start.y) / H;
        onGestureChange((d) => ({ ...d, photo: { ...d.photo, offsetX, offsetY } }));
        break;
      }
      case "resize": {
        const patch = computeResize(gesture, point, e.shiftKey, W, H);
        onGestureChange((d) => ({ ...d, layers: d.layers.map((l) => (l.id === gesture.layerId ? ({ ...l, ...patch } as Layer) : l)) }));
        break;
      }
      case "rotate": {
        const rotation = rotationFromPointer(gesture.box, point, e.shiftKey);
        setAngleBadge(rotation);
        onGestureChange((d) => ({ ...d, layers: d.layers.map((l) => (l.id === gesture.layerId ? { ...l, rotation } : l)) }));
        break;
      }
    }
  }

  function handlePointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (gestureRef.current && overlayRef.current?.hasPointerCapture(e.pointerId)) {
      overlayRef.current.releasePointerCapture(e.pointerId);
    }
    gestureRef.current = null;
    setGuides({ x: false, y: false });
    setAngleBadge(null);
  }

  function handleDoubleClick(e: React.MouseEvent<HTMLDivElement>) {
    const point = toCanvasPoint(e);
    const hit = hitTestLayers(doc.layers, point.x, point.y, W, H);
    if (hit) onActivate?.(hit.id);
  }

  const selectedLayer = selection && selection !== PHOTO_SELECTION ? layerById(selection) : undefined;
  const selectedBox = selectedLayer ? getLayerBox(selectedLayer, W, H) : null;
  const hoveredLayer = hoveredId && hoveredId !== selection ? layerById(hoveredId) : undefined;
  const hoveredBox = hoveredLayer ? getLayerBox(hoveredLayer, W, H) : null;

  function boxStyle(box: LayerBox): React.CSSProperties {
    return {
      left: `${((box.cx - box.w / 2) / W) * 100}%`,
      top: `${((box.cy - box.h / 2) / H) * 100}%`,
      width: `${(box.w / W) * 100}%`,
      height: `${(box.h / H) * 100}%`,
      transform: `rotate(${box.rotation}deg)`,
    };
  }

  const handles = selectedLayer?.kind === "text" ? TEXT_HANDLES : ALL_HANDLES;

  return (
    <div className="ie-stage-host" ref={hostRef}>
      <div className="ie-stage" style={{ width: displayW || undefined, height: displayH || undefined }}>
        <canvas ref={canvasRef} className="ie-canvas" />
        <div
          ref={overlayRef}
          className="ie-stage-overlay"
          tabIndex={-1}
          onPointerDown={handleOverlayPointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={() => setHoveredId(null)}
          onDoubleClick={handleDoubleClick}
          style={{ cursor: hoveredBox ? "move" : doc.sourceMediaId ? "grab" : "default" }}
        >
          {guides.x && <div className="ie-guide ie-guide-v" />}
          {guides.y && <div className="ie-guide ie-guide-h" />}
          {hoveredBox && <div className="ie-layer-hover" style={boxStyle(hoveredBox)} />}
          {selectedBox && selectedLayer && (
            <div className={`ie-layer-selection${selectedLayer.locked ? " locked" : ""}`} style={boxStyle(selectedBox)}>
              {!selectedLayer.locked &&
                handles.map((id) => (
                  <span key={id} className={`ie-handle ie-handle-${id}`} onPointerDown={(e) => handleHandlePointerDown(e, id)} />
                ))}
              {!selectedLayer.locked && (
                <>
                  <span className="ie-rotate-stem" />
                  <span className="ie-rotate-handle" title="Drag to rotate (Shift snaps to 15°)" onPointerDown={handleRotatePointerDown} />
                </>
              )}
              {angleBadge !== null && <span className="ie-angle-badge">{Math.round(angleBadge)}°</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
