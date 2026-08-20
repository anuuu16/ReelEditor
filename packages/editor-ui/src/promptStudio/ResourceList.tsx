import { useEffect, useState } from "react";
import { deleteStudioResource, patchStudioResource, studioResourceUrl } from "./api.js";
import { RESOURCE_KINDS } from "./resourceKinds.js";
import type { MetadataVariant, StudioProject, StudioResource, StudioResourceKind } from "./types.js";

interface ResourceListProps {
  project: StudioProject;
  onChanged: (resources: StudioResource[]) => void;
  /** Restricts which kind groups render, e.g. a wizard step that only wants "Scene audio". */
  allowedKinds?: StudioResourceKind[];
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
  // Collapsed by default so a resource grid with many uploads doesn't turn into a wall of forms —
  // the title/description/hashtag editor only matters once you actually need it.
  const [isExpanded, setIsExpanded] = useState(false);

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
    setIsExpanded(true);
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
        {resource.language && <span className="prompt-studio-resource-tag">{resource.language}</span>}
        {resource.sceneN !== null && <span className="prompt-studio-resource-tag">scene {resource.sceneN}</span>}
        {variants.length > 0 && <span className="prompt-studio-resource-tag">{variants.length} variant{variants.length === 1 ? "" : "s"}</span>}
      </div>
      <p className="hint prompt-studio-resource-filename">{resource.filename}</p>

      <div className="inline-fields">
        <button type="button" onClick={() => setIsExpanded((v) => !v)}>
          {isExpanded ? "Hide details" : "Details"}
        </button>
        <button type="button" className="project-delete-button" onClick={handleDelete}>
          Delete
        </button>
      </div>

      {isExpanded && (
        <>
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

          <button type="button" onClick={handleAddVariant}>
            + Add another variant
          </button>
        </>
      )}
    </div>
  );
}

export function ResourceList({ project, onChanged, allowedKinds }: ResourceListProps) {
  function handleDeleted(resourceId: string) {
    onChanged(project.resources.filter((r) => r.id !== resourceId));
  }

  function handleUpdated(updated: StudioResource) {
    onChanged(project.resources.map((r) => (r.id === updated.id ? updated : r)));
  }

  const kindSections = allowedKinds ? RESOURCE_KINDS.filter((k) => allowedKinds.includes(k.kind)) : RESOURCE_KINDS;
  const visibleResources = allowedKinds ? project.resources.filter((r) => allowedKinds.includes(r.kind)) : project.resources;

  if (visibleResources.length === 0) {
    return <p className="hint">No resources uploaded yet.</p>;
  }

  return (
    <div className="prompt-studio-resource-groups">
      {kindSections.map((section) => {
        const items = project.resources
          .filter((r) => r.kind === section.kind)
          .sort((a, b) => (section.needsSceneN ? (a.sceneN ?? 0) - (b.sceneN ?? 0) : a.uploadedAt - b.uploadedAt));
        if (items.length === 0) return null;

        return (
          <div key={section.kind} className="prompt-studio-resource-group">
            <h3 className="prompt-studio-resource-group-title">
              {section.label} <span className="prompt-studio-char-count">({items.length})</span>
            </h3>
            <div className="prompt-studio-resource-grid">
              {items.map((resource) => (
                <ResourceCard
                  key={resource.id}
                  studioId={project.id}
                  resource={resource}
                  onDeleted={handleDeleted}
                  onUpdated={handleUpdated}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
