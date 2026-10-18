import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { listImageTemplates, loadImageMediaBlob, saveImageMediaBlob, saveImageProject, saveImageToGallery } from "../persistence/db.js";
import { SliderField } from "../imageEditor/SliderField.js";
import { CompareStage, COMPARE_MODES, type CompareMode } from "../imageEditor/CompareStage.js";
import { originalDocument, referencedMediaIds, type OutputFormat } from "../imageEditor/document.js";
import { effectiveExportMatte, exportDocument, FORMAT_INFO, type LoadedMedia, type MediaMap } from "../imageEditor/renderImage.js";
import { BUILT_IN_TEMPLATES, remapTemplateMedia, savedToTemplate, type ImageTemplate } from "../imageEditor/templates.js";
import { decodeImageBlob } from "../imageEditor/useImageMedia.js";
import { formatBytes, hashBlob } from "../imageEditor/storage.js";
import { createZip } from "../imageEditor/zip.js";
import {
  baseName,
  buildBatchDocument,
  collectOutputs,
  DEFAULT_NAME_PATTERN,
  runBatch,
  type BatchItem,
  type BatchOptions,
} from "../imageEditor/batch.js";
import { TemplatesPicker } from "./TemplatesPicker.js";

interface Item extends BatchItem {
  previewUrl: string;
  outputUrl?: string;
}

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function BatchExportView() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [saved, setSaved] = useState<ImageTemplate[] | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [options, setOptions] = useState<BatchOptions>({ format: "png", quality: 0.9, namePattern: DEFAULT_NAME_PATTERN });
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [status, setStatus] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showOriginals, setShowOriginals] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState<CompareMode>("slider");
  const [selectedMedia, setSelectedMedia] = useState<MediaMap | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const decodedRef = useRef<Map<string, LoadedMedia>>(new Map());
  const templateMediaRef = useRef<{ id: string; media: MediaMap; mapping: Map<string, string> } | null>(null);

  const templates = useMemo(() => [...BUILT_IN_TEMPLATES, ...(saved ?? [])], [saved]);
  const templateId = params.get("template") ?? BUILT_IN_TEMPLATES[0].id;
  const template = templates.find((t) => t.id === templateId) ?? BUILT_IN_TEMPLATES[0];

  useEffect(() => {
    listImageTemplates()
      .then((list) => setSaved(list.map(savedToTemplate)))
      .catch((err) => {
        console.error("Could not list templates", err);
        setSaved([]);
      });
  }, []);

  useEffect(() => {
    const current = decodedRef;
    return () => {
      for (const item of current.current.values()) if (item.url) URL.revokeObjectURL(item.url);
    };
  }, []);

  const flash = useCallback((message: string) => {
    setStatus(message);
    window.setTimeout(() => setStatus(null), 3000);
  }, []);

  /** The template's own media (a logo, a background image), decoded once per template. */
  const templateMedia = useCallback(async () => {
    if (templateMediaRef.current?.id === template.id) return templateMediaRef.current;
    const media: MediaMap = {};
    const mapping = new Map<string, string>();
    for (const [id, blob] of Object.entries(template.media)) {
      const fresh = await hashBlob(blob);
      mapping.set(id, fresh);
      media[fresh] = await decodeImageBlob(fresh, blob);
    }
    for (const id of referencedMediaIds(template.config)) {
      if (mapping.has(id)) continue;
      const blob = await loadImageMediaBlob(id).catch(() => null);
      if (blob) media[id] = await decodeImageBlob(id, blob);
    }
    templateMediaRef.current = { id: template.id, media, mapping };
    return templateMediaRef.current;
  }, [template]);

  const decodeItem = useCallback(async (item: Item): Promise<LoadedMedia> => {
    const cached = decodedRef.current.get(item.id);
    if (cached) return cached;
    const decoded = await decodeImageBlob(item.id, item.file);
    decodedRef.current.set(item.id, decoded);
    return decoded;
  }, []);

  const documentFor = useCallback(
    async (item: Item) => {
      const [photo, shared] = await Promise.all([decodeItem(item), templateMedia()]);
      const config = shared.mapping.size > 0 ? remapTemplateMedia(template.config, shared.mapping) : template.config;
      return { doc: buildBatchDocument(config, item.id, item.name), media: { ...shared.media, [item.id]: photo } };
    },
    [decodeItem, templateMedia, template],
  );

  // Large before/after for the selected item.
  useEffect(() => {
    const item = items.find((i) => i.id === selectedId);
    if (!item) {
      setSelectedMedia(null);
      return;
    }
    let cancelled = false;
    documentFor(item)
      .then(({ media }) => {
        if (!cancelled) setSelectedMedia(media);
      })
      .catch(() => {
        if (!cancelled) setSelectedMedia(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, items, documentFor]);

  function addFiles(files: File[]) {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;
    setItems((list) => [
      ...list,
      ...images.map((file) => ({
        id: crypto.randomUUID(),
        name: baseName(file.name),
        file,
        status: "pending" as const,
        previewUrl: URL.createObjectURL(file),
      })),
    ]);
  }

  function removeItem(id: string) {
    setItems((list) => {
      const item = list.find((i) => i.id === id);
      if (item) {
        URL.revokeObjectURL(item.previewUrl);
        if (item.outputUrl) URL.revokeObjectURL(item.outputUrl);
      }
      return list.filter((i) => i.id !== id);
    });
    if (selectedId === id) setSelectedId(null);
  }

  function resetOutputs(list: Item[]): Item[] {
    return list.map((item) => {
      if (item.outputUrl) URL.revokeObjectURL(item.outputUrl);
      return { ...item, status: "pending", output: undefined, outputUrl: undefined, error: undefined };
    });
  }

  // Any change to what's being rendered invalidates previous outputs.
  useEffect(() => {
    setItems((list) => (list.some((i) => i.status !== "pending") ? resetOutputs(list) : list));
  }, [template, options.format, options.quality]);

  async function handleRun() {
    if (items.length === 0 || running) return;
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const started = resetOutputs(items);
    setItems(started);
    setProgress({ done: 0, total: started.length });
    try {
      const finished = await runBatch(started, {
        signal: controller.signal,
        render: async (item) => {
          const { doc, media } = await documentFor(item);
          return exportDocument(doc, media, options.format, options.quality);
        },
        onProgress: (list, done, total) => {
          setItems(list.map((item) => (item.output && !item.outputUrl ? { ...item, outputUrl: URL.createObjectURL(item.output) } : item)));
          setProgress({ done, total });
        },
      });
      const failed = finished.filter((i) => i.status === "error").length;
      flash(
        failed
          ? `${finished.length - failed} rendered, ${failed} failed`
          : `Rendered ${finished.length} image${finished.length === 1 ? "" : "s"}`,
      );
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  const outputs = useMemo(() => collectOutputs(items, options, template.name, template.config.canvas), [items, options, template]);
  const totalOutputBytes = outputs.reduce((acc, o) => acc + o.blob.size, 0);

  async function handleDownloadZip() {
    if (outputs.length === 0) return;
    const entries = await Promise.all(outputs.map(async (o) => ({ name: o.name, data: new Uint8Array(await o.blob.arrayBuffer()) })));
    download(new Blob([createZip(entries)], { type: "application/zip" }), `${template.name.replace(/[^\w-]+/g, "_")}-batch.zip`);
  }

  async function handleSaveAll() {
    for (const o of outputs) {
      await saveImageToGallery({
        id: crypto.randomUUID(),
        name: o.name.replace(/\.[^.]+$/, ""),
        blob: o.blob,
        width: template.config.canvas.width,
        height: template.config.canvas.height,
        format: FORMAT_INFO[options.format].ext,
        savedAt: Date.now(),
      });
    }
    flash(`Saved ${outputs.length} to the gallery`);
  }

  /** Turns one batch item into a full project — for the image that needs individual attention. */
  async function handleOpenInEditor(item: Item) {
    const { doc } = await documentFor(item);
    const photoId = await hashBlob(item.file);
    await saveImageMediaBlob(photoId, item.file);
    const shared = await templateMedia();
    for (const [id, loaded] of Object.entries(shared.media)) await saveImageMediaBlob(id, loaded.blob);
    const id = crypto.randomUUID();
    await saveImageProject({
      id,
      name: `${item.name} — ${template.name}`,
      doc: { ...doc, sourceMediaId: photoId },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      thumbnail: null,
    });
    navigate(`/image-editor/${id}`);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
    addFiles(Array.from(e.dataTransfer.files));
  }

  const selected = items.find((i) => i.id === selectedId) ?? null;
  const selectedDoc = useMemo(() => {
    if (!selected || !selectedMedia) return null;
    const shared = templateMediaRef.current;
    const config = shared && shared.mapping.size > 0 ? remapTemplateMedia(template.config, shared.mapping) : template.config;
    return buildBatchDocument(config, selected.id, selected.name);
  }, [selected, selectedMedia, template]);
  const doneCount = items.filter((i) => i.status === "done").length;

  return (
    <>
      <div className="dashboard-hero">
        <p className="hint">
          Pick a look, drop in any number of photos, and every one is rendered with that template at its output size. Download them all as
          one zip, save them to the gallery, or open any single result in the editor for individual tweaks.
        </p>
      </div>

      <section className="dashboard-section">
        <h2>1 · Template</h2>
        {saved === null ? (
          <p className="hint">Loading templates…</p>
        ) : (
          <TemplatesPicker templates={templates} selectedId={template.id} onSelect={(id) => setParams({ template: id })} />
        )}
      </section>

      <section className="dashboard-section">
        <div className="dashboard-section-header">
          <h2>2 · Images{items.length > 0 && ` (${items.length})`}</h2>
          {items.length > 0 && (
            <button type="button" className="project-secondary-button" onClick={() => setShowOriginals((v) => !v)}>
              {showOriginals ? "Showing originals" : "Show originals"}
            </button>
          )}
        </div>
        <div
          className={`batch-dropzone${isDragOver ? " drag-over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
        >
          <label className="batch-file-label">
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => {
                addFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
            <span>Choose images…</span>
          </label>
          <span className="hint">or drop them here — each becomes one export.</span>
        </div>

        {items.length > 0 && (
          <div className="batch-grid">
            {items.map((item, index) => (
              <figure
                key={item.id}
                className={`batch-card batch-${item.status}${selectedId === item.id ? " selected" : ""}`}
                onClick={() => setSelectedId(item.id)}
              >
                <div className="batch-thumb">
                  <img src={showOriginals || !item.outputUrl ? item.previewUrl : item.outputUrl} alt="" />
                  <span className="batch-badge">
                    {item.status === "done" && !showOriginals
                      ? "after"
                      : item.status === "rendering"
                        ? "rendering…"
                        : item.status === "error"
                          ? "failed"
                          : "original"}
                  </span>
                </div>
                <figcaption>
                  <span className="project-list-name" title={item.name}>
                    {index + 1}. {item.name}
                  </span>
                  <span className="project-list-meta">
                    {formatBytes(item.file.size)}
                    {item.output && ` → ${formatBytes(item.output.size)}`}
                    {item.error && ` · ${item.error}`}
                  </span>
                </figcaption>
                <div className="inline-fields">
                  {item.output && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const out = outputs.find((o) => o.blob === item.output);
                        if (out) download(out.blob, out.name);
                      }}
                    >
                      Download
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleOpenInEditor(item);
                    }}
                    title="Create a project from this image with the template applied"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="project-delete-button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeItem(item.id);
                    }}
                  >
                    ✕
                  </button>
                </div>
              </figure>
            ))}
          </div>
        )}

        {selected && selectedDoc && selectedMedia && (
          <div className="batch-compare">
            <div className="ie-preview-toolbar">
              <span className="batch-compare-title">{selected.name}</span>
              {COMPARE_MODES.map((m) => (
                <button key={m.id} type="button" className={compareMode === m.id ? "active" : ""} onClick={() => setCompareMode(m.id)}>
                  {m.label}
                </button>
              ))}
              <button type="button" onClick={() => setSelectedId(null)}>
                Close
              </button>
            </div>
            <div className="batch-compare-stage">
              <CompareStage
                before={originalDocument(selectedDoc)}
                after={selectedDoc}
                media={selectedMedia}
                matte={effectiveExportMatte(selectedDoc, options.format)}
                mode={compareMode}
                beforeLabel="Original"
                afterLabel={template.name}
              />
            </div>
          </div>
        )}
      </section>

      <section className="dashboard-section">
        <h2>3 · Export</h2>
        <div className="batch-options">
          <div className="field">
            <span>Format</span>
            <div className="inline-fields">
              {(Object.keys(FORMAT_INFO) as OutputFormat[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  className={options.format === id ? "active" : ""}
                  onClick={() => setOptions((o) => ({ ...o, format: id }))}
                >
                  {FORMAT_INFO[id].label}
                </button>
              ))}
            </div>
          </div>
          {FORMAT_INFO[options.format].lossy && (
            <SliderField
              label="Quality"
              value={options.quality}
              min={0.1}
              max={1}
              step={0.01}
              onChange={(quality) => setOptions((o) => ({ ...o, quality }))}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          )}
          <label className="field">
            <span>File names — {"{name} {index} {template} {width} {height} {date}"}</span>
            <input type="text" value={options.namePattern} onChange={(e) => setOptions((o) => ({ ...o, namePattern: e.target.value }))} />
          </label>
          <p className="hint">
            Output: {template.config.canvas.width}×{template.config.canvas.height} {FORMAT_INFO[options.format].label}
            {outputs.length > 0 && ` · ${outputs.length} file${outputs.length === 1 ? "" : "s"}, ${formatBytes(totalOutputBytes)}`}
            {outputs[0] && ` · e.g. ${outputs[0].name}`}
          </p>
        </div>

        <div className="inline-fields batch-actions">
          {!running ? (
            <button type="button" className="dashboard-new-project" disabled={items.length === 0} onClick={handleRun}>
              {doneCount === items.length && items.length > 0
                ? "Render again"
                : `Render ${items.length || ""} image${items.length === 1 ? "" : "s"}`}
            </button>
          ) : (
            <button type="button" className="dashboard-new-project" onClick={() => abortRef.current?.abort()}>
              Stop ({progress.done}/{progress.total})
            </button>
          )}
          <button type="button" disabled={outputs.length === 0 || running} onClick={handleDownloadZip}>
            Download all (.zip)
          </button>
          <button type="button" disabled={outputs.length === 0 || running} onClick={handleSaveAll}>
            Save all to gallery
          </button>
          {status && <span className="ie-status">{status}</span>}
        </div>
        {running && (
          <div className="storage-bar batch-progress">
            <div className="storage-bar-fill" style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
          </div>
        )}
      </section>
    </>
  );
}
