import { useState, type ChangeEvent } from "react";
import { uploadStudioResource } from "./api.js";
import type { StudioProject, StudioResource, StudioResourceKind } from "./types.js";

interface ResourceUploaderProps {
  project: StudioProject;
  onUploaded: (resource: StudioResource) => void;
}

const KIND_OPTIONS: Array<{ id: StudioResourceKind; label: string }> = [
  { id: "cover", label: "Cover image" },
  { id: "logo", label: "Logo" },
  { id: "banner", label: "Banner" },
  { id: "character", label: "Character reference" },
  { id: "sceneVideo", label: "Scene video" },
  { id: "sceneAudio", label: "Scene audio" },
  { id: "finalExport", label: "Final export" },
  { id: "other", label: "Other" },
];

const LANGUAGE_KINDS: StudioResourceKind[] = ["sceneAudio", "finalExport"];
const SCENE_N_KINDS: StudioResourceKind[] = ["sceneVideo", "sceneAudio"];

export function ResourceUploader({ project, onUploaded }: ResourceUploaderProps) {
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<StudioResourceKind>("sceneVideo");
  const [language, setLanguage] = useState(project.languages[0] ?? "");
  const [sceneN, setSceneN] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    setFile(e.target.files?.[0] ?? null);
  }

  async function handleUpload() {
    if (!file) return;
    setIsUploading(true);
    setError(null);
    try {
      const resource = await uploadStudioResource(project.id, file, {
        kind,
        language: LANGUAGE_KINDS.includes(kind) && language ? language : undefined,
        sceneN: SCENE_N_KINDS.includes(kind) && sceneN ? Number(sceneN) : undefined,
      });
      onUploaded(resource);
      setFile(null);
      setSceneN("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="prompt-studio-uploader">
      <div className="inline-fields prompt-studio-header-row">
        <label className="field">
          <span>Kind</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as StudioResourceKind)}>
            {KIND_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        {LANGUAGE_KINDS.includes(kind) && (
          <label className="field">
            <span>Language</span>
            <select value={language} onChange={(e) => setLanguage(e.target.value)}>
              <option value="">(none)</option>
              {project.languages.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        )}

        {SCENE_N_KINDS.includes(kind) && (
          <label className="field">
            <span>Scene number</span>
            <input type="number" min={1} value={sceneN} onChange={(e) => setSceneN(e.target.value)} placeholder="1" />
          </label>
        )}

        <label className="field">
          <span>File</span>
          <input type="file" onChange={handleFileChange} />
        </label>
      </div>

      <button type="button" onClick={handleUpload} disabled={!file || isUploading}>
        {isUploading ? "Uploading..." : "Upload"}
      </button>

      {error && <p className="export-error">{error}</p>}
    </div>
  );
}
