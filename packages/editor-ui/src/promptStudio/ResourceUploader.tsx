import { useState, type DragEvent } from "react";
import { uploadStudioResource } from "./api.js";
import { RESOURCE_KINDS, type ResourceKindConfig } from "./resourceKinds.js";
import type { StudioProject, StudioResource, StudioResourceKind } from "./types.js";

interface ResourceUploaderProps {
  project: StudioProject;
  onUploaded: (resource: StudioResource) => void;
  /** Restricts which kind drop zones render, e.g. a wizard step that only wants "Scene audio". */
  allowedKinds?: StudioResourceKind[];
}

interface PendingFile {
  id: string;
  file: File;
  kind: StudioResourceKind;
  language: string;
  sceneNText: string;
  status: "pending" | "uploading" | "done" | "error";
  error: string | null;
}

// Finds the last run of digits in a filename (ignoring the extension) — "scene_03.mp4",
// "Chanda_mama_scene07_final.wav", and "03.mp3" all resolve to their scene number for free, so
// dropping a batch of already-numbered Flow exports rarely needs any manual scene number entry.
function guessSceneNumber(filename: string): number | null {
  const withoutExt = filename.replace(/\.[^./\\]+$/, "");
  const matches = withoutExt.match(/\d{1,3}/g);
  if (!matches || matches.length === 0) return null;
  const n = Number(matches[matches.length - 1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function ResourceUploader({ project, onUploaded, allowedKinds }: ResourceUploaderProps) {
  // One labeled drop zone per kind, so dropping a file into "Scene videos" already says what it
  // is — no per-file kind dropdown to fill in every time. A wizard step narrows this to just the
  // kinds relevant to that step.
  const KIND_SECTIONS = allowedKinds ? RESOURCE_KINDS.filter((k) => allowedKinds.includes(k.kind)) : RESOURCE_KINDS;
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [dragOverKind, setDragOverKind] = useState<StudioResourceKind | null>(null);
  const [isUploadingAll, setIsUploadingAll] = useState(false);

  function addFiles(kind: StudioResourceKind, section: ResourceKindConfig, files: FileList | File[]) {
    const defaultLanguage = project.languages[0] ?? "";
    const additions: PendingFile[] = Array.from(files).map((file) => ({
      id: crypto.randomUUID(),
      file,
      kind,
      language: section.needsLanguage ? defaultLanguage : "",
      sceneNText: section.needsSceneN ? String(guessSceneNumber(file.name) ?? "") : "",
      status: "pending" as const,
      error: null,
    }));
    setPending((prev) => [...prev, ...additions]);
  }

  function updatePending(id: string, patch: Partial<PendingFile>) {
    setPending((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  function removePending(id: string) {
    setPending((prev) => prev.filter((p) => p.id !== id));
  }

  function handleDrop(section: ResourceKindConfig, e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragOverKind(null);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) addFiles(section.kind, section, e.dataTransfer.files);
  }

  // Dragging a pending row to reorder it renumbers every "Scene #" in that same kind group by its
  // new position — the whole point of letting someone drag instead of typing scene numbers by hand.
  // Groups render sorted by that same number, so the new order is what's visibly shown too.
  function reorderWithinKind(kind: StudioResourceKind, draggedId: string, targetId: string) {
    if (draggedId === targetId) return;
    setPending((prev) => {
      const group = prev.filter((p) => p.kind === kind);
      const fromIndex = group.findIndex((p) => p.id === draggedId);
      const toIndex = group.findIndex((p) => p.id === targetId);
      if (fromIndex === -1 || toIndex === -1) return prev;
      const reordered = [...group];
      const [moved] = reordered.splice(fromIndex, 1);
      reordered.splice(toIndex, 0, moved);
      const renumbered = new Map(reordered.map((p, index) => [p.id, String(index + 1)]));
      return prev.map((p) => (p.kind === kind ? { ...p, sceneNText: renumbered.get(p.id) ?? p.sceneNText } : p));
    });
  }

  async function uploadOne(item: PendingFile) {
    updatePending(item.id, { status: "uploading", error: null });
    try {
      const section = KIND_SECTIONS.find((s) => s.kind === item.kind);
      const sceneN = section?.needsSceneN && item.sceneNText ? Number(item.sceneNText) : undefined;
      const resource = await uploadStudioResource(project.id, item.file, {
        kind: item.kind,
        language: section?.needsLanguage && item.language ? item.language : undefined,
        sceneN,
      });
      onUploaded(resource);
      updatePending(item.id, { status: "done" });
    } catch (err) {
      updatePending(item.id, { status: "error", error: err instanceof Error ? err.message : String(err) });
    }
  }

  async function handleUploadAll() {
    setIsUploadingAll(true);
    const toUpload = pending.filter((p) => p.status === "pending" || p.status === "error");
    for (const item of toUpload) {
      await uploadOne(item);
    }
    setIsUploadingAll(false);
    setPending((prev) => prev.filter((p) => p.status !== "done"));
  }

  const pendingCount = pending.filter((p) => p.status !== "done").length;

  return (
    <div className="prompt-studio-uploader">
      <div className="prompt-studio-dropzone-grid">
        {KIND_SECTIONS.map((section) => {
          const inputId = `prompt-studio-dropzone-${section.kind}`;
          return (
            <div key={section.kind} className="prompt-studio-dropzone-section">
              <label
                htmlFor={inputId}
                className={`prompt-studio-dropzone${dragOverKind === section.kind ? " drag-over" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverKind(section.kind);
                }}
                onDragLeave={() => setDragOverKind(null)}
                onDrop={(e) => handleDrop(section, e)}
              >
                <span className="prompt-studio-dropzone-label">{section.label}</span>
                {section.hint && <span className="hint">{section.hint}</span>}
              </label>
              <input
                id={inputId}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) addFiles(section.kind, section, e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
          );
        })}
      </div>

      {pending.length > 0 && (
        <div className="prompt-studio-pending-list">
          {KIND_SECTIONS.map((section) => {
            const groupItems = pending
              .filter((p) => p.kind === section.kind)
              .sort((a, b) => (section.needsSceneN ? (Number(a.sceneNText) || 0) - (Number(b.sceneNText) || 0) : 0));
            if (groupItems.length === 0) return null;

            return (
              <div className="prompt-studio-pending-group" key={section.kind}>
                <h4 className="prompt-studio-pending-group-title">{section.label}</h4>
                {groupItems.map((item) => (
                  <div
                    className="prompt-studio-pending-row"
                    key={item.id}
                    draggable={section.needsSceneN}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", item.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragOver={(e) => {
                      if (section.needsSceneN) e.preventDefault();
                    }}
                    onDrop={(e) => {
                      if (!section.needsSceneN) return;
                      e.preventDefault();
                      const draggedId = e.dataTransfer.getData("text/plain");
                      reorderWithinKind(section.kind, draggedId, item.id);
                    }}
                  >
                    {section.needsSceneN && <span className="prompt-studio-drag-handle" title="Drag to reorder">⠿</span>}
                    <span className="prompt-studio-pending-name" title={item.file.name}>
                      {item.file.name}
                    </span>

                    {section.needsLanguage && (
                      <select value={item.language} onChange={(e) => updatePending(item.id, { language: e.target.value })}>
                        <option value="">(none)</option>
                        {project.languages.map((l) => (
                          <option key={l} value={l}>
                            {l}
                          </option>
                        ))}
                      </select>
                    )}

                    {section.needsSceneN && (
                      <input
                        type="number"
                        min={1}
                        inputMode="numeric"
                        className="prompt-studio-scene-n-input"
                        value={item.sceneNText}
                        onChange={(e) => updatePending(item.id, { sceneNText: e.target.value })}
                        placeholder="Scene #"
                      />
                    )}

                    <span className="prompt-studio-pending-status">
                      {item.status === "uploading" && "Uploading..."}
                      {item.status === "done" && "Done"}
                      {item.status === "error" && (item.error ?? "Failed")}
                    </span>

                    <button
                      type="button"
                      className="project-delete-button"
                      onClick={() => removePending(item.id)}
                      disabled={item.status === "uploading"}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            );
          })}

          <button type="button" onClick={handleUploadAll} disabled={isUploadingAll || pendingCount === 0}>
            {isUploadingAll ? "Uploading..." : `Upload all (${pendingCount})`}
          </button>
        </div>
      )}
    </div>
  );
}
