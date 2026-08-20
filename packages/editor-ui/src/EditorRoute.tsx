import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import type { ProjectModel } from "@reel-studio/shared-types";
import { Editor } from "./Editor.js";
import { loadProjectFromServer } from "./persistence/projectServer.js";
import { createInitialProject } from "./state/initialProject.js";

interface NavigationState {
  project?: ProjectModel;
}

// /editor (no id) is a brand new, not-yet-saved project — the object it should open with always
// arrives via router state from whoever navigated here (Dashboard's "+ New project"). /editor/:id
// is an existing saved project — router state is a fast path when we already have it in hand
// (Dashboard's "Open"), but a direct link or a page refresh has no state, so it re-fetches by id.
export function EditorRoute() {
  const { projectId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const passedProject = (location.state as NavigationState | null)?.project;

  const [project, setProject] = useState<ProjectModel | null>(passedProject ?? null);
  const [isLoading, setIsLoading] = useState(!passedProject && !!projectId);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (passedProject || !projectId) return;
    setIsLoading(true);
    setError(null);
    loadProjectFromServer(projectId)
      .then(setProject)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setIsLoading(false));
    // Only re-run if the id in the URL actually changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  if (isLoading) {
    return (
      <div className="dashboard">
        <p className="hint">Loading project...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard">
        <p className="export-error">{error}</p>
        <button type="button" onClick={() => navigate("/")}>
          Back to dashboard
        </button>
      </div>
    );
  }

  return <Editor initialProject={project ?? (projectId ? null : createInitialProject())} onBackToDashboard={() => navigate("/")} />;
}
