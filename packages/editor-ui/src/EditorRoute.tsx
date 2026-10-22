import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import type { ProjectModel } from "@reel-studio/shared-types";
import { Editor } from "./Editor.js";
import { pickFreshestProject } from "./persistence/localSnapshot.js";
import { loadProjectFromServer } from "./persistence/projectServer.js";
import { createInitialProject } from "./state/initialProject.js";

interface NavigationState {
  project?: ProjectModel;
}

// /editor (no id) is a brand new, not-yet-saved project — the object it should open with always
// arrives via router state from whoever navigated here (Dashboard's "+ New project"). /editor/:id
// is an existing saved project — router state is a fast path when we already have it in hand
// (Dashboard's "Open"), but a direct link or a page refresh has no state, so it re-fetches by id.
// Either way the local autosave snapshot gets the last word when it's fresher (see
// localSnapshot.ts): a refresh seconds after an edit must not roll that edit back.
export function EditorRoute() {
  const { projectId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const passedProject = (location.state as NavigationState | null)?.project;

  const [project, setProject] = useState<ProjectModel | null>(null);
  const [isLoading, setIsLoading] = useState(!!projectId);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    setIsLoading(true);
    setError(null);
    (async () => {
      let candidate: ProjectModel | null = passedProject ?? null;
      let loadError: unknown = null;
      if (!candidate) {
        try {
          candidate = await loadProjectFromServer(projectId);
        } catch (err) {
          // Not on the server (yet) — maybe it only ever lived in the local snapshot.
          loadError = err;
        }
      }
      const freshest = await pickFreshestProject(projectId, candidate);
      if (!freshest) throw loadError ?? new Error("Project not found");
      setProject(freshest);
    })()
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
