import { useState } from "react";
import type { ProjectModel } from "@reel-studio/shared-types";
import { loadProjectFromServer, saveProjectToServer } from "../persistence/projectServer.js";
import { buildEditorProjectForLanguage } from "./buildEditorProject.js";
import { patchStudioProject } from "./api.js";
import type { StudioEditorProjectLink, StudioProject } from "./types.js";

interface LaunchEditorPanelProps {
  project: StudioProject;
  onLinkAdded: (link: StudioEditorProjectLink) => void;
  onOpenProject: (project: ProjectModel) => void;
}

export function LaunchEditorPanel({ project, onLinkAdded, onOpenProject }: LaunchEditorPanelProps) {
  const [busyLanguage, setBusyLanguage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleLaunch(language: string) {
    setBusyLanguage(language);
    setError(null);
    try {
      const editorProject = await buildEditorProjectForLanguage(project, language);
      await saveProjectToServer(editorProject);
      const link: StudioEditorProjectLink = { language, editorProjectId: editorProject.id };
      const updated = await patchStudioProject(project.id, { editorProjects: [...project.editorProjects, link] });
      const savedLink = updated.editorProjects.find((l) => l.language === language) ?? link;
      onLinkAdded(savedLink);
      onOpenProject(editorProject);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyLanguage(null);
    }
  }

  async function handleOpen(link: StudioEditorProjectLink) {
    setBusyLanguage(link.language);
    setError(null);
    try {
      const editorProject = await loadProjectFromServer(link.editorProjectId);
      onOpenProject(editorProject);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyLanguage(null);
    }
  }

  return (
    <section className="prompt-studio-section">
      <h2>Editor projects</h2>
      <p className="hint">One full timeline project per language, built from the shared scene resources above. No media is duplicated.</p>

      {error && <p className="export-error">{error}</p>}

      <ul className="prompt-studio-language-list">
        {project.languages.map((language) => {
          const link = project.editorProjects.find((l) => l.language === language);
          const isBusy = busyLanguage === language;
          return (
            <li key={language} className="prompt-studio-language-row">
              <span className="prompt-studio-language-name">{language}</span>
              {link ? (
                <button type="button" disabled={isBusy} onClick={() => handleOpen(link)}>
                  {isBusy ? "Opening..." : "Open editor"}
                </button>
              ) : (
                <button type="button" disabled={isBusy} onClick={() => handleLaunch(language)}>
                  {isBusy ? "Launching..." : "Launch editor"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
