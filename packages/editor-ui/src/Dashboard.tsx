import { useEffect, useState } from "react";
import type { ProjectModel } from "@reel-studio/shared-types";
import { createInitialProject } from "./state/initialProject.js";
import { formatProjectDate, useProjectBrowser } from "./persistence/useProjectBrowser.js";
import { deleteSavedImage, listSavedImages, type SavedImage } from "./persistence/db.js";

interface DashboardProps {
  onOpenProject: (project: ProjectModel) => void;
  onOpenImageEditor: () => void;
  onOpenPromptStudio: () => void;
}

interface GalleryEntry extends SavedImage {
  url: string;
}

export function Dashboard({ onOpenProject, onOpenImageEditor, onOpenPromptStudio }: DashboardProps) {
  const { realProjects, templates, refresh, errorMessage, busyProjectId, openProject, useAsTemplate, deleteProject } = useProjectBrowser();
  const [savedImages, setSavedImages] = useState<GalleryEntry[]>([]);

  async function refreshImages() {
    const images = await listSavedImages();
    // Object URLs are recreated on each listing; the previous batch is revoked on unmount below.
    setSavedImages(images.map((image) => ({ ...image, url: URL.createObjectURL(image.blob) })));
  }

  useEffect(() => {
    refresh();
    refreshImages().catch((err) => console.error("Failed to load saved images", err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => savedImages.forEach((image) => URL.revokeObjectURL(image.url));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedImages]);

  async function handleDeleteImage(image: GalleryEntry) {
    if (!window.confirm(`Delete "${image.name}"?`)) return;
    await deleteSavedImage(image.id);
    await refreshImages();
  }

  function handleDownloadImage(image: GalleryEntry) {
    const link = document.createElement("a");
    link.href = image.url;
    link.download = `${image.name}.${image.format}`;
    link.click();
  }

  function handleNew() {
    onOpenProject(createInitialProject());
  }

  async function handleOpen(id: string) {
    const project = await openProject(id);
    if (project) onOpenProject(project);
  }

  async function handleUseTemplate(id: string) {
    const project = await useAsTemplate(id);
    if (project) onOpenProject(project);
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>Reel Studio</h1>
        <div className="inline-fields">
          <button type="button" onClick={onOpenImageEditor}>
            Image Editor
          </button>
          <button type="button" onClick={onOpenPromptStudio}>
            Prompt Studio
          </button>
        </div>
      </header>

      <div className="dashboard-body">
        <div className="dashboard-hero">
          <button type="button" className="dashboard-new-project" onClick={handleNew}>
            + New project
          </button>
          <p className="hint">Start a blank reel, open a saved one below, or start from a template.</p>
        </div>

        {errorMessage && <p className="export-error">{errorMessage}</p>}

        <section className="dashboard-section">
          <h2>Recent projects</h2>
          <ul className="project-list">
            {realProjects.length === 0 && <p className="hint">No saved projects yet — start a new one above.</p>}
            {realProjects.map((p) => (
              <li key={p.id} className="project-list-item">
                <div className="project-list-thumb">{p.thumbnailDataUrl && <img src={p.thumbnailDataUrl} alt="" />}</div>
                <div className="project-list-info">
                  <span className="project-list-name">{p.name || "Untitled reel"}</span>
                  <span className="project-list-meta">
                    {p.clipCount} clip{p.clipCount === 1 ? "" : "s"} · {formatProjectDate(p.updatedAt)}
                  </span>
                </div>
                <button type="button" disabled={busyProjectId === p.id} onClick={() => handleOpen(p.id)}>
                  {busyProjectId === p.id ? "Opening…" : "Open"}
                </button>
                <button
                  type="button"
                  className="project-delete-button"
                  disabled={busyProjectId === p.id}
                  onClick={() => deleteProject(p.id, p.name)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="dashboard-section">
          <h2>Templates</h2>
          <p className="hint">Pre-arranged reels with placeholder clips — pick one, then replace each clip's media with your own footage.</p>
          <ul className="project-list">
            {templates.length === 0 && <p className="hint">No saved templates yet — save any project as one from within the editor.</p>}
            {templates.map((p) => (
              <li key={p.id} className="project-list-item">
                <div className="project-list-thumb">{p.thumbnailDataUrl && <img src={p.thumbnailDataUrl} alt="" />}</div>
                <div className="project-list-info">
                  <span className="project-list-name">{p.name || "Untitled template"}</span>
                  <span className="project-list-meta">
                    {p.clipCount} clip{p.clipCount === 1 ? "" : "s"} · {formatProjectDate(p.updatedAt)}
                  </span>
                </div>
                <button type="button" disabled={busyProjectId === p.id} onClick={() => handleUseTemplate(p.id)}>
                  {busyProjectId === p.id ? "Loading…" : "Use template"}
                </button>
                <button
                  type="button"
                  className="project-delete-button"
                  disabled={busyProjectId === p.id}
                  onClick={() => deleteProject(p.id, p.name)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="dashboard-section">
          <h2>Saved images</h2>
          <p className="hint">Images you saved from the Image Editor, kept locally in this browser.</p>
          {savedImages.length === 0 && <p className="hint">Nothing saved yet — use "Save" in the Image Editor.</p>}
          <div className="image-gallery">
            {savedImages.map((image) => (
              <figure key={image.id} className="image-gallery-item">
                <img src={image.url} alt={image.name} />
                <figcaption>
                  <span className="project-list-name">{image.name}</span>
                  <span className="project-list-meta">
                    {image.width}×{image.height} {image.format.toUpperCase()} · {formatProjectDate(image.savedAt)}
                  </span>
                </figcaption>
                <div className="inline-fields">
                  <button type="button" onClick={() => handleDownloadImage(image)}>
                    Download
                  </button>
                  <button type="button" className="project-delete-button" onClick={() => handleDeleteImage(image)}>
                    Delete
                  </button>
                </div>
              </figure>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
