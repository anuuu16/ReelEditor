import { useNavigate, useParams } from "react-router-dom";
import type { ProjectModel } from "@reel-studio/shared-types";
import { PromptStudioView } from "./PromptStudioView.js";

export function PromptStudioRoute() {
  const { studioId, tab } = useParams();
  const navigate = useNavigate();

  if (!studioId) {
    navigate("/", { replace: true });
    return null;
  }

  function handleOpenProject(project: ProjectModel) {
    navigate(`/editor/${project.id}`, { state: { project } });
  }

  return (
    <PromptStudioView
      studioId={studioId}
      activeTab={tab}
      onTabChange={(next) => navigate(`/prompt-studio/${studioId}/${next}`)}
      onBack={() => navigate("/")}
      onOpenProject={handleOpenProject}
    />
  );
}
