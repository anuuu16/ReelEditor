import { useRef, useState, type DragEvent } from "react";
import { SHAPE_TYPES, STICKERS, type ImageDocument, type Layer, type ShapeType } from "./document.js";
import { PHOTO_SELECTION, type Selection } from "./LayerStage.js";

interface LayerPanelProps {
  doc: ImageDocument;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  onAddText: () => void;
  onAddShape: (shape: ShapeType) => void;
  onAddSticker: (emoji: string) => void;
  onAddImage: (file: File) => void;
  onToggleVisible: (id: string) => void;
  onToggleLocked: (id: string) => void;
  onReorder: (id: string, toIndex: number) => void;
}

const KIND_GLYPH: Record<Layer["kind"], string> = { text: "T", shape: "◆", image: "▣" };

function layerSummary(layer: Layer): string {
  if (layer.kind === "text") return layer.text.split("\n")[0].slice(0, 28) || "(empty)";
  if (layer.kind === "shape") return layer.shape;
  return "image";
}

export function LayerPanel({
  doc,
  selection,
  onSelect,
  onAddText,
  onAddShape,
  onAddSticker,
  onAddImage,
  onToggleVisible,
  onToggleLocked,
  onReorder,
}: LayerPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [openMenu, setOpenMenu] = useState<"shape" | "sticker" | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  // Drawn bottom-to-top, listed top-to-bottom — the way every layers panel reads.
  const rows = doc.layers.map((layer, index) => ({ layer, index })).reverse();

  function handleDragOver(e: DragEvent<HTMLLIElement>, index: number) {
    if (!dragId) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    // Above the row's midline = land ABOVE it in the list (= higher array index).
    const above = e.clientY < rect.top + rect.height / 2;
    setDropIndex(above ? index + 1 : index);
  }

  function handleDrop(e: DragEvent<HTMLElement>) {
    e.preventDefault();
    if (dragId && dropIndex != null) {
      const from = doc.layers.findIndex((l) => l.id === dragId);
      // Removing the dragged layer first shifts everything above it down by one.
      const target = dropIndex > from ? dropIndex - 1 : dropIndex;
      onReorder(dragId, target);
    }
    setDragId(null);
    setDropIndex(null);
  }

  return (
    <>
      <div className="inline-fields inline-fields-wrap ie-layer-add">
        <button type="button" onClick={onAddText}>
          + Text
        </button>
        <div className="ie-shape-menu-host">
          <button
            type="button"
            className={openMenu === "shape" ? "active" : ""}
            onClick={() => setOpenMenu((m) => (m === "shape" ? null : "shape"))}
          >
            + Shape
          </button>
          {openMenu === "shape" && (
            <div className="ie-shape-menu" onMouseLeave={() => setOpenMenu(null)}>
              {SHAPE_TYPES.map((shape) => (
                <button
                  key={shape}
                  type="button"
                  onClick={() => {
                    onAddShape(shape);
                    setOpenMenu(null);
                  }}
                >
                  {shape}
                </button>
              ))}
            </div>
          )}
        </div>
        <button type="button" onClick={() => fileInputRef.current?.click()} title="A logo, a sticker, a cut-out — any image file">
          + Image
        </button>
        <div className="ie-shape-menu-host">
          <button
            type="button"
            className={openMenu === "sticker" ? "active" : ""}
            onClick={() => setOpenMenu((m) => (m === "sticker" ? null : "sticker"))}
          >
            + Sticker
          </button>
          {openMenu === "sticker" && (
            <div className="ie-shape-menu ie-sticker-menu" onMouseLeave={() => setOpenMenu(null)}>
              {STICKERS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => {
                    onAddSticker(emoji);
                    setOpenMenu(null);
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onAddImage(file);
            e.target.value = "";
          }}
        />
      </div>

      <ul className="ie-layer-list" onDragOver={(e) => dragId && e.preventDefault()} onDrop={handleDrop}>
        {rows.map(({ layer, index }) => (
          <li
            key={layer.id}
            className={[
              "ie-layer-row",
              selection === layer.id ? "selected" : "",
              layer.visible ? "" : "hidden-layer",
              dragId === layer.id ? "dragging" : "",
              dropIndex === index + 1 ? "drop-above" : "",
              dropIndex === index ? "drop-below" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              setDragId(layer.id);
            }}
            onDragEnd={() => {
              setDragId(null);
              setDropIndex(null);
            }}
            onDragOver={(e) => handleDragOver(e, index)}
            onClick={() => onSelect(layer.id)}
          >
            <span className={`ie-layer-glyph ie-layer-glyph-${layer.kind}`}>{KIND_GLYPH[layer.kind]}</span>
            <span className="ie-layer-name">
              <span>{layer.name}</span>
              <small>{layerSummary(layer)}</small>
            </span>
            <button
              type="button"
              className={`ie-layer-toggle${layer.visible ? " on" : ""}`}
              title={layer.visible ? "Hide" : "Show"}
              onClick={(e) => {
                e.stopPropagation();
                onToggleVisible(layer.id);
              }}
            >
              {layer.visible ? "👁" : "–"}
            </button>
            <button
              type="button"
              className={`ie-layer-toggle${layer.locked ? " on" : ""}`}
              title={layer.locked ? "Unlock" : "Lock"}
              onClick={(e) => {
                e.stopPropagation();
                onToggleLocked(layer.id);
              }}
            >
              {layer.locked ? "🔒" : "🔓"}
            </button>
          </li>
        ))}
        <li
          className={`ie-layer-row ie-layer-row-photo${selection === PHOTO_SELECTION ? " selected" : ""}${doc.sourceMediaId ? "" : " hidden-layer"}`}
          onClick={() => onSelect(doc.sourceMediaId ? PHOTO_SELECTION : null)}
        >
          <span className="ie-layer-glyph ie-layer-glyph-photo">▦</span>
          <span className="ie-layer-name">
            <span>Photo</span>
            <small>{doc.sourceMediaId ? doc.sourceName : "no photo loaded"}</small>
          </span>
        </li>
      </ul>
      {doc.layers.length === 0 && <p className="hint">Add text, a shape or another image — then drag it around on the preview.</p>}
      {doc.layers.length > 1 && <p className="hint">Drag rows to reorder. Top of the list is in front.</p>}
    </>
  );
}
