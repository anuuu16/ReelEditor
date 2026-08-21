import { useEffect, useState } from "react";
import { deleteStudioResource, patchStudioResource, studioResourceUrl } from "./api.js";
import { RESOURCE_KINDS } from "./resourceKinds.js";
import type { MetadataVariant, StudioProject, StudioResource, StudioResourceKind } from "./types.js";
import { Button, TextField, TextareaField } from "./ui/index.js";

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
        {resource.language && <span className="rounded bg-ps-elevated px-1.5 py-0.5 text-[11px] text-ps-muted">{resource.language}</span>}
        {resource.sceneN !== null && <span className="rounded bg-ps-elevated px-1.5 py-0.5 text-[11px] text-ps-muted">scene {resource.sceneN}</span>}
        {variants.length > 0 && <span className="rounded bg-ps-elevated px-1.5 py-0.5 text-[11px] text-ps-muted">{variants.length} variant{variants.length === 1 ? "" : "s"}</span>}
      </div>
      <p className="prompt-studio-resource-filename text-xs text-ps-muted">{resource.filename}</p>

      <div className="flex flex-wrap items-center gap-1.5">
        <Button onClick={() => setIsExpanded((v) => !v)}>{isExpanded ? "Hide details" : "Details"}</Button>
        <Button variant="danger" onClick={handleDelete}>
          Delete
        </Button>
      </div>

      {isExpanded && (
        <>
          {variants.map((variant, index) => (
            <div className="prompt-studio-variant" key={index}>
              <div className="mb-3.5 flex flex-wrap gap-3">
                <TextField
                  label="Label"
                  value={variant.label ?? ""}
                  onChange={(value) => updateVariant(index, { label: value })}
                  onBlur={() => flush(variants)}
                  className="min-w-[140px] flex-1"
                />
                <TextField
                  label="Language"
                  value={variant.language ?? ""}
                  onChange={(value) => updateVariant(index, { language: value })}
                  onBlur={() => flush(variants)}
                  className="min-w-[140px] flex-1"
                />
              </div>
              <TextField
                label="Title"
                value={variant.title ?? ""}
                onChange={(value) => updateVariant(index, { title: value })}
                onBlur={() => flush(variants)}
                className="mb-3.5"
              />
              <TextareaField
                label="Description"
                rows={2}
                value={variant.description ?? ""}
                onChange={(value) => updateVariant(index, { description: value })}
                onBlur={() => flush(variants)}
                className="mb-3.5"
              />
              <TextField
                label="Hashtags (comma separated)"
                value={(variant.hashtags ?? []).join(", ")}
                onChange={(value) =>
                  updateVariant(index, {
                    hashtags: value
                      .split(",")
                      .map((h) => h.trim())
                      .filter(Boolean),
                  })
                }
                onBlur={() => flush(variants)}
                className="mb-3.5"
              />
              <Button variant="danger" onClick={() => handleRemoveVariant(index)}>
                Remove variant
              </Button>
            </div>
          ))}

          <Button onClick={handleAddVariant} className="mt-1">
            + Add another variant
          </Button>
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
    return <p className="text-xs text-ps-muted">No resources uploaded yet.</p>;
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
              {section.label} <span className="text-ps-muted">({items.length})</span>
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
