import { useState, type MouseEvent } from "react";
import type { ProjectModel } from "@reel-studio/shared-types";
import { useEditorDispatch, useEditorState } from "../state/EditorContext.js";
import { createInitialProject } from "../state/initialProject.js";
import {
  deleteProjectFromServer,
  listProjectsFromServer,
  loadProjectFromServer,
  saveProjectToServer,
  stripProjectToTemplate,
  type ProjectSummary,
} from "../persistence/projectServer.js";

type Status = "idle" | "saving";

function formatDate(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString();
}

export function ProjectsPanel() {
  const state = useEditorState();
  const dispatch = useEditorDispatch();
  const [isOpen, setIsOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busyProjectId, setBusyProjectId] = useState<string | null>(null);
  const realProjects = projects.filter((p) => !p.isTemplate);
  const templates = projects.filter((p) => p.isTemplate);

  async function refresh() {
    try {
      setProjects(await listProjectsFromServer());
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }

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
    setBusyProjectId(id);
    setErrorMessage(null);
    try {
      const template = await loadProjectFromServer(id);
      const newProject: ProjectModel = {
        ...template,
        id: crypto.randomUUID(),
        metadata: {
          ...template.metadata,
          isTemplate: false,
          templateId: id,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      };
      dispatch({ type: "LOAD_PROJECT", project: newProject });
      setIsOpen(false);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyProjectId(null);
    }
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
    setBusyProjectId(id);
    setErrorMessage(null);
    try {
      const project = await loadProjectFromServer(id);
      dispatch({ type: "LOAD_PROJECT", project });
      setIsOpen(false);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyProjectId(null);
    }
  }

  async function handleDelete(id: string, name: string) {
    const proceed = window.confirm(`Delete "${name || "Untitled reel"}"? This removes its folder and media permanently.`);
    if (!proceed) return;
    setBusyProjectId(id);
    try {
      await deleteProjectFromServer(id);
      await refresh();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyProjectId(null);
    }
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
                  {p.clipCount} clip{p.clipCount === 1 ? "" : "s"} · {formatDate(p.updatedAt)}
                </span>
              </div>
              <button type="button" disabled={busyProjectId === p.id} onClick={() => handleOpen(p.id)}>
                {busyProjectId === p.id ? "Opening…" : "Open"}
              </button>
              <button
                type="button"
                className="project-delete-button"
                disabled={busyProjectId === p.id}
                onClick={() => handleDelete(p.id, p.name)}
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
                  {p.clipCount} clip{p.clipCount === 1 ? "" : "s"} · {formatDate(p.updatedAt)}
                </span>
              </div>
              <button type="button" disabled={busyProjectId === p.id} onClick={() => handleUseTemplate(p.id)}>
                {busyProjectId === p.id ? "Loading…" : "Use template"}
              </button>
              <button
                type="button"
                className="project-delete-button"
                disabled={busyProjectId === p.id}
                onClick={() => handleDelete(p.id, p.name)}
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
