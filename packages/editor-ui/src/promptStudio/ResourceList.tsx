import { useEffect, useState } from "react";
import { deleteStudioResource, patchStudioResource, studioResourceUrl } from "./api.js";
import type { MetadataVariant, StudioProject, StudioResource } from "./types.js";

interface ResourceListProps {
  project: StudioProject;
  onChanged: (resources: StudioResource[]) => void;
}

function ResourcePreview({ studioId, resource }: { studioId: string; resource: StudioResource }) {
  const url = studioResourceUrl(studioId, resource.id);
  if (resource.kind === "cover" || resource.kind === "logo" || resource.kind === "banner" || resource.kind === "character") {
    return <img className="prompt-studio-resource-preview" src={url} alt={resource.filename} />;
  }
  if (resource.kind === "sceneVideo" || resource.kind === "finalExport") {
    return <video className="prompt-studio-resource-preview" src={url} controls />;
  }
  if (resource.kind === "sceneAudio") {
    return <audio src={url} controls />;
  }
  return (
    <a href={url} target="_blank" rel="noreferrer">
      {resource.filename}
    </a>
  );
}

function emptyVariant(): MetadataVariant {
  return { label: "", language: "", title: "", description: "", hashtags: [] };
}

function ResourceCard({
  studioId,
  resource,
  onDeleted,
  onUpdated,
}: {
  studioId: string;
  resource: StudioResource;
  onDeleted: (resourceId: string) => void;
  onUpdated: (resource: StudioResource) => void;
}) {
  const [variants, setVariants] = useState<MetadataVariant[]>(resource.metadata.length ? resource.metadata : []);

  useEffect(() => {
    setVariants(resource.metadata);
  }, [resource.id, resource.metadata]);

  function updateVariant(index: number, patch: Partial<MetadataVariant>) {
    setVariants((prev) => prev.map((v, i) => (i === index ? { ...v, ...patch } : v)));
  }

  async function flush(nextVariants: MetadataVariant[]) {
    const updated = await patchStudioResource(studioId, resource.id, { metadata: nextVariants });
    onUpdated(updated);
  }

  function handleAddVariant() {
    const next = [...variants, emptyVariant()];
    setVariants(next);
    flush(next).catch(() => undefined);
  }

  function handleRemoveVariant(index: number) {
    const next = variants.filter((_, i) => i !== index);
    setVariants(next);
    flush(next).catch(() => undefined);
  }

  async function handleDelete() {
    if (!window.confirm(`Delete "${resource.filename}"?`)) return;
    await deleteStudioResource(studioId, resource.id);
    onDeleted(resource.id);
  }

  return (
    <div className="prompt-studio-resource-card">
      <ResourcePreview studioId={studioId} resource={resource} />
      <div className="prompt-studio-resource-meta">
        <span className="prompt-studio-resource-kind">{resource.kind}</span>
        {resource.language && <span className="prompt-studio-resource-tag">{resource.language}</span>}
        {resource.sceneN !== null && <span className="prompt-studio-resource-tag">scene {resource.sceneN}</span>}
      </div>
      <p className="hint">{resource.filename}</p>

      {variants.map((variant, index) => (
        <div className="prompt-studio-variant" key={index}>
          <div className="inline-fields prompt-studio-header-row">
            <label className="field">
              <span>Label</span>
              <input
                type="text"
                value={variant.label ?? ""}
                onChange={(e) => updateVariant(index, { label: e.target.value })}
                onBlur={() => flush(variants)}
              />
            </label>
            <label className="field">
              <span>Language</span>
              <input
                type="text"
                value={variant.language ?? ""}
                onChange={(e) => updateVariant(index, { language: e.target.value })}
                onBlur={() => flush(variants)}
              />
            </label>
          </div>
          <label className="field">
            <span>Title</span>
            <input
              type="text"
              value={variant.title ?? ""}
              onChange={(e) => updateVariant(index, { title: e.target.value })}
              onBlur={() => flush(variants)}
            />
          </label>
          <label className="field">
            <span>Description</span>
            <textarea
              rows={2}
              value={variant.description ?? ""}
              onChange={(e) => updateVariant(index, { description: e.target.value })}
              onBlur={() => flush(variants)}
            />
          </label>
          <label className="field">
            <span>Hashtags (comma separated)</span>
            <input
              type="text"
              value={(variant.hashtags ?? []).join(", ")}
              onChange={(e) =>
                updateVariant(index, {
                  hashtags: e.target.value
                    .split(",")
                    .map((h) => h.trim())
                    .filter(Boolean),
                })
              }
              onBlur={() => flush(variants)}
            />
          </label>
          <button type="button" className="project-delete-button" onClick={() => handleRemoveVariant(index)}>
            Remove variant
          </button>
        </div>
      ))}

      <div className="inline-fields">
        <button type="button" onClick={handleAddVariant}>
          + Add another variant
        </button>
        <button type="button" className="project-delete-button" onClick={handleDelete}>
          Delete resource
        </button>
      </div>
    </div>
  );
}

export function ResourceList({ project, onChanged }: ResourceListProps) {
  function handleDeleted(resourceId: string) {
    onChanged(project.resources.filter((r) => r.id !== resourceId));
  }

  function handleUpdated(updated: StudioResource) {
    onChanged(project.resources.map((r) => (r.id === updated.id ? updated : r)));
  }

  if (project.resources.length === 0) {
    return <p className="hint">No resources uploaded yet.</p>;
  }

  return (
    <div className="prompt-studio-resource-grid">
      {project.resources.map((resource) => (
        <ResourceCard key={resource.id} studioId={project.id} resource={resource} onDeleted={handleDeleted} onUpdated={handleUpdated} />
      ))}
    </div>
  );
}
