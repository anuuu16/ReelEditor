import { useEffect } from "react";
import type { ProjectModel } from "@reel-studio/shared-types";
import { createInitialProject } from "./state/initialProject.js";
import { formatProjectDate, useProjectBrowser } from "./persistence/useProjectBrowser.js";

interface DashboardProps {
  onOpenProject: (project: ProjectModel) => void;
  onOpenImageEditor: () => void;
}

export function Dashboard({ onOpenProject, onOpenImageEditor }: DashboardProps) {
  const { realProjects, templates, refresh, errorMessage, busyProjectId, openProject, useAsTemplate, deleteProject } = useProjectBrowser();

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      </div>
    </div>
  );
}
