import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createInitialProject } from "./state/initialProject.js";
import { formatProjectDate, useProjectBrowser } from "./persistence/useProjectBrowser.js";
import {
  deleteSavedAudio,
  deleteSavedImage,
  listSavedAudio,
  listSavedImages,
  type SavedAudio,
  type SavedImage,
} from "./persistence/db.js";
import { createStudioProject, deleteStudioProject, listStudioProjects } from "./promptStudio/api.js";
import type { StudioProjectSummary } from "./promptStudio/types.js";

interface GalleryEntry extends SavedImage {
  url: string;
}

interface AudioGalleryEntry extends SavedAudio {
  url: string;
}

function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatStudioSummaryMeta(s: StudioProjectSummary): string {
  const languages = s.languages.length ? s.languages.join(", ") : "no languages yet";
  return `${languages} · ${s.sceneCount} scene${s.sceneCount === 1 ? "" : "s"} · ${s.resourceCount} resource${s.resourceCount === 1 ? "" : "s"}`;
}

export function Dashboard() {
  const navigate = useNavigate();
  const { realProjects, templates, refresh, errorMessage, busyProjectId, openProject, useAsTemplate, deleteProject } = useProjectBrowser();
  const [savedImages, setSavedImages] = useState<GalleryEntry[]>([]);
  const [savedAudio, setSavedAudio] = useState<AudioGalleryEntry[]>([]);
  const [studioProjects, setStudioProjects] = useState<StudioProjectSummary[]>([]);
  const [studioError, setStudioError] = useState<string | null>(null);
  const [isCreatingStudio, setIsCreatingStudio] = useState(false);

  async function refreshImages() {
    const images = await listSavedImages();
    // Object URLs are recreated on each listing; the previous batch is revoked on unmount below.
    setSavedImages(images.map((image) => ({ ...image, url: URL.createObjectURL(image.blob) })));
  }

  async function refreshAudio() {
    const clips = await listSavedAudio();
    setSavedAudio(clips.map((clip) => ({ ...clip, url: URL.createObjectURL(clip.blob) })));
  }

  function refreshStudioProjects() {
    listStudioProjects()
      .then(setStudioProjects)
      .catch((err) => setStudioError(err instanceof Error ? err.message : String(err)));
  }

  useEffect(() => {
    refresh();
    refreshImages().catch((err) => console.error("Failed to load saved images", err));
    refreshAudio().catch((err) => console.error("Failed to load saved audio", err));
    refreshStudioProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => savedImages.forEach((image) => URL.revokeObjectURL(image.url));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedImages]);

  useEffect(() => {
    return () => savedAudio.forEach((clip) => URL.revokeObjectURL(clip.url));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedAudio]);

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

  async function handleDeleteAudio(clip: AudioGalleryEntry) {
    if (!window.confirm(`Delete "${clip.name}"?`)) return;
    await deleteSavedAudio(clip.id);
    await refreshAudio();
  }

  function handleDownloadAudio(clip: AudioGalleryEntry) {
    const link = document.createElement("a");
    link.href = clip.url;
    link.download = `${clip.name}.${clip.format}`;
    link.click();
  }

  function handleNew() {
    // Route to /editor/:id (not bare /editor) even though nothing has been saved to the server yet —
    // the id already exists (createInitialProject mints one), and putting it in the URL immediately
    // is what lets a page reload re-fetch this exact project once autosave lands, instead of landing
    // back on bare /editor and minting yet another blank project (silently orphaning whatever was
    // just being worked on — confirmed live: two same-second "Untitled reel" folders on disk, one
    // with real clips, one empty, from exactly this sequence).
    const project = createInitialProject();
    navigate(`/editor/${project.id}`, { state: { project } });
  }

  async function handleOpen(id: string) {
    const project = await openProject(id);
    if (project) navigate(`/editor/${project.id}`, { state: { project } });
  }

  async function handleUseTemplate(id: string) {
    const project = await useAsTemplate(id);
    if (project) navigate(`/editor/${project.id}`, { state: { project } });
  }

  async function handleNewStudioProject() {
    setIsCreatingStudio(true);
    setStudioError(null);
    try {
      const created = await createStudioProject({});
      navigate(`/prompt-studio/${created.id}`);
    } catch (err) {
      setStudioError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCreatingStudio(false);
    }
  }

  async function handleDeleteStudioProject(id: string, title: string) {
    if (!window.confirm(`Delete "${title}"? This removes its poem, prompts, and every uploaded resource.`)) return;
    try {
      await deleteStudioProject(id);
      refreshStudioProjects();
    } catch (err) {
      setStudioError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>Reel Studio</h1>
        <div className="inline-fields">
          <button type="button" onClick={() => navigate("/image-editor")}>
            Image Editor
          </button>
          <button type="button" onClick={() => navigate("/audio-editor")}>
            Audio Editor
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
          <div className="dashboard-section-header">
            <h2>Prompt Studio projects</h2>
            <button type="button" onClick={handleNewStudioProject} disabled={isCreatingStudio}>
              {isCreatingStudio ? "Creating..." : "+ New Studio project"}
            </button>
          </div>
          <p className="hint">
            Poems, Flow video prompts, uploaded resources, and language-specific editor projects, all in one place.
          </p>
          {studioError && <p className="export-error">{studioError}</p>}
          <ul className="project-list">
            {studioProjects.length === 0 && <p className="hint">No Studio projects yet — start one above.</p>}
            {studioProjects.map((s) => (
              <li key={s.id} className="project-list-item">
                <div className="project-list-info">
                  <span className="project-list-name">{s.title}</span>
                  <span className="project-list-meta">{formatStudioSummaryMeta(s)}</span>
                </div>
                <button type="button" onClick={() => navigate(`/prompt-studio/${s.id}`)}>
                  Open
                </button>
                <button type="button" className="project-delete-button" onClick={() => handleDeleteStudioProject(s.id, s.title)}>
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

        <section className="dashboard-section">
          <h2>Saved audio</h2>
          <p className="hint">Audio you saved from the Audio Editor, kept locally in this browser.</p>
          {savedAudio.length === 0 && <p className="hint">Nothing saved yet — use "Save" in the Audio Editor.</p>}
          <ul className="project-list">
            {savedAudio.map((clip) => (
              <li key={clip.id} className="project-list-item">
                <div className="project-list-info">
                  <span className="project-list-name">{clip.name}</span>
                  <span className="project-list-meta">
                    {formatDuration(clip.durationSeconds)} {clip.format.toUpperCase()} · {formatProjectDate(clip.savedAt)}
                  </span>
                  <audio controls src={clip.url} preload="none" />
                </div>
                <button type="button" onClick={() => handleDownloadAudio(clip)}>
                  Download
                </button>
                <button type="button" className="project-delete-button" onClick={() => handleDeleteAudio(clip)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
