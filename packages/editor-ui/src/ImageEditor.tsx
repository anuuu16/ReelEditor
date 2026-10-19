import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { ASPECT_RATIO_PRESETS } from "@reel-studio/timeline-core";
import {
  deleteImageTemplate,
  listImageTemplates,
  loadImageProject,
  saveImageProject,
  saveImageTemplate,
  saveImageToGallery,
  type ImageProjectRecord,
} from "./persistence/db.js";
import { useSnapshotHistory } from "./state/useSnapshotHistory.js";
import { SliderField } from "./imageEditor/SliderField.js";
import { Section } from "./imageEditor/fields.js";
import {
  applyTemplateConfig,
  createDefaultDocument,
  createDefaultPhotoSettings,
  createImageLayer,
  createShapeLayer,
  createStickerLayer,
  createTextLayer,
  duplicateLayer,
  FULL_CROP,
  hasTransparency,
  moveLayer,
  normalizeDocument,
  originalDocument,
  referencedMediaIds,
  reorderLayer,
  updateLayer,
  type ImageDocument,
  type Layer,
  type OutputFormat,
  type ShapeType,
} from "./imageEditor/document.js";
import { effectiveExportMatte, exportDocument, FORMAT_INFO, renderThumbnail } from "./imageEditor/renderImage.js";
import { useImageMedia } from "./imageEditor/useImageMedia.js";
import { LayerStage, PHOTO_SELECTION, type Selection } from "./imageEditor/LayerStage.js";
import { COMPARE_MODES, CompareStage, type CompareMode } from "./imageEditor/CompareStage.js";
import { LayerPanel } from "./imageEditor/LayerPanel.js";
import { LayerInspector } from "./imageEditor/LayerInspector.js";
import { PhotoPanels } from "./imageEditor/PhotoPanels.js";
import { TemplatesPanel } from "./imageEditor/TemplatesPanel.js";
import {
  BUILT_IN_TEMPLATES,
  buildSavedTemplate,
  freshLayerIds,
  remapTemplateMedia,
  savedToTemplate,
  type ImageTemplate,
} from "./imageEditor/templates.js";
import { purgeUnreferencedMedia } from "./imageEditor/storage.js";

interface ImageEditorProps {
  /** The project to open. A brand-new id opens an empty, unsaved project that's created on its first edit. */
  projectId: string;
  onBack: () => void;
  /** Opens the batch exporter with a template preselected. */
  onBatchExport: (templateId: string) => void;
}

const UNTITLED = "Untitled image";
const AUTOSAVE_DELAY_MS = 400;
const THUMBNAIL_EDGE = 320;

/** Scales the live preview canvas down into a small JPEG for the Dashboard. */
function captureThumbnail(canvas: HTMLCanvasElement | null): Promise<Blob | null> {
  if (!canvas || canvas.width === 0) return Promise.resolve(null);
  const scale = Math.min(1, THUMBNAIL_EDGE / Math.max(canvas.width, canvas.height));
  const thumb = document.createElement("canvas");
  thumb.width = Math.max(1, Math.round(canvas.width * scale));
  thumb.height = Math.max(1, Math.round(canvas.height * scale));
  const ctx = thumb.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  ctx.fillStyle = "#1a1b20";
  ctx.fillRect(0, 0, thumb.width, thumb.height);
  ctx.drawImage(canvas, 0, 0, thumb.width, thumb.height);
  return new Promise((resolve) => thumb.toBlob((blob) => resolve(blob), "image/jpeg", 0.8));
}

const SCALE_PRESETS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// A stored document can outlive its blobs (storage cleared, a failed write): references to
// anything that's gone are dropped so the editor doesn't present a photo it can't draw. Image
// layers are kept — they render as a placeholder and can be given a new image.
function dropMissingMedia(doc: ImageDocument, available: Set<string>): ImageDocument {
  const sourceOk = doc.sourceMediaId === null || available.has(doc.sourceMediaId);
  const backgroundOk = doc.background.mediaId === null || available.has(doc.background.mediaId);
  if (sourceOk && backgroundOk) return doc;
  return {
    ...doc,
    sourceMediaId: sourceOk ? doc.sourceMediaId : null,
    background: backgroundOk
      ? doc.background
      : { ...doc.background, mediaId: null, mode: doc.background.mode === "image" ? "solid" : doc.background.mode },
  };
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export function ImageEditor({ projectId, onBack, onBatchExport }: ImageEditorProps) {
  const { state: doc, commit, checkpoint, live, load, undo, redo, canUndo, canRedo } = useSnapshotHistory(createDefaultDocument());
  const { media, add: addMedia, restore: restoreMedia, sync: syncMedia } = useImageMedia();
  const [ready, setReady] = useState(false);
  const [name, setName] = useState(UNTITLED);
  // What's on disk for this project: null until it has been saved once. A brand-new project that
  // was never touched is never written, so backing out of "+ New image project" leaves no clutter.
  const recordRef = useRef<Pick<ImageProjectRecord, "createdAt"> | null>(null);
  const loadedRef = useRef<{ doc: ImageDocument; name: string } | null>(null);
  const pendingSaveRef = useRef<(() => Promise<void>) | null>(null);
  // The last thumbnail written — reused when a flush happens after the canvas is gone (unmount).
  const thumbnailRef = useRef<Blob | null>(null);
  const stageCanvasRef = useRef<HTMLCanvasElement>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [savedTemplates, setSavedTemplates] = useState<ImageTemplate[]>([]);
  const [customRatio, setCustomRatio] = useState({ w: 1, h: 1 });
  const [estimatedBytes, setEstimatedBytes] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [isDragOver, setIsDragOver] = useState(false);
  const [compare, setCompare] = useState<CompareMode | null>(null);
  const textInputRef = useRef<HTMLTextAreaElement>(null);

  const { width, height } = doc.canvas;
  const photo = doc.sourceMediaId ? (media[doc.sourceMediaId] ?? null) : null;
  const backgroundImage = doc.background.mediaId ? (media[doc.background.mediaId] ?? null) : null;
  const selectedLayer = selection && selection !== PHOTO_SELECTION ? (doc.layers.find((l) => l.id === selection) ?? null) : null;
  const selectedIndex = selectedLayer ? doc.layers.indexOf(selectedLayer) : -1;

  const croppedLongEdge = photo ? Math.max(photo.width * doc.photo.crop.width, photo.height * doc.photo.crop.height) : 0;
  const targetLongEdge = Math.max(width, height);
  const willUpscale = croppedLongEdge > 0 && targetLongEdge > croppedLongEdge;

  const flash = useCallback((message: string) => {
    setStatus(message);
    window.setTimeout(() => setStatus(null), 2400);
  }, []);

  // -------------------------------------------------------------------------------------------
  // Persistence: open the project on mount, then autosave (debounced) on every change.

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const record = await loadImageProject(projectId).catch(() => null);
      // A cancelled instance (StrictMode double-invokes this in dev) must not flip `ready`, or the
      // autosave below would overwrite the stored document with the blank starting one.
      if (cancelled) return;
      if (record) {
        const available = new Set(await restoreMedia(referencedMediaIds(record.doc)));
        if (cancelled) return;
        const restored = dropMissingMedia(normalizeDocument(record.doc), available);
        recordRef.current = { createdAt: record.createdAt };
        loadedRef.current = { doc: restored, name: record.name };
        thumbnailRef.current = record.thumbnail;
        load(restored);
        setName(record.name);
      } else {
        loadedRef.current = { doc, name };
      }
      setReady(true);
    })();
    listImageTemplates()
      .then((list) => {
        if (!cancelled) setSavedTemplates(list.map(savedToTemplate));
      })
      .catch((err) => console.error("Could not list templates", err));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (!ready) return;
    const loaded = loadedRef.current;
    // Nothing to write for an untouched new project.
    if (!recordRef.current && loaded && loaded.doc === doc && loaded.name === name) return;

    const save = async () => {
      pendingSaveRef.current = null;
      try {
        const createdAt = recordRef.current?.createdAt ?? Date.now();
        await syncMedia(referencedMediaIds(doc));
        await saveImageProject({
          id: projectId,
          name: name.trim() || UNTITLED,
          doc,
          createdAt,
          updatedAt: Date.now(),
          thumbnail: (thumbnailRef.current = (await captureThumbnail(stageCanvasRef.current)) ?? thumbnailRef.current),
        });
        recordRef.current = { createdAt };
        setSaveState("saved");
      } catch (err) {
        console.error("Autosave failed", err);
        setSaveState("idle");
      }
    };
    setSaveState("saving");
    pendingSaveRef.current = save;
    const handle = window.setTimeout(save, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(handle);
  }, [doc, name, ready, projectId, syncMedia]);

  // Leaving the editor: write anything still waiting on the debounce, then drop stored blobs no
  // project or template needs any more (this session's undo history is gone at that point, so
  // only what's referenced on disk matters).
  useEffect(() => {
    return () => {
      const flush = pendingSaveRef.current?.() ?? Promise.resolve();
      flush.then(() => purgeUnreferencedMedia()).catch((err) => console.error("Cleanup on leave failed", err));
    };
  }, []);

  // -------------------------------------------------------------------------------------------
  // Media in

  const loadPhotoFile = useCallback(
    async (file: File) => {
      try {
        const item = await addMedia(file);
        const name = file.name.replace(/\.[^./]+$/, "") || "image";
        commit((d) => ({
          ...d,
          sourceMediaId: item.id,
          sourceName: name,
          photo: { ...d.photo, crop: FULL_CROP, cropAspect: "Free" },
        }));
        setName((current) => (current.trim() === "" || current === UNTITLED ? name : current));
        setSelection(PHOTO_SELECTION);
      } catch {
        flash(`Couldn't read ${file.name}`);
      }
    },
    [addMedia, commit, flash],
  );

  const addImageLayer = useCallback(
    async (file: File) => {
      try {
        const item = await addMedia(file);
        const name = file.name.replace(/\.[^./]+$/, "") || "Image";
        // Box aspect is expressed in canvas fractions, so the image's ratio is corrected by the canvas's.
        const layer = createImageLayer(item.id, name, (item.width / item.height) * (doc.canvas.height / doc.canvas.width));
        commit((d) => ({ ...d, layers: [...d.layers, layer] }));
        setSelection(layer.id);
      } catch {
        flash(`Couldn't read ${file.name}`);
      }
    },
    [addMedia, commit, flash, doc.canvas.width, doc.canvas.height],
  );

  const loadBackgroundFile = useCallback(
    async (file: File) => {
      try {
        const item = await addMedia(file);
        commit((d) => ({ ...d, background: { ...d.background, mode: "image", mediaId: item.id } }));
      } catch {
        flash(`Couldn't read ${file.name}`);
      }
    },
    [addMedia, commit, flash],
  );

  /** Files arriving by drop or paste: the first one becomes the photo; after that they're layers. */
  const receiveFile = useCallback(
    (file: File) => {
      if (!doc.sourceMediaId) {
        void loadPhotoFile(file);
      } else {
        void addImageLayer(file);
        flash("Added as an image layer — use Source → Image file to replace the photo");
      }
    },
    [doc.sourceMediaId, loadPhotoFile, addImageLayer, flash],
  );

  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      if (isEditableTarget(e.target)) return;
      const file = Array.from(e.clipboardData?.items ?? [])
        .find((item) => item.type.startsWith("image/"))
        ?.getAsFile();
      if (file) receiveFile(file);
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [receiveFile]);

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
    const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/"));
    if (file) receiveFile(file);
  }

  // -------------------------------------------------------------------------------------------
  // Layers

  function addText() {
    const layer = createTextLayer({ y: 0.5 });
    commit((d) => ({ ...d, layers: [...d.layers, layer] }));
    setSelection(layer.id);
    // Jump straight into typing.
    window.setTimeout(() => textInputRef.current?.select(), 0);
  }

  function addSticker(emoji: string) {
    const layer = createStickerLayer(emoji);
    commit((d) => ({ ...d, layers: [...d.layers, layer] }));
    setSelection(layer.id);
  }

  function addShape(shape: ShapeType) {
    const layer = createShapeLayer(shape);
    // Shape boxes are defined in canvas fractions; start them square-ish in pixels.
    const aspect = doc.canvas.width / doc.canvas.height;
    if (shape !== "line" && shape !== "arrow") layer.height = layer.width * aspect * 0.75;
    commit((d) => ({ ...d, layers: [...d.layers, layer] }));
    setSelection(layer.id);
  }

  function patchSelectedLayer(patch: Partial<Layer>, key?: string) {
    if (!selectedLayer) return;
    const id = selectedLayer.id;
    commit((d) => ({ ...d, layers: updateLayer(d.layers, id, patch) }), key);
  }

  function removeLayer(id: string) {
    commit((d) => ({ ...d, layers: d.layers.filter((l) => l.id !== id) }));
    if (selection === id) setSelection(null);
  }

  function duplicateSelected() {
    if (!selectedLayer) return;
    const id = selectedLayer.id;
    let newId: string | null = null;
    commit((d) => {
      const result = duplicateLayer(d.layers, id);
      newId = result.newId;
      return { ...d, layers: result.layers };
    });
    if (newId) setSelection(newId);
  }

  function nudgeSelected(dx: number, dy: number) {
    if (!selectedLayer || selectedLayer.locked) return;
    const id = selectedLayer.id;
    commit(
      (d) => ({ ...d, layers: d.layers.map((l) => (l.id === id ? { ...l, x: l.x + dx / width, y: l.y + dy / height } : l)) }),
      `nudge:${id}`,
    );
  }

  async function replaceLayerImage(file: File) {
    if (!selectedLayer || selectedLayer.kind !== "image") return;
    const id = selectedLayer.id;
    try {
      const item = await addMedia(file);
      commit((d) => ({
        ...d,
        layers: updateLayer(d.layers, id, { mediaId: item.id, name: file.name.replace(/\.[^./]+$/, "") || "Image" }),
      }));
    } catch {
      flash(`Couldn't read ${file.name}`);
    }
  }

  function fitImageLayerAspect() {
    if (!selectedLayer || selectedLayer.kind !== "image") return;
    const source = media[selectedLayer.mediaId];
    if (!source) return;
    // Keep the width, derive the height from the image's own proportions.
    const heightFraction = (selectedLayer.width * width) / (source.width / source.height) / height;
    patchSelectedLayer({ height: heightFraction });
  }

  // -------------------------------------------------------------------------------------------
  // Keyboard

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      // Undo/redo apply everywhere, including inside fields: every field is a controlled input
      // whose edits are already in the document history, so the app's undo is the one that works.
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (isEditableTarget(e.target)) {
        if (e.key === "Escape") (e.target as HTMLElement).blur();
        return;
      }
      if (!selectedLayer) {
        if (e.key === "Escape") setSelection(null);
        return;
      }
      if (e.key === "Escape") {
        setSelection(null);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeLayer(selectedLayer.id);
      } else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicateSelected();
      } else if (e.key === "[" || e.key === "]" || e.key === "{" || e.key === "}") {
        e.preventDefault();
        const forward = e.key === "]" || e.key === "}";
        const direction = e.shiftKey || e.key === "{" || e.key === "}" ? (forward ? "top" : "bottom") : forward ? "up" : "down";
        commit((d) => ({ ...d, layers: moveLayer(d.layers, selectedLayer.id, direction) }));
      } else if (e.key.startsWith("Arrow")) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        nudgeSelected(
          e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0,
          e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0,
        );
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  // -------------------------------------------------------------------------------------------
  // Output size

  function applyPresetSize(preset: { id: string; width: number; height: number }) {
    commit((d) => ({ ...d, canvas: { aspectId: preset.id, width: preset.width, height: preset.height } }));
  }

  function setCustomSize(patch: { width?: number; height?: number }, key: string) {
    commit((d) => ({ ...d, canvas: { ...d.canvas, aspectId: "custom", ...patch } }), `canvas:${key}`);
  }

  // Scales the ORIGINAL photo's own (cropped) dimensions — a quick way to upscale or downscale
  // while keeping native proportions, separate from the fixed aspect frames.
  function applyScale(factor: number) {
    if (!photo) return;
    setCustomSize(
      {
        width: Math.max(1, Math.round(photo.width * doc.photo.crop.width * factor)),
        height: Math.max(1, Math.round(photo.height * doc.photo.crop.height * factor)),
      },
      "scale",
    );
  }

  // -------------------------------------------------------------------------------------------
  // Templates

  function applyTemplate(template: ImageTemplate) {
    (async () => {
      // Templates reference shared media by content hash; older ones carried their own copies,
      // which are folded into the shared store (and re-keyed by hash) on the way in.
      const mapping = new Map<string, string>();
      for (const [id, blob] of Object.entries(template.media)) mapping.set(id, (await addMedia(blob)).id);
      const config = mapping.size > 0 ? remapTemplateMedia(template.config, mapping) : template.config;
      await restoreMedia(referencedMediaIds(config));
      commit((d) => applyTemplateConfig(d, freshLayerIds(config)));
      setSelection(null);
      flash(`Applied "${template.name}"`);
    })().catch((err) => {
      console.error("Apply template failed", err);
      flash("Couldn't apply template");
    });
  }

  async function saveCurrentAsTemplate(templateName: string) {
    try {
      const thumbnail = photo ? renderThumbnail(doc, media) : null;
      const saved = buildSavedTemplate(templateName, doc, thumbnail);
      await saveImageTemplate(saved);
      setSavedTemplates((list) => [savedToTemplate(saved), ...list]);
      flash(`Saved template "${templateName}"`);
    } catch (err) {
      console.error("Save template failed", err);
      flash("Couldn't save template");
    }
  }

  /** Saves this project's look as a template (once) and hands it to the batch exporter. */
  async function batchExportWithThisLook() {
    const templateName = `${name.trim() || UNTITLED} look`;
    let template = savedTemplates.find((t) => t.name === templateName) ?? null;
    if (!template) {
      const thumbnail = photo ? renderThumbnail(doc, media) : null;
      const saved = buildSavedTemplate(templateName, doc, thumbnail);
      await saveImageTemplate(saved);
      template = savedToTemplate(saved);
      setSavedTemplates((list) => [template!, ...list]);
    }
    onBatchExport(template.id);
  }

  async function removeTemplate(template: ImageTemplate) {
    if (!window.confirm(`Delete template "${template.name}"?`)) return;
    await deleteImageTemplate(template.id);
    setSavedTemplates((list) => list.filter((t) => t.id !== template.id));
  }

  // -------------------------------------------------------------------------------------------
  // Output

  const { format, quality } = doc.export;
  const exportMatte = effectiveExportMatte(doc, format);
  const flattensTransparency = hasTransparency(doc) && !doc.frame.matte && !FORMAT_INFO[format].alpha;

  // Estimating output size means actually encoding, so it's debounced.
  useEffect(() => {
    if (!photo) {
      setEstimatedBytes(null);
      return;
    }
    let cancelled = false;
    const handle = window.setTimeout(() => {
      exportDocument(doc, media, format, quality)
        .then((blob) => {
          if (!cancelled) setEstimatedBytes(blob.size);
        })
        .catch(() => {
          if (!cancelled) setEstimatedBytes(null);
        });
    }, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [doc, media, photo, format, quality]);

  async function handleDownload() {
    try {
      const blob = await exportDocument(doc, media, format, quality);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.download = `${doc.sourceName}-${width}x${height}.${FORMAT_INFO[format].ext}`;
      link.href = url;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      console.error("Download failed", err);
      flash("Export failed");
    }
  }

  async function handleCopy() {
    try {
      // Clipboards only reliably take PNG; it also keeps transparent corners intact.
      const blob = await exportDocument(doc, media, "png", 1);
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      flash("Copied to clipboard as PNG");
    } catch (err) {
      console.error("Copy to clipboard failed", err);
      flash("Copy failed");
    }
  }

  async function handleSave() {
    try {
      const blob = await exportDocument(doc, media, format, quality);
      await saveImageToGallery({
        id: crypto.randomUUID(),
        name: `${doc.sourceName}-${width}x${height}`,
        blob,
        width,
        height,
        format: FORMAT_INFO[format].ext,
        savedAt: Date.now(),
      });
      flash("Saved — visible on the Dashboard");
    } catch (err) {
      console.error("Save failed", err);
      flash("Save failed");
    }
  }

  function resetEdits() {
    commit((d) => ({
      ...createDefaultDocument(),
      sourceMediaId: d.sourceMediaId,
      sourceName: d.sourceName,
      canvas: d.canvas,
      export: d.export,
      photo: createDefaultPhotoSettings(),
    }));
    setSelection(null);
  }

  function startOver() {
    if (!window.confirm("Start over? This clears the photo, layers and every setting. (You can still undo.)")) return;
    commit(() => createDefaultDocument());
    setSelection(null);
  }

  const showLayerInspector = selectedLayer !== null;
  const beforeDoc = useMemo(() => originalDocument(doc), [doc]);

  return (
    <div className="dashboard ie-root">
      <header className="dashboard-header">
        <button type="button" className="add-title-button" onClick={onBack} title="Back to your image projects">
          ← Projects
        </button>
        <div className="ie-title-group">
          <h1>Image Editor</h1>
          <input
            className="project-title"
            value={name}
            placeholder={UNTITLED}
            size={Math.max(name.length, 10)}
            title="Project name"
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setName((n) => n.trim() || UNTITLED)}
          />
        </div>
        <div className="inline-fields ie-header-actions">
          {status ? (
            <span className="ie-status">{status}</span>
          ) : (
            <span className="ie-save-state" title="Edits are kept in this browser and restored when you come back">
              {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved locally" : ""}
            </span>
          )}
          <button type="button" onClick={undo} disabled={!canUndo} title="Undo (⌘Z)">
            ↶ Undo
          </button>
          <button type="button" onClick={redo} disabled={!canRedo} title="Redo (⇧⌘Z)">
            ↷ Redo
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!photo}
            title="Export and keep a copy in this browser's gallery on the Dashboard"
          >
            Save to gallery
          </button>
          <button type="button" onClick={handleCopy} disabled={!photo}>
            Copy
          </button>
          <button type="button" className="ie-primary" onClick={handleDownload} disabled={!photo}>
            Download
          </button>
        </div>
      </header>

      <div className="ie-body">
        <div className="ie-controls">
          <Section
            title="Source"
            actions={
              <button type="button" className="ie-link-button" onClick={startOver} disabled={!photo && doc.layers.length === 0}>
                Start over
              </button>
            }
          >
            <label className="field">
              <span>Image file</span>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void loadPhotoFile(file);
                  e.target.value = "";
                }}
              />
            </label>
            <p className="hint">You can also drop an image on the preview, or paste one from the clipboard.</p>
            {photo && (
              <p className="hint">
                {doc.sourceName} — {photo.width}×{photo.height}
              </p>
            )}
          </Section>

          <Section title="Layers">
            <LayerPanel
              doc={doc}
              selection={selection}
              onSelect={setSelection}
              onAddText={addText}
              onAddShape={addShape}
              onAddSticker={addSticker}
              onAddImage={(file) => void addImageLayer(file)}
              onToggleVisible={(id) =>
                commit((d) => ({ ...d, layers: updateLayer(d.layers, id, { visible: !d.layers.find((l) => l.id === id)?.visible }) }))
              }
              onToggleLocked={(id) =>
                commit((d) => ({ ...d, layers: updateLayer(d.layers, id, { locked: !d.layers.find((l) => l.id === id)?.locked }) }))
              }
              onReorder={(id, toIndex) => commit((d) => ({ ...d, layers: reorderLayer(d.layers, id, toIndex) }))}
            />
          </Section>

          <Section title="Output size">
            <div className="inline-fields inline-fields-wrap">
              {ASPECT_RATIO_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={doc.canvas.aspectId === preset.id ? "active" : ""}
                  onClick={() => applyPresetSize(preset)}
                >
                  {preset.id}
                </button>
              ))}
              <button
                type="button"
                className={doc.canvas.aspectId === "custom" ? "active" : ""}
                onClick={() => commit((d) => ({ ...d, canvas: { ...d.canvas, aspectId: "custom" } }))}
              >
                Custom
              </button>
            </div>
            <div className="inline-fields">
              <label className="field">
                <span>Width</span>
                <input
                  type="number"
                  min={1}
                  value={width}
                  onChange={(e) => setCustomSize({ width: Math.max(1, Number(e.target.value)) }, "width")}
                />
              </label>
              <label className="field">
                <span>Height</span>
                <input
                  type="number"
                  min={1}
                  value={height}
                  onChange={(e) => setCustomSize({ height: Math.max(1, Number(e.target.value)) }, "height")}
                />
              </label>
            </div>
            <div className="field">
              <span>Scale source</span>
              <div className="inline-fields inline-fields-wrap">
                {SCALE_PRESETS.map((factor) => (
                  <button key={factor} type="button" disabled={!photo} onClick={() => applyScale(factor)}>
                    {Math.round(factor * 100)}%
                  </button>
                ))}
              </div>
            </div>
            {willUpscale && (
              <p className="export-warning">
                Source is ~{Math.round(croppedLongEdge)}px on its long side — {targetLongEdge}px will upscale it and may look soft.
              </p>
            )}
          </Section>

          <Section title="Templates">
            <TemplatesPanel
              builtIn={BUILT_IN_TEMPLATES}
              saved={savedTemplates}
              hasPhoto={photo !== null}
              onApply={applyTemplate}
              onSaveCurrent={(name) => void saveCurrentAsTemplate(name)}
              onDelete={(template) => void removeTemplate(template)}
            />
          </Section>

          <Section title="Export">
            <div className="inline-fields">
              {(Object.keys(FORMAT_INFO) as OutputFormat[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  className={format === id ? "active" : ""}
                  onClick={() => commit((d) => ({ ...d, export: { ...d.export, format: id } }))}
                >
                  {FORMAT_INFO[id].label}
                </button>
              ))}
            </div>
            {FORMAT_INFO[format].lossy && (
              <SliderField
                label="Quality"
                value={quality}
                min={0.1}
                max={1}
                step={0.01}
                onChange={(v) => commit((d) => ({ ...d, export: { ...d.export, quality: v } }), "export:quality")}
                format={(v) => `${Math.round(v * 100)}%`}
              />
            )}
            <p className="hint">
              Output: {width}×{height} {FORMAT_INFO[format].label}
              {estimatedBytes != null && ` · ~${formatBytes(estimatedBytes)}`}
            </p>
            {flattensTransparency && (
              <p className="export-warning">
                JPEG has no transparency: transparent areas will be filled with {exportMatte}. Pick a colour under Frame → "Behind
                {doc.background.mode === "transparent" ? " transparency" : " the corners"}", or export PNG/WebP to keep them transparent.
              </p>
            )}
            <div className="inline-fields inline-fields-wrap">
              <button
                type="button"
                disabled={!photo && doc.layers.length === 0}
                onClick={() => void batchExportWithThisLook()}
                title="Save this look as a template and apply it to a whole folder of photos"
              >
                Batch export with this look…
              </button>
              <button type="button" onClick={resetEdits} disabled={!photo && doc.layers.length === 0}>
                Reset all edits
              </button>
            </div>
          </Section>
        </div>

        <div
          className={`ie-preview${isDragOver ? " drag-over" : ""}${photo ? "" : " empty"}`}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
        >
          {!photo && doc.layers.length === 0 && !ready && <p className="hint">Loading…</p>}
          {!photo && doc.layers.length === 0 && ready && <p className="hint">Choose, drop, or paste an image to start editing.</p>}
          {photo && (
            <div className="ie-preview-toolbar">
              <button type="button" className={compare ? "active" : ""} onClick={() => setCompare((c) => (c ? null : "slider"))}>
                {compare ? "✓ Comparing" : "Compare before / after"}
              </button>
              {compare &&
                COMPARE_MODES.map((m) => (
                  <button key={m.id} type="button" className={compare === m.id ? "active" : ""} onClick={() => setCompare(m.id)}>
                    {m.label}
                  </button>
                ))}
              {compare && (
                <span className="hint">Before = the original photo fitted into the same frame. Editing is paused while comparing.</span>
              )}
            </div>
          )}
          {photo && compare && <CompareStage before={beforeDoc} after={doc} media={media} matte={exportMatte} mode={compare} />}
          {(photo || doc.layers.length > 0) && !compare && (
            <LayerStage
              doc={doc}
              media={media}
              matte={exportMatte}
              canvasRef={stageCanvasRef}
              selection={selection}
              onSelect={setSelection}
              onGestureStart={checkpoint}
              onGestureChange={live}
              onActivate={(id) => {
                setSelection(id);
                window.setTimeout(() => textInputRef.current?.focus(), 0);
              }}
            />
          )}
        </div>

        <div className="ie-controls">
          <div className="ie-context-switch">
            <button
              type="button"
              className={showLayerInspector ? "" : "active"}
              onClick={() => setSelection(photo ? PHOTO_SELECTION : null)}
            >
              Photo
            </button>
            <button type="button" className={showLayerInspector ? "active" : ""} disabled={!selectedLayer}>
              {selectedLayer ? `Layer: ${selectedLayer.name}` : "Layer"}
            </button>
          </div>
          {showLayerInspector && selectedLayer ? (
            <LayerInspector
              key={selectedLayer.id}
              layer={selectedLayer}
              index={selectedIndex}
              count={doc.layers.length}
              canvasWidth={width}
              canvasHeight={height}
              media={media}
              onChange={patchSelectedLayer}
              onMove={(direction) => commit((d) => ({ ...d, layers: moveLayer(d.layers, selectedLayer.id, direction) }))}
              onDuplicate={duplicateSelected}
              onDelete={() => removeLayer(selectedLayer.id)}
              onReplaceImage={(file) => void replaceLayerImage(file)}
              onFitImageAspect={fitImageLayerAspect}
              textInputRef={textInputRef}
            />
          ) : (
            <PhotoPanels
              doc={doc}
              photo={photo}
              background={backgroundImage}
              commit={commit}
              checkpoint={checkpoint}
              live={live}
              onLoadBackgroundImage={(file) => void loadBackgroundFile(file)}
              customRatio={customRatio}
              onCustomRatioChange={setCustomRatio}
            />
          )}
        </div>
      </div>
    </div>
  );
}
