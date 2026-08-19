import { useState, type MouseEvent } from "react";
import { useEditorDispatch, useEditorState } from "../state/EditorContext.js";
import { createInitialProject } from "../state/initialProject.js";
import { formatProjectDate, useProjectBrowser } from "../persistence/useProjectBrowser.js";
import { saveProjectToServer, stripProjectToTemplate } from "../persistence/projectServer.js";

type Status = "idle" | "saving";

export function ProjectsPanel() {
  const state = useEditorState();
  const dispatch = useEditorDispatch();
  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const { realProjects, templates, refresh, errorMessage, setErrorMessage, busyProjectId, openProject, useAsTemplate, deleteProject } =
    useProjectBrowser();

  function openPanel() {
    setIsOpen(true);
    setErrorMessage(null);
    refresh();
  }

  function stopPropagation(e: MouseEvent) {
    e.stopPropagation();
  }

  async function handleSave() {
    setStatus("saving");
    setErrorMessage(null);
    try {
      await saveProjectToServer(state.project);
      await refresh();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setStatus("idle");
    }
  }

  async function handleSaveAsTemplate() {
    const name = window.prompt("Template name?", state.project.metadata.name || "Untitled template");
    if (!name) return;
    setStatus("saving");
    setErrorMessage(null);
    try {
      await saveProjectToServer(stripProjectToTemplate(state.project, name));
      await refresh();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setStatus("idle");
    }
  }

  async function handleUseTemplate(id: string) {
    const project = await useAsTemplate(id);
    if (!project) return;
    dispatch({ type: "LOAD_PROJECT", project });
    setIsOpen(false);
  }

  function handleNew() {
    const proceed = window.confirm(
      "Start a new project? Save the current one first if you want to keep it in a folder."
    );
    if (!proceed) return;
    dispatch({ type: "LOAD_PROJECT", project: createInitialProject() });
    setIsOpen(false);
  }

  async function handleOpen(id: string) {
    const project = await openProject(id);
    if (!project) return;
    dispatch({ type: "LOAD_PROJECT", project });
    setIsOpen(false);
  }

  if (!isOpen) {
    return (
      <button type="button" className="add-title-button" onClick={openPanel}>
        Projects
      </button>
    );
  }

  return (
    <div className="export-overlay" onClick={() => setIsOpen(false)}>
      <div className="export-panel projects-panel" onClick={stopPropagation}>
        <button type="button" className="export-close" onClick={() => setIsOpen(false)} title="Close">
          ×
        </button>
        <h2>Projects</h2>
        <p className="hint">Saved to ~/ReelStudioProjects — each project is its own folder with all its media.</p>

        <div className="inline-fields inline-fields-wrap">
          <button type="button" onClick={handleNew}>
            New project
          </button>
          <button type="button" onClick={handleSave} disabled={status === "saving"}>
            {status === "saving" ? "Saving…" : "Save this project"}
          </button>
          <button type="button" onClick={handleSaveAsTemplate} disabled={status === "saving"}>
            Save as template
          </button>
        </div>

        {errorMessage && <p className="export-error">{errorMessage}</p>}

        <ul className="project-list">
          {realProjects.length === 0 && <p className="hint">No saved projects yet.</p>}
          {realProjects.map((p) => (
            <li key={p.id} className="project-list-item">
              <div className="project-list-thumb">
                {p.thumbnailDataUrl && <img src={p.thumbnailDataUrl} alt="" />}
              </div>
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

        <h2>Templates</h2>
        <p className="hint">Pre-arranged reels with placeholder clips — pick one, then replace each clip's media with your own footage.</p>

        <ul className="project-list">
          {templates.length === 0 && <p className="hint">No saved templates yet — "Save as template" turns any project into one.</p>}
          {templates.map((p) => (
            <li key={p.id} className="project-list-item">
              <div className="project-list-thumb">
                {p.thumbnailDataUrl && <img src={p.thumbnailDataUrl} alt="" />}
              </div>
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
      </div>
    </div>
  );
}
